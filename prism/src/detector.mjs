import { createWindows, segmentText } from "./segmenter.mjs";
import {
  buildBoundaryRequest,
  buildCategoryRequest,
  buildSpeculativeRequest,
  buildSubtypeRequest,
} from "./questions.mjs";
import { decisionsToDetections, maskText } from "./masker.mjs";

const DEFAULT_CONFIG = Object.freeze({
  profile: "economy",
  windowSize: 48,
  overlap: 8,
  windowConcurrency: 3,
  noneAcceptProbability: 0.9,
  minValuePresence: 0.55,
  minStrongCategoryProbability: 0.55,
  minWeakValuePresence: 0.25,
  minCorroboratingCategoryProbability: 0.4,
  minUncertainCategoryProbability: 0.6,
  minLeafPathScore: 0.5,
  minHighRiskPathScore: 0.4,
  strictUncertaintyMasking: true,
  boundaryRefinement: true,
  boundaryRadius: 4,
  minBoundaryProbability: 0.35,
});

const HIGH_RISK_CATEGORIES = new Set(["CREDENTIAL", "FINANCIAL"]);
const REFINABLE_SUBTYPES = new Set([
  "ADDRESS",
  "DIAGNOSIS",
  "MEDICATION",
  "PROCEDURE",
  "MEDICAL_HISTORY",
  "DEVICE_ID",
  "IMEI",
]);
const HEALTH_PHRASE_SUBTYPES = new Set([
  "DIAGNOSIS",
  "MEDICATION",
  "PROCEDURE",
  "MEDICAL_HISTORY",
]);

export class PrismDetector {
  constructor({ client, taxonomy, config = {} }) {
    if (!client) throw new Error("PrismDetector requires a Jev client");
    if (!taxonomy) throw new Error("PrismDetector requires a taxonomy");
    this.client = client;
    this.taxonomy = taxonomy;
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (!new Set(["economy", "latency"]).has(this.config.profile)) {
      throw new Error(`Unknown profile: ${this.config.profile}`);
    }
  }

  async detect(text) {
    if (typeof text !== "string") throw new TypeError("text must be a string");
    if (text.length === 0) {
      return this.#emptyResult(text);
    }
    const started = performance.now();
    const units = segmentText(text);
    const windows = createWindows(text, units, {
      windowSize: this.config.windowSize,
      overlap: this.config.overlap,
    });
    const windowResults = await mapLimit(
      windows,
      this.config.windowConcurrency,
      (window) => this.#classifyWindow(window),
    );

    const decisions = reconcileWindowDecisions(windowResults);
    const detections = decisionsToDetections(
      text,
      units,
      decisions,
      this.taxonomy,
    );
    const usage = sumUsage(windowResults);
    return {
      masked_text: maskText(text, detections, this.taxonomy),
      detections: detections.map(stripInternalFields),
      taxonomy_version: this.taxonomy.version,
      model: windowResults.find((result) => result.model)?.model ?? this.client.model,
      meta: {
        profile: this.config.profile,
        units: units.length,
        windows: windows.length,
        api_calls: usage.api_calls,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        attempts: usage.attempts,
        latency_ms: Math.round(performance.now() - started),
      },
    };
  }

  #emptyResult(text) {
    return {
      masked_text: text,
      detections: [],
      taxonomy_version: this.taxonomy.version,
      model: this.client.model,
      meta: {
        profile: this.config.profile,
        units: 0,
        windows: 0,
        api_calls: 0,
        input_tokens: 0,
        output_tokens: 0,
        attempts: 0,
        latency_ms: 0,
      },
    };
  }

  async #classifyWindow(window) {
    return this.config.profile === "latency"
      ? this.#classifyWindowSpeculatively(window)
      : this.#classifyWindowEconomically(window);
  }

  async #classifyWindowEconomically(window) {
    const categoryRequest = buildCategoryRequest(window, this.taxonomy);
    const categoryResponse = await this.client.evaluate(categoryRequest);
    const routed = routeUnits(
      window,
      categoryResponse.answers,
      this.taxonomy,
      this.config,
    );
    if (routed.length === 0) {
      return {
        decisions: new Map(),
        model: categoryResponse.model,
        responses: [categoryResponse],
      };
    }

    const subtypeRequest = buildSubtypeRequest(window, routed, this.taxonomy);
    const subtypeResponse = await this.client.evaluate(subtypeRequest);
    const preliminary = finalizeDecisions(
      routed,
      subtypeResponse.answers,
      this.taxonomy,
      this.config,
    );
    if (!this.config.boundaryRefinement) {
      return {
        decisions: preliminary,
        model: subtypeResponse.model ?? categoryResponse.model,
        responses: [categoryResponse, subtypeResponse],
      };
    }

    const groups = createBoundaryGroups(preliminary);
    if (groups.length === 0) {
      return {
        decisions: preliminary,
        model: subtypeResponse.model ?? categoryResponse.model,
        responses: [categoryResponse, subtypeResponse],
      };
    }

    const boundaryRequest = buildBoundaryRequest(
      window,
      groups,
      this.taxonomy,
      { radius: this.config.boundaryRadius },
    );
    const boundaryResponse = await this.client.evaluate({
      state: boundaryRequest.state,
      questions: boundaryRequest.questions,
    });
    return {
      decisions: applyBoundaryAnswers(
        preliminary,
        groups,
        boundaryRequest.optionMaps,
        boundaryResponse.answers,
        this.config,
      ),
      model:
        boundaryResponse.model ?? subtypeResponse.model ?? categoryResponse.model,
      responses: [categoryResponse, subtypeResponse, boundaryResponse],
    };
  }

  async #classifyWindowSpeculatively(window) {
    const request = buildSpeculativeRequest(window, this.taxonomy);
    const response = await this.client.evaluate(request);
    const routed = routeUnits(
      window,
      response.answers,
      this.taxonomy,
      this.config,
    );
    return {
      decisions: finalizeDecisions(
        routed,
        response.answers,
        this.taxonomy,
        this.config,
      ),
      model: response.model,
      responses: [response],
    };
  }
}

