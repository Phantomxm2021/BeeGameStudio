# Resource Library Curation and Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Resource Library metadata reusable after one curation pass, expose valid elements and multi-element bundles to Workflow, and create placeholders only for proven gaps.

**Architecture:** Keep one canonical element record. Technical facts are produced by the existing inspector; semantic usage and style values are confirmed through Pack/folder/element policy and are the only searchable values. A temporary suggestion on the same element record is not searchable and is cleared on confirmation or rejection. The first suggestion provider may only project already-confirmed Pack/folder policy and objectively inspected facts; it must leave unprovable roles pending instead of using filenames, keywords, an LLM or an unbounded heuristic. Resource Core computes element-scoped readiness and bounded candidate bundles; the resource server persists and exposes that result; Resource Curator selects exact returned identities through the existing single inventory commit.

**Tech Stack:** TypeScript, Bun, Zod v4, Supabase REST repository, R2 resource storage, React/Vite frontend, Vitest/Bun tests.

---

## File map

Core contracts and deterministic matching:

- Modify `packages/beegame-resource-core/src/types.ts` for curation suggestions, coverage obligations, element readiness, bundle candidates and diagnostics.
- Modify `packages/beegame-resource-core/src/metadata-policy.ts` for one effective-policy resolver and pending-suggestion helpers.
- Modify `packages/beegame-resource-core/src/publish-readiness.ts` for element-scoped selection readiness while retaining Pack authority checks.
- Modify `packages/beegame-resource-core/src/catalog.ts` for element-level eligibility, set coverage and bounded bundles; remove the whole-Pack selection gate.
- Test `packages/beegame-resource-core/src/__tests__/metadata-policy.test.ts`, `publish-readiness.test.ts`, `catalog.test.ts` and add `curation.test.ts` when the helper has its own contract.
- Add `packages/beegame-resource-core/src/__tests__/fixtures.ts` for neutral typed Pack, folder, element, dependency and match-request builders shared by the core tests.

Resource server persistence and APIs:

- Modify `docs/beegame-supabase-schema.sql` as the single development schema authority; add the temporary suggestion payload to the canonical element row and indexes needed by confirmed metadata.
- Modify `packages/beegame-resource-server/src/supabase-resource-repository.ts` for the new row fields and atomic batch confirmation.
- Modify `packages/beegame-resource-server/src/app.ts` for curation queue, batch confirmation and element-scoped match diagnostics.
- Modify `packages/beegame-resource-server/src/index.ts` so reinspection updates only technical facts and preserves confirmed semantic policy.
- Test `packages/beegame-resource-server/src/__tests__/app.test.ts`, `selection-route.test.ts`, `lifecycle-handlers.test.ts` and add `curation-route.test.ts` for batch behavior.

Workflow integration:

- Modify `packages/agent-workflow-server/src/beegame/native-resource-library-tool.ts` to expose bundles and bounded gaps from the single match result.
- Modify `packages/agent-workflow-server/src/beegame/resource-inventory-commit.ts` to validate exact bundle members while preserving one decision per selected resource and one placeholder per true gap.
- Modify `packages/agent-workflow-server/src/beegame/native-resource-inventory-commit-tool.ts` and `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts` to describe bundle selection without introducing another tool or state path.
- Modify `packages/agent-workflow-server/src/beegame/resource-match-observation.ts` only where the durable observation schema must store the new bounded result.
- Test `packages/agent-workflow-server/src/beegame/resource-inventory-commit.test.ts`, `native-resource-library-tool.test.ts`, `delivery-workflow-resource-integration.test.ts` and recovery tests.

Administration UI:

- Modify `apps/frontend/src/services/resourceLibraryApi.ts` for curation queue and atomic batch-confirmation contracts.
- Modify `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.tsx` to add one Needs Curation workbench, evidence display and Pack/folder/selection batch confirmation.
- Add `apps/frontend/src/components/ResourceLibrary/CurationWorkbench.tsx` and focused tests when the existing view would otherwise own queue state, selection state and editor state together.
- Update `apps/frontend/src/i18n/locales/zh.json` and `en.json` for curation labels and diagnostics.

Verification and cutover:

