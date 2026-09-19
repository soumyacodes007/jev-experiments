# jev-experiments

Two independent experiments in building real software on **Jev** (TypeSafe's
System One model) — both following the same discipline: **code owns control
flow, calculation, and exact work; Jev supplies only narrow, calibrated semantic
judgments.** They solve different problems and live in their own folders.

```
.
├── halo/     agent security classification layer
├── prism/    sensitive-data (PII) detection + masking
└── package.json   shared scripts (halo:* and prism:*)
```

## [`halo/`](halo/) — security classification for AI agents

Watches agent activity (prompts, tool/MCP calls, shell commands, tool results,
whole trajectories) and returns `{ safety, subcategory, confidence }` over a
fixed taxonomy of 5 categories / 24 subcategories, which a policy engine maps to
`ALLOW | LOG | WARN | REQUIRE_APPROVAL | BLOCK`.

- One Jev call asks the **whole taxonomy in parallel**; a deterministic policy
  engine composes the signals into the verdict.
- Validated on a synthetic corpus with a dev / holdout / **sealed** out-of-sample
  split, a classifier red-team, and self-consistency runs.
- Ships in **shadow mode** (observe + log, don't enforce) with a replay loop from
  production logs to tuning.
- Measured: recall 100%, disruptive FPR 0%, category accuracy 98–100%, ~390ms p50,
  ~$0.00026/call on the current corpus. See [`halo/report.md`](halo/report.md) and
  [`halo/README.md`](halo/README.md).

```bash
npm run halo:test      # 40 offline unit tests
npm run halo:eval      # full corpus against live Jev
npm run halo:serve     # shadow-mode HTTP service
```

## [`prism/`](prism/) — sensitive-data detection & masking

Segments text into addressable units with exact offsets, runs Jev value-membership
Nouls + category/subtype Choices per unit (IDENTITY / CREDENTIAL / FINANCIAL /
HEALTH / DIGITAL), then repairs, merges, resolves overlaps, and masks accepted
spans — with retries, audit records, and fail-closed behavior in code.

- "Economy" vs "latency" profiles trading API calls against speed.
- Evaluated against Jev 1.13.0 with a 50-case corpus and consistency suites.
- See [`prism/docs/PRISM_JEV_SYSTEM_DESIGN.md`](prism/docs/PRISM_JEV_SYSTEM_DESIGN.md)
  and [`prism/docs/PRISM_ECONOMY_VS_LATENCY_CTO.md`](prism/docs/PRISM_ECONOMY_VS_LATENCY_CTO.md).

```bash
npm run prism:test     # prism unit tests
npm run prism:eval     # run the 50-case evaluation
npm run prism:mask     # mask sensitive spans in text
```

## Setup

```bash
# .env holds the Jev key (gitignored); either name works:
#   JEV_API_KEY=...   or   TYPESAFE_API_KEY=...
npm test               # runs BOTH halo and prism unit suites
```

Zero runtime dependencies in either track — a security/privacy tool shouldn't
carry a supply chain. Node ≥ 22.

## Provenance

`halo/` and `prism/` are separate implementations. They share the repo, the model,
and the "keep code in control, use Jev for judgments" philosophy, but no code.
