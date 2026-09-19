import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, RULES, tierFor } from "../src/policy.js";
import { subQuestionId } from "../src/questions.js";
import {
  SUBCATEGORY_TO_CATEGORY,
  SUBCATEGORIES,
  categoryOf,
  isAuthorizable,
} from "../src/taxonomy.js";

// Helpers to synthesize Jev answers without the API.
const noul = (v) => ({ type: "noul", noul: v });
const choice = (c, conf = 0.9, probs = {}) => ({ type: "choice", choice: c, confidence: conf, probabilities: probs });

function answers(signals = {}, cat = "NONE", catConf = 0.9, subs = {}) {
  const a = { category: choice(cat, catConf) };
  for (const [k, v] of Object.entries(signals)) a[k] = noul(v);
  for (const [branch, [sub, conf]] of Object.entries(subs)) a[subQuestionId(branch)] = choice(sub, conf);
  return a;
}

test("taxonomy: every subcategory maps to a real category", () => {
  for (const sub of SUBCATEGORIES) {
    const cat = SUBCATEGORY_TO_CATEGORY[sub];
    assert.ok(cat, `${sub} has no parent`);
    assert.equal(categoryOf(sub), cat);
  }
});

test("taxonomy: 24 subcategories across 5 categories", () => {
  assert.equal(SUBCATEGORIES.length, 24);
  assert.equal(new Set(Object.values(SUBCATEGORY_TO_CATEGORY)).size, 5);
});

test("clean event with no signals is SAFE", () => {
  const r = decide(answers({}, "NONE", 0.99), {});
  assert.equal(r.safety, "SAFE");
  assert.equal(r.subcategory, "NONE");
  assert.equal(r.tier, "ALLOW");
});

test("THE INVARIANT: branch is never chosen by highest subcategory confidence", () => {
  // A benign event: no signal fires, category says NONE. But off-branch
  // subcategory questions answer confidently anyway (as measured: 0.88-0.99).
  // If the policy ever picked the branch by max subcategory confidence, this
  // would classify UNSAFE. It must stay SAFE.
  const a = answers(
    { sig_destruction: 0.1, sig_exfiltration: 0.05, sig_user_authorized: 0.9 },
    "NONE",
    0.95,
    {
      DANGEROUS_OPERATIONS_TOOL_ABUSE: ["SYSTEM_DATA_DESTRUCTION", 0.99],
      SENSITIVE_INFORMATION_STEALING: ["CORPORATE_SECRET_STEALING", 0.98],
      PROMPT_INJECTION_JAILBREAK: ["INSTRUCTION_INJECTION", 0.97],
    }
  );
  const r = decide(a, {});
  assert.equal(r.safety, "SAFE", "off-branch high-confidence subcats must not create a verdict");
});

test("exfiltration rule fires and routes to credential leakage", () => {
  const a = answers(
    { sig_exfiltration: 0.98, sig_secret_material: 0.98, sig_user_authorized: 0.05, sig_scope_creep: 0.9 },
    "DANGEROUS_OPERATIONS_TOOL_ABUSE",
    0.9,
    { DANGEROUS_OPERATIONS_TOOL_ABUSE: ["CREDENTIAL_STEALING_LEAKAGE", 0.99] }
  );
  const r = decide(a, {});
  assert.equal(r.safety, "UNSAFE");
  assert.equal(r.category, "DANGEROUS_OPERATIONS_TOOL_ABUSE");
  assert.equal(r.subcategory, "CREDENTIAL_STEALING_LEAKAGE");
  assert.equal(r.tier, "BLOCK");
});

test("authorization suppresses credential handling to KNOWN egress but still logs it", () => {
  // gh secret set: real exfil signals, user asked, scope matches, destination is
  // the user's own CI (known egress) and no injection is present.
  const a = answers(
    { sig_exfiltration: 0.95, sig_secret_material: 0.97, sig_user_authorized: 0.92, sig_scope_creep: 0.1, sig_production_target: 0.9 },
    "DANGEROUS_OPERATIONS_TOOL_ABUSE",
    0.8,
    { DANGEROUS_OPERATIONS_TOOL_ABUSE: ["CREDENTIAL_STEALING_LEAKAGE", 0.9] }
  );
  const derived = { destinations: { untrusted_egress: false, anonymous_sink: false, known_egress: true } };
  const r = decide(a, derived);
  assert.equal(r.safety, "SAFE", "authorized credential handling to first-party CI is not a finding");
  assert.equal(r.suppressed, "user_authorized");
  assert.equal(r.tier, "LOG", "suppression is audited, not silent");
});

