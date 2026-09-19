import test from "node:test";
import assert from "node:assert/strict";
import { createPrismServer } from "../src/service.mjs";

test("HTTP service exposes health and masking without logging input text", async () => {
  const detector = {
    async detect(text) {
      return {
        masked_text: text.replace("jane@example.com", "[EMAIL]"),
        detections: [{ start: 8, end: 24, category: "IDENTITY", subtype: "EMAIL" }],
        taxonomy_version: "test",
        model: "fake",
        meta: { api_calls: 1, input_tokens: 10, latency_ms: 1 },
      };
    },
  };
  await withServer(detector, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const response = await fetch(`${baseUrl}/v1/mask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Contact jane@example.com" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.masked_text, "Contact [EMAIL]");
    assert.equal(body.detections[0].subtype, "EMAIL");
    assert.equal(typeof body.request_id, "string");
  });
});

test("HTTP service rejects malformed JSON and fails closed when detection fails", async () => {
  const detector = {
    async detect() {
      throw new TypeError("upstream unavailable");
    },
  };
  await withServer(detector, async (baseUrl) => {
    const malformed = await fetch(`${baseUrl}/v1/mask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad",
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, "invalid_json");

    const unavailable = await fetch(`${baseUrl}/v1/mask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "secret" }),
    });
    assert.equal(unavailable.status, 503);
    assert.equal(
      (await unavailable.json()).error,
      "detector_unavailable_fail_closed",
    );
  });
});

async function withServer(detector, callback) {
  const service = createPrismServer({ detector, host: "127.0.0.1", port: 0 });
  const address = await service.listen();
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await service.close();
  }
}
