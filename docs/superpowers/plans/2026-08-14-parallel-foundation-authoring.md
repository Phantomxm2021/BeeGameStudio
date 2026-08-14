# Parallel Foundation Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After GDD commit, author the seven remaining canonical foundation documents concurrently and finalize them through narrow dependency-calibration waves in 35–50 minutes without BGS-authored prose or a second document track.

**Architecture:** Preserve the existing serial GDD path and the existing canonical Markdown/receipt boundary. Add one durable per-document batch state and a foundation-only multi-dispatch lane; seven native sessions write their own canonical files concurrently, then the same logical sessions receive contract-selected calibration projections in four dependency waves. Existing validators and authored-document receipts remain the only finalization authority.

**Tech Stack:** TypeScript, Bun test, Zod v4, existing `DeliveryRun`/`RunStore`, `BeeGameSessionManager`, native document-author sessions, React/Vitest workflow card, Chrome Web React acceptance.

---

## File map

- Create `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.ts`: pure state machine for draft and calibration readiness.
- Create `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.test.ts`: dependency-wave and state-transition tests.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`: durable per-document checkpoint and worker-session identity.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`: strict parsing and backward-compatible default for runs created before this feature.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`: foundation-only parallel dispatch slots and per-terminal metrics.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`: launch/recover multiple foundation slots without changing other phases.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`: draft completion, calibration completion, canonical commit and final readiness.
- Modify `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`: preserve and resume one native logical session per document.
- Modify `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`: prove session reuse and distinct-file isolation.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`: explicit parallel-draft and calibration lifecycle instructions only.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`: prove BGS does not author, chunk or request redundant verification.
- Modify `packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts`: project only available, contract-authorized upstream sections.
- Modify `packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts`: GDD-only draft projection and full calibration projection.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`: expose concurrent per-document state.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts`: task state assertions.
- Modify `packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.ts`: aggregate draft and calibration turns by canonical document.
- Modify `packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.test.ts`: eight-document, multi-dispatch metric assertions.
- Modify `packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts`: controller-level parallel and out-of-order terminal coverage.
- Modify `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`: process-restart recovery with partially finished batch.
- Modify `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`: concurrent task rendering and non-additive timer assertion.
- Update `docs/superpowers/reviews/` only after real Chrome acceptance with measured evidence.

### Task 1: Durable batch state and dependency waves

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`

- [ ] **Step 1: Write failing state-machine tests**

Cover these exact cases:

```ts
const state = beginParallelFoundationAuthoring(['docs/GDD.md'])
expect(readyDraftPaths(state)).toEqual(CANONICAL_FOUNDATION_DOCUMENTS.slice(1))

const drafted = CANONICAL_FOUNDATION_DOCUMENTS.slice(1).reduce(
  (current, path) => recordFoundationDraft(current, path, {
    digest: 'a'.repeat(64),
    workerSessionId: `session:${path}`,
  }),
  state,
)
expect(readyCalibrationPaths(drafted)).toEqual(['docs/LEVEL_SCENE_DESIGN.md'])

const level = recordFoundationCommit(drafted, 'docs/LEVEL_SCENE_DESIGN.md')
expect(readyCalibrationPaths(level)).toEqual([
  'docs/BALANCE_DESIGN.md',
  'docs/ART_DIRECTION.md',
  'docs/UI_UX_SPEC.md',
])
```

Also assert the next waves are Technical + Audio, then Asset Plan; duplicate transitions, noncanonical paths, missing digests and calibration before upstream commit must throw.

- [ ] **Step 2: Run RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.test.ts
```

Expected: FAIL because the module and durable state do not exist.

- [ ] **Step 3: Add the minimal durable types**

Add these types to `types.ts`:

```ts
export type FoundationAuthoringStatus =
  | 'pending'
  | 'drafting'
  | 'drafted'
  | 'calibrating'
  | 'committed'
  | 'needs_action'

export type FoundationDocumentCheckpoint = {
  path: FoundationDocumentPath
  status: FoundationAuthoringStatus
  draftDigest?: string
  workerSessionId?: string
  upstreamDigests?: Record<string, string>
  dispatch?: DispatchRecord
  failureReason?: string
}

