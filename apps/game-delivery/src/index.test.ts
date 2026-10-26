import { describe, expect, test } from "bun:test";
import { createDeliveryWorker } from "./index.js";

const deploymentId = "deploy-123";
const sourceHtml = "<!doctype html><html><head><title>Game</title></head><body>Play</body></html>";
const manifest = {
  version: 1,
  deploymentId,
  files: [{
    path: "index.html",
    byteSize: new TextEncoder().encode(sourceHtml).byteLength,
    contentType: "text/html; charset=utf-8",
    sha256: "0".repeat(64),
  }],
};

function worker() {
  const rpcRequests: string[] = [];
  const delivery = createDeliveryWorker({
    fetchImpl: (async (input) => {
      rpcRequests.push(String(input));
      return Response.json(true);
    }) as typeof fetch,
  });
  const bucket = {
    get: async (key: string) => key.endsWith("manifest.json")
      ? { body: JSON.stringify(manifest) }
      : { body: sourceHtml },
  };
  return { delivery, env: {
    DELIVERY_BUCKET: bucket,
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_ANON_KEY: "anon-key",
    PORTAL_ORIGIN: "https://portal.test",
  }, rpcRequests };
}

describe("delivery source verification", () => {
  test("returns stored HTML without the play bridge for the verification query", async () => {
    const { delivery, env } = worker();
    const raw = await delivery.fetch(
      new Request(`https://games.test/deployments/${deploymentId}/files/index.html?bgs_verification=raw`),
      env,
    );
    expect(await raw.text()).toBe(sourceHtml);
  });

  test("keeps bridge injection on the ordinary public page", async () => {
    const { delivery, env } = worker();
    const page = await delivery.fetch(
      new Request(`https://games.test/deployments/${deploymentId}/files/index.html`),
      env,
    );
    const body = await page.text();
    expect(body).toContain("beegame:play");
    expect(body).not.toBe(sourceHtml);
  });
});
