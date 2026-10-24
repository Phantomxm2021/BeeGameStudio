import { describe, expect, it } from "bun:test";
import { recordPortalEvent } from "./analytics";
import type { GamePortalEnv } from "./worker";
const event = {
  projectId: "game_1",
  kind: "play",
  dedupId: "00000000-0000-4000-8000-000000000001",
  visitorId: "00000000-0000-4000-8000-000000000002",
};
const env = {
  BEEGAME_SUPABASE_URL: "https://db.test",
  BEEGAME_SUPABASE_SERVICE_ROLE_KEY: "server-only",
} as GamePortalEnv;
const request = (body: unknown = event, origin = "https://portal.test") =>
  new Request("https://portal.test/api/events", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "cf-connecting-ip": "192.0.2.1",
    },
    body: JSON.stringify(body),
  });
describe("public event ingestion", () => {
  it("keeps event keys and dedup IDs, hashes the address and uses only the server key", async () => {
    let body: any, headers: any;
    const result = await recordPortalEvent(
      request(),
      env,
      async (_url, init) => {
        body = JSON.parse(String(init?.body));
        headers = init?.headers;
        return Response.json({ status: "ok", counted: true, playCount: 1 });
      },
    );
    expect(await result.json()).toEqual({ counted: true, playCount: 1 });
    expect(body.p_dedup_id).toBe(event.dedupId);
    expect(body.p_client_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(body)).not.toContain("192.0.2.1");
    expect(headers.authorization).toBe("Bearer server-only");
  });
  it("rejects foreign origins, invalid events and large bodies before any database write", async () => {
    let writes = 0;
    const fetcher = async () => {
      writes++;
      return Response.json({ status: "ok" });
    };
    expect(
      (
        await recordPortalEvent(
          request(event, "https://elsewhere.test"),
          env,
          fetcher,
        )
      ).status,
    ).toBe(403);
    for (const body of [
      null,
      { ...event, projectId: 123 },
      { ...event, dedupId: [event.dedupId] },
      { ...event, kind: "purchase" },
      { ...event, dedupId: "fake" },
    ])
      expect(
        (await recordPortalEvent(request(body), env, fetcher)).status,
      ).toBe(400);
    expect(
      (
        await recordPortalEvent(
          request({ ...event, extra: "a".repeat(3000) }),
          env,
          fetcher,
        )
      ).status,
    ).toBe(413);
    expect(writes).toBe(0);
  });
  it("preserves deduplication and rate-limit results without inventing counts", async () => {
    const duplicate = await recordPortalEvent(request(), env, async () =>
      Response.json({ status: "ok", counted: false, playCount: 10 }),
    );
    expect(await duplicate.json()).toEqual({ counted: false, playCount: 10 });
    expect(
      (
        await recordPortalEvent(request(), env, async () =>
          Response.json({ status: "rate_limited" }),
        )
      ).status,
    ).toBe(429);
    expect(
      (
        await recordPortalEvent(request(), env, async () =>
          Response.json({ status: "not_found" }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await recordPortalEvent(request(), env, async () => {
          throw Error("secret");
        })
      ).status,
    ).toBe(503);
  });
});
