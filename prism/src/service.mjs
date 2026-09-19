import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { JevHttpError } from "./jev-client.mjs";

const MAX_BODY_BYTES = 1_000_000;

export function createPrismServer({ detector, host = "127.0.0.1", port = 8787 }) {
  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    const started = performance.now();
    try {
      if (request.method === "GET" && request.url === "/health") {
        return sendJson(response, 200, { status: "ok" });
      }
      if (request.method !== "POST" || request.url !== "/v1/mask") {
        return sendJson(response, 404, { error: "not_found", request_id: requestId });
      }

      const body = await readJson(request);
      if (typeof body.text !== "string") {
        return sendJson(response, 400, {
          error: "text_must_be_a_string",
          request_id: requestId,
        });
      }
      const result = await detector.detect(body.text);
      logRequest({
        requestId,
        status: 200,
        elapsed: performance.now() - started,
        inputLength: body.text.length,
        detections: result.detections.length,
        meta: result.meta,
      });
      return sendJson(response, 200, { request_id: requestId, ...result });
    } catch (error) {
      const unavailable =
        error instanceof JevHttpError ||
        error?.name === "TimeoutError" ||
        error?.name === "AbortError" ||
        error instanceof TypeError;
      const status =
        error?.code === "BODY_TOO_LARGE"
          ? 413
          : error?.code === "INVALID_JSON"
            ? 400
            : unavailable
              ? 503
              : 500;
      logRequest({
        requestId,
        status,
        elapsed: performance.now() - started,
        error: error?.name ?? "Error",
      });
      return sendJson(response, status, {
        error:
          status === 503
            ? "detector_unavailable_fail_closed"
            : error?.code === "INVALID_JSON"
              ? "invalid_json"
              : "request_failed",
        request_id: requestId,
      });
    }
  });

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve(server.address());
        });
      });
    },
    close() {
      return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("Invalid JSON body.");
    error.code = "INVALID_JSON";
    throw error;
  }
}

function sendJson(response, status, body) {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serialized),
    "cache-control": "no-store",
  });
  response.end(serialized);
}

function logRequest(event) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`);
}
