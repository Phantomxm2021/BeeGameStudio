import type { GamePortalEnv } from "./worker";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const kinds = new Set(["visit", "play", "banner_impression", "banner_click"]);
const reply = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function recordPortalEvent(
  request: Request,
  env: GamePortalEnv,
  fetchImpl: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response> = fetch,
): Promise<Response> {
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return reply({ error: "forbidden" }, 403);
  if (/bot\b|crawler|spider/i.test(request.headers.get("user-agent") || ""))
    return reply({ counted: false }, 200);
  if (!env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY)
    return reply({ error: "unavailable" }, 503);
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: "invalid_event" }, 400);
  let bytes = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 2048) {
        await reader.cancel();
        return reply({ error: "event_too_large" }, 413);
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    const event = JSON.parse(text);
    if (
      !event ||
      typeof event.projectId !== "string" ||
      typeof event.dedupId !== "string" ||
      typeof event.visitorId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(event.projectId || "") ||
      !kinds.has(event.kind) ||
      !uuid.test(event.dedupId || "") ||
      !uuid.test(event.visitorId || "")
    )
      return reply({ error: "invalid_event" }, 400);
    // An IP is used only for a short-lived rate bucket; raw addresses are never stored.
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const hash = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(
        new Date().toISOString().slice(0, 10) +
          ":" +
          (request.headers.get("cf-connecting-ip") || "local"),
      ),
    );
    const clientHash = [...new Uint8Array(hash)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const response = await fetchImpl(
      new URL(
        "/rest/v1/rpc/beegame_portal_record_event",
        env.BEEGAME_SUPABASE_URL,
      ),
      {
        method: "POST",
        headers: {
          apikey: env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          p_project_id: event.projectId,
          p_kind: event.kind,
          p_dedup_id: event.dedupId,
          p_visitor_id: event.visitorId,
          p_client_hash: clientHash,
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) return reply({ error: "unavailable" }, 503);
    const value = (await response.json()) as {
      status: string;
      counted?: boolean;
      playCount?: number;
    };
    if (value.status === "rate_limited")
      return reply({ error: "rate_limited" }, 429);
    if (value.status === "not_found") return reply({ error: "not_found" }, 404);
    if (value.status !== "ok") return reply({ error: "unavailable" }, 503);
    return reply(
      { counted: value.counted === true, playCount: value.playCount },
      200,
    );
  } catch (error) {
    return reply(
      { error: error instanceof SyntaxError ? "invalid_event" : "unavailable" },
      error instanceof SyntaxError ? 400 : 503,
    );
  }
}
