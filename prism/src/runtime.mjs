import { PrismDetector } from "./detector.mjs";
import { loadDotEnv, requireJevApiKey } from "./env.mjs";
import { JevClient } from "./jev-client.mjs";
import { loadTaxonomy } from "./taxonomy.mjs";

export async function createRuntime({ profile = "economy", config = {} } = {}) {
  loadDotEnv();
  const taxonomy = await loadTaxonomy();
  const client = new JevClient({
    apiKey: requireJevApiKey(),
    endpoint:
      process.env.JEV_ENDPOINT ?? "https://api.typesafe.ai/v1/systemone",
    model: process.env.JEV_MODEL ?? "jev-1.13.0",
    timeoutMs: integerEnv("JEV_TIMEOUT_MS", 45_000),
    maxRetries: integerEnv("JEV_MAX_RETRIES", 3),
  });
  const detector = new PrismDetector({
    client,
    taxonomy,
    config: { profile, ...config },
  });
  return { taxonomy, client, detector };
}

function integerEnv(name, fallback) {
  if (!(name in process.env)) return fallback;
  const value = Number.parseInt(process.env[name], 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

