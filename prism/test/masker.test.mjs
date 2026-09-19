import test from "node:test";
import assert from "node:assert/strict";
import { decisionsToDetections, maskText } from "../src/masker.mjs";
import { segmentText } from "../src/segmenter.mjs";
import { loadTaxonomy } from "../src/taxonomy.mjs";

test("adjacent name tokens merge and masks apply from right to left", async () => {
  const taxonomy = await loadTaxonomy();
  const text = "John Smith emailed john@example.com.";
  const units = segmentText(text);
  const decisions = new Map([
    [
      0,
      decision(0, "IDENTITY", "PERSON_NAME", 0.98),
    ],
    [
      1,
      decision(1, "IDENTITY", "PERSON_NAME", 0.97),
    ],
    [
      3,
      decision(3, "IDENTITY", "EMAIL", 1),
    ],
  ]);
  const detections = decisionsToDetections(text, units, decisions, taxonomy);
  assert.deepEqual(
    detections.map(({ start, end, subtype }) => ({
      value: text.slice(start, end),
      subtype,
    })),
    [
      { value: "John Smith", subtype: "PERSON_NAME" },
      { value: "john@example.com", subtype: "EMAIL" },
    ],
  );
  assert.equal(
    maskText(text, detections, taxonomy),
    "[PERSON_NAME] emailed [EMAIL].",
  );
});

function decision(unitIndex, category, subtype, score) {
  return {
    unit_index: unitIndex,
    category,
    subtype,
    path_score: score,
    category_probability: score,
    subtype_probability: score,
    uncertain: false,
    action: "MASK",
  };
}

