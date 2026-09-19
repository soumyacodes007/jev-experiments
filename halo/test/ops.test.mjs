import { test } from "node:test";
import assert from "node:assert/strict";
import { TokenBucket, Semaphore } from "../src/ratelimit.js";
import { RollingMetrics } from "../src/logstore.js";

test("token bucket allows a burst then throttles", () => {
  const b = new TokenBucket({ ratePerSec: 0, burst: 3 });
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), true);
  assert.equal(b.take(), false, "burst exhausted, no refill at rate 0");
});

test("token bucket refills over time", async () => {
  const b = new TokenBucket({ ratePerSec: 1000, burst: 1 });
  assert.equal(b.take(), true);
  assert.equal(b.take(), false);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(b.take(), true, "refilled after ~20ms at 1000/s");
});

test("semaphore caps concurrency and queues the rest", async () => {
  const s = new Semaphore(2);
  await s.acquire();
  await s.acquire();
  assert.equal(s.inFlight, 2);
  let third = false;
  const p = s.acquire().then(() => (third = true));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(third, false, "third acquire is queued");
  s.release();
  await p;
  assert.equal(third, true, "third proceeds after a release");
});

test("rolling metrics aggregate tier and safety", () => {
  const m = new RollingMetrics();
  m.observe({ tier: "BLOCK", subcategory: "CREDENTIAL_STEALING_LEAKAGE", mode: "shadow", safety: "UNSAFE", latency_ms: 400 });
  m.observe({ tier: "ALLOW", subcategory: "NONE", mode: "shadow", safety: "SAFE", latency_ms: 100 });
  m.observe({ tier: "ALLOW", subcategory: "NONE", mode: "shadow", safety: "SAFE", prefilter_hit: true, latency_ms: 1 });
  const s = m.snapshot();
  assert.equal(s.total, 3);
  assert.equal(s.unsafe, 1);
  assert.equal(s.by_tier.ALLOW, 2);
  assert.equal(s.by_tier.BLOCK, 1);
  assert.ok(s.latency_ms.p50 >= 0);
});
