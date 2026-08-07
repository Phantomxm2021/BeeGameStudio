# Resource Curation Dialog AI Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Put the approved AI-processing view inside the existing resource-curation dialog and expose durable, real model usage and Credit values without adding a second task system.

**Architecture:** The existing durable semantic-curation job remains the only task authority. Each semantic model call returns its provider usage, the workflow runtime bills that call using the existing usage billing client, and the resource worker persists the accepted usage on the processing item; the job projection sums item usage for the dialog. The dialog adds only a local tab view over the existing queue and job state.

**Tech Stack:** React 19, TypeScript, Vitest, Bun, Hono, Supabase REST, existing BeeGame usage billing client.

## Global Constraints

- Do not add a second queue, feedback path, compatibility path, or client-side token estimate.
- The existing durable resource-processing job and its item rows remain the only task state.
- Credit is charged only for actual model runtime calls through the existing billing client.
- Failed model calls retain any provider usage already billed; retry calls are new actual calls.
- The default semantic run analyzes only resources without a confirmed suggestion or effective tag. The explicit `all` run analyzes every ready resource except `manual-only` resources.
- Full reanalysis never overwrites canonical tags. It stores a fresh AI suggestion through the same semantic commit and durable job path; administrators still decide whether to confirm it.
- The UI must not display raw JSON or raw model reasoning.
- Preserve unrelated dirty-worktree changes and do not modify example projects.

---

### Task 1: Extend the durable resource usage contract

**Files:**
- Create: `supabase/migrations/20260807010000_resource_processing_usage.sql`
- Modify: `docs/beegame-supabase-schema.sql:351-376`
- Modify: `packages/beegame-resource-server/src/resource-processing-jobs.ts`
- Test: `packages/beegame-resource-server/src/__tests__/resource-processing-jobs.test.ts`

**Interfaces:**
- Produce `ResourceProcessingUsage` with `inputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `outputTokens`, `totalTokens`, and `creditsMicro`.
- Extend `ResourceProcessingReceipt` with optional accepted `usage`.
- Expose cumulative `usage` on `ResourceProcessingJob`.

- [ ] **Step 1: Write the failing persistence test**

Add a semantic job test whose processor returns a receipt with usage and assert the terminal job contains the same usage. Add a concurrent-item test asserting job usage is the sum of item usage rather than the last worker's value.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `bun test packages/beegame-resource-server/src/__tests__/resource-processing-jobs.test.ts`

Expected: FAIL because the job type and REST projection do not yet persist usage.

- [ ] **Step 3: Add durable columns and aggregation**

Add non-negative token columns and `credits_micro bigint` to both the migration and canonical schema. Store usage on each processing item when an item completes; when an item fails, store usage carried by a structured processing error. Recompute the job aggregate from all item rows inside `updateAggregate`, then return it from `toJob`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `bun test packages/beegame-resource-server/src/__tests__/resource-processing-jobs.test.ts`

Expected: PASS with usage totals stable across worker ordering.

---

### Task 2: Return and bill semantic model usage

**Files:**
- Modify: `packages/beegame-resource-server/src/semantic-curation-model.ts`
- Modify: `packages/beegame-resource-server/src/index.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Test: `packages/beegame-resource-server/src/__tests__/semantic-curation-model.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/resource-semantic-runtime.test.ts`

**Interfaces:**
- `ResourceSemanticModelClient.classify` returns `{ decision, usage }` where usage is normalized from the model runtime.
- Internal resource-curation requests carry the durable `jobId`, `elementId`, and processing `attempt` for billing idempotency and metadata.
- Internal responses carry `{ content, usage }`; no client-facing second endpoint is introduced.

- [ ] **Step 1: Write failing tests for usage propagation**

Assert that the resource semantic client returns normalized provider usage, that the internal runtime request includes the durable processing identity, and that the existing billing recorder receives the model usage with a deterministic per-attempt idempotency key.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `bun test packages/beegame-resource-server/src/__tests__/semantic-curation-model.test.ts packages/agent-workflow-server/src/__tests__/resource-semantic-runtime.test.ts`

Expected: FAIL because the internal response currently exposes content only and the resource client discards usage.

- [ ] **Step 3: Implement the single usage path**

In the workflow server's existing internal resource route, call `generateBeeGameModelWithUsage` with the existing `DashboardRepository` billing methods using the resource owner, durable job id as session identity, and `resourceJobId/elementId/attempt` metadata. Return normalized usage. In the resource server, pass the identity through the existing semantic call, return usage in the processing receipt, and attach usage to failures after a model response has already been billed.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `bun test packages/beegame-resource-server/src/__tests__/semantic-curation-model.test.ts packages/agent-workflow-server/src/__tests__/resource-semantic-runtime.test.ts`