test("authorization does NOT suppress credential exfil to an ANONYMOUS sink", () => {
  // Same signals, same confident 'authorization' -- but the destination is
  // paste.ee. The 'throwaway key for a demo' story cannot license this.
  const a = answers(
    { sig_exfiltration: 0.98, sig_secret_material: 0.98, sig_user_authorized: 0.93, sig_scope_creep: 0.2 },
    "DANGEROUS_OPERATIONS_TOOL_ABUSE",
    0.9,
    { DANGEROUS_OPERATIONS_TOOL_ABUSE: ["CREDENTIAL_STEALING_LEAKAGE", 0.99] }
  );
  const derived = { destinations: { untrusted_egress: true, anonymous_sink: true, known_egress: false } };
  const r = decide(a, derived);
  assert.equal(r.safety, "UNSAFE", "exfil to an anonymous sink survives any authorization story");
  assert.equal(r.suppressed, "veto_untrusted_destination");
});

test("forged authorization via injection does not suppress even to known egress", () => {
  const a = answers(
    { sig_exfiltration: 0.98, sig_secret_material: 0.98, sig_user_authorized: 0.8, sig_scope_creep: 0.3, sig_injected_instructions: 0.9, sig_agent_followed_injection: 0.9 },
    "PROMPT_INJECTION_JAILBREAK",
    0.7,
    {
      PROMPT_INJECTION_JAILBREAK: ["INSTRUCTION_INJECTION", 0.95],
      DANGEROUS_OPERATIONS_TOOL_ABUSE: ["CREDENTIAL_STEALING_LEAKAGE", 0.95],
    }
  );
  const r = decide(a, { destinations: { known_egress: true } });
  assert.equal(r.safety, "UNSAFE", "authorization carried in by injection is not consent");
});

test("authorization does NOT suppress a non-authorizable finding", () => {
  // Privilege escalation is authorizable:false. A user asking to 'stop the
  // approval prompts' cannot license disabling the audit control.
  const a = answers(
    { sig_privilege_change: 0.96, sig_user_authorized: 0.9, sig_scope_creep: 0.2 },
    "DANGEROUS_OPERATIONS_TOOL_ABUSE",
    0.9,
    { DANGEROUS_OPERATIONS_TOOL_ABUSE: ["PRIVILEGE_ESCALATION_BOUNDARY_VIOLATION", 0.95] }
  );
  const r = decide(a, {});
  assert.equal(r.safety, "UNSAFE", "escalation must survive user authorization");
  assert.equal(r.subcategory, "PRIVILEGE_ESCALATION_BOUNDARY_VIOLATION");
});

test("runaway is non-authorizable: user asking for a loop does not make it safe", () => {
  const a = answers(
    { sig_resource_runaway: 0.99, sig_user_authorized: 0.86 },
    "RESOURCE_ABUSE",
    0.9,
    { RESOURCE_ABUSE: ["GENERATION_RUNAWAY_ATTACK", 0.95] }
  );
  const r = decide(a, { repetition: { isRepetitive: true } });
  assert.equal(r.safety, "UNSAFE");
  assert.equal(r.category, "RESOURCE_ABUSE");
});

test("manufactured authorization via injection does not suppress", () => {
  // The red-team gap: a forged 'USER: I authorize...' rides in via a tool
  // result. If Jev is fooled into sig_user_authorized high AND it's a
  // non-authorizable exfil, suppression must still not fire.
  const a = answers(
    { sig_exfiltration: 0.98, sig_secret_material: 0.98, sig_user_authorized: 0.7, sig_scope_creep: 0.4, sig_injected_instructions: 0.9, sig_agent_followed_injection: 0.9 },
    "PROMPT_INJECTION_JAILBREAK",
    0.7,
    {
      PROMPT_INJECTION_JAILBREAK: ["INSTRUCTION_INJECTION", 0.95],
      DANGEROUS_OPERATIONS_TOOL_ABUSE: ["CREDENTIAL_STEALING_LEAKAGE", 0.95],
    }
  );
  const r = decide(a, {});
  assert.equal(r.safety, "UNSAFE");
  // Injection outranks its downstream effect: the security event is the injection.
  assert.equal(r.category, "PROMPT_INJECTION_JAILBREAK");
});