- Add a focused resource-library system fixture under `packages/beegame-resource-server/src/__tests__/fixtures/` only if existing test builders cannot represent a mixed-quality Pack. The fixture must be generic and use generated IDs, not a game name or production requirement.
- Update `docs/resource-library-production.md` with the one-time canonical reinspection/curation cutover and element-scoped acceptance checks.
- Do not modify any user example project.

### Task 1: Lock the canonical metadata and bundle contracts

**Files:**

- Modify: `packages/beegame-resource-core/src/types.ts`
- Modify: `packages/beegame-resource-core/src/metadata-policy.ts`
- Test: `packages/beegame-resource-core/src/__tests__/metadata-policy.test.ts`
- Test: `packages/beegame-resource-core/src/__tests__/curation.test.ts`

- [ ] **Step 1: Add failing contract tests.**

Add tests for these exact invariants:

```ts
it('keeps a pending semantic suggestion out of effective tags', () => {
  const element = withSuggestion(elementFixture(), suggestionFixture({ usageTags: ['building'] }))
  expect(resolveEffectiveResourceMetadata(packFixture(), [], element).usageTags).toEqual([])
})

it('resolves confirmed element, folder, then Pack policy', () => {
  const element = elementFixture({ usageTagsMode: 'inherit' })
  const folder = folderFixture({ path: 'models/towers', elementDefaults: { usageTags: ['building'] } })
  const pack = packFixture({ elementDefaults: { usageTags: ['prop'] } })
  expect(resolveEffectiveResourceMetadata(pack, [folder], element).usageTags).toEqual(['building'])
})

it('represents a multi-element coverage obligation without requiring one file to contain every fact', () => {
  const result = matchResourceRequirements([packFixture()], [modelFixture(), textureFixture()], {
    requirements: [{
      requirementId: 'resource-1',
      profile: {
        dimensions: ['3D'], assetKinds: ['model', 'texture'], usageTags: ['building'],
        capabilities: [], styles: [],
        coverage: [{ assetKinds: ['model'] }, { assetKinds: ['texture'] }],
      },
    }],
    deliveryCapabilities: [{ sourceFormat: 'glb', disposition: 'direct', targetFormat: 'glb' }, { sourceFormat: 'png', disposition: 'direct', targetFormat: 'png' }],
  })
  expect(result.groups[0].bundles[0].coveredObligations).toHaveLength(2)
})
```

The test builders use neutral generated IDs and authored metadata. Do not use filenames, requirement names, keywords or regular expressions in assertions.

Create the shared builders before the tests so every helper used in the examples is defined. The minimum element helpers are:

```ts
export function elementFixture(overrides: Partial<ResourceElement> = {}): ResourceElement {
  return {
    id: 'element-1', packId: 'pack-1', name: 'element', path: 'root.bin', category: 'models', kind: 'model',
    specs: { contentHash: 'a'.repeat(64), size: 1 }, usageTags: ['building'], assetKind: 'model',
    capabilities: [], dependencies: [], status: 'ready', ...overrides,
  }
}

export function withSuggestion(element: ResourceElement, suggestion: ResourceSemanticSuggestion): ResourceElement {
  return { ...element, semanticSuggestion: suggestion }
}

export function suggestionFixture(overrides: Partial<ResourceSemanticSuggestion> = {}): ResourceSemanticSuggestion {
  return { usageTags: [], styles: [], relations: [], evidence: ['inspected fact'], confidence: 'medium', generatedAt: '2026-01-01T00:00:00.000Z', generatorRevision: 'test', ...overrides }
}
```

`packFixture`, `folderFixture`, `modelFixture`, `textureFixture`, `mixedQualityPacks`, `mixedQualityElements`, and the request builders must return the same typed shapes using generated IDs and the existing `Resource*` enums. They are test-only factories, not production matching inputs.

- [ ] **Step 2: Run the focused tests and verify they fail for missing contracts.**

Run: `bun test packages/beegame-resource-core/src/__tests__/metadata-policy.test.ts packages/beegame-resource-core/src/__tests__/curation.test.ts`

Expected: FAIL because the canonical resolver, suggestion type and coverage/bundle fields do not yet exist.

- [ ] **Step 3: Add the smallest canonical types.**

Add the following shapes to `types.ts`:

