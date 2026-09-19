import test from "node:test";
import assert from "node:assert/strict";
import {
  allSubtypeLabels,
  categoryForSubtype,
  loadTaxonomy,
} from "../src/taxonomy.mjs";

test("PRISM taxonomy contains 40 unique subtypes", async () => {
  const taxonomy = await loadTaxonomy();
  const labels = allSubtypeLabels(taxonomy);
  assert.equal(labels.length, 40);
  assert.equal(new Set(labels).size, 40);
  assert.equal(categoryForSubtype(taxonomy, "API_KEY"), "CREDENTIAL");
  assert.equal(categoryForSubtype(taxonomy, "EMAIL"), "IDENTITY");
  assert.equal(categoryForSubtype(taxonomy, "URL"), "DIGITAL");
});