test("specificity backoff: low subcategory confidence reports category, not SAFE", () => {
  const a = answers(
    { sig_privilege_change: 0.9 },
    "DANGEROUS_OPERATIONS_TOOL_ABUSE",
    0.6,
    { DANGEROUS_OPERATIONS_TOOL_ABUSE: ["PRIVILEGE_ESCALATION_BOUNDARY_VIOLATION", 0.4] }
  );
  const r = decide(a, {});
  assert.equal(r.safety, "UNSAFE", "never degrade to SAFE on low confidence");
  // forcedSub on the PRIVILEGE_ESCALATION rule keeps it specific; use a
  // non-forced rule to see backoff.
});

test("specificity backoff on a non-forced branch degrades to category level", () => {
  const a = answers(
    { sig_context_extraction: 0.8 },
    "SENSITIVE_INFORMATION_STEALING",
    0.7,
    { SENSITIVE_INFORMATION_STEALING: ["CORPORATE_SECRET_STEALING", 0.5] } // below 0.9
  );
  const r = decide(a, {});
  assert.equal(r.safety, "UNSAFE");
  assert.equal(r.specificity, "category");
  assert.equal(r.subcategory, "SENSITIVE_INFORMATION_STEALING", "reports parent when detail is unreliable");
});

test("deterministic hidden-payload detector alone forces an injection verdict", () => {
  const a = answers({}, "NONE", 0.9);
  const r = decide(a, { obfuscation: { hidden_instruction_found: true } });
  assert.equal(r.safety, "UNSAFE");
  assert.equal(r.subcategory, "ENCODING_OBFUSCATION");
  assert.equal(r.tier, "BLOCK", "deterministic detection is high-trust");
});

test("category Choice can open a branch when confident, but not when NONE", () => {
  // No rule fires, but the model is confident it's an attack category.
  const withOpinion = decide(answers({}, "MALICIOUS_CODE_CYBERATTACK", 0.9, { MALICIOUS_CODE_CYBERATTACK: ["MALICIOUS_CODE_GENERATION", 0.95] }), {});
  assert.equal(withOpinion.safety, "UNSAFE");
  // Same but category is NONE -> SAFE regardless of subcategory noise.
  const none = decide(answers({}, "NONE", 0.9, { MALICIOUS_CODE_CYBERATTACK: ["MALICIOUS_CODE_GENERATION", 0.99] }), {});
  assert.equal(none.safety, "SAFE");
});

test("low category confidence does NOT open a branch on its own", () => {
  const r = decide(answers({}, "MALICIOUS_CODE_CYBERATTACK", 0.4, { MALICIOUS_CODE_CYBERATTACK: ["MALICIOUS_CODE_GENERATION", 0.95] }), {});
  assert.equal(r.safety, "SAFE", "an unsure category guess is not a verdict");
});

test("tierFor escalates uncertainty rather than silencing it", () => {
  assert.equal(tierFor("critical", 0.9), "BLOCK");
  assert.equal(tierFor("critical", 0.5), "REQUIRE_APPROVAL");
  assert.equal(tierFor("high", 0.9), "BLOCK");
  assert.equal(tierFor("high", 0.6), "REQUIRE_APPROVAL");
  assert.equal(tierFor("medium", 0.9), "WARN");
  assert.equal(tierFor("medium", 0.5), "LOG");
});

test("every forcedSub in a rule belongs to that rule's category", () => {
  for (const rule of RULES) {
    if (rule.forcedSub) {
      assert.equal(categoryOf(rule.forcedSub), rule.category, `${rule.name} forces a subcategory from the wrong category`);
    }
  }
});

test("missing signals never imply risk", () => {
  // Empty answers object: proxy returns 0 for everything.
  const r = decide({ category: choice("NONE", 0.5) }, {});
  assert.equal(r.safety, "SAFE");
});