```ts
export type ResourceSemanticSuggestion = {
  usageTags: readonly ResourceUsageTag[]
  styles: readonly string[]
  relations: readonly ResourceElementRelation[]
  evidence: readonly string[]
  confidence: 'high' | 'medium' | 'low'
  generatedAt: string
  generatorRevision: string
}

export type ResourceCoverageObligation = {
  assetKinds?: readonly ResourceAssetKind[]
  usageTags?: readonly ResourceUsageTag[]
  capabilities?: readonly ResourceCapability[]
  relationKinds?: readonly ResourceRelationKind[]
  embeddedKinds?: readonly ResourceEmbeddedComponentKind[]
}

export type ResourceAcquisitionProfile = {
  dimensions: readonly ResourceDimension[]
  assetKinds: readonly ResourceAssetKind[]
  usageTags: readonly ResourceUsageTag[]
  capabilities: readonly ResourceCapability[]
  styles: readonly string[]
  coverage?: readonly ResourceCoverageObligation[]
}

export type ResourceRequirementCandidateBundle = {
  bundleId: string
  candidates: readonly ResourceRequirementCandidate[]
  coveredObligations: readonly string[]
  uncoveredObligations: readonly string[]
}

export type ResourceMatchDiagnostic = {
  code: 'missing_semantics' | 'technical_not_ready' | 'dependency_not_ready' | 'delivery_unsupported' | 'coverage_gap'
  count: number
}

export type ResourceRequirementMatchGroup = {
  requirementId: string
  status: 'matched' | 'no-match'
  bundles: readonly ResourceRequirementCandidateBundle[]
  diagnostics: readonly ResourceMatchDiagnostic[]
}
```

Add `semanticSuggestion?: ResourceSemanticSuggestion` to `ResourceElement`. Keep it out of `ResourceCatalogElement`, `ResourceCatalogPack`, facets and match candidates. Keep `usageTags` as the only effective tag field.

- [ ] **Step 4: Implement one effective metadata resolver and clear-on-decision helpers.**

In `metadata-policy.ts`, export:

```ts
export function resolveEffectiveResourceMetadata(
  pack: ResourcePack,
  folders: readonly ResourceFolder[],
  element: ResourceElement,
): ResourceElement

export function confirmSemanticSuggestion(
  element: ResourceElement,
  input: { usageTags: readonly ResourceUsageTag[]; styleOverride?: string },
): ResourceElement

export function rejectSemanticSuggestion(element: ResourceElement): ResourceElement
```

`resolveEffectiveResourceMetadata` must apply element override, nearest folder default, then Pack default, and must ignore `semanticSuggestion`. Confirmation writes canonical element values and sets `usageTagsMode: 'override'` when element-scoped; rejection clears the suggestion without changing confirmed values. No read path may use a suggestion.

Add `buildResourceSemanticSuggestion(pack, folders, element, now, generatorRevision)`. It may suggest only confirmed inherited Pack/folder values and roles objectively present in the inspected content profile. If no such value is provable, it returns `undefined`; it never reads `name`, `path`, filename, Pack marketing tags or free text. This is the complete first provider; adding an external model provider is outside this root fix.

- [ ] **Step 5: Run the focused tests and typecheck the core package.**

Run: `bun test packages/beegame-resource-core/src/__tests__/metadata-policy.test.ts packages/beegame-resource-core/src/__tests__/curation.test.ts && bun run --cwd packages/beegame-resource-core typecheck`

Expected: PASS with the new canonical contracts and no inferred metadata behavior.

- [ ] **Step 6: Commit the contract boundary.**

Run: `git add packages/beegame-resource-core/src/types.ts packages/beegame-resource-core/src/metadata-policy.ts packages/beegame-resource-core/src/__tests__/metadata-policy.test.ts packages/beegame-resource-core/src/__tests__/curation.test.ts && git commit -m "feat: define canonical resource curation contracts"`

### Task 2: Implement element-scoped readiness and deterministic bundle matching

**Files:**

- Modify: `packages/beegame-resource-core/src/publish-readiness.ts`
- Modify: `packages/beegame-resource-core/src/catalog.ts`
- Modify: `packages/beegame-resource-core/src/__tests__/publish-readiness.test.ts`
- Modify: `packages/beegame-resource-core/src/__tests__/catalog.test.ts`

- [ ] **Step 1: Add failing readiness and regression tests.**

Cover these exact cases:

