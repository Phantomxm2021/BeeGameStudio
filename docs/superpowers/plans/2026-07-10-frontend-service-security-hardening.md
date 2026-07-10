# Frontend Service Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the audited client/service security gaps without changing the game-build workflow: credentials never leave trusted origins, outbound connections are policy-controlled, untrusted uploads are bounded and inspected, and authorization is verified at every server boundary.

**Architecture:** Keep browser services thin and untrusted. Put security controls in three shared server-side boundaries: `outbound-target-policy` for all egress, `secret-crypto` for persisted credentials, and `upload-policy` for all binary/text imports. Replace browser-persisted Supabase refresh tokens with an HttpOnly server session in a separately deployable migration, so rollback remains possible.

**Tech Stack:** TypeScript, Hono, Node `crypto` and `dns/promises`, Supabase Auth, Vitest, existing BeeGame dashboard repository and stores.

---

## Scope and delivery order

1. Immediate controls: browser token containment, encoded identifiers, request-size limits, client-side avatar allowlist. These are already implemented in the frontend audit working tree and must be committed with their regression tests.
2. Server trust-boundary controls: outbound target validation, upload validation, and endpoint authorization tests. These can be released independently of the session migration.
3. Secret encryption and migration: encrypt model/MCP/web-tool credentials at rest, migrate legacy plaintext records, and fail closed when the encryption key is absent in production.
4. Session migration: use HttpOnly cookies for Supabase sessions. This requires a controlled production rollout because it changes login persistence.

## Files and responsibilities

- `apps/frontend/src/services/apiClient.ts` — browser auth header policy; must never attach an application token to a non-API origin.
- `apps/frontend/src/services/supabaseAuthApi.ts` — browser OAuth UI only after session migration; no refresh token persistence.
- `apps/frontend/src/services/chatAttachments.ts` — client UX preflight only; server remains authoritative.
- `packages/agent-workflow-server/src/security/outbound-target-policy.ts` — canonical URL, DNS, port, and private-network egress policy.
- `packages/agent-workflow-server/src/security/secret-crypto.ts` — versioned AES-256-GCM envelope encryption and key loading.
- `packages/agent-workflow-server/src/security/upload-policy.ts` — count, byte, filename, MIME, magic-byte, and archive-entry policy.
- `packages/agent-workflow-server/src/app.ts` — route-level validation, authorization, response redaction, and policy integration.
- `packages/agent-workflow-server/src/mcp-servers-store.ts` — encrypt MCP environment values before local persistence.
- `packages/agent-workflow-server/src/model-config-store.ts` — encrypt local model configuration secrets before local persistence.
- `packages/agent-workflow-server/src/supabase-dashboard-store.ts` — store ciphertext rather than raw API keys and redact every read response.
- `packages/beegame-skills-core/src/routes.ts` and `packages/beegame-skills-core/src/store.ts` — zip import constraints and safe skill-package extraction.
- `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts` — route authorization, SSRF, and upload integration tests.
- `packages/agent-workflow-server/src/__tests__/security-*.test.ts` — focused unit tests for crypto, egress, and upload policy.

### Task 1: Commit and lock the immediate browser controls

**Files:**
- Modify: `apps/frontend/src/services/apiClient.ts`
- Modify: `apps/frontend/src/services/chatAttachments.ts`
- Modify: `apps/frontend/src/services/supabaseAuthApi.ts`
- Modify: `apps/frontend/src/services/api.ts`
- Modify: `apps/frontend/src/services/beeGameAdapter.ts`
- Test: `apps/frontend/src/services/apiClient.test.ts`
- Test: `apps/frontend/src/services/chatAttachments.test.ts`

- [ ] **Step 1: Keep production browser tokens disabled and test the invariant**

`getEnvAuthToken()` must return an empty string whenever `import.meta.env.MODE === 'production'`; `VITE_BEEGAME_ALLOW_DEV_AUTH_TOKEN` must not override this. Add a test that supplies both variables and asserts that the request has no `Authorization` header.