Expected: PASS with no fallback provider, billing endpoint, or token estimate.

---

### Task 3: Implement the approved dialog view

**Files:**
- Modify: `apps/frontend/src/services/resourceLibraryApi.ts`
- Modify: `apps/frontend/src/components/ResourceLibrary/CurationWorkbench.tsx`
- Test: `apps/frontend/src/components/ResourceLibrary/CurationWorkbench.test.tsx`

**Interfaces:**
- The existing `ResourceProcessingJob` API exposes durable usage fields.
- `CurationWorkbench` owns only local tab selection; the latest durable semantic job is restored through the same processing-job projection, while polling, retry, confirm, and reject continue through the existing API methods.

- [ ] **Step 1: Write failing UI tests**

Add tests asserting: the dialog contains `资源整理` and `AI 处理` tabs; AI processing shows stage, runtime, input/cache/output/total tokens, and Credit in the same usage area; current processing shows `completed/total` on the right; failed items render red `×` rows; the old standalone AI header and `查看失败项` button are absent.

- [ ] **Step 2: Run the focused UI test to verify it fails**

Run: `bun test apps/frontend/src/components/ResourceLibrary/CurationWorkbench.test.tsx`

Expected: FAIL because the current dialog has one view, an AI start button, and a separate status/button row.

- [ ] **Step 3: Implement the minimal dialog change**

Add accessible internal tabs. Keep the existing queue content under `资源整理`; move the semantic job view under `AI 处理`. Restore the latest semantic job from the same durable job authority when the dialog opens. Render one compact usage section containing status, stage, runtime, and durable usage. Render `completed/total` in the current-processing heading. Render each failure in the processing list with a red `×` and its error text. Remove the standalone AI job header and failure-summary button.

- [ ] **Step 4: Run the focused UI test to verify it passes**

Run: `bun test apps/frontend/src/components/ResourceLibrary/CurationWorkbench.test.tsx`

Expected: PASS with the existing confirm/reject behavior unchanged.

### Extension: Add explicit full semantic reanalysis

**Files:**

- Modify: `packages/beegame-resource-server/src/resource-processing-jobs.ts`
- Modify: `packages/beegame-resource-server/src/app.ts`
- Modify: `packages/beegame-resource-server/src/index.ts`
- Modify: `packages/beegame-resource-server/src/supabase-resource-repository.ts`
- Modify: `packages/beegame-resource-core/src/semantic-curation.ts`
- Modify: `apps/frontend/src/services/resourceLibraryApi.ts`
- Modify: `apps/frontend/src/components/ResourceLibrary/CurationWorkbench.tsx`
- Add: `supabase/migrations/20260807030000_resource_semantic_analysis_mode.sql`

**Contract:**

- `mode: missing` is the existing default and remains the normal “AI 整理用途” action.
- `mode: all` is the only full reanalysis command. The mode is persisted on the existing processing job and is passed through recovery and batch execution.
- `all` selects ready resources with valid inspected content hashes and excludes only `manual-only` resources. It does not create another queue or job kind.
- The semantic commit mode for `all` preserves `usage_tags` and writes only a new `semantic_suggestion`, including for resources that already have tags. `manual-only` remains excluded at both selection and commit boundaries.
- The existing model usage, billing, retry, receipt, and durable progress contracts are unchanged.

**Verification:**

- Test the route selection boundary, durable mode propagation through a recovery batch, preservation of canonical tags, and the single AI-tab command.
- Confirm the live processing-job schema contains `analysis_mode` before using the command.

---

### Task 4: Verify the complete change

**Files:**
- No new production files.

- [ ] **Step 1: Run all affected frontend and resource suites**

Run: `bun test apps/frontend/src/components/ResourceLibrary/CurationWorkbench.test.tsx apps/frontend/src/services/resourceLibraryApi.test.ts packages/beegame-resource-server/src packages/agent-workflow-server/src/__tests__/resource-semantic-runtime.test.ts`

Expected: PASS with no unrelated test failures.

- [ ] **Step 2: Run type checks and whitespace validation**

Run: `bun run --cwd apps/frontend build`, `bun run --cwd packages/beegame-resource-server typecheck`, `bun run --cwd packages/agent-workflow-server typecheck`, and `git diff --check`.

Expected: PASS; no business code outside the listed files is changed.

- [ ] **Step 3: Perform a read-only browser check**

Open the resource-library dialog in the system Chrome session, confirm both tabs, the usage/stage/runtime area, `completed/total`, and red failure rows. Do not start a real AI job during this UI-only check.