```ts
it('keeps valid roots selectable when an unrelated root is invalid', () => {
  const report = evaluateResourcePackPublishReadiness(packFixture(), [validRoot(), invalidUnrelatedRoot()])
  expect(report.canPublish).toBe(true)
  expect(report.elements.find(item => item.elementId === validRoot().id)?.selectionReady).toBe(true)
  expect(report.elements.find(item => item.elementId === invalidUnrelatedRoot().id)?.selectionReady).toBe(false)
})

it('isolates a root whose required dependency is not ready', () => {
  const report = evaluateResourceElementSelectionReadiness(packFixture(), rootWithDependency(), [rootWithDependency(), failedDependency()])
  expect(report.selectionReady).toBe(false)
  expect(report.blocking.map(issue => issue.code)).toContain('dependency_not_ready')
})

it('forms a bounded bundle from model and texture roots', () => {
  const result = matchResourceRequirements(mixedQualityPacks(), mixedQualityElements(), requestWithModelTextureCoverage())
  expect(result.groups[0].status).toBe('matched')
  expect(result.groups[0].bundles[0].candidates.map(item => item.assetKind)).toEqual(expect.arrayContaining(['model', 'texture']))
})

it('returns no-match only after eligible roots and bundles are exhausted', () => {
  const result = matchResourceRequirements([publishedPack()], [invalidRoot()], requestWithModelCoverage())
  expect(result.groups[0].status).toBe('no-match')
  expect(result.groups[0].diagnostics).toEqual(expect.arrayContaining([{ code: 'technical_not_ready', count: 1 }]))
})
```

- [ ] **Step 2: Run the tests and verify the current whole-Pack gate fails the regression.**

Run: `bun test packages/beegame-resource-core/src/__tests__/publish-readiness.test.ts packages/beegame-resource-core/src/__tests__/catalog.test.ts`

Expected: FAIL for the unrelated-invalid-root and multi-element bundle cases; current matching rejects the Pack before checking individual roots and only returns single-element candidates.

- [ ] **Step 3: Add `evaluateResourceElementSelectionReadiness`.**

Make the function validate the root and its transitive required dependency closure only. It must validate immutable hash, ready status, asset kind, effective semantic tags, external reference bindings, required semantic relations, and delivery capability. Return `{ selectionReady, blocking, warnings, dependencyIds }`. Keep Pack checks for license, version, at least one selectable root, duplicate paths and duplicate hashes, but do not use Pack-level `canPublish` as an element selection gate.

- [ ] **Step 4: Replace the matching admission map.**

In `matchResourceRequirements`, replace the `publishedById` construction that calls `evaluateResourcePackPublishReadiness(...).canPublish` with a per-element readiness map. Build it using the effective metadata resolver and the full element set. Exclude only the root whose readiness is false. Record bounded diagnostic counters by reason; never expose unusable element IDs to Workflow.

- [ ] **Step 5: Implement deterministic coverage and bundle construction.**

For each requirement, create one obligation for each `coverage` entry. A candidate covers an obligation only when its typed asset kind, confirmed usage tags, inspected capabilities, relation kinds and embedded component kinds satisfy that obligation. Hard root constraints remain per element. Build bundles in stable order by pack ID, element ID and candidate delivery disposition; add a candidate only when it covers an uncovered obligation. Limit bundle size and returned bundle count to the existing bounded candidate policy. A complete bundle is `matched`; no complete bundle is `no-match`.

- [ ] **Step 6: Run core tests and typecheck.**

Run: `bun test packages/beegame-resource-core/src/__tests__/publish-readiness.test.ts packages/beegame-resource-core/src/__tests__/catalog.test.ts packages/beegame-resource-core/src/__tests__/metadata-policy.test.ts && bun run --cwd packages/beegame-resource-core typecheck`

Expected: PASS; the tower-kit regression must show valid elements and no Pack-wide exclusion.

- [ ] **Step 7: Commit the element-scoped matcher.**

Run: `git add packages/beegame-resource-core/src/publish-readiness.ts packages/beegame-resource-core/src/catalog.ts packages/beegame-resource-core/src/__tests__/publish-readiness.test.ts packages/beegame-resource-core/src/__tests__/catalog.test.ts && git commit -m "fix: match resources by element readiness and coverage"`

### Task 3: Persist curation state and expose one batch curation API

**Files:**

