# Resource Inventory Root Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unbounded Agent-driven Resource Library pagination with one bounded structured match and one durable inventory commit that accepts convertible source formats, creates placeholders only for proven gaps, resumes after interruption, and never leaves a stopped worker projected as running.

**Architecture:** Resource planning adds a structured acquisition profile to each canonical requirement. Resource Core performs deterministic bounded matching over authored catalog facts; the Workflow-facing tool exposes only `match_requirements`. A new service-owned `CommitResourceInventory` validates one complete decision set, persists a receipt, imports/converts/authors resources, and derives the existing inventory receipt. Session termination is reconciled through the existing single dispatch transition.

**Tech Stack:** TypeScript, Bun test, Zod v4, Hono, AssimpJS, BeeGame modular Manifest v8, durable Workflow run store.

---

### Task 1: Structured acquisition profiles and bounded catalog matching

**Files:**
- Modify: `packages/beegame-resource-core/src/types.ts`
- Modify: `packages/beegame-resource-core/src/catalog.ts`
- Modify: `packages/beegame-resource-core/src/index.ts`
- Test: `packages/beegame-resource-core/src/__tests__/catalog.test.ts`

- [x] **Step 1: Write failing tests for exact structured matching**

Add tests proving that matching accepts requirement profiles containing dimensions, asset kinds, usage tags, capabilities and styles; returns a fixed maximum candidate count; reports only an aggregate `unclassified` count for elements missing required semantic metadata; and computes `direct`, `convert` or `unsupported` only from an explicit delivery capability map. Include FBX→GLB and OGG direct-delivery cases. Do not use requirement names, element names, paths, keywords or regular expressions in expectations.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun test packages/beegame-resource-core/src/__tests__/catalog.test.ts
```

Expected: FAIL because requirement match contracts and `matchResourceRequirements` do not exist.

- [x] **Step 3: Implement the minimal core contracts and matcher**

Add canonical types equivalent to:

```ts
export type ResourceAcquisitionProfile = {
  dimensions: readonly ResourceDimension[]
  assetKinds: readonly ResourceAssetKind[]
  usageTags: readonly ResourceUsageTag[]
  capabilities: readonly ResourceCapability[]
  styles: readonly string[]
}

export type ResourceDeliveryCapability = {
  sourceFormat: string
  disposition: 'direct' | 'convert'
  targetFormat: string
  adapterId?: string
}
```

Implement one stable matcher that intersects only explicit metadata, sorts by exact metadata coverage and stable IDs, caps candidates per requirement, and separates metadata-incomplete elements into `unclassified` without treating them as no-match.

- [x] **Step 4: Verify GREEN**

Run the same test and expect all catalog tests to pass.

### Task 2: Canonical Manifest profiles and source/target format separation

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/asset-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-asset-manifest-tool.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/document-readiness-audit.ts`
- Test: `packages/agent-workflow-server/src/beegame/native-asset-manifest-tool.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/document-readiness-audit.test.ts`

- [x] **Step 1: Write failing profile-boundary tests**

Require every Manifest requirement to carry one strict `acquisition_profile`. Prove the planner cannot omit it, cannot invent free-text fields, and that Foundation readiness rejects an Asset Plan whose source-format wording is used as a runtime admission whitelist.

- [x] **Step 2: Verify RED with focused tests**

```bash
bun test packages/agent-workflow-server/src/beegame/native-asset-manifest-tool.test.ts packages/agent-workflow-server/src/beegame/document-readiness-audit.test.ts
```

- [x] **Step 3: Implement the strict profile schema and authority prompt**

Extend `BeeGameAssetRequirement` and `submit_resource_plan` with the Resource Core profile. Update the planner and Reviewer authority so `asset_format_capabilities` means runtime-consumable output formats and acquisition profiles describe source semantics. Keep Resource Library policy and roots service-owned.

- [x] **Step 4: Verify GREEN and update existing fixtures mechanically**

Update test fixtures with explicit profiles appropriate to their declared resource kind; do not insert a permissive default in production parsing.

### Task 3: Replace Workflow pagination with one match operation

**Files:**
- Modify: `packages/beegame-resource-server/src/app.ts`
- Test: `packages/beegame-resource-server/src/__tests__/app.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/resource-selection-client.ts`
- Test: `packages/agent-workflow-server/src/__tests__/resource-selection-client.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-resource-library-tool.ts`
- Test: `packages/agent-workflow-server/src/beegame/native-resource-library-tool.test.ts`

- [x] **Step 1: Write failing server/client/tool tests**

Prove `/api/resource-catalog/matches` accepts profiles plus delivery capabilities and returns one bounded catalog revision with candidate groups. Prove the Workflow tool schema exposes only the canonical bounded matching operation and rejects every unsupported action.

- [x] **Step 2: Verify RED**

```bash
bun test packages/beegame-resource-server/src/__tests__/app.test.ts packages/agent-workflow-server/src/__tests__/resource-selection-client.test.ts packages/agent-workflow-server/src/beegame/native-resource-library-tool.test.ts
```

- [x] **Step 3: Implement one endpoint and one Workflow action**

The resource service loads current published catalog facts, calls the core matcher, and returns only bounded candidate facts. The client parses the strict response. The native tool caches the exact match result for the current dispatch and returns it without pagination cursors.

- [x] **Step 4: Verify GREEN and scan the Curator production lane**

