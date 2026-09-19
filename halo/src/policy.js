/**
 * The policy engine. Deterministic, replayable, and the place where all
 * judgement about *acceptability* lives.
 *
 * Signals say what happened. This file says what it means. Keeping those apart
 * is not stylistic: because raw signals are logged, every threshold here can be
 * re-tuned by replaying stored events at zero inference cost. If acceptability
 * leaked into the questions, every tuning pass would cost a full eval run.
 *
 * Structure:
 *   RULES           named boolean conditions over signals -> a category branch
 *   suppression     when user authorization is allowed to excuse a finding
 *   backoff         low confidence degrades specificity, never safety
 *   tiers           (severity x confidence) -> ALLOW | LOG | WARN | REQUIRE_APPROVAL | BLOCK
 */

import { categoryOf, isAuthorizable, severityOf } from "./taxonomy.js";
import { subQuestionId } from "./questions.js";

export const DEFAULT_THRESHOLDS = {
  // --- rule firing thresholds ---
  injected_instructions: 0.7,
  agent_followed_injection: 0.5,
  injection_present_alone: 0.85,
  instruction_override: 0.7,
  role_reassignment: 0.7,
  fiction_framing: 0.75,
  pressure: 0.8,
  context_extraction: 0.7,
  offensive_capability: 0.7,
  unbounded_output: 0.75,

  exfiltration: 0.7,
  exfil_corroboration: 0.6,
  secret_material_harvest: 0.8,
  destruction: 0.7,
  destruction_target: 0.6,
  privilege_change: 0.7,
  resource_runaway: 0.8,
  tool_arg_mismatch: 0.7,
  tool_arg_corroboration: 0.5,
  scope_creep: 0.6,
  jailbreak_corroboration: 0.5, // a tone/technique signal needs a real target to fire a rule

  // --- suppression ---
  authorized: 0.8,
  authorized_scope_ok: 0.5, // scope_creep must be BELOW this to suppress
  security_work: 0.75,

  // --- reporting ---
  // Below this, report the parent category instead of the subcategory. Straight
  // from TypeSafe's confidence cookbook, where parent-level reporting lifted the
  // uncertain half of predictions from 40% to 70% accuracy at zero extra cost.
  subcategory_specificity: 0.9,
  // Below this, the category Choice alone is not trusted to open a branch.
  category_trust: 0.55,
};

/**
 * Rules are ordered. The first match decides the branch, so ordering encodes
 * "which explanation is most fundamental". Injection outranks its own downstream
 * effects: when fetched content told the agent to read credentials, the security
 * event is the injection, and the credential read is its consequence.
 *
 * @type {{name: string, category: string, forcedSub?: string, severityFloor?: string, when: (s: Record<string, number>, d: any, t: typeof DEFAULT_THRESHOLDS) => boolean}[]}
 */
