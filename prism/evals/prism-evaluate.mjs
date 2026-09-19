#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRuntime } from "../src/runtime.mjs";
import { categoryForSubtype } from "../src/taxonomy.mjs";

const args = parseArgs(process.argv.slice(2));
const datasetPath = resolve(args.dataset ?? "prism/evals/prism-50.json");
const profile = args.profile ?? "economy";
const concurrency = positiveInteger(args.concurrency ?? "4", "concurrency");
const limit = args.limit
  ? positiveInteger(args.limit, "limit")
  : Number.POSITIVE_INFINITY;
const repeats = positiveInteger(args.repeats ?? "1", "repeats");
const outputPath = resolve(
  args.output ?? `prism/evals/results/prism-50-${profile}-latest.json`,
);

const allCases = JSON.parse(await readFile(datasetPath, "utf8"));
const selectedIds = args.ids
  ? new Set(args.ids.split(",").map((id) => id.trim()).filter(Boolean))
  : null;
const dataset = (selectedIds
  ? allCases.filter((item) => selectedIds.has(item.id))
  : allCases
).slice(0, limit);
if (selectedIds) {
  const foundIds = new Set(dataset.map((item) => item.id));
  const missingIds = [...selectedIds].filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    throw new Error(`Unknown or excluded case IDs: ${missingIds.join(", ")}`);
  }
}
const { detector, taxonomy, client } = await createRuntime({ profile });
const jobs = [];
for (const item of dataset) {
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    jobs.push({ item, repeat });
  }
}

let completed = 0;
const startedAt = new Date();
const wallStarted = performance.now();
const runs = await mapLimit(jobs, concurrency, async ({ item, repeat }) => {
  let run;
  try {
    const expected = resolveExpectedSpans(item, taxonomy);
    const result = await detector.detect(item.text);
    run = scoreCase(item, repeat, expected, result, taxonomy);
  } catch (error) {
    run = {
      id: item.id,
      repeat,
      error: error?.message ?? String(error),
      strict: { tp: 0, fp: 0, fn: item.expected.length },
      relaxed: { tp: 0, fp: 0, fn: item.expected.length },
      expected_count: item.expected.length,
      predicted_count: 0,
    };
  }
  completed += 1;
  process.stderr.write(
    `[${completed}/${jobs.length}] ${item.id}${repeats > 1 ? ` #${repeat + 1}` : ""}${run.error ? " ERROR" : ""}\n`,
  );
  return run;
});

const report = buildReport({
  runs,
  dataset,
  repeats,
  profile,
  model: client.model,
  taxonomy,
  datasetPath,
  startedAt,
  wallMs: Math.round(performance.now() - wallStarted),
});
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
const markdownPath = outputPath.replace(/\.json$/u, ".md");
await writeFile(markdownPath, renderMarkdown(report));

process.stdout.write(`${renderConsole(report)}\n`);
process.stdout.write(`JSON: ${outputPath}\nMarkdown: ${markdownPath}\n`);
if (report.summary.errors > 0) process.exitCode = 1;

function scoreCase(item, repeat, expected, result, taxonomy) {
  const predicted = result.detections.map((detection) => ({
    start: detection.start,
    end: detection.end,
    subtype: detection.subtype,
    category: detection.category,
    score: detection.path_score,
  }));
  const strict = matchSpans(expected, predicted, (gold, prediction) =>
    gold.start === prediction.start &&
    gold.end === prediction.end &&
    gold.subtype === prediction.subtype,
  );
  const relaxed = matchSpans(expected, predicted, (gold, prediction) =>
    gold.subtype === prediction.subtype &&
    gold.start < prediction.end &&
    prediction.start < gold.end,
  );
  return {
    id: item.id,
    repeat,
    expected_count: expected.length,
    predicted_count: predicted.length,
    strict: summarizeMatch(strict),
    relaxed: summarizeMatch(relaxed),
    masking_exact: result.masked_text === expectedMaskedText(item.text, expected, taxonomy),
    false_negatives: strict.unmatchedGold.map(publicSpan),
    false_positives: strict.unmatchedPredicted.map(publicSpan),
    expected: expected.map(publicSpan),
    predicted: predicted.map(publicSpan),
    meta: result.meta,
  };
}

