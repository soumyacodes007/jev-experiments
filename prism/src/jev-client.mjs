const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export class JevHttpError extends Error {
  constructor(message, { status, body, retryable = false } = {}) {
    super(message);
    this.name = "JevHttpError";
    this.status = status;
    this.body = body;
    this.retryable = retryable;
  }
}

export class JevClient {
  constructor({
    apiKey,
    endpoint = DEFAULT_ENDPOINT,
    model = "jev-1.13.0",
    timeoutMs = 45_000,
    maxRetries = 3,
    fetchImpl = globalThis.fetch,
  }) {
    if (!apiKey) throw new Error("JevClient requires apiKey");
    if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.fetchImpl = fetchImpl;
  }

  async evaluate({ state, questions }) {
    const started = performance.now();
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ model: this.model, state, questions }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const bodyText = await response.text();
        let body;
        try {
          body = bodyText ? JSON.parse(bodyText) : {};
        } catch {
          body = { raw: bodyText.slice(0, 500) };
        }

        if (!response.ok) {
          const retryable = response.status === 429 || response.status === 529;
          const error = new JevHttpError(
            `Jev returned HTTP ${response.status}`,
            { status: response.status, body, retryable },
          );
          if (!retryable || attempt === this.maxRetries) throw error;
          const retryAfter = Number(response.headers.get("retry-after"));
          await delay(
            Number.isFinite(retryAfter)
              ? retryAfter * 1000
              : backoffMilliseconds(attempt),
          );
          continue;
        }

        validateResponse(body, questions);
        return {
          ...body,
          latency_ms: Math.round(performance.now() - started),
          attempts: attempt + 1,
        };
      } catch (error) {
        lastError = error;
        const retryable =
          error?.retryable ||
          error?.name === "TimeoutError" ||
          error?.name === "AbortError" ||
          error instanceof TypeError;
        if (!retryable || attempt === this.maxRetries) throw error;
        await delay(backoffMilliseconds(attempt));
      }
    }
    throw lastError;
  }
}

function validateResponse(body, questions) {
  if (!body || typeof body !== "object" || !body.answers || !body.usage) {
    throw new Error("Jev response is missing answers or usage.");
  }
  for (const id of Object.keys(questions)) {
    if (!body.answers[id]) throw new Error(`Jev response is missing answer ${id}.`);
  }
}

function backoffMilliseconds(attempt) {
  return Math.min(8_000, 500 * 2 ** attempt + Math.floor(Math.random() * 250));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