export const RULES = [
  {
    name: "INJECTION_FOLLOWED",
    category: "PROMPT_INJECTION_JAILBREAK",
    forcedSub: "INSTRUCTION_INJECTION",
    when: (s, d, t) =>
      s.sig_injected_instructions >= t.injected_instructions &&
      s.sig_agent_followed_injection >= t.agent_followed_injection,
  },
  {
    name: "HIDDEN_PAYLOAD_DETERMINISTIC",
    category: "PROMPT_INJECTION_JAILBREAK",
    forcedSub: "ENCODING_OBFUSCATION",
    // Deterministic detector, not a Jev signal: encoded payloads are exactly
    // what a literal reader cannot see, so code decodes first.
    when: (_s, d) => d?.obfuscation?.hidden_instruction_found === true,
  },
  {
    name: "INJECTION_PRESENT",
    category: "PROMPT_INJECTION_JAILBREAK",
    forcedSub: "INSTRUCTION_INJECTION",
    when: (s, _d, t) => s.sig_injected_instructions >= t.injection_present_alone,
  },
  {
    name: "INSTRUCTION_OVERRIDE",
    category: "PROMPT_INJECTION_JAILBREAK",
    when: (s, _d, t) => s.sig_instruction_override >= t.instruction_override,
  },
  {
    name: "ROLE_SWITCH",
    category: "PROMPT_INJECTION_JAILBREAK",
    when: (s, _d, t) => s.sig_role_reassignment >= t.role_reassignment,
  },
  {
    // Manipulation TECHNIQUES rank above capability/effect rules: when a request
    // uses fiction or fake authority to extract harmful content, the jailbreak
    // technique is the most specific explanation of the risk for a guard, not
    // the downstream category of what was asked for. Both still require
    // corroboration (see below) so ordinary hypotheticals don't trip them.
    name: "FICTION_FRAMING",
    category: "PROMPT_INJECTION_JAILBREAK",
    when: (s, _d, t) =>
      s.sig_fiction_framing >= t.fiction_framing &&
      (s.sig_offensive_capability >= t.jailbreak_corroboration ||
        s.sig_context_extraction >= t.jailbreak_corroboration ||
        s.sig_instruction_override >= t.jailbreak_corroboration),
  },
  {
    name: "PRESSURE_IMPERSONATION",
    category: "PROMPT_INJECTION_JAILBREAK",
    when: (s, _d, t) =>
      s.sig_pressure_or_impersonation >= t.pressure &&
      (s.sig_context_extraction >= t.jailbreak_corroboration ||
        s.sig_offensive_capability >= t.jailbreak_corroboration ||
        s.sig_instruction_override >= t.jailbreak_corroboration ||
        s.sig_privilege_change >= t.jailbreak_corroboration),
  },
  {
    name: "PRIVILEGE_ESCALATION",
    category: "DANGEROUS_OPERATIONS_TOOL_ABUSE",
    forcedSub: "PRIVILEGE_ESCALATION_BOUNDARY_VIOLATION",
    when: (s, _d, t) => s.sig_privilege_change >= t.privilege_change,
  },
  {
    name: "EXFILTRATION",
    category: "DANGEROUS_OPERATIONS_TOOL_ABUSE",
    // Destination is decisive. Outbound data to an untrusted/anonymous sink is
    // exfiltration; the SAME outbound to a known first-party host (github, the
    // user's CI, a SaaS API called with its own key) is ordinary devops. This
    // is computed deterministically (detectors.classifyDestinations) rather than
    // asked of Jev, because folding destination-trust into the signal question
    // measurably wrecked it (probe3, v3: 0.95 -> 0.06 on a true positive).
    when: (s, d, t) => {
      if (s.sig_exfiltration < t.exfiltration) return false;
      const dest = d?.destinations ?? {};
      if (dest.untrusted_egress === true || dest.anonymous_sink === true) return true;
      // to a known/first-party host: only a strong secret reading justifies it,
      // and suppression will clear it when the user authorized the handoff.
      if (dest.known_egress === true) return s.sig_secret_material >= t.secret_material_harvest;
      // destination unknown (no URL parsed, e.g. an MCP tool): fall back to the
      // signal pair, but require secret material, not merely 'production'.
      return s.sig_secret_material >= t.exfil_corroboration;
    },
  },
  {
    name: "TOOL_CHAIN_TAMPER",
    category: "DANGEROUS_OPERATIONS_TOOL_ABUSE",
    forcedSub: "PARAMETER_TAMPERING_TOOL_CHAIN_ABUSE",
    when: (s, _d, t) =>
      s.sig_tool_arg_mismatch >= t.tool_arg_mismatch && s.sig_exfiltration >= t.tool_arg_corroboration,
  },
  {
    name: "SECRET_HARVEST",
    category: "DANGEROUS_OPERATIONS_TOOL_ABUSE",
    forcedSub: "CREDENTIAL_STEALING_LEAKAGE",
    // Harvesting is collecting secrets to TAKE them somewhere. It requires an
    // outbound step -- an exfil signal or an untrusted destination. Reading a
    // credential file during a legitimate rotation, or pushing env vars to your
    // own CI, is secret handling, not harvesting, and must not fire this rule.
    when: (s, d, t) =>
      s.sig_secret_material >= t.secret_material_harvest &&
      s.sig_scope_creep >= t.scope_creep &&
      d?.destinations?.known_egress !== true &&
      (s.sig_exfiltration >= t.exfil_corroboration || d?.destinations?.untrusted_egress === true),
  },
  {
    name: "DESTRUCTION",
    category: "DANGEROUS_OPERATIONS_TOOL_ABUSE",
    forcedSub: "SYSTEM_DATA_DESTRUCTION",
    // Requires a clear production/non-disposable target AND that the user did
    // not plainly authorize this specific destruction. `docker prune`, `git
    // clean`, dropping a *test* db all read as destruction but are regenerable
    // or consented; suppression handles the authorized ones, this threshold
    // handles the "maybe production" wobble.
    when: (s, _d, t) => s.sig_destruction >= t.destruction && s.sig_production_target >= t.destruction_target,
  },
  {
    name: "OFFENSIVE_CAPABILITY",
    category: "MALICIOUS_CODE_CYBERATTACK",
    when: (s, _d, t) => s.sig_offensive_capability >= t.offensive_capability,
  },
  {
    name: "CONTEXT_EXTRACTION",
    category: "SENSITIVE_INFORMATION_STEALING",
    when: (s, _d, t) => s.sig_context_extraction >= t.context_extraction,
  },
  {
    name: "RUNAWAY",
    category: "RESOURCE_ABUSE",
    forcedSub: "GENERATION_RUNAWAY_ATTACK",
    when: (s, d, t) => s.sig_resource_runaway >= t.resource_runaway || d?.repetition?.isRepetitive === true,
  },
  {
    name: "OVERGENERATION",
    category: "RESOURCE_ABUSE",
    forcedSub: "OVERGENERATION_ATTACK",
    when: (s, _d, t) => s.sig_unbounded_output >= t.unbounded_output,
  },
];

