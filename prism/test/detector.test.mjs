import test from "node:test";
import assert from "node:assert/strict";
import { PrismDetector } from "../src/detector.mjs";
import { loadTaxonomy } from "../src/taxonomy.mjs";

const LABELS = new Map([
  ["John", ["IDENTITY", "PERSON_NAME"]],
  ["Smith", ["IDENTITY", "PERSON_NAME"]],
  ["john@example.com", ["IDENTITY", "EMAIL"]],
  ["sk_live_test_123", ["CREDENTIAL", "API_KEY"]],
]);

test("economy profile performs hierarchy and masks exact spans", async () => {
  const taxonomy = await loadTaxonomy();
  const client = new FakeJevClient(taxonomy);
  const detector = new PrismDetector({
    client,
    taxonomy,
    config: { boundaryRefinement: false },
  });
  const result = await detector.detect(
    "Contact John Smith at john@example.com using sk_live_test_123.",
  );
  assert.equal(
    result.masked_text,
    "Contact [PERSON_NAME] at [EMAIL] using [API_KEY].",
  );
  assert.deepEqual(
    result.detections.map((detection) => detection.subtype),
    ["PERSON_NAME", "EMAIL", "API_KEY"],
  );
  assert.equal(result.meta.api_calls, 2);
  assert.equal(result.meta.profile, "economy");
});

test("latency profile uses one speculative API call", async () => {
  const taxonomy = await loadTaxonomy();
  const client = new FakeJevClient(taxonomy);
  const detector = new PrismDetector({
    client,
    taxonomy,
    config: { profile: "latency" },
  });
  const result = await detector.detect("John used sk_live_test_123.");
  assert.equal(result.masked_text, "[PERSON_NAME] used [API_KEY].");
  assert.equal(result.meta.api_calls, 1);
});

class FakeJevClient {
  constructor(taxonomy) {
    this.taxonomy = taxonomy;
    this.model = "fake-jev";
  }

  async evaluate({ state, questions }) {
    const answers = {};
    for (const [id, question] of Object.entries(questions)) {
      if (id.startsWith("val_")) {
        const localIndex = findLocalIndex(question.instructions.question);
        const text = state.units[localIndex].text;
        answers[id] = {
          type: "noul",
          noul: text === "sk_live_test_123" ? 0.2 : LABELS.has(text) ? 1 : 0,
        };
      } else if (id.startsWith("cat_")) {
        const unitIndex = Number(id.split("_")[1]);
        const localIndex = findLocalIndex(question.instructions.question);
        const text = state.units[localIndex].text;
        const [category = "NONE"] = LABELS.get(text) ?? [];
        const options = Object.keys(question.criteria);
        answers[id] = choiceAnswer(category, options);
        assert.equal(unitIndex >= 0, true);
      } else if (id.startsWith("sub_")) {
        const [, unitIndexText, category] = id.split("_");
        const unitIndex = Number(unitIndexText);
        const instructionText =
          question.instructions.question ?? question.instructions.premise;
        const localIndex = findLocalIndex(instructionText);
        const text = state.routed_units
          ? state.routed_units[localIndex].text
          : state.units[localIndex].text;
        const expected = LABELS.get(text);
        const subtype = expected?.[0] === category
          ? expected[1]
          : Object.keys(question.criteria)[0];
        answers[id] = choiceAnswer(subtype, Object.keys(question.criteria));
      }
    }
    return {
      model: this.model,
      answers,
      usage: { input_tokens: 100, output_tokens: 10 },
      latency_ms: 1,
      attempts: 1,
    };
  }
}

function findLocalIndex(question) {
  return Number(question.match(/units\[(\d+)\]/u)[1]);
}

function choiceAnswer(choice, options) {
  return {
    type: "choice",
    choice,
    confidence: 1,
    probabilities: Object.fromEntries(
      options.map((option) => [option, option === choice ? 1 : 0]),
    ),
  };
}