- Modify: `docs/beegame-supabase-schema.sql`
- Modify: `packages/beegame-resource-server/src/supabase-resource-repository.ts`
- Modify: `packages/beegame-resource-server/src/app.ts`
- Modify: `packages/beegame-resource-server/src/index.ts`
- Test: `packages/beegame-resource-server/src/__tests__/app.test.ts`
- Test: `packages/beegame-resource-server/src/__tests__/lifecycle-handlers.test.ts`
- Add: `packages/beegame-resource-server/src/__tests__/curation-route.test.ts`

- [ ] **Step 1: Add failing API tests for curation and element-scoped publication.**

Test these request contracts:

```ts
it('returns pending suggestions without exposing them through catalog search', async () => {
  const queue = await request('/api/resource-packs/pack/curation')
  expect(queue.items[0].suggestion).toEqual(expect.objectContaining({ confidence: 'medium' }))
  const catalog = await request('/api/resource-catalog/elements?usageTags=building')
  expect(catalog.items).toHaveLength(0)
})

it('confirms a selected batch atomically and clears suggestions', async () => {
  const response = await request('/api/resource-packs/pack/curation/confirm', {
    method: 'POST',
    body: { elementIds: ['e1', 'e2'], usageTags: ['building'], usageTagsMode: 'override' },
  })
  expect(response.updatedElementIds).toEqual(['e1', 'e2'])
  expect(response.elements.every(element => !element.semanticSuggestion)).toBe(true)
})

it('does not fail a published Pack because an unrelated element is invalid', async () => {
  const report = await request('/api/resource-packs/pack/publish-readiness')
  expect(report.canPublish).toBe(true)
  expect(report.elements.find(item => item.elementId === 'valid')?.selectionReady).toBe(true)
})
```

- [ ] **Step 2: Run the server tests and verify the routes/field are absent.**

Run: `bun test packages/beegame-resource-server/src/__tests__/app.test.ts packages/beegame-resource-server/src/__tests__/curation-route.test.ts`

Expected: FAIL because the canonical schema mapping and curation routes do not yet exist.

- [ ] **Step 3: Extend the canonical schema and row mapping.**

Add one nullable `semantic_suggestion jsonb` field to `beegame_resource_elements`, validate its controlled arrays and evidence shape in the repository boundary, and add a GIN index only for confirmed `usage_tags`, `capabilities` and `asset_kind`. Do not create a shadow suggestions table or compatibility view. Map the field in both directions in `supabase-resource-repository.ts`.

- [ ] **Step 4: Add the curation queue and atomic confirmation methods.**

Expose repository methods that return elements with non-null suggestions, resolved effective metadata and blocking readiness codes. Add one batch method that validates every element ID belongs to the Pack, validates the controlled tag vocabulary, updates all selected rows in one repository transaction boundary, and clears `semantic_suggestion` in the same operation. Reject partial success; do not loop through independent mutation requests.

- [ ] **Step 5: Add API endpoints and preserve inspection ownership.**

Add authenticated routes:

- `GET /api/resource-packs/:packId/curation` returns the bounded queue and grouped issue counts;
- `POST /api/resource-packs/:packId/curation/confirm` confirms one Pack/folder/element batch and clears suggestions;
- `POST /api/resource-packs/:packId/curation/reject` clears suggestions and optionally sets `manual-only` in the same batch.

Reinspection may update only technical facts, dependency bindings and inspector provenance. It must preserve confirmed `usageTags`, styles and non-pending semantic relations. Publish readiness returns Pack authority plus per-element selection readiness and issue lists.

Upload and reinspection call `buildResourceSemanticSuggestion` only when the element has no confirmed effective semantic policy. The provider receives the structured inspection result and inherited confirmed policy, never filename/path/free text. If it returns no provable role, the element remains in the queue with no suggestion; administrators can still set one Pack/folder/selection batch.

- [ ] **Step 6: Run server tests and typecheck.**

Run: `bun test packages/beegame-resource-server/src/__tests__/app.test.ts packages/beegame-resource-server/src/__tests__/curation-route.test.ts packages/beegame-resource-server/src/__tests__/lifecycle-handlers.test.ts && bun run --cwd packages/beegame-resource-server typecheck`

Expected: PASS with atomic curation operations, no suggestion search leakage and element-scoped readiness.

- [ ] **Step 7: Commit the curation persistence/API boundary.**