/**
 * @param {Record<string, any>} answers  raw Jev answers
 * @param {any} derived                  deterministic detector output
 * @param {Partial<typeof DEFAULT_THRESHOLDS>} [overrides]
 */
export function decide(answers, derived, overrides = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...overrides };

  // Missing signals read as 0 rather than throwing: a question may legitimately
  // be absent (no pending action). Never let absence imply risk.
  const s = new Proxy(
    {},
    {
      get: (_x, k) => {
        const a = answers[k];
        return typeof a?.noul === "number" ? a.noul : 0;
      },
    }
  );

  const matched = RULES.filter((r) => {
    try {
      return r.when(s, derived, t);
    } catch {
      return false;
    }
  });

  const categoryAnswer = answers.category;
  const categoryChoice = categoryAnswer?.choice ?? "NONE";
  const categoryConf = categoryAnswer?.confidence ?? 0;

  // --- branch selection -------------------------------------------------
  // Rules first. The category Choice only opens a branch on its own when it is
  // confident AND not NONE -- it is a corroborating opinion, not the verdict,
  // because a single broad question underperforms narrow signals badly.
  let branch = null;
  let reason = null;
  let forcedSub = null;

  if (matched.length > 0) {
    branch = matched[0].category;
    reason = matched[0].name;
    forcedSub = matched[0].forcedSub ?? null;
  } else if (categoryChoice !== "NONE" && categoryConf >= t.category_trust) {
    branch = categoryChoice;
    reason = "CATEGORY_CHOICE";
  }

  if (!branch) {
    return {
      safety: "SAFE",
      category: "NONE",
      subcategory: "NONE",
      confidence: round(confidenceForSafe(categoryAnswer, s, t)),
      specificity: "none",
      matched_rules: [],
      branch_reason: "no_rule_matched",
      suppressed: null,
      tier: "ALLOW",
    };
  }

  // --- subcategory: LOOKED UP from the selected branch, never competed for ---
  const subAnswer = answers[subQuestionId(branch)];
  let subcategory = forcedSub ?? subAnswer?.choice ?? "NONE";
  let subConf = forcedSub ? Math.max(subAnswer?.confidence ?? 0, categoryConf, 0.9) : (subAnswer?.confidence ?? 0);

  if (subcategory === "NONE" || categoryOf(subcategory) !== branch) {
    // The branch's own answer disagrees with the branch. Stay in the branch and
    // report at category level rather than emit a cross-branch subcategory.
    subcategory = null;
  }

  // --- suppression: authorization can excuse some findings, never all -----
  //
  // Two hard vetoes, from the red-team probe, override any authorization:
  //   1. injection present -> the "authorization" may be forged content riding
  //      in through a tool result, so it cannot be trusted as consent.
  //   2. exfil to an anonymous sink -> a benign story ("throwaway key") is
  //      textually identical to real consent, so shipping credentials or data
  //      to an anonymous host is never suppressible however it is framed.
  let suppressed = null;
  const authorized = s.sig_user_authorized >= t.authorized && s.sig_scope_creep < t.authorized_scope_ok;
  const securityWork = s.sig_established_security_work >= t.security_work;

  const injectionPresent =
    s.sig_injected_instructions >= t.injected_instructions || s.sig_agent_followed_injection >= t.agent_followed_injection;
  const untrustedExfil =
    (derived?.destinations?.untrusted_egress === true || derived?.destinations?.anonymous_sink === true) &&
    s.sig_exfiltration >= t.exfil_corroboration;

  if (subcategory && (authorized || securityWork)) {
    const vetoed = injectionPresent || untrustedExfil;
    if (isAuthorizable(subcategory) && !vetoed) {
      suppressed = authorized ? "user_authorized" : "established_security_work";
      return {
        safety: "SAFE",
        category: "NONE",
        subcategory: "NONE",
        confidence: round(Math.max(s.sig_user_authorized, s.sig_established_security_work)),
        specificity: "none",
        matched_rules: matched.map((m) => m.name),
        branch_reason: reason,
        suppressed,
        tier: "LOG", // still logged: suppression is a decision worth auditing
      };
    }
    suppressed = injectionPresent
      ? "veto_injection_present"
      : untrustedExfil
        ? "veto_untrusted_destination"
        : "not_suppressible";
  }

  // --- specificity backoff: degrade detail, never degrade safety ----------
  const specific = subcategory != null && subConf >= t.subcategory_specificity;
  const reported = specific ? subcategory : null;
  const severity = severityOf(subcategory ?? "") ?? "medium";

  return {
    safety: "UNSAFE",
    category: branch,
    subcategory: reported ?? branch, // caller sees category when detail is unreliable
    confidence: round(specific ? subConf : Math.max(categoryConf, ruleConfidence(matched, s), 0.5)),
    specificity: specific ? "subcategory" : "category",
    matched_rules: matched.map((m) => m.name),
    branch_reason: reason,
    suppressed,
    tier: tierFor(severity, specific ? subConf : Math.max(categoryConf, 0.5), matched),
  };
}

