# Secure Web Preview Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict managed Web previews to authenticated project readers without persisting preview credentials, while preserving the existing Web preview lifecycle.

**Architecture:** Keep `BeeGamePreviewManager` responsible for starting and proxying Web servers. Add a small, in-memory access-grant manager that translates a one-time authenticated bootstrap URL into a scoped browser cookie; every `/previews/:sessionId/*` request validates that cookie before proxying. The dashboard requests an ephemeral bootstrap URL and never embeds canonical preview metadata directly.

**Tech Stack:** Bun, TypeScript, Hono, React, Vitest via `bun test`.

---

## File structure

- Create `packages/agent-workflow-server/src/beegame/preview-access-manager.ts`: opaque grant/session lifecycle, cookie parsing/serialization, and deterministic clock/random injection for tests.
- Modify `packages/agent-workflow-server/src/beegame/preview-manager.ts`: add explicit `kind: 'web'`, `engine: 'web'`, and a monotonic preview generation used to revoke access on start/restart/stop.
- Modify `packages/agent-workflow-server/src/app.ts`: issue authenticated access URLs, consume bootstrap grants, validate proxy cookies, and revoke grants as lifecycle changes.
- Modify `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`: replace the anonymous-iframe assertion with access-control coverage.
- Modify `apps/frontend/src/services/api.ts` and `apps/frontend/src/services/beeGameAdapter.ts`: expose `BeeGamePreviewAccessPayload` and the project access request.
- Modify `apps/frontend/src/components/Demiurge/DashboardView.tsx`: acquire/clear access URLs around preview lifecycle operations.
- Modify `apps/frontend/src/components/Demiurge/BeeGameLivePreviewPage.tsx` and its test: render/open only the ephemeral bootstrap URL and show access expiration separately from build failure.

### Task 1: Define and test preview access grants

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/preview-access-manager.ts`
- Test: `packages/agent-workflow-server/src/__tests__/preview-access-manager.test.ts`

- [ ] **Step 1: Write failing access-manager tests**

```ts
test('consumes a grant once and creates a session for its user and preview generation', () => {
  const manager = new PreviewAccessManager({ now: () => now, randomId: () => 'opaque-id' })
  const grant = manager.issue({ userId: 'owner-a', projectId: 'project-a', sessionId: 'session-a', generation: 3 })
  expect(manager.consumeGrant(grant.token, { sessionId: 'session-a', generation: 3 })).toMatchObject({ userId: 'owner-a' })
  expect(manager.consumeGrant(grant.token, { sessionId: 'session-a', generation: 3 })).toBeUndefined()
})

test('rejects expired and revoked browser sessions', () => {
  let now = new Date('2026-07-10T00:00:00.000Z')
  const manager = new PreviewAccessManager({ now: () => now, randomId: () => crypto.randomUUID() })
  const grant = manager.issue({ userId: 'owner-a', projectId: 'project-a', sessionId: 'session-a', generation: 3 })
  const session = manager.consumeGrant(grant.token, { sessionId: 'session-a', generation: 3 })
  now = new Date('2026-07-10T01:00:00.000Z')
  expect(manager.authorize(session?.token, { sessionId: 'session-a', generation: 3 })).toBeUndefined()
})
```

- [ ] **Step 2: Run the focused test to verify RED**

Run: `bun test packages/agent-workflow-server/src/__tests__/preview-access-manager.test.ts`

Expected: FAIL because `PreviewAccessManager` does not exist.

- [ ] **Step 3: Implement the minimal in-memory manager**

```ts
export class PreviewAccessManager {
  issue(input: PreviewAccessSubject): PreviewAccessGrant
  consumeGrant(token: string, expected: PreviewAccessTarget): PreviewAccessSession | undefined
  authorize(cookieValue: string | undefined, expected: PreviewAccessTarget): PreviewAccessSession | undefined
  revoke(sessionId: string): void
}
```

Use `randomUUID()` by default, fixed TTL configuration, opaque map keys, and exact comparisons for session ID and generation. Do not encode identity in a client token.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `bun test packages/agent-workflow-server/src/__tests__/preview-access-manager.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/preview-access-manager.ts packages/agent-workflow-server/src/__tests__/preview-access-manager.test.ts
git commit -m "feat: add preview access grants"
```

### Task 2: Make Web preview identity and revocation explicit

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/preview-manager.ts:13-24,107-220`
- Test: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`

- [ ] **Step 1: Write failing lifecycle assertions**

```ts
expect(started).toMatchObject({ kind: 'web', engine: 'web' })
expect(restarted.generation).toBeGreaterThan(started.generation)
expect(stopped.generation).toBe(restarted.generation)
```

- [ ] **Step 2: Run the relevant route test to verify RED**

Run: `bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts --test-name-pattern "managed preview process"`

Expected: FAIL because snapshot fields are absent.

- [ ] **Step 3: Add only Web capability and generation fields**

```ts
type BeeGamePreviewSnapshot = {
  kind: 'web'
  engine: 'web'
  generation: number
  // existing fields
}
```

Increment generation whenever a process set is replaced or stopped. Preserve existing script discovery and Web proxy behavior; do not add native-engine detection.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run: `bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts --test-name-pattern "managed preview process"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/preview-manager.ts packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts
git commit -m "feat: identify managed previews as web"
```

### Task 3: Gate preview proxy traffic and add authenticated bootstrap routes

**Files:**
- Modify: `packages/agent-workflow-server/src/app.ts:296-309,1050-1155,3130-3188,3708-3805`
- Modify: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts:6400-6460`