function resolveExpectedSpans(item, taxonomy) {
  return item.expected.map((expected) => {
    const occurrences = allOccurrences(item.text, expected.value);
    const occurrence = expected.occurrence ?? 0;
    const start = occurrences[occurrence];
    if (start === undefined) {
      throw new Error(`${item.id}: expected value is absent: ${expected.value}`);
    }
    const category = categoryForSubtype(taxonomy, expected.subtype);
    if (!category) throw new Error(`${item.id}: unknown subtype ${expected.subtype}`);
    return {
      start,
      end: start + expected.value.length,
      subtype: expected.subtype,
      category,
    };
  });
}

function matchSpans(gold, predicted, predicate) {
  const used = new Set();
  const matchedGold = [];
  const unmatchedGold = [];
  for (const goldSpan of gold) {
    const index = predicted.findIndex(
      (prediction, predictionIndex) =>
        !used.has(predictionIndex) && predicate(goldSpan, prediction),
    );
    if (index < 0) unmatchedGold.push(goldSpan);
    else {
      used.add(index);
      matchedGold.push(goldSpan);
    }
  }
  return {
    matchedGold,
    unmatchedGold,
    unmatchedPredicted: predicted.filter((_, index) => !used.has(index)),
  };
}

function summarizeMatch(match) {
  return {
    tp: match.matchedGold.length,
    fp: match.unmatchedPredicted.length,
    fn: match.unmatchedGold.length,
  };
}

function buildReport({
  runs,
  dataset,
  repeats,
  profile,
  model,
  taxonomy,
  datasetPath,
  startedAt,
  wallMs,
}) {
  const validRuns = runs.filter((run) => !run.error);
  const strict = aggregateCounts(runs.map((run) => run.strict));
  const relaxed = aggregateCounts(runs.map((run) => run.relaxed));
  const latencies = validRuns.map((run) => run.meta.latency_ms).sort((a, b) => a - b);
  const inputTokens = sum(validRuns.map((run) => run.meta.input_tokens));
  const outputTokens = sum(validRuns.map((run) => run.meta.output_tokens));
  const apiCalls = sum(validRuns.map((run) => run.meta.api_calls));
  const perSubtype = buildPerSubtype(runs);
  const casePasses = validRuns.filter(
    (run) => run.strict.fp === 0 && run.strict.fn === 0,
  ).length;

  return {
    generated_at: new Date().toISOString(),
    started_at: startedAt.toISOString(),
    dataset: datasetPath,
    cases: dataset.length,
    repeats,
    runs: runs.length,
    profile,
    model,
    taxonomy_version: taxonomy.version,
    wall_ms: wallMs,
    summary: {
      errors: runs.filter((run) => run.error).length,
      exact_case_passes: casePasses,
      exact_case_accuracy: divide(casePasses, runs.length),
      strict: withMetrics(strict),
      relaxed: withMetrics(relaxed),
      masking_exact_rate: divide(
        validRuns.filter((run) => run.masking_exact).length,
        validRuns.length,
      ),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      api_calls: apiCalls,
      estimated_cost_usd: (inputTokens * 0.042) / 1_000_000,
      latency_ms: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99),
        mean: latencies.length ? sum(latencies) / latencies.length : null,
      },
    },
    per_subtype: perSubtype,
    failures: runs.filter(
      (run) => run.error || run.strict.fp > 0 || run.strict.fn > 0,
    ),
    runs_detail: runs,
  };
}

function buildPerSubtype(runs) {
  const metrics = new Map();
  const ensure = (subtype) => {
    if (!metrics.has(subtype)) metrics.set(subtype, { tp: 0, fp: 0, fn: 0 });
    return metrics.get(subtype);
  };
  for (const run of runs) {
    for (const expected of run.expected ?? []) ensure(expected.subtype).fn += 1;
    const match = matchSpans(
      run.expected ?? [],
      run.predicted ?? [],
      (gold, prediction) =>
        gold.start === prediction.start &&
        gold.end === prediction.end &&
        gold.subtype === prediction.subtype,
    );
    for (const matched of match.matchedGold) {
      const item = ensure(matched.subtype);
      item.tp += 1;
      item.fn -= 1;
    }
    for (const falsePositive of match.unmatchedPredicted) {
      ensure(falsePositive.subtype).fp += 1;
    }
  }
  return Object.fromEntries(
    [...metrics.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([subtype, counts]) => [subtype, withMetrics(counts)]),
  );
}

