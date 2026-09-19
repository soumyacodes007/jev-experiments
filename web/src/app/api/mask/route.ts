export const runtime = "nodejs";

const DEFAULT_PRISM_API = "http://127.0.0.1:8787";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as { text?: unknown }).text !== "string"
  ) {
    return Response.json({ error: "text_must_be_a_string" }, { status: 400 });
  }

  const upstream = process.env.PRISM_API_URL ?? DEFAULT_PRISM_API;

  try {
    const response = await fetch(`${upstream.replace(/\/$/u, "")}/v1/mask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });

    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch {
    return Response.json(
      {
        error: "prism_backend_unavailable",
        detail: "Start the PRISM service on port 8787 and try again.",
      },
      { status: 503 },
    );
  }
}