- [ ] **Step 1: Replace the anonymous iframe test with failing security tests**

```ts
expect((await app.request('/previews/beegame_iframe_preview/')).status).toBe(404)
const access = await app.request('/api/beegame-sessions/beegame_iframe_preview/preview/access', { headers: ownerHeaders })
const bootstrap = await app.request((await access.json()).accessUrl)
expect(bootstrap.status).toBe(302)
expect(bootstrap.headers.get('set-cookie')).toContain('HttpOnly')
expect((await app.request('/previews/beegame_iframe_preview/', { headers: { cookie } })).status).toBe(200)
```

Add cases for a different owner, grant reuse, restart revocation, and a canonical build URL containing no access token.

- [ ] **Step 2: Run focused security tests to verify RED**

Run: `bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts --test-name-pattern "preview.*access|iframe"`

Expected: FAIL because direct preview requests still return 200 and access routes do not exist.

- [ ] **Step 3: Implement the shared access route helper and bootstrap handler**

```ts
async function issuePreviewAccess(request: Request, user: BeeGameUserContext, projectId: string): Promise<BeeGamePreviewAccessPayload>
function handlePreviewBootstrap(c: Context): Response
function handlePreviewProxy(c: Context): Promise<Response>
```

The project helper must use `project.read`, existing ownership resolution, and the current running snapshot. The session helper must use the existing session ownership guard. Bootstrap consumes one grant, sets a path-scoped `HttpOnly; SameSite=Strict` cookie (append `Secure` outside local HTTP), and redirects to the canonical root. Proxy validates the cookie and exact preview generation before calling `proxyBeeGamePreviewRequest`.

Revoke access before start, restart, and stop process operations. Remove wildcard CORS from proxy responses; retain HTML console injection only after authorization.

- [ ] **Step 4: Run focused server tests to verify GREEN**

Run: `bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts --test-name-pattern "preview.*access|iframe|managed preview process|Vite base"`

Expected: PASS.

- [ ] **Step 5: Run the full server test suite**

Run: `bun test packages/agent-workflow-server/src/__tests__`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts
git commit -m "fix: require authenticated preview access"
```

### Task 4: Expose ephemeral preview access to the dashboard

**Files:**
- Modify: `apps/frontend/src/services/api.ts:191-205,1030-1055`
- Modify: `apps/frontend/src/services/beeGameAdapter.ts:658-672`
- Test: `apps/frontend/src/services/beeGameAdapter.test.ts`

- [ ] **Step 1: Write failing adapter tests**

```ts
const access = await beeGameAdapter.getProjectPreviewAccess('project_runtime')
expect(access).toEqual({ status: 'ready', accessUrl: '/previews/session/access/opaque' })
expect(fetch).toHaveBeenCalledWith('/api/projects/project_runtime/preview/access', expect.anything())
```

- [ ] **Step 2: Run adapter test to verify RED**

Run: `bun test apps/frontend/src/services/beeGameAdapter.test.ts --test-name-pattern "preview access"`

Expected: FAIL because the API type and adapter method do not exist.

- [ ] **Step 3: Add the narrow public API surface**

```ts
export interface BeeGamePreviewAccessPayload {
  status: 'ready' | 'unavailable'
  accessUrl?: string
  expiresAt?: string
  message?: string
}