Run the focused tests, then scan the Resource Curator production lane for any non-canonical browsing, direct import or mutation action. Expected: only bounded matching and atomic inventory commit remain.

### Task 4: Target delivery adapters and durable inventory commit

**Files:**
- Modify: `packages/agent-workflow-server/package.json`
- Create: `packages/agent-workflow-server/src/beegame/resource-delivery-adapters.ts`
- Create: `packages/agent-workflow-server/src/beegame/resource-inventory-commit.ts`
- Create: `packages/agent-workflow-server/src/beegame/native-resource-inventory-commit-tool.ts`
- Modify: `packages/agent-workflow-server/src/beegame/project-resource-application.ts`
- Modify: `packages/agent-workflow-server/src/beegame/asset-contracts.ts`
- Test: `packages/agent-workflow-server/src/beegame/resource-inventory-commit.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/asset-contracts-resource-binding.test.ts`

- [x] **Step 1: Write failing commit and conversion tests**

Cover: exact observed candidate identities; one-or-more library decisions or one placeholder per required group; one resource reused across several bindings; placeholder rejection when selectable candidates exist; proven no-match acceptance; FBX source copied with dependency closure then converted to GLB under `assets/generated/**`; OGG direct use when declared; prepared receipt recovery across a replacement dispatch without repeating completed acquisition; stale plan/catalog and content-hash rejection; one resource identity across source and generated files.

- [x] **Step 2: Verify RED**

```bash
bun test packages/agent-workflow-server/src/beegame/resource-inventory-commit.test.ts packages/agent-workflow-server/src/beegame/asset-contracts-resource-binding.test.ts
```

- [x] **Step 3: Implement the target adapter registry**

Register explicit target-owned capabilities. Implement FBX dependency-closure conversion with AssimpJS `glb2`; preserve exact source files, write generated output atomically, and keep generated files under the same Manifest resource record. Direct formats copy without conversion. Do not add a shared fallback adapter.

- [x] **Step 4: Implement `CommitResourceInventory`**

Persist the first match as the plan transaction's immutable observation so a new Continue dispatch adopts it instead of rematching. Persist one decision-independent strict receipt with `prepared | applying | committed`, frozen decisions, staged resource IDs, output hashes and many-to-many bindings. Validate active-dispatch authority before receipt preparation, staging advancement and publication. Pass the frozen Catalog revision into resolution and validate every downloaded source/dependency against its inspected content hash. Acquire and convert only in a receipt-specific staging workspace; after every staged resource validates, publish all files and one canonical Manifest. Reconcile exact same-hash files left by an interrupted publication, but reject conflicting bytes. Remove committed staging/current pointers and derive the terminal result only from a committed receipt plus current file audit.

- [x] **Step 5: Verify GREEN**

Run both tests and confirm an interrupted commit resumes without invoking candidate selection again.

### Task 5: Integrate the single terminal and stopped-session recovery

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/query-engine-runner.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.test.ts`

- [x] **Step 1: Write failing integration tests**

Prove the Curator receives no generic file or shell tools, calls one match and one commit, and terminal bindings come from the committed receipt. Simulate `session.stopped` and process restart; assert durable dispatch becomes `interrupted`, `thinking` becomes `idle`, elapsed time freezes, and Continue resumes the same prepared commit.

- [x] **Step 2: Verify RED**

```bash
bun test packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.test.ts
```

- [x] **Step 3: Wire the new tools and terminal**

Remove AssetManifest mutation access from the Curator. Supply only projected authority, Manifest plan and the two native resource operations. Read terminal state from the committed inventory receipt and preserve the existing `ResourceInventoryReceipt` as the sole completed Workflow state.

- [x] **Step 4: Unify stopped transport reconciliation**

At status polling and startup recovery, route stopped/missing sessions with a running durable dispatch through the existing interruption transition. Reject late progress events by dispatch authority. Do not classify user stop as failure.

- [x] **Step 5: Verify GREEN**

Run the focused tests and inspect assertions for stopped, interrupted and resumed states.

### Task 6: Remove old production paths and verify the system

**Files:**
- Delete obsolete Curator action schemas, pagination helpers and positive tests from the files above.
- Modify: `docs/beegame-resource-production-plan.md`
- Modify: `docs/beegame-native-game-delivery-architecture.md`
- Modify: `docs/beegame-resource-semantic-contract.md`

- [x] **Step 1: Delete dual-track production logic**

Remove Workflow catalog pagination, direct import, Curator AssetManifest placeholder mutation, model-reconstructed final bindings, and obsolete prompts/tests. Keep Resource Library administration browsing separate from Workflow.

- [x] **Step 2: Audit forbidden residuals**

Scan the Resource Curator production lane for retired browsing/import/mutation actions and scan the resource Workflow for token, wall-clock, tool-call or attempt limits.

Expected: no old Curator production path or resource business limit remains.

- [x] **Step 3: Run focused and package verification**

```bash
bun test packages/beegame-resource-core/src packages/beegame-resource-server/src packages/agent-workflow-server/src/beegame packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
bun run typecheck
git diff --check
```

Expected: zero failures, TypeScript exit 0, diff check exit 0.

- [ ] **Step 4: Run a new-project Chrome acceptance test**

Start the normal BeeGame services, create one Web + React + 3D project with Resource Library `preferred`, and verify one bounded candidate operation, at least one library import when suitable, placeholders only for proven gaps, service restart continuation without repeated selection/download, correct Workflow status, and transition into Resource Content. Stop all services after the test.
