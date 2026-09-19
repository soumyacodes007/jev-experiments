/**
 * Orchestration: event -> verdict.
 *
 *   Stage 0  deterministic prefilter + derived facts        (~0ms)
 *   Stage 1  ONE Jev call, whole taxonomy in parallel       (~330ms p50)
 *   Stage 2  deterministic policy composition               (~0ms)
 *   Stage 3  escalation for the uncertain band              (opt-in)
 */

import { JevClient, JevError } from "./client.js";
import { buildState } from "./state.js";
import { buildQuestions } from "./questions.js";
import { decide } from "./policy.js";
import { prefilter } from "./prefilter.js";

export class Halo {
  /** @param {{client?: JevClient, thresholds?: object, escalate?: boolean, usePrefilter?: boolean}} [opts] */
  constructor(opts = {}) {
    this.client = opts.client ?? new JevClient();
    this.thresholds = opts.thresholds ?? {};
    this.escalate = opts.escalate ?? true;
    this.usePrefilter = opts.usePrefilter ?? true;
  }

  /**
   * @param {import("./state.js").HaloEvent} event
   * @returns {Promise<object>} full envelope; `.verdict` is the public contract
   */
  async classify(event) {
    const t0 = Date.now();

    if (this.usePrefilter) {
      const pf = prefilter(event);
      if (pf.skip) {
        return envelope({
          verdict: { safety: "SAFE", category: "NONE", subcategory: "NONE", confidence: 0.99, specificity: "none" },
          decision: { tier: "ALLOW", matched_rules: [], branch_reason: `prefilter:${pf.reason}`, suppressed: null },
          signals: {},
          meta: { prefilter_hit: true, escalated: false, latency_ms: Date.now() - t0, model: null },
        });
      }
    }

    const { state, derived } = buildState(event);
    const questions = buildQuestions(state);

    let res;
    try {
      res = await this.client.systemOne(state, questions);
    } catch (err) {
      return this.#failClosed(err, event, derived, t0);
    }

    let result = decide(res.answers, derived, this.thresholds);
    let escalated = false;

    // Stage 3: the uncertain band. A category-level UNSAFE means the branch is
    // trusted but the detail is not -- a second look with a wider window is the
    // cheapest thing that can sharpen it.
    if (this.escalate && result.safety === "UNSAFE" && result.specificity === "category") {
      const wider = buildState(event, { ...WIDE_LIMITS });
      try {
        const res2 = await this.client.systemOne(wider.state, questions);
        const result2 = decide(res2.answers, wider.derived, this.thresholds);
        escalated = true;
        // Take the sharper answer, but never let escalation downgrade safety.
        if (result2.safety === "UNSAFE" && result2.specificity === "subcategory") {
          result = result2;
        }
      } catch {
        /* escalation is best-effort; the first verdict stands */
      }
    }

    return envelope({
      verdict: {
        safety: result.safety,
        category: result.category,
        subcategory: result.subcategory,
        confidence: result.confidence,
        specificity: result.specificity,
      },
      decision: {
        tier: result.tier,
        matched_rules: result.matched_rules,
        branch_reason: result.branch_reason,
        suppressed: result.suppressed,
      },
      signals: rawSignals(res.answers),
      choices: rawChoices(res.answers),
      meta: {
        prefilter_hit: false,
        escalated,
        latency_ms: Date.now() - t0,
        model: res.model,
        input_tokens: res.usage?.input_tokens,
        derived,
      },
    });
  }

  /**
   * Never fail open on a security layer.
   *
   * An auth or validation error is an operator problem and must surface loudly.
   * A transient upstream failure degrades to the deterministic evidence we
   * already have, and anything with a pending action is held for approval
   * rather than waved through.
   */
  #failClosed(err, event, derived, t0) {
    const kind = err instanceof JevError ? err.kind : "unknown";
    const hardFail = kind === "auth" || kind === "validation" || kind === "config";

    const deterministicHit = derived?.obfuscation?.hidden_instruction_found || derived?.repetition?.isRepetitive;
    const hasAction = event.current_action != null;

    const tier = deterministicHit ? "BLOCK" : hasAction ? "REQUIRE_APPROVAL" : "LOG";

    return envelope({
      verdict: {
        safety: deterministicHit ? "UNSAFE" : "UNKNOWN",
        category: deterministicHit ? "PROMPT_INJECTION_JAILBREAK" : "NONE",
        subcategory: deterministicHit ? "ENCODING_OBFUSCATION" : "NONE",
        confidence: deterministicHit ? 0.9 : 0,
        specificity: deterministicHit ? "subcategory" : "none",
      },
      decision: {
        tier,
        matched_rules: deterministicHit ? ["HIDDEN_PAYLOAD_DETERMINISTIC"] : [],
        branch_reason: "degraded_mode",
        suppressed: null,
      },
      signals: {},
      meta: {
        prefilter_hit: false,
        escalated: false,
        latency_ms: Date.now() - t0,
        model: null,
        error: { kind, message: err?.message, hard: hardFail },
        degraded: true,
      },
    });
  }
}

const WIDE_LIMITS = {
  maxTurns: 24,
  maxPriorCalls: 40,
  maxToolResults: 10,
  maxToolResultChars: 3000,
  maxTurnChars: 6000,
  maxTotalChars: 48000,
};

function rawSignals(answers) {
  const out = {};
  for (const [k, v] of Object.entries(answers)) {
    if (k.startsWith("sig_") && typeof v?.noul === "number") out[k] = v.noul;
  }
  return out;
}

function rawChoices(answers) {
  const out = {};
  for (const [k, v] of Object.entries(answers)) {
    if (v?.type === "choice") out[k] = { choice: v.choice, confidence: v.confidence };
  }
  return out;
}

function envelope(e) {
  return { ...e, halo_version: "0.1.0", ts: new Date().toISOString() };
}