function routeUnits(window, answers, taxonomy, config) {
  const none = taxonomy.none_label;
  const routed = [];
  for (const unit of window.units) {
    const valueAnswer = answers[`val_${unit.index}`];
    if (!valueAnswer || valueAnswer.type !== "noul") {
      throw new Error(`Missing value-membership Noul answer for unit ${unit.index}`);
    }
    const answer = answers[`cat_${unit.index}`];
    if (!answer || answer.type !== "choice") {
      throw new Error(`Missing Choice answer for unit ${unit.index}`);
    }
    const probabilities = answer.probabilities ?? {};
    const noneProbability = probabilities[none] ?? 0;
    const strongestSensitiveCategory = bestSensitiveCategory(
      probabilities,
      taxonomy,
    );
    const strongestSensitiveProbability =
      probabilities[strongestSensitiveCategory] ?? 0;
    const categoryIndependentlySupportsValue =
      answer.choice !== none &&
      (probabilities[answer.choice] ?? 0) >= config.minStrongCategoryProbability;
    const twoJudgmentsCorroborateValue =
      valueAnswer.noul >= config.minWeakValuePresence &&
      strongestSensitiveProbability >=
        config.minCorroboratingCategoryProbability;
    if (
      valueAnswer.noul < config.minValuePresence &&
      !categoryIndependentlySupportsValue &&
      !twoJudgmentsCorroborateValue
    ) {
      continue;
    }
    let category = answer.choice;
    if (category === none) {
      if (noneProbability >= config.noneAcceptProbability) continue;
      category = strongestSensitiveCategory;
      if (!category) continue;
    }
    if (!taxonomy.categories[category]) {
      throw new Error(`Jev returned unknown category ${category}`);
    }
    routed.push({
      unit,
      category,
      category_probability: probabilities[category] ?? 0,
      category_confidence: answer.confidence ?? 0,
      category_probabilities: probabilities,
      category_was_none:
        answer.choice === none && !twoJudgmentsCorroborateValue,
      value_probability: valueAnswer.noul,
    });
  }
  return routed;
}

function bestSensitiveCategory(probabilities, taxonomy) {
  return Object.keys(taxonomy.categories).sort(
    (a, b) => (probabilities[b] ?? 0) - (probabilities[a] ?? 0),
  )[0];
}

function finalizeDecisions(routed, answers, taxonomy, config) {
  const decisions = new Map();
  for (const route of routed) {
    const id = `sub_${route.unit.index}_${route.category}`;
    const answer = answers[id];
    if (!answer || answer.type !== "choice") {
      throw new Error(`Missing subtype Choice answer ${id}`);
    }
    const subtype = answer.choice;
    if (!Object.hasOwn(taxonomy.categories[route.category].subtypes, subtype)) {
      throw new Error(`Jev returned unknown subtype ${subtype} for ${route.category}`);
    }
    const subtypeProbability = answer.probabilities?.[subtype] ?? 0;
    const pathScore = geometricMean(
      route.category_probability,
      subtypeProbability,
    );
    const minimum = HIGH_RISK_CATEGORIES.has(route.category)
      ? config.minHighRiskPathScore
      : config.minLeafPathScore;
    const uncertain = pathScore < minimum || route.category_was_none;
    if (
      uncertain &&
      route.category_probability < config.minUncertainCategoryProbability
    ) {
      continue;
    }
    if (uncertain && !config.strictUncertaintyMasking) continue;

    decisions.set(route.unit.index, {
      unit_index: route.unit.index,
      category: route.category,
      subtype: uncertain ? "SENSITIVE" : subtype,
      path_score: pathScore,
      category_probability: route.category_probability,
      subtype_probability: subtypeProbability,
      uncertain,
      action: "MASK",
    });
  }
  return decisions;
}

