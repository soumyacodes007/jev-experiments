import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBoundaryRequest,
  buildCategoryRequest,
  buildSpeculativeRequest,
  buildSubtypeRequest,
} from "../src/questions.mjs";
import { createWindows, segmentText } from "../src/segmenter.mjs";
import { loadTaxonomy } from "../src/taxonomy.mjs";

test("question builders target explicit state paths", async () => {
  const taxonomy = await loadTaxonomy();
  const text = "John used sk_live_test_123";
  const window = createWindows(text, segmentText(text))[0];
  const category = buildCategoryRequest(window, taxonomy);
  assert.equal(Object.keys(category.questions).length, 6);
  assert.match(
    category.questions.cat_0.instructions.question,
    /`units\[0\]\.text`/u,
  );

  const subtype = buildSubtypeRequest(
    window,
    [{ unit: window.units[2], category: "CREDENTIAL" }],
    taxonomy,
  );
  assert.deepEqual(
    Object.keys(subtype.questions.sub_2_CREDENTIAL.criteria).sort(),
    Object.keys(taxonomy.categories.CREDENTIAL.subtypes).sort(),
  );

  const speculative = buildSpeculativeRequest(window, taxonomy);
  assert.equal(
    Object.keys(speculative.questions).length,
    window.units.length * (2 + Object.keys(taxonomy.categories).length),
  );
});

test("boundary builder offers bounded exact-span and subtype choices", async () => {
  const taxonomy = await loadTaxonomy();
  const text = "Ship to 42 Lake View Road, Pune tomorrow";
  const window = createWindows(text, segmentText(text))[0];
  const groups = [{
    category: "IDENTITY",
    subtype: "ADDRESS",
    decisions: [{ unit_index: 2, path_score: 0.9 }],
  }];
  const request = buildBoundaryRequest(window, groups, taxonomy, { radius: 4 });
  const startOptions = request.optionMaps.get("bound_start_0");
  const endOptions = request.optionMaps.get("bound_end_0");

  assert.equal(Object.keys(request.questions).length, 3);
  assert.equal(
    [...startOptions.values()].includes(2),
    true,
  );
  assert.equal(
    [...endOptions.values()].includes(6),
    true,
  );
  assert.equal(
    request.optionMaps.get("bound_type_0").get("ADDRESS"),
    "ADDRESS",
  );
});