export type FoundationDraftState = {
  completedPaths: FoundationDocumentPath[]
  documents?: FoundationDocumentCheckpoint[]
}
```

Keep `completedPaths` as the canonical committed prefix for existing UI/recovery consumers. `documents` is the sole detailed state, not another artifact track.

- [ ] **Step 4: Implement the pure state machine**

Use the existing `getGameDocumentContract(path).upstreamSections` as the dependency source. Export:

```ts
beginParallelFoundationAuthoring(completedPaths)
readyDraftPaths(state)
readyCalibrationPaths(state)
recordFoundationDispatch(state, path, status, dispatch)
recordFoundationDraft(state, path, { digest, workerSessionId })
recordFoundationCommit(state, path)
recordFoundationFailure(state, path, reason)
foundationCommittedPrefix(state)
```

All returned objects and arrays must be fresh values. Sort paths by `CANONICAL_FOUNDATION_DOCUMENTS`, never `localeCompare`.

- [ ] **Step 5: Extend the Zod schema**

Increment `DELIVERY_RUN_SCHEMA_VERSION` because the repository deliberately rejects obsolete durable snapshots instead of migrating them. Parse strict checkpoint objects. Require lowercase 64-hex digests, unique canonical paths and canonical array order. Permit `documents` to be absent only for serial runs created under the current schema; once present it must contain GDD plus all seven downstream paths exactly once.

- [ ] **Step 6: Run GREEN and compatibility tests**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts
```

Expected: all tests pass; current-schema serial snapshots without `documents` still parse and older schema versions remain explicitly obsolete.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts
git commit -m "feat: model parallel foundation authoring"
```

### Task 2: Preserve one native logical session per document

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`

- [ ] **Step 1: Write failing continuation tests**

Start a `parallel-draft` dispatch, complete it, preserve its session, then start a `calibration` dispatch with `resumeWorkerSessionId`. Assert:

```ts
expect(sessionIds).toHaveLength(1)
expect(prompts).toHaveLength(2)
expect(prompts[1]).toContain('calibrate')
expect(prompts[1]).not.toContain('rewrite the complete document')
```

Also assert an unknown, stopped or busy `resumeWorkerSessionId` fails closed.

- [ ] **Step 2: Run RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts
```

Expected: continuation test fails because `close()` always disposes the native session.

- [ ] **Step 3: Extend the port contract**

Change only the optional close boundary:

```ts
close?(
  dispatchId: string,
  options?: { preserveSession?: boolean },
): Promise<void>
```

For `parallel-draft`, persist the returned `sessionId` on its `DispatchRecord`. `close(dispatchId, {preserveSession:true})` removes dispatch-local maps but does not stop or dispose the underlying `BeeGameSessionManager` record. A later calibration request carries `contract.resumeWorkerSessionId`; `start()` binds the new dispatch to that running, idle session rather than calling `sessions.start()`.

- [ ] **Step 4: Keep final cleanup deterministic**

Calibration success, failure, explicit workflow stop and project deletion must call normal `close()` and dispose the preserved session. Never leave a session preserved after its document reaches `committed` or `needs_action`.

- [ ] **Step 5: Run GREEN**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/session-manager-runtime-errors.test.ts
```

Expected: all tests pass; `sessions.start()` is called once per document across two turns.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts
git commit -m "feat: resume native document author sessions"
```

### Task 3: Add foundation-only parallel dispatch slots

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts`

- [ ] **Step 1: Write failing dispatcher tests**

Using the existing fake worker port, launch seven document-author requests with distinct canonical task IDs. Assert seven running records coexist, a duplicate path reuses its own idempotency lane, and an eighth non-foundation dispatch is rejected while the batch is active. Complete terminals in reverse order and assert every terminal is reconciled once.

- [ ] **Step 2: Run RED**

```bash
bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts
```

Expected: FAIL with `another delivery worker is already running`.

- [ ] **Step 3: Introduce dispatch-slot helpers**

Inside `dispatch.ts`, use one slot rule:

```ts
function foundationPathFor(request: WorkerDispatchRequest) {
  const mode = request.contract.authoringMode
  const path = request.contract.foundationDocumentPath
  return request.workerType === 'document-author' &&
    (mode === 'parallel-draft' || mode === 'calibration') &&
    CANONICAL_FOUNDATION_DOCUMENTS.includes(path as never)
      ? (path as FoundationDocumentPath)
      : undefined
}
```

Foundation batch records live only in their matching `FoundationDocumentCheckpoint.dispatch`; all other workers continue using `run.activeDispatch`. Add strict `findDispatch`, `setDispatch`, and `clearDispatch` helpers and use them consistently in dispatch, completion, failure, stop, status and terminal replay.

- [ ] **Step 4: Correct concurrent metrics**

