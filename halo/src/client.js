/**
 * Jev API client.
 *
 * Zero dependencies -- a security layer should not carry a supply chain.
 *
 * Failure policy: this client never silently degrades. It throws a typed error
 * and lets the caller decide, because "fail open" on a classification layer is
 * the same as having no classification layer, and that decision belongs to
 * policy, not to a transport.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export class JevError extends Error {
  /** @param {string} message @param {{kind: string, status?: number, retryable: boolean, cause?: unknown}} opts */
  constructor(message, opts) {
    super(message);
    this.name = "JevError";
    this.kind = opts.kind;
    this.status = opts.status;
    this.retryable = opts.retryable;
    this.cause = opts.cause;
  }
}

const DEFAULTS = {
  endpoint: "https://api.typesafe.ai/v1/systemone",
  model: "jev-latest",
  timeoutMs: 4000,
  maxRetries: 2,
  baseBackoffMs: 150,
};

/**
 * Loads the API key. Both official SDKs read TYPESAFE_API_KEY; this repo's .env
 * uses JEV_API_KEY, so accept either, env first.
 */
export function loadApiKey({ envPath = ".env" } = {}) {
  const fromEnv = process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY;
  if (fromEnv) return fromEnv;
  try {
    const text = readFileSync(resolve(envPath), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      if (k === "JEV_API_KEY" || k === "TYPESAFE_API_KEY") {
        return line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* fall through */
  }
  throw new JevError("no API key: set JEV_API_KEY or TYPESAFE_API_KEY", {
    kind: "config",
    retryable: false,
  });
}

export class JevClient {
  /** @param {Partial<typeof DEFAULTS> & {apiKey?: string}} [opts] */
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts };
    this.apiKey = opts.apiKey ?? loadApiKey();
    /** @type {{calls: number, retries: number, failures: number, inputTokens: number, latencies: number[]}} */
    this.stats = { calls: 0, retries: 0, failures: 0, inputTokens: 0, latencies: [] };
  }

  /**
   * @param {unknown} state
   * @param {Record<string, unknown>} questions
   * @returns {Promise<{answers: Record<string, any>, usage: any, model: string, latencyMs: number}>}
   */
  async systemOne(state, questions) {
    const body = JSON.stringify({ model: this.cfg.model, state, questions });
    let lastErr;

    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      if (attempt > 0) {
        this.stats.retries++;
        // exponential backoff with full jitter
        const ceiling = this.cfg.baseBackoffMs * 2 ** (attempt - 1);
        await sleep(Math.random() * ceiling);
      }

      const started = Date.now();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.cfg.timeoutMs);

      try {
        const res = await fetch(this.cfg.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body,
          signal: ac.signal,
        });
        const latencyMs = Date.now() - started;

        if (res.status === 401 || res.status === 403) {
          // Never retried, and never swallowed: a bad key must page someone
          // rather than quietly turn the security layer off.
          throw new JevError(`authentication failed (${res.status})`, {
            kind: "auth",
            status: res.status,
            retryable: false,
          });
        }
        if (res.status === 422 || res.status === 400) {
          const detail = await safeText(res);
          throw new JevError(`request rejected (${res.status}): ${detail.slice(0, 400)}`, {
            kind: "validation",
            status: res.status,
            retryable: false,
          });
        }
        if (res.status === 429 || res.status >= 500) {
          lastErr = new JevError(`upstream ${res.status}`, {
            kind: res.status === 429 ? "rate_limit" : "upstream",
            status: res.status,
            retryable: true,
          });
          continue;
        }
        if (!res.ok) {
          throw new JevError(`unexpected status ${res.status}`, {
            kind: "upstream",
            status: res.status,
            retryable: false,
          });
        }

        const json = await res.json();
        if (!json || typeof json !== "object" || !json.answers) {
          throw new JevError("malformed response: no answers", {
            kind: "malformed",
            retryable: false,
          });
        }

        this.stats.calls++;
        this.stats.inputTokens += json.usage?.input_tokens ?? 0;
        this.stats.latencies.push(latencyMs);
        return { answers: json.answers, usage: json.usage, model: json.model, latencyMs };
      } catch (err) {
        if (err instanceof JevError && !err.retryable) {
          this.stats.failures++;
          throw err;
        }
        lastErr =
          err?.name === "AbortError"
            ? new JevError(`timeout after ${this.cfg.timeoutMs}ms`, { kind: "timeout", retryable: true })
            : err instanceof JevError
              ? err
              : new JevError(`network error: ${err?.message ?? err}`, {
                  kind: "network",
                  retryable: true,
                  cause: err,
                });
      } finally {
        clearTimeout(timer);
      }
    }

    this.stats.failures++;
    throw lastErr ?? new JevError("exhausted retries", { kind: "unknown", retryable: false });
  }

  summary() {
    const l = [...this.stats.latencies].sort((a, b) => a - b);
    const pct = (p) => (l.length ? l[Math.min(l.length - 1, Math.floor((p / 100) * l.length))] : 0);
    return {
      calls: this.stats.calls,
      retries: this.stats.retries,
      failures: this.stats.failures,
      inputTokens: this.stats.inputTokens,
      p50: pct(50),
      p95: pct(95),
      p99: pct(99),
      // input tokens billed at $0.042/MTok; output tokens are free
      estUsd: +((this.stats.inputTokens / 1e6) * 0.042).toFixed(6),
    };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeText = async (res) => {
  try {
    return await res.text();
  } catch {
    return "";
  }
};