function renderConsole(report) {
  const summary = report.summary;
  return [
    `PRISM Jev evaluation: ${report.cases} cases x ${report.repeats}`,
    `Profile/model: ${report.profile} / ${report.model}`,
    `Strict P/R/F1: ${percent(summary.strict.precision)} / ${percent(summary.strict.recall)} / ${percent(summary.strict.f1)}`,
    `Relaxed P/R/F1: ${percent(summary.relaxed.precision)} / ${percent(summary.relaxed.recall)} / ${percent(summary.relaxed.f1)}`,
    `Exact cases: ${summary.exact_case_passes}/${report.runs}`,
    `Masking exact: ${percent(summary.masking_exact_rate)}`,
    `Errors: ${summary.errors}`,
    `Latency p50/p95/p99: ${summary.latency_ms.p50} / ${summary.latency_ms.p95} / ${summary.latency_ms.p99} ms`,
    `Input tokens / API calls / estimated cost: ${summary.input_tokens} / ${summary.api_calls} / $${summary.estimated_cost_usd.toFixed(6)}`,
  ].join("\n");
}

function renderMarkdown(report) {
  const summary = report.summary;
  const failed = report.failures.map((failure) =>
    `| ${failure.id} | ${failure.error ?? "span mismatch"} | ${failure.strict.fp} | ${failure.strict.fn} |`,
  );
  return `# PRISM Jev Evaluation\n\n` +
    `Generated: ${report.generated_at}\n\n` +
    `- Cases: ${report.cases}\n` +
    `- Repeats: ${report.repeats}\n` +
    `- Profile: ${report.profile}\n` +
    `- Model: ${report.model}\n` +
    `- Strict precision / recall / F1: ${percent(summary.strict.precision)} / ${percent(summary.strict.recall)} / ${percent(summary.strict.f1)}\n` +
    `- Relaxed precision / recall / F1: ${percent(summary.relaxed.precision)} / ${percent(summary.relaxed.recall)} / ${percent(summary.relaxed.f1)}\n` +
    `- Exact case passes: ${summary.exact_case_passes}/${report.runs}\n` +
    `- Exact masking rate: ${percent(summary.masking_exact_rate)}\n` +
    `- API errors: ${summary.errors}\n` +
    `- Input tokens: ${summary.input_tokens}\n` +
    `- API calls: ${summary.api_calls}\n` +
    `- Estimated cost: $${summary.estimated_cost_usd.toFixed(6)}\n` +
    `- Latency p50 / p95 / p99: ${summary.latency_ms.p50} / ${summary.latency_ms.p95} / ${summary.latency_ms.p99} ms\n\n` +
    `## Failures\n\n` +
    (failed.length
      ? `| Case | Reason | FP | FN |\n| --- | --- | ---: | ---: |\n${failed.join("\n")}\n`
      : `No failures.\n`);
}

function expectedMaskedText(text, expected, taxonomy) {
  let masked = text;
  const format = taxonomy.masking.placeholder_format;
  for (const span of [...expected].sort((a, b) => b.start - a.start)) {
    masked = `${masked.slice(0, span.start)}${format.replace("{subtype}", span.subtype)}${masked.slice(span.end)}`;
  }
  return masked;
}

function publicSpan({ start, end, subtype, category, score }) {
  return { start, end, subtype, category, ...(score === undefined ? {} : { score }) };
}

function aggregateCounts(items) {
  return items.reduce(
    (total, item) => ({
      tp: total.tp + item.tp,
      fp: total.fp + item.fp,
      fn: total.fn + item.fn,
    }),
    { tp: 0, fp: 0, fn: 0 },
  );
}

function withMetrics(counts) {
  const precision = divide(counts.tp, counts.tp + counts.fp);
  const recall = divide(counts.tp, counts.tp + counts.fn);
  return {
    ...counts,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  };
}

function allOccurrences(text, value) {
  const positions = [];
  let cursor = 0;
  while (cursor <= text.length) {
    const index = text.indexOf(value, cursor);
    if (index < 0) break;
    positions.push(index);
    cursor = index + Math.max(1, value.length);
  }
  return positions;
}

function percentile(sorted, quantile) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function divide(numerator, denominator) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

async function mapLimit(items, concurrencyLimit, mapper) {
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
  await Promise.all(
    Array.from(
      { length: Math.min(concurrencyLimit, Math.max(1, items.length)) },
      () => worker(),
    ),
  );
  return results;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${key} requires a value`);
    }
    parsed[key.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