Do not compute document usage from the shared `run.usage` delta. For document-author terminals, persist `result.authoringMetrics` directly in the dispatch event. This prevents concurrent sessions from claiming each other's cache and output tokens.

- [ ] **Step 5: Preserve failure isolation**

A failed foundation slot becomes `needs_action` through `recordFoundationFailure`; it must not set the entire run to failed while independent slots are running. Once all independent slots settle, the run becomes `needs_action` if any document slot failed.

- [ ] **Step 6: Run GREEN**

```bash
bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
```

Expected: seven slots start, out-of-order completion is deterministic, regular phases remain single-dispatch.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
git commit -m "feat: dispatch foundation authors concurrently"
```

### Task 4: Parallel draft and calibration lifecycle

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`

- [ ] **Step 1: Write failing workflow tests**

Prove this complete sequence:

```text
GDD committed
→ seven parallel-draft dispatches
→ all seven draft terminals accepted without document receipts
→ Level calibration and commit
→ Balance + Art + UI calibration and commit
→ Technical + Audio calibration and commit
→ Asset calibration and commit
→ eight-document readiness
→ FOUNDATION_REVIEW
```

Assert no downstream draft receives a committed receipt before calibration and every calibration request contains its preserved `resumeWorkerSessionId`.

- [ ] **Step 2: Run RED**

```bash
bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts
```

Expected: FAIL because GDD completion currently dispatches only Level and commits every initial terminal immediately.

- [ ] **Step 3: Branch only after GDD commit**

Leave the existing GDD initial-authoring implementation untouched. When `completedPaths` becomes `['docs/GDD.md']`, initialize the batch and dispatch all `readyDraftPaths()` with:

```ts
contract: {
  authoringMode: 'parallel-draft',
  foundationDocumentPath: path,
  completeDocumentContract: getGameDocumentContract(path),
  availableUpstreamPaths: ['docs/GDD.md'],
}
```

- [ ] **Step 4: Accept a complete draft without committing it**

For `parallel-draft`, require exactly the assigned written path, safe canonical path, complete raw Markdown structure, and no front matter. Compute the draft SHA-256 and call `recordFoundationDraft`; do not call `commitAuthoredFoundationDocument`.

- [ ] **Step 5: Dispatch ready calibration waves**

After every terminal reconciliation, call `readyCalibrationPaths()`. Each calibration request includes:

```ts
contract: {
  authoringMode: 'calibration',
  foundationDocumentPath: path,
  completeDocumentContract: getGameDocumentContract(path),
  resumeWorkerSessionId: checkpoint.workerSessionId,
  expectedDraftDigest: checkpoint.draftDigest,
  availableUpstreamPaths: getGameDocumentContract(path).upstreamSections.map(x => x.path),
}
```

- [ ] **Step 6: Commit only calibrated documents**

Calibration completion verifies the draft baseline digest, validates the final Markdown, invokes `commitAuthoredFoundationDocument`, records the committed digest and advances the canonical `completedPaths` prefix. After Asset Plan commit, run the existing `requireCompleteFoundation` audit and enter `FOUNDATION_REVIEW`.

- [ ] **Step 7: Add restart recovery**

On `ensureProgress`, redispatch only checkpoints in `pending`, `drafted`, or a durable non-running dispatch state. A currently running slot is never duplicated. A process restart after draft completion resumes calibration from the persisted native session ID when available; if that local session cannot be recovered, pause that document with a visible error instead of silently starting from scratch.

- [ ] **Step 8: Run GREEN**

```bash
bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
```

Expected: lifecycle and recovery tests pass with deterministic dependency waves.

- [ ] **Step 9: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
git commit -m "feat: calibrate parallel foundation drafts"
```

### Task 5: Narrow authority projections and lifecycle prompts

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts`
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

- [ ] **Step 1: Write failing projection and boundary tests**

Assert a Balance parallel draft receives only authorized GDD ranges even though its contract also names Level. Assert Balance calibration receives both GDD and finalized Level ranges. Assert prompts contain no generated prose, checkpoint count, forced Edit size, whole-file grep, byte count, API retry or watchdog instruction.

- [ ] **Step 2: Run RED**

```bash
bun test packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
```

Expected: projection currently tries to read every upstream path and has no lifecycle variants.

- [ ] **Step 3: Filter projections by available authority**

Add `availableUpstreamPaths` to projection input. Intersect it with `contract.upstreamSections`; reject any path outside the contract. Preserve contract order and include the canonical file digest for every projected source.

