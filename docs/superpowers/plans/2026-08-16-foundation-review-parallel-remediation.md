# Foundation Review Parallel Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single Foundation repair worker with three isolated concurrent remediation lanes, accelerate review with two native read-only specialists, preserve one canonical `review.json`, and expose the full state in the Dashboard.

**Architecture:** BGS dispatches one parent Reviewer configured with two read-only native Agent definitions; only the parent commits `review.json`. Accepted conflicts create three deterministic lane records, and BGS starts only affected lanes as independent top-level document-author workers with exact path authority. After all required lanes commit byte-bound receipts, one final Reviewer verifies all eight current documents and either advances or stops at `needs_action`.

**Tech Stack:** TypeScript, Bun, Zod, React, Vitest, persisted DeliveryRun state, the existing Bee Game Studio native CLI stream protocol, and Web/React Chrome acceptance.

## Global Constraints

- Do not modify native Agent core code or native Write/Edit behavior.
- BGS may route, validate, persist, recover, enforce permissions, and render state; it may not author, merge, or judge document content.
- `review.json` version 2 remains the only durable Foundation review authority; do not restore `review.md` or a decision sidecar.
- Do not introduce a compatibility path, MVP path, feature flag, example-specific rule, or second workflow track.
- Only one semantic remediation cycle and one final verification review are allowed.
- Every remediation writer is an independent top-level workflow Agent; write-capable subagents are forbidden.
- Reviewer specialists use existing native Agent definitions with read/search tools only.
- All live acceptance must use Web/React through Chrome on a copy of the existing completed eight-document project.
- Preserve unrelated user changes and stage only files named by each task.

---

### Task 1: Freeze the Existing JSON Reviewer Baseline

**Files:**
- Verify/commit the currently modified Reviewer, session-port, schema, prompt, controller, and session-manager files shown by `git status --short`.
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts`

**Interfaces:**
- Consumes: version 2 `FoundationReview`, current-byte revision validation, failed-role retry, exact per-role failures, and outside-project workflow mutation denial already present in the worktree.
- Produces: a committed green baseline before lane changes.

- [ ] **Step 1: Audit the pending diff**

```bash
git status --short
git diff -- packages/agent-workflow-server/src/beegame packages/agent-workflow-server/src/__tests__
```

Confirm it contains only approved Reviewer convergence and permission fixes. Do not stage unrelated files.

- [ ] **Step 2: Run baseline verification**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts
bun test packages/agent-workflow-server/src
bun run typecheck
git diff --check
```

Expected: all tests and typecheck pass; diff-check has no output.

- [ ] **Step 3: Commit only the verified baseline files**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/session-manager.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts
git commit -m "fix: finalize actionable foundation review baseline"
```

---

### Task 2: Enforce Workflow Mutation Ownership

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Test: `packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts`

**Interfaces:**
- Consumes: `SessionRecord.workflowWorker`, `workflowAllowedPaths`, `isFileMutationTool()`, and `resolveProspectivePath()`.
- Produces:

```ts
type WorkflowFileMutationAuthority = {
  behavior: 'allow' | 'deny'
  reason:
    | 'workflow_allowed_path'
    | 'workflow_path_not_allowed'
    | 'workflow_workspace_boundary'
    | 'workflow_mutation_target_invalid'
  message?: string
}

function workflowFileMutationAuthority(
  record: SessionRecord,
  request: DashboardPermissionRequest,
): WorkflowFileMutationAuthority | undefined
```

- [ ] **Step 1: Write failing boundary tests**

Start a workflow remediation session with `workflowAllowedPaths: ['docs/GDD.md']`. Assert `Write`, `Edit`, and `MultiEdit` allow `docs/GDD.md`, deny `docs/AUDIO_DESIGN.md`, deny `/tmp/mdcheck.py`, and leave `pendingPermissions()` empty. Add an authorized `assets/content/` directory case, a prospective child, and a symlink escape.

- [ ] **Step 2: Verify RED**

```bash
bun test packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts
```

Expected: the current project-wide auto-approval incorrectly allows the sibling document.

- [ ] **Step 3: Implement workflow-first authority**

Evaluate `workflowFileMutationAuthority()` before project auto-approval. Resolve target and allowlist entries against the real project root. Exact file entries authorize only themselves; entries ending in `/` authorize confined descendants. Missing targets, sibling paths, and escapes deny immediately and persist the helper's reason in `permission.resolved`. Return `undefined` only for non-workflow/non-file-mutation requests so interactive behavior remains unchanged.

- [ ] **Step 4: Verify GREEN and commit**

```bash
bun test packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
bun run typecheck
git add packages/agent-workflow-server/src/beegame/session-manager.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts
git commit -m "fix: enforce workflow mutation path ownership"
```

---

### Task 3: Add the Remediation-Lane Domain Model

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts`