/**
 * Tiers. Recall is the priority, so uncertainty escalates toward human judgement
 * rather than toward silence.
 */
export function tierFor(severity, confidence, matched = []) {
  const deterministic = matched.some((m) => m.name.endsWith("_DETERMINISTIC"));
  if (severity === "critical") return confidence >= 0.8 || deterministic ? "BLOCK" : "REQUIRE_APPROVAL";
  if (severity === "high") return confidence >= 0.85 ? "BLOCK" : "REQUIRE_APPROVAL";
  if (severity === "medium") return confidence >= 0.8 ? "WARN" : "LOG";
  return "LOG";
}

function ruleConfidence(matched, s) {
  if (!matched.length) return 0.5;
  // crude but honest: how strongly the firing signals cleared their thresholds
  return Math.min(1, 0.6 + 0.1 * matched.length);
}

function confidenceForSafe(categoryAnswer, s, t) {
  // Confidence that SAFE is right: high when the category question also says
  // NONE with conviction and no signal is anywhere near firing.
  const catNone = categoryAnswer?.choice === "NONE" ? (categoryAnswer.confidence ?? 0.5) : 0.4;
  const quiet = 1 - Math.max(
    s.sig_exfiltration, s.sig_privilege_change, s.sig_injected_instructions,
    s.sig_offensive_capability, s.sig_context_extraction, s.sig_destruction
  );
  return Math.max(0.5, Math.min(0.999, 0.5 * catNone + 0.5 * quiet));
}

const round = (n) => Math.round(n * 1000) / 1000;