- [ ] **Step 4: Add minimal lifecycle prompts**

`parallel-draft` says: write one complete production-usable document at the assigned path, treat unavailable upstream authority as explicit assumptions/owned decisions in the existing dependency sections, and stop after the complete file is written.

`calibration` says: read the current canonical file and supplied upstream projection, revise only statements whose authority changed or became available, preserve unrelated valid content, and stop after the file is complete.

Both explicitly state that BGS owns mechanical validation after the turn, so the author must not run a redundant final grep or byte-count check. They do not dictate Write/Edit counts or sizes.

- [ ] **Step 5: Run GREEN**

```bash
bun test packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
git commit -m "feat: project calibration authority narrowly"
```

### Task 6: UI state and per-document metrics

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.ts`
- Modify: `packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.test.ts`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`

- [ ] **Step 1: Write failing display and metric tests**

Assert concurrent cards map to Chinese-visible states equivalent to drafting, awaiting calibration, calibrating, completed and needs action. Assert stage elapsed time uses one wall-clock interval and does not sum seven document durations. Assert one document metric combines draft and calibration usage while retaining each phase breakdown.

- [ ] **Step 2: Run RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.test.ts
cd apps/frontend && bun --bun node_modules/vitest/vitest.mjs run --config vitest.config.ts src/components/Demiurge/WorkflowCard.test.tsx
```

- [ ] **Step 3: Project durable task state**

Map checkpoint status without exposing internal dispatch records. Keep task order canonical. The stage card's active label may show the count of currently drafting/calibrating documents, but its timer continues to use `elapsedMs + activeSince` exactly once.

- [ ] **Step 4: Aggregate metrics without overlap**

For each canonical path report:

```ts
{
  path,
  phases: { draft?: DocumentAuthoringMetrics, calibration?: DocumentAuthoringMetrics },
  totals: { inputTokens, cacheReadTokens, cacheCreationTokens, outputTokens, rawProcessedTokens, durationMs },
  finalBytes,
  finalLines,
  finalDigest,
}
```

Sum terminal-owned phase metrics; never use shared run-usage deltas for concurrent documents.

- [ ] **Step 5: Run GREEN**

Run the commands from Step 2. Expected: all backend and frontend tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.ts packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.test.ts apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
git commit -m "feat: report concurrent document authoring"
```

### Task 7: Full regression and Chrome acceptance

**Files:**
- Update after acceptance: `docs/superpowers/reviews/2026-08-14-parallel-foundation-authoring-chrome-acceptance.md`

- [ ] **Step 1: Run the focused backend suite**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.test.ts packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts packages/agent-workflow-server/src/beegame/document-authoring-acceptance-metrics.test.ts
```

Expected: zero failures.

- [ ] **Step 2: Run typecheck and diff checks**

```bash
bun run typecheck
git diff --check
```

Expected: both exit 0.

- [ ] **Step 3: Run Chrome Web React acceptance on fixed ports**

Start the existing fixed-port development stack, create a new Web + React project through Chrome, and let all eight foundation documents finish. Do not change the test project to hide failures. Stop immediately if any document stalls, restarts, writes another file, or loses its preserved session; inspect raw logs before changing code.

- [ ] **Step 4: Verify artifacts and receipts**

Confirm all eight canonical Markdown files, all eight committed receipts, all complete-document validators and the eight-document readiness audit. Manually sample every document for discipline responsibility, production usefulness, readability and non-redundancy.

- [ ] **Step 5: Record measured performance**

Write the acceptance review with GDD duration plus downstream elapsed time, per-document phase duration, fresh/cache/output tokens, longest SSE silence, tool calls, file bytes/lines, validation results and total cost. Acceptance requires downstream completion at or below 60 minutes; 35–50 minutes remains the target.

- [ ] **Step 6: Commit acceptance evidence**

```bash
git add docs/superpowers/reviews/2026-08-14-parallel-foundation-authoring-chrome-acceptance.md
git commit -m "docs: record parallel authoring acceptance"
```

## Self-review

- Spec coverage: parallel drafts, four calibration waves, one canonical file/session, BGS boundary, failure visibility, metrics, timer behavior and Chrome acceptance each map to a task.
- No native core, file-tool, streaming, watchdog or compression file is modified.
- Existing GDD authoring and post-foundation review remain serial and unchanged.
- The only additional durable state is per-document lifecycle/dispatch evidence inside the existing run snapshot.
- No placeholder implementation steps remain; every task has a RED command, implementation boundary, GREEN command and commit.
