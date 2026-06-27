# BeeGame Local User Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first local-user permission foundation for BeeGame without changing the core runtime or moving persistence to Supabase yet.

**Architecture:** Keep the current local dashboard behavior working, but stop letting the frontend provide ownership. The server derives a local user context, route handlers use named permissions, and local stores remain file-backed while becoming ready for owner-scoped adapters. The initial local user maps to the legacy `dashboard-local` owner internally so existing model settings remain available.

**Tech Stack:** TypeScript, Hono, Bun tests, React frontend service APIs, existing BeeGame dashboard server stores.

---

## File Structure

- Create: `packages/agent-workflow-server/src/auth/user-context.ts`
  - Defines the local user context, role model, permission names, and permission evaluator.
- Modify: `packages/agent-workflow-server/src/app.ts`
  - Derives current user from request context, removes owner query authority, and routes model config operations through the user id.
- Modify: `apps/frontend/src/services/modelConfigApi.ts`
  - Removes `ownerId=dashboard-local` from model config calls.
- Modify: `apps/frontend/src/services/beeGameAdapter.ts`
  - Removes `ownerId=dashboard-local` from intake/model config calls.
- Modify: `packages/agent-workflow-server/src/__tests__/routes.test.ts`
  - Adds route tests for owner derivation and removes tests that require frontend owner query authority.
- Modify: `apps/frontend/src/services/beeGameAdapter.test.ts`
  - Updates fetch expectations to ownerless URLs.
- Modify: `docs/superpowers/specs/2026-06-27-beegame-multi-user-supabase-design.md`
  - Already updated; no implementation edits required.

## Task 1: Server Local User Context and Permissions

**Files:**
- Create: `packages/agent-workflow-server/src/auth/user-context.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/routes.test.ts`

- [ ] **Step 1: Write the failing route test**

Add a test that creates a model config without `ownerId`, then confirms the model is readable without `ownerId`.

```ts
test('derives the default local user for model configs without owner query parameters', async () => {
  const createRes = await app.request('/api/model-configs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Primary LLM',
      provider: 'openai-compatible',
      baseUrl: 'https://llm.example.invalid/v1',
      apiKey: 'sk-dashboard-secret',
      models: { balanced: 'balanced-model' },
      isDefault: true,
    }),
  })
  expect(createRes.status).toBe(200)
  const created = await createRes.json()

  const listRes = await app.request('/api/model-configs')
  expect(listRes.status).toBe(200)
  expect(await listRes.json()).toEqual([
    expect.objectContaining({ id: created.id, name: 'Primary LLM' }),
  ])
})
```

- [ ] **Step 2: Run the failing server test**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/routes.test.ts -t "default local user"
```

Expected before implementation: the test fails because routes still depend on `ownerId` or do not have explicit user context helpers.

- [ ] **Step 3: Add user context helper**

Create `packages/agent-workflow-server/src/auth/user-context.ts`:

```ts
export type BeeGameRole = 'owner' | 'developer' | 'reviewer' | 'viewer'

export type BeeGamePermission =
  | 'workspace.read'
  | 'workspace.manage'
  | 'workspace.manage_members'
  | 'project.read'
  | 'project.create'
  | 'project.delete'
  | 'project.export'
  | 'agent.send_message'
  | 'agent.cancel'
  | 'agent.approve_tool'
  | 'preview.manage'
  | 'assets.upload'
  | 'assets.integrate'
  | 'model_config.manage'
  | 'mcp.manage'
  | 'runtime_settings.manage'
  | 'secrets.manage'

export type BeeGameUserContext = {
  id: string
  role: BeeGameRole
}

export const DEFAULT_LOCAL_USER_ID = 'dashboard-local'

export function getLocalUserContext(): BeeGameUserContext {
  return {
    id: process.env.BEEGAME_LOCAL_USER_ID?.trim() || DEFAULT_LOCAL_USER_ID,
    role: 'owner',
  }
}

export function hasBeeGamePermission(
  user: BeeGameUserContext,
  permission: BeeGamePermission,
): boolean {
  return getRolePermissions(user.role).has(permission)
}

function getRolePermissions(role: BeeGameRole): ReadonlySet<BeeGamePermission> {
  if (role === 'owner') return OWNER_PERMISSIONS
  if (role === 'developer') return DEVELOPER_PERMISSIONS
  if (role === 'reviewer') return REVIEWER_PERMISSIONS
  return VIEWER_PERMISSIONS
}

const VIEWER_PERMISSIONS = new Set<BeeGamePermission>([
  'workspace.read',
  'project.read',
  'project.export',
])

const REVIEWER_PERMISSIONS = new Set<BeeGamePermission>([
  ...VIEWER_PERMISSIONS,
])

const DEVELOPER_PERMISSIONS = new Set<BeeGamePermission>([
  ...REVIEWER_PERMISSIONS,
  'project.create',
  'agent.send_message',
  'agent.cancel',
  'agent.approve_tool',
  'preview.manage',
  'assets.upload',
  'assets.integrate',
])

const OWNER_PERMISSIONS = new Set<BeeGamePermission>([
  ...DEVELOPER_PERMISSIONS,
  'workspace.manage',
  'workspace.manage_members',
  'project.delete',
  'model_config.manage',
  'mcp.manage',
  'runtime_settings.manage',
  'secrets.manage',
])
```

- [ ] **Step 4: Run the focused server test**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/routes.test.ts -t "default local user"
```

