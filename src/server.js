/**
 * HALO service. Zero-dependency node:http.
 *
 * Deployment posture (agreed for v1): ship in SHADOW mode first.
 *
 *   HALO_MODE=shadow   (default) — HALO classifies and LOGS every decision but
 *                       marks `enforcing:false`. The caller is expected to ignore
 *                       the tier and take no action. This is the safe first
 *                       deployment: it builds the real-traffic corpus (the one
 *                       thing synthetic evals cannot give us) with zero risk of a
 *                       false BLOCK interrupting a real developer.
 *   HALO_MODE=enforce  — `enforcing:true`; the tier is authoritative. Flip to
 *                       this only after shadow-mode logs show the real-traffic
 *                       FPR is acceptable (replay them with evals/replay.mjs).
 *
 * Endpoints:
 *   POST /classify   body: HaloEvent            -> {safety, subcategory, confidence, tier, enforcing, ...}
 *   GET  /healthz                               -> liveness
 *   GET  /metrics                               -> rolling decision metrics
 *   GET  /stats                                 -> Jev client stats (latency, cost)
 *
 * Every decision is appended to HALO_LOG (JSONL) — that log is the tuning and
 * training corpus, replayable at zero inference cost.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Halo } from "./classify.js";
import { JevError } from "./client.js";
import { DecisionLog, RollingMetrics } from "./logstore.js";
import { TokenBucket, Semaphore } from "./ratelimit.js";

const PORT = Number(process.env.HALO_PORT ?? 8787);
const MODE = process.env.HALO_MODE === "enforce" ? "enforce" : "shadow";
const MAX_BODY = 1 << 20; // 1 MiB
const RATE = Number(process.env.HALO_RATE_PER_SEC ?? 200);
const BURST = Number(process.env.HALO_BURST ?? 400);
const MAX_INFLIGHT = Number(process.env.HALO_MAX_INFLIGHT ?? 32);
const LOG_PATH = process.env.HALO_LOG ?? "logs/decisions.jsonl";

const halo = new Halo({ escalate: process.env.HALO_ESCALATE !== "0" });
const log = new DecisionLog(LOG_PATH);
const metrics = new RollingMetrics();
const bucket = new TokenBucket({ ratePerSec: RATE, burst: BURST });
const sem = new Semaphore(MAX_INFLIGHT);

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    return json(res, 200, { ok: true, service: "halo", version: "0.1.0", mode: MODE });
  }
  if (req.method === "GET" && req.url === "/metrics") {
    return json(res, 200, { mode: MODE, ...metrics.snapshot() });
  }
  if (req.method === "GET" && req.url === "/stats") {
    return json(res, 200, { mode: MODE, inflight: sem.inFlight, queue_depth: sem.depth, jev: halo.client.summary() });
  }
  if (req.method !== "POST" || req.url !== "/classify") {
    return json(res, 404, { error: "not found; POST /classify" });
  }

  // backpressure: shed load rather than collapse the upstream
  if (!bucket.take()) {
    return json(res, 429, { error: "rate limited", retry_after_ms: 100 });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return json(res, 413, { error: e.message });
  }
  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return json(res, 400, { error: "invalid JSON" });
  }
  if (!event || typeof event !== "object") {
    return json(res, 400, { error: "body must be a HaloEvent object" });
  }

  const requestId = randomUUID();
  await sem.acquire();
  try {
    const env = await halo.classify(event);
    const record = log.write(env, { mode: MODE, request_id: requestId });
    metrics.observe(record);

    return json(res, 200, {
      request_id: requestId,
      mode: MODE,
      enforcing: MODE === "enforce",
      safety: env.verdict.safety,
      subcategory: env.verdict.subcategory,
      confidence: env.verdict.confidence,
      category: env.verdict.category,
      // In shadow mode this is advisory: what HALO WOULD do. The caller must not
      // act on it until mode is enforce.
      tier: env.decision.tier,
      _envelope: env,
    });
  } catch (err) {
    const status = err instanceof JevError && err.kind === "auth" ? 502 : 500;
    return json(res, status, { request_id: requestId, error: "classification failed", detail: err?.message });
  } finally {
    sem.release();
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(s) });
  res.end(s);
}

const shutdown = async () => {
  process.stderr.write("\nHALO draining…\n");
  server.close();
  await log.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, () => {
  process.stderr.write(
    `HALO listening on :${PORT}  mode=${MODE}  log=${LOG_PATH}  ${MODE === "shadow" ? "(observe-only; tiers advisory)" : "(ENFORCING)"}\n`
  );
});