**Interfaces:**
- Consumes: `FoundationReview`, `FoundationDocumentPath`, `DispatchRecord`, and SHA-256 digests.
- Produces:

```ts
type FoundationRemediationLaneId =
  | 'core-design'
  | 'technical-assets'
  | 'presentation'

type FoundationRemediationLaneStatus =
  | 'not_required'
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'

type FoundationRemediationReceipt = {
  reviewDigest: string
  sourceRevision: string
  ownedPaths: FoundationDocumentPath[]
  beforeDigests: Record<string, string>
  afterDigests: Record<string, string>
  committedAt: string
}

type FoundationRemediationLane = {
  id: FoundationRemediationLaneId
  ownedPaths: FoundationDocumentPath[]
  affectedPaths: FoundationDocumentPath[]
  status: FoundationRemediationLaneStatus
  dispatch?: DispatchRecord
  receipt?: FoundationRemediationReceipt
  failureReason?: string
}

type FoundationRemediationState = {
  reviewPath: string
  reviewDigest: string
  sourceRevision: string
  lanes: FoundationRemediationLane[]
  resultingRevision?: string
}
```

- [ ] **Step 1: Write failing construction/schema tests**

Test that `createFoundationRemediationState()` produces three lanes in canonical order, partitions all eight paths once, intersects affected paths canonically, and marks unaffected lanes `not_required`. Reject duplicate lanes, overlapping ownership, noncanonical arrays, `not_required` with dispatch/receipt, completed without receipt, and malformed digests.

- [ ] **Step 2: Verify RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts
```

Expected: module/type/schema failures.

- [ ] **Step 3: Implement state and schema**

Export immutable definitions with these exact groups:

```ts
[
  {
    id: 'core-design',
    ownedPaths: [
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/BALANCE_DESIGN.md',
    ],
  },
  {
    id: 'technical-assets',
    ownedPaths: ['docs/TECHNICAL_DESIGN.md', 'docs/ASSET_PLAN.md'],
  },
  {
    id: 'presentation',
    ownedPaths: [
      'docs/ART_DIRECTION.md',
      'docs/UI_UX_SPEC.md',
      'docs/AUDIO_DESIGN.md',
    ],
  },
]
```

Add `foundationRemediationState?: FoundationRemediationState` to `DeliveryRun`. Increment `DELIVERY_RUN_SCHEMA_VERSION` from 20 to 21 and update only the verified version 21 fingerprint.

- [ ] **Step 4: Verify GREEN and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts
bun run typecheck
git add packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts
git commit -m "feat: persist foundation remediation lanes"
```

---

### Task 4: Dispatch, Reconcile, Retry, and Recover the Lanes

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`

**Interfaces:**
- Consumes: `FoundationRemediationState`, accepted review path/digest, and terminal `completedMutationPaths`.
- Produces: `pendingFoundationRemediationLanes()`, `recordFoundationRemediationDispatch()`, `recordFoundationRemediationFailure()`, `commitFoundationRemediationReceipt()`, and `foundationRemediationReadyForVerification()`.

- [ ] **Step 1: Write failing routing tests**

Use a review touching GDD, Technical, and UI. Assert three concurrent task IDs in canonical order:

```ts
[
  'foundation-remediation:core-design',
  'foundation-remediation:technical-assets',
  'foundation-remediation:presentation',
]
```

Each request gets only its lane's affected `allowedPaths`, but the same immutable review path, digest, and source revision. An unaffected lane creates no dispatch.

- [ ] **Step 2: Write failing receipt/retry/recovery tests**

Cover one lane completing while siblings run, no early verification, failed-only retry, duplicate idempotent receipt, mutation-path mismatch rejection, digest mismatch rejection, restart preservation, and exactly one final Reviewer after all required lane receipts validate against current bytes.

- [ ] **Step 3: Verify RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts
```

