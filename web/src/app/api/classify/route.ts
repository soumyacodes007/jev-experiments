export const runtime = "nodejs";

const DEFAULT_HALO_API = "http://127.0.0.1:8788";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || typeof (payload as { text?: unknown }).text !== "string") {
    return Response.json({ error: "text_must_be_a_string" }, { status: 400 });
  }

  const text = (payload as { text: string }).text;

  // Accept either a raw HALO event (pasted JSON trajectory) or plain text,
  // which we wrap as a single user turn.
  let event: unknown;
  try {
    const parsed = JSON.parse(text);
    event =
      parsed && typeof parsed === "object" && ("conversation" in parsed || "current_action" in parsed || "prior_tool_calls" in parsed)
        ? parsed
        : { conversation: [{ role: "user", content: text }] };
  } catch {
    event = { conversation: [{ role: "user", content: text }] };
  }

  const upstream = process.env.HALO_API_URL ?? DEFAULT_HALO_API;

  try {
    const response = await fetch(`${upstream.replace(/\/$/u, "")}/classify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
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
        error: "halo_backend_unavailable",
        detail: "Start the HALO service on port 8788 and try again.",
      },
      { status: 503 },
    );
  }
}
