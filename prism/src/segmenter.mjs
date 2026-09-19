const LEADING_TRIM = /^["'“”‘’]+/u;
const TRAILING_TRIM = /["'“”‘’.,;!?]+$/u;

export function segmentText(text) {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  const units = [];
  const matcher = /\S+/gu;
  let match;
  while ((match = matcher.exec(text)) !== null) {
    const raw = match[0];
    const leading = raw.match(LEADING_TRIM)?.[0].length ?? 0;
    const withoutLeading = raw.slice(leading);
    const trailing = withoutLeading.match(TRAILING_TRIM)?.[0].length ?? 0;
    const value = withoutLeading.slice(
      0,
      trailing === 0 ? undefined : -trailing,
    );
    if (!value) continue;
    const start = match.index + leading;
    units.push({
      id: `u${units.length}`,
      index: units.length,
      text: value,
      start,
      end: start + value.length,
    });
  }
  return units;
}

export function createWindows(
  text,
  units,
  { windowSize = 64, overlap = 12 } = {},
) {
  if (!Number.isInteger(windowSize) || windowSize < 1) {
    throw new RangeError("windowSize must be a positive integer");
  }
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= windowSize) {
    throw new RangeError("overlap must be >= 0 and smaller than windowSize");
  }
  if (units.length === 0) return [];

  const windows = [];
  const step = windowSize - overlap;
  for (let startIndex = 0; startIndex < units.length; startIndex += step) {
    const slice = units.slice(startIndex, startIndex + windowSize);
    const first = slice[0];
    const last = slice.at(-1);
    windows.push({
      id: `w${windows.length}`,
      units: slice,
      text: text.slice(first.start, last.end),
      start: first.start,
      end: last.end,
    });
    if (startIndex + windowSize >= units.length) break;
  }
  return windows;
}

