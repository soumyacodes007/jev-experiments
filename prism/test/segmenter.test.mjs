import test from "node:test";
import assert from "node:assert/strict";
import { createWindows, segmentText } from "../src/segmenter.mjs";

test("segmenter preserves exact offsets and excludes sentence punctuation", () => {
  const text = 'Email "john@example.com," then call (415) 555-0199.';
  const units = segmentText(text);
  assert.deepEqual(
    units.map(({ text: value }) => value),
    ["Email", "john@example.com", "then", "call", "(415)", "555-0199"],
  );
  for (const unit of units) {
    assert.equal(text.slice(unit.start, unit.end), unit.text);
  }
});

test("windowing overlaps while preserving global unit indexes", () => {
  const text = "one two three four five six";
  const units = segmentText(text);
  const windows = createWindows(text, units, { windowSize: 4, overlap: 1 });
  assert.equal(windows.length, 2);
  assert.deepEqual(
    windows.map((window) => window.units.map((unit) => unit.index)),
    [
      [0, 1, 2, 3],
      [3, 4, 5],
    ],
  );
});

test("segmenter trims Unicode quotation marks without shifting offsets", () => {
  const text = "Send to “jane@example.com” now";
  const units = segmentText(text);
  assert.equal(units[2].text, "jane@example.com");
  assert.equal(text.slice(units[2].start, units[2].end), units[2].text);
});