- [ ] **Step 2: Keep credentials on trusted API origins only**

Implement and retain this contract in `authenticatedFetch`:

```ts
const isTrustedApiRequest = (input: RequestInfo | URL): boolean => {
  const raw = typeof input === 'string' ? input : input.toString();
  const pageOrigin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const requestUrl = new URL(raw, pageOrigin);
  const apiUrl = new URL(API_BASE_URL || pageOrigin, pageOrigin);
  return requestUrl.origin === apiUrl.origin;
};
```

Pass the boolean to `buildAuthHeadersAsync`. Test `https://external.example.test/resource` receives no bearer token, while `/api/current-user` receives the valid session token.

- [ ] **Step 3: Bound browser attachment conversion**

Keep `MAX_CHAT_ATTACHMENTS = 8`, `MAX_CHAT_ATTACHMENT_TOTAL_BYTES = 32 * 1024 * 1024`, and per-file `MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024`. Select at most eight files and stop before the aggregate byte limit before calling `FileReader`.

- [ ] **Step 4: Encode every client-side path and query identifier**

Use `encodeURIComponent` for all path segments and query values in `api.ts`, `beeGameAdapter.ts`, and `modelConfigApi.ts`. Do not encode the full path string; encode each supplied ID individually.

- [ ] **Step 5: Verify and commit**

Run:

```bash
cd apps/frontend
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run src/services/apiClient.test.ts src/services/chatAttachments.test.ts src/services/supabaseAuthApi.test.ts --reporter=dot
cd ../..
npm run typecheck
```

Expected: all selected tests pass and TypeScript exits 0.

```bash
git add apps/frontend/src/services
git commit -m "security: harden frontend service boundaries"
```

### Task 2: Add one server-side outbound target policy

