import { playBridgeScript } from "./play-bridge.js";
var DEFAULT_CONTENT_SECURITY_POLICY = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https: wss:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");
function createDeliveryWorker(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async fetch(request, env) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return response("Method Not Allowed", 405, {
          allow: "GET, HEAD",
          "content-type": "text/plain; charset=utf-8",
        });
      }
      const route = parseDeliveryRoute(new URL(request.url).pathname);
      if (!route) return notFound();
      if (!(await isDeploymentPublic(fetchImpl, env, route.deploymentId))) {
        return notFound();
      }
      const manifestObject = await env.DELIVERY_BUCKET.get(
        `deployments/${route.deploymentId}/manifest.json`,
      );
      if (!manifestObject) return notFound();
      const manifest = await readManifest(manifestObject, route.deploymentId);
      if (!manifest) return notFound();
      const requestedFile = manifest.files.find(
        (file) => file.path === route.filePath,
      );
      const target =
        requestedFile ??
        (route.allowsSpaFallback
          ? manifest.files.find((file) => file.path === "index.html")
          : void 0);
      if (!target) return notFound();
      const object = await env.DELIVERY_BUCKET.get(
        `deployments/${route.deploymentId}/files/${target.path}`,
      );
      if (!object) return notFound();
      const headers = deliveryHeaders(
        target.contentType,
        env.CONTENT_SECURITY_POLICY,
      );
      const result = new Response(
        request.method === "HEAD" ? null : object.body,
        { status: 200, headers },
      );
      if (
        request.method === "GET" &&
        target.path === "index.html" &&
        target.contentType.toLowerCase().startsWith("text/html")
      ) {
        return new HTMLRewriter()
          .on("head", {
            element(element) {
              element.prepend(
                playBridgeScript(
                  route.deploymentId,
                  env.PORTAL_ORIGIN || "https://portal.beegame.studio",
                ),
                { html: true },
              );
            },
          })
          .transform(result);
      }
      return result;
    },
  };
}
var index_default = createDeliveryWorker();
async function isDeploymentPublic(fetchImpl, env, deploymentId) {
  const configuredSupabaseUrl = env.SUPABASE_URL?.trim();
  const supabaseUrl = configuredSupabaseUrl?.endsWith("/")
    ? configuredSupabaseUrl.slice(0, -1)
    : configuredSupabaseUrl;
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) return false;
  try {
    const result = await fetchImpl(
      `${supabaseUrl}/rest/v1/rpc/beegame_is_deployment_public`,
      {
        method: "POST",
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ p_deployment_id: deploymentId }),
        signal: AbortSignal.timeout(3e3),
      },
    );
    if (!result.ok) return false;
    return (await result.json()) === true;
  } catch {
    return false;
  }
}
function parseDeliveryRoute(pathname) {
  const rawParts = pathname.split("/").filter(Boolean);
  if (rawParts[0] !== "deployments" || !rawParts[1]) return void 0;
  const deploymentId = rawParts[1];
  if (!isSafeIdentifier(deploymentId)) return void 0;
  const fileParts =
    rawParts[2] === "files" ? rawParts.slice(3) : rawParts.slice(2);
  const decoded = [];
  for (const part of fileParts) {
    let value;
    try {
      value = decodeURIComponent(part);
    } catch {
      return void 0;
    }
    if (
      !value ||
      value === "." ||
      value === ".." ||
      value.includes("\\") ||
      value.includes("\0")
    ) {
      return void 0;
    }
    decoded.push(value);
  }
  const filePath = decoded.join("/") || "index.html";
  const lastSegment = decoded[decoded.length - 1] ?? "";
  return {
    deploymentId,
    filePath,
    allowsSpaFallback: decoded.length === 0 || !lastSegment.includes("."),
  };
}
function isSafeIdentifier(value) {
  if (value.length < 8 || value.length > 160) return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    const allowed =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      character === "-" ||
      character === "_";
    if (!allowed) return false;
  }
  return true;
}
async function readManifest(object, deploymentId) {
  try {
    const parsed = JSON.parse(await new Response(object.body).text());
    if (
      parsed.version !== 1 ||
      parsed.deploymentId !== deploymentId ||
      !Array.isArray(parsed.files)
    ) {
      return void 0;
    }
    const files = [];
    const seen = /* @__PURE__ */ new Set();
    for (const candidate of parsed.files) {
      if (!candidate || typeof candidate !== "object") return void 0;
      const file = candidate;
      if (
        typeof file.path !== "string" ||
        !isSafeFilePath(file.path) ||
        seen.has(file.path) ||
        !Number.isSafeInteger(file.byteSize) ||
        Number(file.byteSize) < 0 ||
        typeof file.contentType !== "string" ||
        !file.contentType ||
        file.contentType.length > 200 ||
        typeof file.sha256 !== "string" ||
        file.sha256.length !== 64
      )
        return void 0;
      seen.add(file.path);
      files.push(file);
    }
    if (!seen.has("index.html")) return void 0;
    return { version: 1, deploymentId, files };
  } catch {
    return void 0;
  }
}
function isSafeFilePath(path) {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  )
    return false;
  return path
    .split("/")
    .every((part) => Boolean(part) && part !== "." && part !== "..");
}
function deliveryHeaders(contentType, contentSecurityPolicy) {
  return new Headers({
    "content-type": contentType,
    "cache-control": contentType.toLowerCase().startsWith("text/html")
      ? "public, max-age=0, must-revalidate"
      : "public, max-age=31536000, immutable",
    "content-security-policy":
      contentSecurityPolicy?.trim() || DEFAULT_CONTENT_SECURITY_POLICY,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "cross-origin",
  });
}
function notFound() {
  return response("Not Found", 404, {
    "content-type": "text/plain; charset=utf-8",
  });
}
function response(body, status, headers) {
  return new Response(body, { status, headers });
}
export { createDeliveryWorker, index_default as default };