Run: `git add docs/beegame-supabase-schema.sql packages/beegame-resource-server/src/supabase-resource-repository.ts packages/beegame-resource-server/src/app.ts packages/beegame-resource-server/src/index.ts packages/beegame-resource-server/src/__tests__/app.test.ts packages/beegame-resource-server/src/__tests__/lifecycle-handlers.test.ts packages/beegame-resource-server/src/__tests__/curation-route.test.ts && git commit -m "feat: add batch resource curation API"`

### Task 4: Update the Workflow match and commit contracts for bundles

**Files:**

- Modify: `packages/agent-workflow-server/src/beegame/native-resource-library-tool.ts`
- Modify: `packages/agent-workflow-server/src/beegame/resource-inventory-commit.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-resource-inventory-commit-tool.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/resource-match-observation.ts`
- Test: `packages/agent-workflow-server/src/beegame/native-resource-library-tool.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/resource-inventory-commit.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-workflow-resource-integration.test.ts`

- [ ] **Step 1: Add failing Workflow tests for bundle selection and placeholders.**

Cover:

```ts
it('projects exact bundle member identities and coverage gaps', async () => {
  const output = await callResourceLibrary()
  expect(output.data.requirements[0].bundles[0].candidates).toHaveLength(2)
  expect(output.data.requirements[0].bundles[0].covered_obligations).toEqual(['model', 'texture'])
})

it('accepts several library decisions for one requirement when they belong to one returned bundle', async () => {
  await expect(commitLibraryBundle(['model-element', 'texture-element'])).resolves.toMatchObject({ accepted: true })
})

it('rejects a placeholder when any complete bundle is selectable', async () => {
  await expect(commitPlaceholderForMatchedRequirement()).rejects.toThrow('selectable Resource Library bundle')
})
```

- [ ] **Step 2: Run the focused Workflow tests and verify they fail.**

Run: `bun test packages/agent-workflow-server/src/beegame/native-resource-library-tool.test.ts packages/agent-workflow-server/src/beegame/resource-inventory-commit.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-resource-integration.test.ts`

Expected: FAIL because the tool projects only `candidates`, the commit validates only individual candidate membership, and the prompt does not describe bundle IDs.

- [ ] **Step 3: Project the bounded result without adding a second discovery path.**

Update `compactMatchResult` to return, for each requirement, `status`, `bundles`, `covered_obligations`, `uncovered_obligations` and bounded diagnostics. Each bundle contains exact Pack/version/element IDs and delivery facts. Remove the old single-candidate output shape; do not keep a compatibility field.

- [ ] **Step 4: Carry coverage into the canonical Manifest request.**

Map `requirement.acquisition_profile.coverage` in `native-resource-library-tool.ts`. The match observation stores the complete structured result and catalog revision in its existing single durable observation. Do not add a second observation or ask the LLM to rebuild bundles from summaries.

- [ ] **Step 5: Validate decisions against the frozen bundles.**

In `resource-inventory-commit.ts`, accept multiple library decisions for one requirement only when their exact identities appear in one frozen returned bundle and their selected resource IDs are unique. A placeholder is allowed only when no bundle is complete. Preserve one complete inventory commit and the existing receipt/binding derivation. Update error messages to distinguish `selectable Resource Library bundle` from proven `no-match`.

- [ ] **Step 6: Update the Worker contract and tests.**

Tell Resource Curator to call `ResourceLibrary` once, choose one returned complete bundle per requirement, submit every exact bundle member through `CommitResourceInventory`, and use a placeholder only for `no-match`. The prompt must not ask the model to inspect filenames, browse pages, create tags, or invent coverage. Keep the existing two-tool-only contract.

- [ ] **Step 7: Run Workflow tests and typecheck.**

Run: `bun test packages/agent-workflow-server/src/beegame/native-resource-library-tool.test.ts packages/agent-workflow-server/src/beegame/resource-inventory-commit.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-resource-integration.test.ts && bun run typecheck`

Expected: PASS; a valid library bundle is selected, a proven gap can use a placeholder, and no old candidate/placeholder dual path remains.

- [ ] **Step 8: Commit the Workflow bundle contract.**