**Files:**
- Create: `packages/agent-workflow-server/src/security/outbound-target-policy.ts`
- Create: `packages/agent-workflow-server/src/__tests__/outbound-target-policy.test.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `packages/agent-workflow-server/src/mcp-active-discovery.ts`

- [ ] **Step 1: Write failing policy tests**

Cover these inputs with an injectable resolver; do not rely on live DNS in tests:

```ts
await expect(validateOutboundTarget('http://127.0.0.1:8000', { resolve })).rejects.toThrow('private network');
await expect(validateOutboundTarget('http://169.254.169.254/latest', { resolve })).rejects.toThrow('private network');
await expect(validateOutboundTarget('file:///etc/passwd', { resolve })).rejects.toThrow('https or http');
await expect(validateOutboundTarget('https://api.example.com/v1', { resolve })).resolves.toMatchObject({ hostname: 'api.example.com' });
```

- [ ] **Step 2: Implement `validateOutboundTarget`**

Accept only `https:` by default; permit `http:` only when `BEEGAME_ALLOW_INSECURE_OUTBOUND_HTTP=1` and the resolved address is not loopback, link-local, private, multicast, or unspecified. Resolve every hostname immediately before connecting, reject IPv4/IPv6 private ranges, reject credentials in URLs, and permit only ports `443` and `80` unless an explicit admin allowlist entry permits another port.

Expose an options object with `resolve4`, `resolve6`, `allowHttp`, and `allowedHosts` so tests never make a network call.

- [ ] **Step 3: Integrate the policy at all egress points**

Call the policy before:

- model `baseUrl` is saved or used for OpenAI-compatible calls;
- MCP `http`/`sse` URL is saved, tested, or actively discovered;
- web-tool custom endpoint URL is saved or fetched.

Reject invalid data with HTTP 400 and a stable public message: `Outbound URL is not permitted`. Log only hostname, policy reason, and trace id; never log credentials or full query strings.

- [ ] **Step 4: Verify and commit**

Run:

```bash
cd packages/agent-workflow-server
bun test src/__tests__/outbound-target-policy.test.ts src/__tests__/beegame-routes.test.ts
```

Expected: SSRF/private-address cases fail at validation and public HTTPS cases pass.

```bash
git add packages/agent-workflow-server/src/security packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/mcp-active-discovery.ts packages/agent-workflow-server/src/__tests__
git commit -m "security: restrict outbound service targets"
```

### Task 3: Encrypt stored service credentials and migrate plaintext data

**Files:**
- Create: `packages/agent-workflow-server/src/security/secret-crypto.ts`
- Create: `packages/agent-workflow-server/src/__tests__/secret-crypto.test.ts`
- Modify: `packages/agent-workflow-server/src/model-config-store.ts`
- Modify: `packages/agent-workflow-server/src/mcp-servers-store.ts`
- Modify: `packages/agent-workflow-server/src/supabase-dashboard-store.ts`
- Modify: `packages/agent-workflow-server/src/local-data-migration.ts`

- [ ] **Step 1: Write failing encryption and migration tests**

Test encryption round-trip, tampered ciphertext rejection, unknown key-version rejection, and migration from a legacy plaintext `apiKey` fixture:

```ts
const cipher = encryptSecret('sk-live-value', keyRing);
expect(cipher).not.toContain('sk-live-value');
expect(decryptSecret(cipher, keyRing)).toBe('sk-live-value');
expect(() => decryptSecret(`${cipher}x`, keyRing)).toThrow('Invalid encrypted secret');
```

- [ ] **Step 2: Implement versioned AES-256-GCM envelopes**

Load `BEEGAME_CONFIG_ENCRYPTION_KEY` as base64-encoded 32 bytes. Store values as `v1.<iv-base64url>.<tag-base64url>.<ciphertext-base64url>`. Use `randomBytes(12)` for IVs and authenticate the record type as additional authenticated data, for example `model-config:api-key` and `mcp-server:env`.

In production, missing or malformed key configuration must prevent startup. In local development, allow plaintext only when `BEEGAME_ALLOW_PLAINTEXT_SECRETS=1`; emit a startup warning with no secret values.

- [ ] **Step 3: Change persistence contracts**

Persist encrypted values in local JSON stores and the existing Supabase `*_ciphertext` columns. Public DTOs must expose only `apiKeyPreview` / `valuePreview`; never return ciphertext or raw values. Preserve an omitted update field as “keep existing secret”, and reserve an explicit `clearSecret: true` field for deletion.

- [ ] **Step 4: Add idempotent legacy migration**

When loading a legacy record whose secret does not start with `v1.`, decrypt is not attempted: encrypt it, atomically rewrite the local store, and append an audit event `secret.migrated`. For Supabase records, run a one-shot admin migration command that updates only plaintext rows. Record counts only; do not record IDs or values in production logs.

- [ ] **Step 5: Verify and commit**

Run:

```bash
cd packages/agent-workflow-server
bun test src/__tests__/secret-crypto.test.ts src/__tests__/local-data-migration.test.ts src/__tests__/dashboard-repository.test.ts
```

Expected: no persisted fixture contains a plaintext key and all public API fixtures contain only masked previews.

```bash
git add packages/agent-workflow-server/src/security packages/agent-workflow-server/src/model-config-store.ts packages/agent-workflow-server/src/mcp-servers-store.ts packages/agent-workflow-server/src/supabase-dashboard-store.ts packages/agent-workflow-server/src/local-data-migration.ts packages/agent-workflow-server/src/__tests__
git commit -m "security: encrypt persisted service credentials"
```

### Task 4: Enforce server-authoritative upload policy

**Files:**
- Create: `packages/agent-workflow-server/src/security/upload-policy.ts`
- Create: `packages/agent-workflow-server/src/__tests__/upload-policy.test.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `packages/beegame-skills-core/src/routes.ts`
- Modify: `packages/beegame-skills-core/src/store.ts`
- Test: `packages/beegame-skills-core/src/routes.test.ts`

