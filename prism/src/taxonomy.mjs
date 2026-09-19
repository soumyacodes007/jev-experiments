import { readFile } from "node:fs/promises";

const DEFAULT_TAXONOMY_URL = new URL(
  "../config/prism-taxonomy.json",
  import.meta.url,
);

export async function loadTaxonomy(url = DEFAULT_TAXONOMY_URL) {
  const taxonomy = JSON.parse(await readFile(url, "utf8"));
  validateTaxonomy(taxonomy);
  return taxonomy;
}

export function validateTaxonomy(taxonomy) {
  if (!taxonomy || typeof taxonomy !== "object") {
    throw new TypeError("Taxonomy must be an object.");
  }
  if (!taxonomy.version || !taxonomy.categories || !taxonomy.none_label) {
    throw new Error("Taxonomy requires version, categories, and none_label.");
  }

  const categories = Object.keys(taxonomy.categories);
  if (categories.length === 0) throw new Error("Taxonomy has no categories.");
  const subtypeOwners = new Map();

  for (const category of categories) {
    const entry = taxonomy.categories[category];
    if (!entry.description || !entry.subtypes) {
      throw new Error(`Category ${category} requires description and subtypes.`);
    }
    for (const [subtype, description] of Object.entries(entry.subtypes)) {
      if (!description) throw new Error(`Subtype ${subtype} has no description.`);
      if (subtypeOwners.has(subtype)) {
        throw new Error(
          `Subtype ${subtype} appears in ${subtypeOwners.get(subtype)} and ${category}.`,
        );
      }
      subtypeOwners.set(subtype, category);
    }
  }

  for (const category of taxonomy.category_precedence ?? []) {
    if (!taxonomy.categories[category]) {
      throw new Error(`Unknown precedence category: ${category}`);
    }
  }
  return taxonomy;
}

export function categoryForSubtype(taxonomy, subtype) {
  for (const [category, entry] of Object.entries(taxonomy.categories)) {
    if (Object.hasOwn(entry.subtypes, subtype)) return category;
  }
  return undefined;
}

export function allSubtypeLabels(taxonomy) {
  return Object.values(taxonomy.categories).flatMap((entry) =>
    Object.keys(entry.subtypes),
  );
}