Expected: current code emits one `foundation-remediation` dispatch and has no lane receipts.

- [ ] **Step 4: Replace single-worker routing**

Initialize lane state once from the accepted review and dispatch required pending lanes with `Promise.all`. Use `foundation-remediation:<laneId>`. Give each worker the complete immutable review authority and exact path whitelist; do not copy document bodies or let BGS summarize conflicts.

- [ ] **Step 5: Reconcile terminal receipts**

Locate dispatches by lane task ID, require terminal mutation paths to equal the lane's affected paths, compute before/after digests, and persist the receipt. Reject sibling-lane paths and never infer success from file times or assistant text.

- [ ] **Step 6: Implement retry, barrier, and recovery**

Reset only failed lanes. Preserve completed sibling receipts. Recompute the complete Foundation revision after the barrier. Fail closed on stale/damaged receipts. Dispatch one verification Reviewer, then stop at `needs_action` if it still returns `NEEDS_REVISION`.

- [ ] **Step 7: Verify GREEN and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts
bun run typecheck
git add packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts
git commit -m "feat: run isolated foundation remediation lanes"
```

---

### Task 5: Add Native Read-Only Reviewer Specialists

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Test: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

**Interfaces:**
- Consumes: existing native CLI `--agents=<JSON>` and Agent-definition `description`, `tools`, and `prompt` fields.
- Produces `workflowAgentDefinitions?: Record<string, { description: string; tools: string[]; prompt: string }>` on `BeeGameSessionRunnerStartInput`.

- [ ] **Step 1: Write failing launch tests**

Assert Foundation Reviewer launches define `foundation-contract-specialist` and `foundation-integration-specialist`, each with exactly `['Read', 'Grep', 'Glob']`. Non-Reviewer launches receive none. Parse the `--agents=<JSON>` command argument and assert no mutation or Bash tool appears.

- [ ] **Step 2: Write failing prompt tests**

Require the parent to invoke both specialists concurrently, treat their findings as advisory, reconcile and deduplicate itself, perform the final coverage pass, and commit one version 2 `review.json`. BGS must not merge or persist specialist output.

- [ ] **Step 3: Verify RED**

```bash
bun test packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
```

Expected: runner input does not yet carry Agent definitions.

- [ ] **Step 4: Implement BGS-side launch configuration**

Pass optional definitions through session creation and append:

```ts
...(input.workflowAgentDefinitions
  ? ['--agents=' + JSON.stringify(input.workflowAgentDefinitions)]
  : [])
```

Construct definitions only for Foundation Reviewers. Do not edit the native core repository.

- [ ] **Step 5: Verify GREEN and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
bun run typecheck
git add packages/agent-workflow-server/src/beegame/session-manager.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
git commit -m "feat: add read-only foundation review specialists"
```

---

### Task 6: Show Remediation Lanes in the Dashboard

**Files:**
- Modify: `packages/agent-workflow-server/src/app.ts`
- Test: `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`
- Modify: `apps/frontend/src/types/message.ts`
- Modify: `apps/frontend/src/viewModels/displayModels.ts`
- Test: `apps/frontend/src/viewModels/displayModels.test.ts`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx`
- Test: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`

**Interfaces:**
- Consumes: persisted `foundationRemediationState` and digest-validated review projection.
- Produces:

```ts
remediationLanes?: Array<{
  id: 'core-design' | 'technical-assets' | 'presentation'
  status: 'not_required' | 'pending' | 'running' | 'completed' | 'failed'
  affectedPaths: string[]
  failureReason?: string
  durationMs?: number
}>
```

- [ ] **Step 1: Write failing API and UI tests**