- [ ] **Step 1: Write failing upload policy tests**

Cover a Base64 attachment over 10 MiB, more than eight attachments, an aggregate payload over 32 MiB, a file whose claimed PNG MIME does not match its magic bytes, a `../SKILL.md` zip entry, a zip with more than 128 entries, and a zip with an uncompressed total over 10 MiB.

- [ ] **Step 2: Implement `validateBeeGameAttachments`**

Decode Base64 in a bounded streaming-compatible path, reject invalid padding, enforce the same count/per-file/total limits as the client, allow only the documented MIME/extension pairs, and verify magic bytes for PNG, JPEG, WebP, PDF, ZIP-based Office documents, and JSON/text encodings. Return normalized media type, byte length, and a safe basename; do not return raw payload in validation errors.

- [ ] **Step 3: Implement safe skill archive extraction**

Require `.zip`, reject absolute paths and path traversal after POSIX normalization, require exactly one root `SKILL.md`, allow only UTF-8 text files, cap individual entry, archive entry count, and total uncompressed bytes, and reject symbolic links. Store normalized relative paths only.

- [ ] **Step 4: Wire route controls and response redaction**

Use `validateBeeGameAttachments` in both `/api/beegame-intake/analyze-attachments` and chat input routes before model invocation or workspace materialization. Use the skill archive validator before `parseSkillZipPackage`. Return one generic 400 message and a request trace id; record detailed policy reasons only in server logs.

- [ ] **Step 5: Verify and commit**

Run:

```bash
cd packages/agent-workflow-server
bun test src/__tests__/upload-policy.test.ts src/__tests__/routes.test.ts
cd ../beegame-skills-core
bun test src/routes.test.ts
```

Expected: malformed and oversized inputs are rejected before file writes or model calls.

```bash
git add packages/agent-workflow-server/src/security packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/__tests__ packages/beegame-skills-core/src
git commit -m "security: validate uploads before processing"
```

### Task 5: Make every privileged action server-authoritative

**Files:**
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `packages/beegame-skills-core/src/routes.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/routes.test.ts`

- [ ] **Step 1: Create a privilege matrix test**

For each route family—model configs, web tools, runtime settings, MCP, user skills, credits admin, lifecycle admin, project delete/export, asset integration—issue requests as `viewer`, `developer`, and the required privileged role. Assert 403 before repository access and no audit event on denial.

- [ ] **Step 2: Centralize route guards**

Define a typed route-policy map:

```ts
const ROUTE_PERMISSION = {
  modelConfig: 'model_config.manage',
  webTools: 'secrets.manage',
  runtimeSettings: 'runtime_settings.manage',
  mcp: 'mcp.manage',
  userSkills: 'skills.manage',
} as const;
```

Use `requirePermission` once per route family and keep ownership checks in `DashboardRepository` for project-scoped records. Never rely on the frontend’s hidden buttons or supplied user id.

- [ ] **Step 3: Redact user-facing errors**

Replace raw `toErrorMessage(err)` responses for privileged configuration routes with `{ error: 'Invalid configuration', traceId }`. Preserve cause and stack only in structured server logs. Keep field-level messages only for non-sensitive schema errors.

- [ ] **Step 4: Verify and commit**

Run:

```bash
cd packages/agent-workflow-server
bun test src/__tests__/beegame-routes.test.ts src/__tests__/routes.test.ts
```

Expected: all unauthorized requests return 403, and sensitive backend failures are not returned in response bodies.

```bash
git add packages/agent-workflow-server/src/app.ts packages/beegame-skills-core/src/routes.ts packages/agent-workflow-server/src/__tests__
git commit -m "security: enforce privileged route contracts"
```

### Task 6: Migrate Supabase sessions to HttpOnly cookies

