# AI Resource Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select compatible published resource-library elements for project asset slots and persist an auditable binding in the platform-neutral project asset manifest.

**Architecture:** The resource core owns deterministic candidate filtering and scoring. The resource server exposes a signed, published-only selection endpoint. The workflow server owns project authorization and writes a `resource_binding` into the existing asset contract; the frontend displays the bound source in the Assets panel.

**Tech Stack:** TypeScript, Bun test runner, Hono workflow routes, Supabase-backed resource repository, React.

---

### Task 1: Define the selection manifest in the resource core

**Files:**
- Modify: `packages/beegame-resource-core/src/types.ts`
- Modify: `packages/beegame-resource-core/src/repository.ts`
- Create: `packages/beegame-resource-core/src/selection.ts`
- Test: `packages/beegame-resource-core/src/__tests__/selection.test.ts`

- [ ] **Step 1: Write failing selection tests**

```ts
test('selects only published ready elements compatible with a 3D environment slot', () => {
  const result = selectResourceCandidates(packs, elements, request)
  expect(result.selections).toEqual([expect.objectContaining({ elementId: 'oak-glb' })])
  expect(result.selections[0].reasons).toContain('category:models')
})

test('uses stable Pack and element ids as a deterministic tie break', () => {
  expect(selectResourceCandidates(packs, elements, request).selections[0].elementId).toBe('a-model')
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `bun test packages/beegame-resource-core/src/__tests__/selection.test.ts`

Expected: FAIL because `selectResourceCandidates` does not exist.

- [ ] **Step 3: Add request, selection, and manifest types**

```ts
export type ResourceSlotRequirement = {
  slotId: string; category?: ResourceCategory; dimension?: ResourceDimension
  acceptedFormats?: readonly string[]; styles?: readonly string[]
  gameTypes?: readonly string[]; purpose?: string
}
export type ResourceSelection = {
  slotId: string; packId: string; packVersion: string; elementId: string
  elementPath: string; score: number; reasons: readonly string[]
}
```

- [ ] **Step 4: Implement filtering and scoring in `selection.ts`**

Reject non-published Packs and non-ready elements before scoring. Normalize comparisons by values already stored in metadata, match dimensions only when both sides specify a non-agnostic dimension, and sort by descending score then Pack id then element id.

- [ ] **Step 5: Run core tests and commit**

Run: `bun test packages/beegame-resource-core/src/__tests__/selection.test.ts`

Expected: PASS.

Commit: `git commit -am "feat: add deterministic resource selection core"`

### Task 2: Publish a signed library selection endpoint

**Files:**
- Modify: `packages/beegame-resource-server/src/app.ts`
- Modify: `packages/beegame-resource-server/src/index.ts`
- Test: `packages/beegame-resource-server/src/__tests__/selection-route.test.ts`

- [ ] **Step 1: Write failing route tests**

```ts
test('returns signed published resource selections for valid requirements', async () => {
  const response = await app.request('/api/resource-selections', {
    method: 'POST', body: JSON.stringify({ requirements: [{ slotId: 'tree', category: 'models' }] }),
  })
  expect((await response.json()).selections[0]).toEqual(expect.objectContaining({ sourceUrl: expect.any(String) }))
})

test('does not return a draft Pack element', async () => { /* selection list is empty */ })
```

- [ ] **Step 2: Run route tests and verify failure**

Run: `bun test packages/beegame-resource-server/src/__tests__/selection-route.test.ts`

Expected: FAIL with route not found.

- [ ] **Step 3: Add `POST /api/resource-selections`**

Parse an array of typed requirements, load candidate Packs/elements through the repository, call the core selector, and sign only each selected object path. Do not expose Storage credentials or include draft/hidden/failed resources.

- [ ] **Step 4: Run server tests and TypeScript check**

Run: `bun test packages/beegame-resource-server/src/__tests__/selection-route.test.ts && bunx tsc -p packages/beegame-resource-server/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `git commit -am "feat: expose signed resource selections"`