function geometricMean(left, right) {
  if (left <= 0 || right <= 0) return 0;
  return Math.sqrt(left * right);
}

function createBoundaryGroups(decisions) {
  const candidates = [...decisions.values()]
    .filter(
      (decision) =>
        !decision.uncertain && REFINABLE_SUBTYPES.has(decision.subtype),
    )
    .sort((left, right) => left.unit_index - right.unit_index);
  const groups = [];

  for (const decision of candidates) {
    const previous = groups.at(-1);
    const lastDecision = previous?.decisions.at(-1);
    const maximumGap = HEALTH_PHRASE_SUBTYPES.has(decision.subtype) ? 3 : 1;
    const joinsPrevious =
      previous &&
      previous.category === decision.category &&
      previous.subtype === decision.subtype &&
      decision.unit_index - lastDecision.unit_index <= maximumGap;
    if (joinsPrevious) {
      previous.decisions.push(decision);
    } else {
      groups.push({
        category: decision.category,
        subtype: decision.subtype,
        decisions: [decision],
      });
    }
  }
  return groups;
}

function applyBoundaryAnswers(
  preliminary,
  groups,
  optionMaps,
  answers,
  config,
) {
  const refined = new Map(preliminary);
  groups.forEach((group, groupIndex) => {
    const startQuestionId = `bound_start_${groupIndex}`;
    const endQuestionId = `bound_end_${groupIndex}`;
    const subtypeQuestionId = `bound_type_${groupIndex}`;
    const startAnswer = requireBoundaryAnswer(answers, startQuestionId);
    const endAnswer = requireBoundaryAnswer(answers, endQuestionId);
    const subtypeAnswer = requireBoundaryAnswer(answers, subtypeQuestionId);
    const startIndex = resolveBoundaryOption(
      optionMaps,
      startQuestionId,
      startAnswer.choice,
    );
    const endIndex = resolveBoundaryOption(
      optionMaps,
      endQuestionId,
      endAnswer.choice,
    );
    const subtype = resolveBoundaryOption(
      optionMaps,
      subtypeQuestionId,
      subtypeAnswer.choice,
    );
    const probabilities = [
      startAnswer.probabilities?.[startAnswer.choice] ?? 0,
      endAnswer.probabilities?.[endAnswer.choice] ?? 0,
      subtypeAnswer.probabilities?.[subtypeAnswer.choice] ?? 0,
    ];
    if (
      startIndex > endIndex ||
      probabilities.some(
        (probability) => probability < config.minBoundaryProbability,
      )
    ) {
      return;
    }

    const anchor = [...group.decisions].sort(
      (left, right) => right.path_score - left.path_score,
    )[0];
    for (const member of group.decisions) {
      refined.delete(member.unit_index);
    }
    for (
      let unitIndex = startIndex;
      unitIndex <= endIndex;
      unitIndex += 1
    ) {
      refined.set(unitIndex, {
        unit_index: unitIndex,
        category: group.category,
        subtype,
        path_score: geometricMean(anchor.path_score, geometricMean(...probabilities.slice(0, 2))),
        category_probability: anchor.category_probability,
        subtype_probability: probabilities[2],
        uncertain: false,
        action: "MASK",
      });
    }
  });
  return refined;
}

function requireBoundaryAnswer(answers, questionId) {
  const answer = answers[questionId];
  if (!answer || answer.type !== "choice") {
    throw new Error(`Missing boundary Choice answer ${questionId}`);
  }
  return answer;
}

function resolveBoundaryOption(optionMaps, questionId, choice) {
  const options = optionMaps.get(questionId);
  if (!options?.has(choice)) {
    throw new Error(`Unknown boundary option ${choice} for ${questionId}`);
  }
  return options.get(choice);
}

function reconcileWindowDecisions(windowResults) {
  const decisions = new Map();
  for (const result of windowResults) {
    for (const [unitIndex, decision] of result.decisions) {
      const previous = decisions.get(unitIndex);
      if (!previous || decision.path_score > previous.path_score) {
        decisions.set(unitIndex, decision);
      }
    }
  }
  return decisions;
}

function sumUsage(windowResults) {
  const total = {
    api_calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    attempts: 0,
  };
  for (const result of windowResults) {
    for (const response of result.responses) {
      total.api_calls += 1;
      total.input_tokens += response.usage?.input_tokens ?? 0;
      total.output_tokens += response.usage?.output_tokens ?? 0;
      total.attempts += response.attempts ?? 1;
    }
  }
  return total;
}

function stripInternalFields(detection) {
  const {
    start_unit: _startUnit,
    end_unit: _endUnit,
    ...publicDetection
  } = detection;
  return publicDetection;
}

async function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