**Files:**
- Create: `packages/agent-workflow-server/src/auth/session-routes.ts`
- Create: `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `apps/frontend/src/services/supabaseAuthApi.ts`
- Modify: `apps/frontend/src/services/apiClient.ts`
- Modify: `apps/frontend/src/services/supabaseAuthApi.test.ts`

- [ ] **Step 1: Introduce server session endpoints behind a feature flag**

When `BEEGAME_HTTPONLY_SESSIONS=1`, add `/api/auth/session`, `/api/auth/session/refresh`, and `/api/auth/session/logout`. The server exchanges Supabase OAuth/password tokens, stores the refresh token in an encrypted server-side session record, and sets a `Secure; HttpOnly; SameSite=Lax; Path=/` session cookie. CSRF-protect state-changing cookie-authenticated routes with a double-submit token or `Origin` validation.

- [ ] **Step 2: Make the browser cookie-first**

Set `credentials: 'include'` for same-origin API requests. Remove refresh-token writes from `localStorage`; retain only transient OAuth PKCE context in `sessionStorage`. During the flag rollout, read the legacy local session once, post it to `/api/auth/session`, clear local storage only after a successful cookie response, and never re-create it.

- [ ] **Step 3: Test session security properties**

Assert cookie attributes, no refresh token in browser storage after migration, CSRF rejection for cross-origin mutation, and successful refresh using only the cookie/session id.

- [ ] **Step 4: Roll out and commit**

Deploy with the flag disabled, verify session metrics and cookie domain configuration in staging, enable for internal users, then remove the legacy branch after one release window.

```bash
git add packages/agent-workflow-server/src/auth apps/frontend/src/services
git commit -m "security: move auth sessions to HttpOnly cookies"
```

### Task 7: Operational rollout, auditability, and release gate

**Files:**
- Create: `docs/security/service-hardening-runbook.md`
- Modify: `.env.example`
- Modify: `packages/agent-workflow-server/src/index.ts`
- Test: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`

- [ ] **Step 1: Document required production configuration**

Document `BEEGAME_CONFIG_ENCRYPTION_KEY`, `BEEGAME_HTTPONLY_SESSIONS`, outbound host allowlists, upload limits, and the one-time legacy secret migration. Explicitly state that `VITE_API_AUTH_TOKEN` is development-only and must not be configured in production.

- [ ] **Step 2: Add redacted security audit events**

Record `outbound_target.rejected`, `upload.rejected`, `secret.migrated`, `privileged_route.denied`, and `session.migrated` with actor id, resource type, policy code, and trace id. Do not record URL query strings, uploaded filenames, raw stack traces, API keys, tokens, or attachment contents.

- [ ] **Step 3: Run release verification**

```bash
npm run typecheck
cd apps/frontend && conda run -n xrmoddemiurge ./node_modules/.bin/vitest run --silent --reporter=dot
cd ../../packages/agent-workflow-server && bun test
cd ../..
git diff --check
```

Expected: all suites pass, no plaintext secret remains in generated local-store fixtures, and the production startup check fails closed without an encryption key.

- [ ] **Step 4: Commit the release documentation**

```bash
git add docs/security .env.example packages/agent-workflow-server/src/index.ts packages/agent-workflow-server/src/__tests__
git commit -m "docs: add service security hardening runbook"
```

## Acceptance criteria

- A browser token cannot be sent to an external origin, and production does not accept `VITE_API_AUTH_TOKEN`.
- Private, loopback, link-local, credential-bearing, and non-policy outbound targets are rejected before connection.
- Model, MCP, and web-tool secrets are encrypted at rest, redacted in public responses and audit logs, and legacy plaintext records migrate once.
- Invalid, oversized, spoofed, or traversal-containing uploads are rejected before parsing, workspace writes, or model calls.
- Every privileged route rejects unauthorized users server-side, independently of frontend visibility.
- Supabase refresh tokens are no longer persisted in browser storage after the HttpOnly-session rollout.
- Full frontend and server test suites pass with no secrets in test output or fixtures.
