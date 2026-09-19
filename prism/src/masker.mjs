const MERGEABLE_SUBTYPES = new Set([
  "PERSON_NAME",
  "PHONE",
  "ADDRESS",
  "DATE_OF_BIRTH",
  "PASSWORD",
  "PRIVATE_KEY",
  "SSH_PRIVATE_KEY",
  "DATABASE_CREDENTIAL",
  "CONNECTION_STRING",
  "CREDIT_CARD",
  "BANK_ACCOUNT",
  "DIAGNOSIS",
  "MEDICATION",
  "PROCEDURE",
  "MEDICAL_HISTORY",
  "SENSITIVE",
]);

const MERGEABLE_GAP = /^[\s,()\-./]+$/u;

export function decisionsToDetections(text, units, decisions, taxonomy) {
  const unitByIndex = new Map(units.map((unit) => [unit.index, unit]));
  const atomic = [...decisions.values()]
    .filter((decision) => decision.action === "MASK")
    .map((decision) => {
      const unit = unitByIndex.get(decision.unit_index);
      if (!unit) throw new Error(`Missing unit ${decision.unit_index}`);
      return {
        start: unit.start,
        end: unit.end,
        start_unit: unit.index,
        end_unit: unit.index,
        category: decision.category,
        subtype: decision.subtype,
        path_score: decision.path_score,
        category_probability: decision.category_probability,
        subtype_probability: decision.subtype_probability,
        uncertain: decision.uncertain,
        action: "MASK",
      };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged = [];
  for (const current of atomic) {
    const previous = merged.at(-1);
    const gap = previous ? text.slice(previous.end, current.start) : "";
    const canMerge =
      previous &&
      previous.category === current.category &&
      previous.subtype === current.subtype &&
      current.start_unit === previous.end_unit + 1 &&
      MERGEABLE_SUBTYPES.has(current.subtype) &&
      gap.length <= 20 &&
      MERGEABLE_GAP.test(gap);

    if (!canMerge) {
      merged.push({ ...current });
      continue;
    }

    previous.end = current.end;
    previous.end_unit = current.end_unit;
    previous.path_score = Math.min(previous.path_score, current.path_score);
    previous.category_probability = Math.min(
      previous.category_probability,
      current.category_probability,
    );
    previous.subtype_probability = Math.min(
      previous.subtype_probability,
      current.subtype_probability,
    );
    previous.uncertain ||= current.uncertain;
  }

  return resolveOverlaps(merged, taxonomy);
}

export function maskText(text, detections, taxonomy) {
  const format = taxonomy.masking?.placeholder_format ?? "[{subtype}]";
  const uncertain = taxonomy.masking?.uncertain_placeholder ?? "[SENSITIVE]";
  let masked = text;
  for (const detection of [...detections].sort((a, b) => b.start - a.start)) {
    const placeholder = detection.uncertain
      ? uncertain
      : format.replaceAll("{category}", detection.category).replaceAll(
          "{subtype}",
          detection.subtype,
        );
    masked = `${masked.slice(0, detection.start)}${placeholder}${masked.slice(detection.end)}`;
  }
  return masked;
}

function resolveOverlaps(detections, taxonomy) {
  const rank = new Map(
    (taxonomy.category_precedence ?? []).map((category, index) => [
      category,
      index,
    ]),
  );
  const sorted = [...detections].sort((a, b) => {
    const rankDifference =
      (rank.get(a.category) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.category) ?? Number.MAX_SAFE_INTEGER);
    if (rankDifference !== 0) return rankDifference;
    if (b.path_score !== a.path_score) return b.path_score - a.path_score;
    return b.end - b.start - (a.end - a.start);
  });

  const accepted = [];
  for (const detection of sorted) {
    if (
      accepted.some(
        (other) => detection.start < other.end && other.start < detection.end,
      )
    ) {
      continue;
    }
    accepted.push(detection);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