Expected: PASS.

## Task 2: Remove Frontend Owner Query Authority

**Files:**
- Modify: `apps/frontend/src/services/modelConfigApi.ts`
- Modify: `apps/frontend/src/services/beeGameAdapter.ts`
- Modify: `apps/frontend/src/services/beeGameAdapter.test.ts`

- [ ] **Step 1: Write/update frontend service expectations**

Update tests so model config and intake calls use:

```text
/api/model-configs
/api/beegame-intake/options
```

and no longer expect:

```text
?ownerId=dashboard-local
```

- [ ] **Step 2: Update service URLs**

Change `modelConfigApi.ts` to:

```ts
export const listModelConfigs = (): Promise<ModelConfig[]> => (
  apiClient.get('/api/model-configs')
)

export const createModelConfig = (input: CreateModelConfigInput): Promise<ModelConfig> => (
  apiClient.post('/api/model-configs', input)
)

export const updateModelConfig = (id: string, input: UpdateModelConfigInput): Promise<ModelConfig> => (
  apiClient.patch(`/api/model-configs/${id}`, input)
)
```

Change BeeGame adapter URLs from owner query URLs to ownerless URLs.

- [ ] **Step 3: Run frontend service tests**

Run:

```bash
cd apps/frontend && npm run test:run -- src/services/beeGameAdapter.test.ts
```

Expected: PASS.

## Task 3: Server Routes Use Current User

**Files:**
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/routes.test.ts`

- [ ] **Step 1: Replace owner query usage**

In `app.ts`, import the local context:

```ts
import {
  getLocalUserContext,
  hasBeeGamePermission,
} from './auth/user-context'
```

Use this helper inside `createAgentWorkflowApp`:

```ts
const getCurrentUser = () => getLocalUserContext()
```

Then change model config routes to use `getCurrentUser().id` instead of `getOwnerId(c.req.query('ownerId'))`.

- [ ] **Step 2: Protect model config mutations**

Before create/update/delete model config operations, require `model_config.manage`:

```ts
const user = getCurrentUser()
if (!hasBeeGamePermission(user, 'model_config.manage')) {
  return c.json({ error: 'Forbidden' }, 403)
}
```

For the local default user this passes because the local user is owner.

- [ ] **Step 3: Remove stale `getOwnerId` helper if unused**

After route updates, run:

```bash
rg -n "getOwnerId|ownerId=dashboard-local|OWNER_ID" packages/agent-workflow-server/src apps/frontend/src
```

Expected: no production runtime references. Test fixtures may still mention old URLs until Task 4 completes.

- [ ] **Step 4: Run server route tests**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/routes.test.ts --timeout 20000
```

Expected: PASS.

## Task 4: Clean Test Fixtures and Static Scan

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/routes.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`
- Modify: `apps/frontend/src/services/beeGameAdapter.test.ts`

- [ ] **Step 1: Replace test URLs**

Replace test-only calls that use:

```text
/api/model-configs?ownerId=dashboard-local
/api/beegame-intake/options?ownerId=dashboard-local
```

with:

```text
/api/model-configs
/api/beegame-intake/options
```

- [ ] **Step 2: Keep explicit owner tests only where they test backward compatibility**

If backward compatibility is intentionally kept, place those tests in one named test:

```text
accepts legacy ownerId query without treating it as authorization
```

Otherwise remove owner query usage entirely.

- [ ] **Step 3: Run static scan**

Run:

```bash
rg -n "ownerId=dashboard-local|const OWNER_ID = 'dashboard-local'|getOwnerId\\(" apps/frontend/src packages/agent-workflow-server/src
```

Expected: no matches in production files.

- [ ] **Step 4: Run focused tests**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/routes.test.ts packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts --timeout 20000
cd apps/frontend && npm run test:run -- src/services/beeGameAdapter.test.ts src/services/modelConfigApi.test.ts
```

Expected: PASS, except `modelConfigApi.test.ts` may not exist. If it does not exist, run only `beeGameAdapter.test.ts`.

## Task 5: Typecheck and Commit

**Files:**
- All files modified above.

- [ ] **Step 1: Run typecheck**

Run:

```bash
/Users/nswell/.bun/bin/bun run typecheck
```

Expected: PASS.

- [ ] **Step 2: Check git diff**

Run:

```bash
git diff --stat
git status --short
```

Expected: source changes plus the plan/spec doc changes. `Projects/` may remain untracked and should not be added.

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/specs/2026-06-27-beegame-multi-user-supabase-design.md docs/superpowers/plans/2026-06-27-beegame-local-user-permissions.md packages/agent-workflow-server/src/auth/user-context.ts packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/__tests__/routes.test.ts packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts apps/frontend/src/services/modelConfigApi.ts apps/frontend/src/services/beeGameAdapter.ts apps/frontend/src/services/beeGameAdapter.test.ts
git commit -m "feat: add BeeGame local user permission foundation"
```

Expected: commit succeeds without adding `Projects/`.

## Self-Review

- Spec coverage: Covers the first implementation slice of the multi-user/permission spec: local user context, named permissions, frontend owner removal, and route-level model config authorization.
- Deferred by design: Supabase Auth, RLS migrations, encrypted secret storage, member management UI, and project-level sharing. These require a second implementation plan after this local foundation lands.
- Placeholder scan: No `TBD`, `TODO`, or unspecified test commands.
- Type consistency: Role and permission names match the design document.