Run: `git add packages/agent-workflow-server/src/beegame/native-resource-library-tool.ts packages/agent-workflow-server/src/beegame/resource-inventory-commit.ts packages/agent-workflow-server/src/beegame/native-resource-inventory-commit-tool.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/resource-match-observation.ts packages/agent-workflow-server/src/beegame/native-resource-library-tool.test.ts packages/agent-workflow-server/src/beegame/resource-inventory-commit.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-resource-integration.test.ts && git commit -m "fix: let workflow select resource bundles"`

### Task 5: Build the one-stop Resource Library curation workbench

**Files:**

- Modify: `apps/frontend/src/services/resourceLibraryApi.ts`
- Add: `apps/frontend/src/components/ResourceLibrary/CurationWorkbench.tsx`
- Modify: `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.tsx`
- Modify: `apps/frontend/src/i18n/locales/zh.json`
- Modify: `apps/frontend/src/i18n/locales/en.json`
- Test: `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx`
- Add: `apps/frontend/src/components/ResourceLibrary/CurationWorkbench.test.tsx`

- [ ] **Step 1: Add failing UI tests.**

Test that the workbench:

```tsx
it('shows pending suggestions and grouped readiness issues', async () => {
  render(<CurationWorkbench packId="pack" api={apiWithPendingSuggestion()} />)
  expect(await screen.findByText('待整理')).toBeInTheDocument()
  expect(screen.getByText('缺少用途标签')).toBeInTheDocument()
  expect(screen.getByText('系统建议')).toBeInTheDocument()
})

it('confirms one batch and removes the pending rows without refreshing each element', async () => {
  render(<CurationWorkbench packId="pack" api={apiWithPendingSuggestion()} />)
  await userEvent.click(await screen.findByRole('button', { name: '批量确认' }))
  expect(apiWithPendingSuggestion().confirmCuration).toHaveBeenCalledWith(expect.objectContaining({ elementIds: ['e1', 'e2'] }))
})
```

- [ ] **Step 2: Run the UI tests and verify they fail.**

Run: `bunx vitest run apps/frontend/src/components/ResourceLibrary/CurationWorkbench.test.tsx apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx`

Expected: FAIL because the queue view and API methods do not yet exist.

- [ ] **Step 3: Add typed API methods.**

Add `getCurationQueue(packId)`, `confirmCuration(packId, input)` and `rejectCuration(packId, input)` to `resourceLibraryApi.ts`. The client sends one batch request and returns the server's updated element IDs and grouped issue counts. It must not issue one request per file.

- [ ] **Step 4: Implement the workbench.**

Render one queue grouped by missing semantic metadata, technical readiness and low-confidence suggestions. Show preview/evidence, affected count, Pack/folder/selection scope, and one batch-confirm button. A confirmation changes only selected canonical fields; a rejection clears suggestions and may mark selected elements `manual-only`. Do not show pending suggestions in the normal catalog facet or element match view.

- [ ] **Step 5: Integrate the workbench into the existing Pack view.**

Load the queue once with the Pack workspace. Refresh the queue and element list after one accepted batch. Preserve current folder defaults, element inspector, upload and preview behavior. Do not create a second resource browser or second tag editor.

- [ ] **Step 6: Run UI tests and build.**

Run: `bunx vitest run apps/frontend/src/components/ResourceLibrary/CurationWorkbench.test.tsx apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx && bun run --cwd apps/frontend build`

Expected: PASS with one batch request per confirmation and no repeated per-element network updates.

- [ ] **Step 7: Commit the curation workbench.**

Run: `git add apps/frontend/src/services/resourceLibraryApi.ts apps/frontend/src/components/ResourceLibrary/CurationWorkbench.tsx apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.tsx apps/frontend/src/i18n/locales/zh.json apps/frontend/src/i18n/locales/en.json apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.test.tsx apps/frontend/src/components/ResourceLibrary/CurationWorkbench.test.tsx && git commit -m "feat: add resource curation workbench"`

### Task 6: Rebuild the canonical catalog and remove obsolete paths

**Files:**

- Modify: `docs/resource-library-production.md`
- Modify: `docs/beegame-resource-semantic-contract.md`
- Modify: `docs/beegame-supabase-schema.sql`
- Remove only after replacement tests pass: retired whole-Pack matching branch, old catalog-curation result types, unused pagination calls from Workflow, and their tests.
- Test: `packages/beegame-resource-core/src/__tests__/catalog.test.ts`
- Test: `packages/beegame-resource-server/src/__tests__/selection-route.test.ts`

