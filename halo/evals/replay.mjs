/**
 * Replay a decision log against the CURRENT policy.
 *
 * This is how shadow-mode production traffic turns into tuning signal. The
 * decision log persists raw Jev signals per event (src/logstore.js), so a
 * policy/threshold change can be re-scored over real history WITHOUT any new Jev
 * calls -- the payoff of keeping the model layer and the policy layer separate.
 *
 * Two modes:
 *   node evals/replay.mjs logs/decisions.jsonl
 *       Re-run decide() over the logged signals with the current thresholds and
 *       report how the verdict distribution shifts vs. what was logged. Free.
 *
 *   node evals/replay.mjs logs/decisions.jsonl --events
 *       If the log lines carry raw events (a labeled corpus you built by hand or
 *       by annotating shadow traffic), re-classify from scratch through Jev.
 *
 * When you have labeled real traffic, add a `label` field per line
 * ("SAFE"/"UNSAFE") and this prints real-traffic FPR and recall -- the number
 * that actually gates flipping HALO from shadow to enforce.
 */

import { readFileSync } from "node:fs";
import { decide } from "../src/policy.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: node evals/replay.mjs <decisions.jsonl> [--events]");
  process.exit(1);
}

const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
const records = lines.map((l) => JSON.parse(l));

// Reconstruct a Jev-answers shape from logged signals + choices, so decide()
// can be re-run offline.
function answersFrom(record) {
  const a = {};
  for (const [k, v] of Object.entries(record.signals ?? {})) a[k] = { type: "noul", noul: v };
  for (const [k, v] of Object.entries(record.choices ?? {})) {
    // choices are logged as {choice, confidence} objects (src/classify.js), but
    // tolerate the "choice/conf" string form too.
    if (v && typeof v === "object") {
      a[k] = { type: "choice", choice: v.choice, confidence: Number(v.confidence) };
    } else {
      const [choice, confidence] = String(v).split("/");
      a[k] = { type: "choice", choice, confidence: Number(confidence) };
    }
  }
  return a;
}

let changed = 0;
let labeled = 0;
let fp = 0;
let fn = 0;
let benign = 0;
let attack = 0;
const shift = {};

for (const r of records) {
  const answers = answersFrom(r);
  // Deterministic detector output isn't fully reconstructable from the log, so
  // pass what we persisted; policy tolerates missing derived fields.
  const now = decide(answers, {});
  const before = r.safety;
  if (now.safety !== before) {
    changed++;
    const key = `${before}→${now.safety}`;
    shift[key] = (shift[key] ?? 0) + 1;
  }
  if (r.label) {
    labeled++;
    if (r.label === "SAFE") {
      benign++;
      if (now.safety === "UNSAFE") fp++;
    } else if (r.label === "UNSAFE") {
      attack++;
      if (now.safety !== "UNSAFE") fn++;
    }
  }
}

const line = "─".repeat(60);
console.log(`\n${line}\nREPLAY  ${file}\n${line}`);
console.log(`records                ${records.length}`);
console.log(`verdict changed vs log ${changed}`);
if (changed) for (const [k, v] of Object.entries(shift)) console.log(`   ${k.padEnd(18)} ${v}`);

if (labeled) {
  console.log(`\nLABELED real-traffic scoring (${labeled} labeled):`);
  console.log(`   benign=${benign}  attack=${attack}`);
  console.log(`   FPR    ${benign ? ((fp / benign) * 100).toFixed(2) : "0.00"}%   (${fp} false positives)`);
  console.log(`   recall ${attack ? (((attack - fn) / attack) * 100).toFixed(2) : "0.00"}%   (${fn} missed)`);
  console.log(`\n   ^ THIS is the number that gates shadow→enforce. Target: FPR ≤ 2%, recall ≥ 98%.`);
} else {
  console.log(`\n(no 'label' fields found — add labels to real traffic to compute FPR/recall)`);
}
console.log(line);
