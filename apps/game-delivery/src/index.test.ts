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


describe("retained publication authorization", () => {
  test("migration accepts the two owned manifest scopes without dropping public-file checks", async () => {
    const sql = await Bun.file(new URL("../../../supabase/migrations/20261103010000_retained_publication_delivery_authorization.sql", import.meta.url)).text();
    expect(sql).toContain("manifest.owner_user_id = deployment.owner_id");
    expect(sql).toContain("manifest.project_id = deployment.project_id");
    expect(sql).toContain("manifest.scope_type = 'project'");
    expect(sql).toContain("manifest.scope_id = deployment.project_id");
    expect(sql).toContain("deployment.portal_published_at is not null");
    expect(sql).toContain("manifest.project_id is null");
    expect(sql).toContain("manifest.deployment_id = deployment.id");
    expect(sql).toContain("manifest.scope_type = 'deployment'");
    expect(sql).toContain("manifest.scope_id = deployment.id");
    for (const check of ["deployment.status = 'succeeded'", "deployment.url <> ''", "deployment.artifact_path is not null", "manifest.provider = 'r2'", "manifest.bucket_role = 'delivery'", "manifest.object_kind = 'deployment_manifest'", "manifest.status = 'ready'", "manifest.visibility = 'public'", "manifest.deleted_at is null", "manifest.metadata ->> 'deployment_id' = deployment.id"])
      expect(sql).toContain(check);
    expect(sql).not.toMatch(/\b(grant|revoke|delete|update)\s/i);
  });

  test.each([false, "rpc-error"])("still refuses unauthorized or unavailable release: %s", async verdict => {
    let reads = 0;
    const delivery = createDeliveryWorker({ fetchImpl: (async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ p_deployment_id: deploymentId });
      return verdict === "rpc-error" ? new Response("Unavailable", { status: 503 }) : Response.json(false);
    }) as typeof fetch });
    const { env } = worker();
    const result = await delivery.fetch(new Request(`https://games.test/deployments/${deploymentId}/files/index.html`), {
      ...env,
      DELIVERY_BUCKET: { get: async () => { reads++; return null; } },
    });
    expect(result.status).toBe(404);
    expect(reads).toBe(0);
  });
});
