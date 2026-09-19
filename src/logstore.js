/**
 * Append-only decision log.
 *
 * This is not incidental logging -- per PRD §7 it is the asset that makes HALO
 * tunable and, later, trainable. Every decision is one JSON line: the full
 * envelope with raw signals. Because raw signals are persisted, a threshold or
 * policy change can be evaluated by REPLAYING the log (evals/replay.mjs) at zero
 * inference cost. In shadow mode this log is the entire point: it is the
 * real-traffic corpus we could never synthesize.
 *
 * Deliberately simple and dependency-free: line-buffered append to a file, with
 * a size-based roll. A real deployment would point HALO_LOG at a pipe to its log
 * shipper; the format is stable JSONL either way.
 */

import { createWriteStream, existsSync, statSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const MAX_BYTES = 64 * 1024 * 1024; // roll at 64 MiB

export class DecisionLog {
  /** @param {string|null} path  file path, or null to log to stdout only */
  constructor(path) {
    this.path = path || null;
    this.stream = null;
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true });
      this.#open();
    }
  }

  #open() {
    if (this.path && existsSync(this.path) && statSync(this.path).size > MAX_BYTES) {
      renameSync(this.path, `${this.path}.${Date.now()}`);
    }
    this.stream = this.path ? createWriteStream(this.path, { flags: "a" }) : null;
  }

  /**
   * @param {object} envelope  a Halo.classify envelope
   * @param {{mode: string, request_id?: string}} ctx
   */
  write(envelope, ctx) {
    const record = {
      at: envelope.ts,
      request_id: ctx.request_id,
      mode: ctx.mode,
      enforcing: ctx.mode === "enforce",
      safety: envelope.verdict?.safety,
      category: envelope.verdict?.category,
      subcategory: envelope.verdict?.subcategory,
      confidence: envelope.verdict?.confidence,
      tier: envelope.decision?.tier,
      matched_rules: envelope.decision?.matched_rules,
      suppressed: envelope.decision?.suppressed,
      prefilter_hit: envelope.meta?.prefilter_hit,
      escalated: envelope.meta?.escalated,
      latency_ms: envelope.meta?.latency_ms,
      model: envelope.meta?.model,
      input_tokens: envelope.meta?.input_tokens,
      degraded: envelope.meta?.degraded ?? false,
      // raw signals + choices: the replayable substrate
      signals: envelope.signals,
      choices: envelope.choices,
    };
    const line = JSON.stringify(record) + "\n";
    if (this.stream) {
      if (this.stream.bytesWritten > MAX_BYTES) {
        this.stream.end();
        this.#open();
      }
      this.stream.write(line);
    }
    return record;
  }

  close() {
    return new Promise((resolve) => (this.stream ? this.stream.end(resolve) : resolve()));
  }
}

/**
 * Rolling in-memory metrics for /metrics. Bounded, cheap, resets on restart.
 * Enough to watch shadow-mode behaviour without a metrics backend.
 */
export class RollingMetrics {
  constructor() {
    this.total = 0;
    this.byTier = {};
    this.bySubcategory = {};
    this.byMode = {};
    this.unsafe = 0;
    this.degraded = 0;
    this.prefilterHits = 0;
    this.latencies = []; // capped
  }

  observe(record) {
    this.total++;
    this.byTier[record.tier] = (this.byTier[record.tier] ?? 0) + 1;
    this.bySubcategory[record.subcategory] = (this.bySubcategory[record.subcategory] ?? 0) + 1;
    this.byMode[record.mode] = (this.byMode[record.mode] ?? 0) + 1;
    if (record.safety === "UNSAFE") this.unsafe++;
    if (record.degraded) this.degraded++;
    if (record.prefilter_hit) this.prefilterHits++;
    if (typeof record.latency_ms === "number") {
      this.latencies.push(record.latency_ms);
      if (this.latencies.length > 5000) this.latencies.shift();
    }
  }

  snapshot() {
    const l = [...this.latencies].sort((a, b) => a - b);
    const q = (p) => (l.length ? l[Math.min(l.length - 1, Math.floor((p / 100) * l.length))] : 0);
    return {
      total: this.total,
      unsafe: this.unsafe,
      unsafe_rate: this.total ? +(this.unsafe / this.total).toFixed(4) : 0,
      degraded: this.degraded,
      prefilter_hit_rate: this.total ? +(this.prefilterHits / this.total).toFixed(4) : 0,
      by_tier: this.byTier,
      by_mode: this.byMode,
      top_subcategories: Object.entries(this.bySubcategory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([k, v]) => ({ subcategory: k, count: v })),
      latency_ms: { p50: q(50), p95: q(95), p99: q(99) },
    };
  }
}
