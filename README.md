# jev-experiments

Experiments in building **real, safety-critical software on [Jev](https://docs.typesafe.ai)** —
TypeSafe's System One model, which returns typed, calibrated judgments instead of
free text. Every track here follows the same discipline:

> **Code owns control flow, calculation, and exact work. Jev supplies only
> narrow, calibrated semantic judgments. Nothing is trusted that a parser could
> get wrong.**

Two independent detection systems live side by side, plus an early web UI.

```
.
├── halo/     security classification for AI agents  (this session's build)
├── prism/    sensitive-data (PII) detection + masking
├── web/      early frontend (Next.js)
└── package.json   shared scripts: halo:* · prism:* · web:*
```

| | [`halo/`](halo/) | [`prism/`](prism/) |
|---|---|---|
| **Problem** | Is this agent action a security risk? | Does this text contain sensitive data, and where? |
| **Input** | Agent trajectory (prompts, tool calls, shell, results) | Free text |
| **Output** | `{ safety, subcategory, confidence }` over 5 cats / 24 subtypes | Masked spans with exact offsets over 5 cats / 40 subtypes |
| **Consumer** | Policy engine → `ALLOW/LOG/WARN/APPROVE/BLOCK` | Redaction / audit pipeline |
| **Jev usage** | One parallel call: whole taxonomy at once | Per-unit membership Nouls + category/subtype Choices |
| **Status** | v0.1, validated on synthetic corpus, shadow-ready | implemented + evaluated (Economy vs Latency profiles) |

---

## `halo/` — security classification for AI agents

Watches agent activity — prompts, assistant turns, tool/MCP calls, shell
commands, tool results, whole multi-turn trajectories — and returns
`{ safety, subcategory, confidence }`. A deterministic policy engine maps the
subcategory to an action tier (`ALLOW · LOG · WARN · REQUIRE_APPROVAL · BLOCK`).

- **One Jev call** asks the entire taxonomy in parallel; the policy engine
  composes the signals into a verdict. Signals *observe*; policy *decides
  acceptability* — a split that keeps thresholds replayable at zero inference cost.
- **Validated** with a dev / holdout / **sealed** out-of-sample split, a
  classifier red-team, and self-consistency runs. Measured on the current
  corpus: recall 100%, disruptive FPR 0%, category accuracy 98–100%, ~390ms p50,
  ~$0.00026/call. Full detail: **[`halo/report.md`](halo/report.md)**.
- **Ships in shadow mode** (observe + log, never enforce) with a replay loop
  that turns production logs into the real-traffic corpus needed before enforcing.

```bash
npm run halo:test      # 40 offline unit tests (no API)
npm run halo:eval      # full corpus against live Jev
npm run halo:redteam   # try to talk the classifier out of a true positive
npm run halo:serve     # shadow-mode HTTP service on :8787
```

Docs: [`halo/README.md`](halo/README.md) · [`halo/docs/HALO_PRD.md`](halo/docs/HALO_PRD.md) · [`halo/report.md`](halo/report.md)

## `prism/` — sensitive-data detection & masking

Segments text into addressable units with exact character offsets, runs Jev
value-membership Nouls plus category/subtype Choices per unit (IDENTITY /
CREDENTIAL / FINANCIAL / HEALTH / DIGITAL), then repairs, merges, resolves
overlaps by precedence, and masks accepted spans — with retries, audit records,
and fail-closed behavior handled in code.

- **Economy vs Latency profiles** trade API calls against speed.
- Evaluated against `jev-1.13.0` with a 50-case corpus and consistency suites.

```bash
npm run prism:test     # prism unit tests
npm run prism:eval     # run the 50-case evaluation
npm run prism:mask     # mask sensitive spans in a piece of text
```

Docs: [`prism/docs/PRISM_JEV_SYSTEM_DESIGN.md`](prism/docs/PRISM_JEV_SYSTEM_DESIGN.md) · [`prism/docs/PRISM_ECONOMY_VS_LATENCY.md`](prism/docs/PRISM_ECONOMY_VS_LATENCY.md)

## `web/` — frontend (early)

A Next.js app for interacting with the detectors. Early scaffold.

```bash
npm run web:dev        # start the dev server
```

---

## Setup

```bash
# 1. Provide a Jev API key (gitignored). Either name works:
#    JEV_API_KEY=...    or    TYPESAFE_API_KEY=...
echo "JEV_API_KEY=..." > .env

# 2. Run the test suites (both tracks, offline, no API):
npm test
```

Node ≥ 22. **Zero runtime dependencies** in both detector tracks — a
security/privacy tool should not carry a supply chain.

## Running guide

Three processes, three terminals. HALO and PRISM each default to port `8787`,
so when running them together **HALO must be moved to `8788`** — the web app
already expects it there.

### 1. HALO service — port 8788

```bash
HALO_PORT=8788 npm run halo:serve
```

Starts in **shadow mode** by default (classifies and logs, never blocks).
Verify it's up:

```bash
curl http://127.0.0.1:8788/healthz
# {"ok":true,"service":"halo","version":"0.1.0","mode":"shadow"}
```

| Env var | Default | What it does |
|---|---|---|
| `HALO_PORT` | `8787` | listen port — **set to `8788`** to match the web app |
| `HALO_MODE` | `shadow` | `shadow` (log only) or `enforce` (tier is authoritative) |
| `HALO_LOG` | `logs/decisions.jsonl` | decision log path (JSONL, replayable) |
| `HALO_RATE_PER_SEC` / `HALO_BURST` | `200` / `400` | request rate limiting |
| `HALO_MAX_INFLIGHT` | `32` | concurrent Jev calls allowed |
| `HALO_ESCALATE` | `1` | set to `0` to disable the low-confidence second call |

### 2. PRISM service — port 8787 (default, no flags needed)

```bash
npm run prism:serve
```

Verify it's up:

```bash
curl -X POST http://127.0.0.1:8787/v1/mask \
  -H 'content-type: application/json' \
  -d '{"text":"email me at a@b.com"}'
```

Override host/port with `--host` / `--port` flags or `HOST` / `PORT` env vars
if `8787` is taken.

### 3. Web frontend — port 3000

```bash
npm run web:dev
```

Open **http://localhost:3000**. The HALO/PRISM toggle switches which service
the input box talks to. If a request fails with `*_backend_unavailable`, the
matching service from step 1 or 2 isn't running yet.

The frontend's API routes point at the two services via env vars (optional —
only needed if you're not using the default ports above):

```bash
# web/.env.local
HALO_API_URL=http://127.0.0.1:8788
PRISM_API_URL=http://127.0.0.1:8787
```

### All at once

```bash
# terminal 1
HALO_PORT=8788 npm run halo:serve
# terminal 2
npm run prism:serve
# terminal 3
npm run web:dev
```

### Just the engines, no UI

Both detectors run standalone without the frontend — useful for evals, curl,
or wiring into your own pipeline:

```bash
npm run halo:eval        # HALO's full corpus against live Jev
npm run prism:eval       # PRISM's 50-case evaluation
npm run prism:mask -- --text "call me at 555-0199"   # mask text from the CLI
```

## Repository conventions

- **`.env` is never committed.** Only `.env.example` is tracked.
- Each detector track owns its `src/`, `test/`, `evals/`, and `docs/`.
- Eval caches (`**/.cache.json`) and decision logs (`logs/`) are gitignored;
  they are regenerated locally and, in HALO's case, are the substrate for
  replay-based tuning.

## Provenance

`halo/` and `prism/` are **separate implementations** of related ideas. They
share this repository, the model, and the "keep code in control, use Jev for
judgments" philosophy — but no code. Numbers in each track's report are measured
from live `jev-1.13.0` responses and are development benchmarks on synthetic
data, not production-accuracy claims.

## License

MIT.