Project three lanes in canonical order with exact paths and per-lane failure. Assert the view model drops malformed lanes. Assert the card shows `核心设计`, `技术与资产`, `表现层`, status, paths, duration, and exact failure while retaining the structured conflict list. Assert it does not display raw JSON, `review.md`, or specialist transcripts.

- [ ] **Step 2: Verify RED**

```bash
bun test packages/agent-workflow-server/src/__tests__/session-routes.test.ts
cd apps/frontend && bun run test:run src/viewModels/displayModels.test.ts src/components/Demiurge/WorkflowCard.test.tsx
```

Expected: `remediationLanes` is absent.

- [ ] **Step 3: Implement projection, normalization, and rendering**

Project display-safe fields only. Strictly normalize IDs/statuses; omit malformed entries. Render one compact lane section below the conflict list using existing labels and duration formatting. Do not create another page.

- [ ] **Step 4: Verify GREEN and commit**

```bash
bun test packages/agent-workflow-server/src/__tests__/session-routes.test.ts
cd apps/frontend && bun run test:run src/viewModels/displayModels.test.ts src/components/Demiurge/WorkflowCard.test.tsx
cd ../.. && bun run typecheck
git add packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts apps/frontend/src/types/message.ts apps/frontend/src/viewModels/displayModels.ts apps/frontend/src/viewModels/displayModels.test.ts apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
git commit -m "feat: show foundation remediation lanes"
```

---

### Task 7: Remove Superseded Paths and Run Chrome Acceptance

**Files:**
- Modify/delete obsolete code in: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify/delete obsolete display mapping in: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- Modify: `docs/superpowers/specs/2026-08-16-foundation-review-parallel-remediation-design.md`

**Interfaces:**
- Consumes: exact permission authority, lane receipts, specialist launch definitions, and Dashboard projection.
- Produces: one production workflow with no single-remediation branch and recorded Chrome evidence.

- [ ] **Step 1: Prove obsolete behavior is absent**

```bash
rg -n "taskId: 'foundation-remediation'|one coordinated remediation|review\\.md|decision\\.json|per-document remediation" packages/agent-workflow-server/src apps/frontend/src
```

Expected: no runtime single-remediation ID or Foundation Markdown/decision compatibility branch. Delete obsolete code rather than aliasing it.

- [ ] **Step 2: Run complete automated verification**

```bash
bun test packages/agent-workflow-server/src
cd apps/frontend && bun run test:run src/components/Demiurge/WorkflowCard.test.tsx src/viewModels/displayModels.test.ts
cd ../.. && bun run typecheck
git diff --check
```

Expected: all pass and diff-check is clean.

- [ ] **Step 3: Run Web/React acceptance through Chrome**

Use fixed development ports and the Chrome control skill. Copy the existing completed eight-document project through the normal UI; do not regenerate or manually edit its documents. Start review, observe structured conflicts, confirm all required lanes run concurrently, wait for every lane receipt, and confirm exactly one final Reviewer starts. The terminal state must be `READY` or one `needs_action`; missing receipts or missing final review is failure.

- [ ] **Step 4: Record evidence**

Append `Implementation Evidence` to the design with commit, project/run IDs, review/remediation/final-review durations, input/cache-input/output/credit usage, lanes and retries, final document digests, final verdict, and comparison with the single-worker baseline. Stop and diagnose exact logs on failure; never modify the test project to force success.

- [ ] **Step 5: Commit cleanup and evidence**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts docs/superpowers/specs/2026-08-16-foundation-review-parallel-remediation-design.md
git commit -m "test: verify parallel foundation remediation"
```

## Plan Self-Review

- Exact permissions are Task 2; lane model is Task 3; dispatch/retry/recovery/barrier is Task 4; read-only specialists are Task 5; Dashboard is Task 6; removal and Chrome acceptance are Task 7.
- Current dirty Reviewer correctness work is verified and committed before architecture changes.
- Types and signatures are introduced before consumers use them.
- No task modifies native core or asks BGS to author, merge, summarize, or judge document content.
- No compatibility branch, second semantic loop, example-specific behavior, or deferred placeholder exists.