### Task 3: Persist project resource bindings in the asset contract

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/asset-contracts.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Test: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`

- [ ] **Step 1: Write a failing contract test**

```ts
test('binds a library selection to an owned project asset slot', async () => {
  const response = await app.request('/api/projects/project_1/assets/tree/resource-binding', { method: 'POST', body: JSON.stringify(selection) })
  expect((await response.json()).slot.resource_binding).toEqual(expect.objectContaining({ element_id: 'oak-glb' }))
})
```

- [ ] **Step 2: Verify the test fails**

Run: `bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts --test-name-pattern="binds a library selection"`

Expected: FAIL with route not found.

- [ ] **Step 3: Add `resource_binding` normalization and an asset-contract update helper**

```ts
export type BeeGameResourceBinding = {
  pack_id: string; pack_version: string; element_id: string
  source_url: string; selected_at: string; selection_reason: string[]
}
```

The helper finds a normalized slot id, replaces only `resource_binding`, preserves the target path and user upload fields, and writes the manifest atomically.

- [ ] **Step 4: Add the protected route**

Require `assets.upload`, ownership of `:id`, and a valid normalized selection payload. Persist through the same dashboard manifest synchronization used by file uploads. Return the updated slot and manifest.

- [ ] **Step 5: Run tests and commit**

Run: `bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts --test-name-pattern="resource binding"`

Expected: PASS.

Commit: `git commit -am "feat: persist project resource bindings"`

### Task 4: Display and replace bound library sources in the project Assets panel

**Files:**
- Modify: `apps/frontend/src/services/api.ts`
- Modify: `apps/frontend/src/components/Demiurge/Sidebar/AssetsPanel.tsx`
- Modify: `apps/frontend/src/components/Demiurge/Sidebar/AssetsPanel.test.tsx`

- [ ] **Step 1: Write a failing panel test**

```tsx
test('shows a bound Pack and element as the slot source', () => {
  render(<AssetsPanel manifest={{ version: 1, slots: [{ id: 'tree', resource_binding: { pack_id: 'fantasy', element_id: 'oak-glb' } }] }} />)
  expect(screen.getByText('fantasy')).toBeInTheDocument()
  expect(screen.getByText('oak-glb')).toBeInTheDocument()
})
```

- [ ] **Step 2: Verify the test fails**

Run: `npm --prefix apps/frontend test -- --run src/components/Demiurge/Sidebar/AssetsPanel.test.tsx`

Expected: FAIL because the payload has no `resource_binding` field.

- [ ] **Step 3: Extend the frontend payload and render a distinct Library source row**

Show Pack, element, and selection reason. Do not present a signed URL as user-facing content. The existing file upload state stays visible as a different source.

- [ ] **Step 4: Run frontend test and build**

Run: `npm --prefix apps/frontend test -- --run src/components/Demiurge/Sidebar/AssetsPanel.test.tsx && npm --prefix apps/frontend run build`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `git commit -am "feat: show library-bound project assets"`

### Task 5: Verify the complete selection-to-project contract flow

**Files:**
- Test: `packages/beegame-resource-server/src/__tests__/selection-route.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`
- Test: `apps/frontend/src/components/Demiurge/Sidebar/AssetsPanel.test.tsx`

- [ ] **Step 1: Add an end-to-end contract fixture**

Create one published compatible Pack element and one draft incompatible element. Select the compatible element, bind it to a project slot, reload the manifest, and assert the same Pack id, version, element id, and reason are preserved.

- [ ] **Step 2: Run focused test suites**

Run: `bun test packages/beegame-resource-core/src/__tests__/selection.test.ts packages/beegame-resource-server/src/__tests__/selection-route.test.ts && bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts --test-name-pattern="resource binding" && npm --prefix apps/frontend test -- --run src/components/Demiurge/Sidebar/AssetsPanel.test.tsx`

Expected: PASS.

- [ ] **Step 3: Commit verification coverage**

Commit: `git commit -am "test: cover resource selection contract flow"`