- [ ] **Step 1: Add the canonical cutover test.**

Use a generic mixed-quality Pack with one valid root, one unrelated invalid root and one root with a failed dependency. Assert valid-root search succeeds, only the dependent root is excluded, suggestions are not searchable, and effective inherited tags are stable across repeated reads.

- [ ] **Step 2: Run the cutover test before removing code.**

Run: `bun test packages/beegame-resource-core/src/__tests__/catalog.test.ts packages/beegame-resource-server/src/__tests__/selection-route.test.ts`

Expected: the new regression test passes; any existing assertions that explicitly require whole-Pack exclusion fail and are the only failures to update in the next step.

- [ ] **Step 3: Replace the canonical schema and reinspection path.**

Apply the full `docs/beegame-supabase-schema.sql` in the development database. Reinspect each distinct content hash once, rebuild dependency bindings, preserve confirmed semantic fields, queue missing semantics, and publish one new catalog revision. Do not add an incremental compatibility migration, alternate reader or shadow table.

- [ ] **Step 4: Delete obsolete Workflow paths and update documentation.**

Remove whole-Pack selection gating, model-reconstructed candidate results, direct Workflow pagination, suggestion-backed search, old catalog status branches, and tests that enforce them. Update the production checklist to require element isolation, batch curation, bundle matching and one-time reinspection.

- [ ] **Step 5: Run the complete resource test set.**

Run: `bun test packages/beegame-resource-core/src/__tests__ packages/beegame-resource-server/src/__tests__ packages/agent-workflow-server/src/beegame/resource-inventory-commit.test.ts packages/agent-workflow-server/src/beegame/native-resource-library-tool.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-resource-integration.test.ts && bun run typecheck && git diff --check`

Expected: all focused tests pass; no old dual path, compatibility parser, feedback artifact or whole-Pack gate remains in production code.

- [ ] **Step 6: Commit the cutover and cleanup.**

Run: `git add docs/resource-library-production.md docs/beegame-resource-semantic-contract.md docs/beegame-supabase-schema.sql packages/beegame-resource-core packages/beegame-resource-server packages/agent-workflow-server && git commit -m "refactor: cut over to canonical resource catalog"`

### Task 7: Verify with the real catalog and one new project

**Files:**

- No user example project changes.
- Read-only evidence: temporary test workspace and service logs.

- [ ] **Step 1: Start only the required BeeGame services.**

Run the repository's documented development command with the configured `xrmoddemiurge` environment. Record service PIDs and ports before testing.

- [ ] **Step 2: Verify the actual catalog contract.**

Against the current Resource Library, call the bounded match operation for a generic 3D defense-style requirement through the service API. Confirm a relevant published Pack exposes valid element candidates even when another element in that Pack is invalid. Confirm bundle coverage includes multiple independent resource files where needed.

- [ ] **Step 3: Verify one end-to-end project.**

Create one new Web + React + 3D project with Resource Library usage `preferred`. Verify the resource phase imports at least one suitable library bundle, uses placeholders only for returned `no-match` groups, writes one durable inventory receipt, survives one service restart without repeating selection or downloading completed files, and reaches Resource Content.

- [ ] **Step 4: Verify repeated use.**

Run a second new project with different requirements. Confirm unchanged Resource Library hashes and confirmed tags are reused without reinspection or administrator re-curation, while project-local bindings remain independent.

- [ ] **Step 5: Stop all services and audit the worktree.**

Stop every service started for the test. Run `git status --short`, `rg` for old catalog actions, compatibility branches, feedback artifacts, filename/keyword matching and whole-Pack gates. Leave the user example projects untouched.

- [ ] **Step 6: Record evidence and commit only after verification.**

Run: `bun run typecheck && bun test packages/beegame-resource-core/src/__tests__ packages/beegame-resource-server/src/__tests__ apps/frontend/src/components/ResourceLibrary packages/agent-workflow-server/src/beegame/resource-inventory-commit.test.ts packages/agent-workflow-server/src/beegame/native-resource-library-tool.test.ts && bun run --cwd apps/frontend build`

Expected: focused tests, frontend build and real-catalog acceptance pass; all started services are stopped; no example project is modified.