getProjectPreviewAccess(projectId: string): Promise<BeeGamePreviewAccessPayload>
```

Use the existing authenticated JSON fetch helpers; do not cache or persist the response.

- [ ] **Step 4: Run adapter test to verify GREEN**

Run: `bun test apps/frontend/src/services/beeGameAdapter.test.ts --test-name-pattern "preview access"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/services/api.ts apps/frontend/src/services/beeGameAdapter.ts apps/frontend/src/services/beeGameAdapter.test.ts
git commit -m "feat: expose preview access bootstrap"
```

### Task 5: Use access URLs in the preview UI

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/DashboardView.tsx:328-361,601-628`
- Modify: `apps/frontend/src/components/Demiurge/BeeGameLivePreviewPage.tsx:35-55,141-230,438-461`
- Test: `apps/frontend/src/components/Demiurge/DashboardView.test.tsx`

- [ ] **Step 1: Write failing UI tests**

```ts
apiMocks.getProjectPreviewAccess.mockResolvedValue({ status: 'ready', accessUrl: '/previews/proj_1/access/opaque' })
expect(await screen.findByTestId('beegame-live-preview-frame')).toHaveAttribute('src', '/previews/proj_1/access/opaque')
expect(screen.getByLabelText('Open live preview')).toBeEnabled()
```

Add one test that a refresh/start/restart gets a new access URL, and one that unavailable access leaves the canonical build report intact while showing the recovery state.

- [ ] **Step 2: Run UI test to verify RED**

Run: `bun test apps/frontend/src/components/Demiurge/DashboardView.test.tsx --test-name-pattern "preview access"`

Expected: FAIL because the frame currently uses `build_url` directly.

- [ ] **Step 3: Implement ephemeral UI state**

```ts
const [previewAccessUrl, setPreviewAccessUrl] = useState('')
const refreshPreviewAccess = async () => {
  const access = await api.getProjectPreviewAccess(projectId)
  setPreviewAccessUrl(access.status === 'ready' ? access.accessUrl || '' : '')
}
```

Call it after live status is loaded and after start/restart; clear it before stop and when the project changes. Pass it as a distinct prop to `BeeGameLivePreviewPage`, which uses it for `iframe.src` and external open while retaining canonical `build_url` solely for build state.

- [ ] **Step 4: Run UI test to verify GREEN**

Run: `bun test apps/frontend/src/components/Demiurge/DashboardView.test.tsx --test-name-pattern "preview access|built game URL|managed preview"`

Expected: PASS.

- [ ] **Step 5: Run typecheck and affected frontend tests**

Run: `bun run typecheck && bun test apps/frontend/src/services/beeGameAdapter.test.ts apps/frontend/src/components/Demiurge/DashboardView.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/Demiurge/DashboardView.tsx apps/frontend/src/components/Demiurge/BeeGameLivePreviewPage.tsx apps/frontend/src/components/Demiurge/DashboardView.test.tsx
git commit -m "feat: embed previews through access grants"
```

### Task 6: Final regression and documentation check

**Files:**
- Modify if needed: `apps/frontend/DEPLOYMENT.md`
- Test: existing server and frontend suites

- [ ] **Step 1: Write a deployment assertion or documentation test where the project has one**

Append this section to `apps/frontend/DEPLOYMENT.md`:

```md
## Protected managed previews

Managed preview URLs require a short-lived authenticated browser access session.
`/previews/*` is not a public sharing URL. Deploy the dashboard and runtime on
the same site so the runtime can use its scoped HttpOnly preview cookie.
```

- [ ] **Step 2: Run static validation**

Run: `bun run check && bun run typecheck`

Expected: PASS.

- [ ] **Step 3: Run end-to-end affected suites**

Run: `bun test packages/agent-workflow-server/src/__tests__ apps/frontend/src/services/beeGameAdapter.test.ts apps/frontend/src/components/Demiurge/DashboardView.test.tsx`

Expected: PASS.

- [ ] **Step 4: Inspect the final diff and commit**

```bash
git diff --check
git status --short
git add apps/frontend/DEPLOYMENT.md
git commit -m "docs: describe protected web previews"
```

Only include `apps/frontend/DEPLOYMENT.md` in this final commit if it changed.
