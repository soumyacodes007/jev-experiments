import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { allSubtypeLabels, loadTaxonomy } from "../src/taxonomy.mjs";

test("the synthetic evaluation corpus has 50 valid cases and covers all subtypes", async () => {
  const taxonomy = await loadTaxonomy();
  const dataset = JSON.parse(
    await readFile(new URL("../evals/prism-50.json", import.meta.url), "utf8"),
  );
  assert.equal(dataset.length, 50);
  assert.equal(new Set(dataset.map((item) => item.id)).size, 50);

  const covered = new Set();
  for (const item of dataset) {
    assert.equal(typeof item.text, "string");
    assert.equal(Array.isArray(item.expected), true);
    for (const expected of item.expected) {
      covered.add(expected.subtype);
      const positions = allOccurrences(item.text, expected.value);
      assert.ok(
        positions.length > (expected.occurrence ?? 0),
        `${item.id} is missing expected value ${expected.value}`,
      );
    }
  }
  assert.deepEqual(
    [...covered].sort(),
    allSubtypeLabels(taxonomy).sort(),
  );
});

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

