# Foundation Remediation Clean-Slate Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the complete current Foundation remediation execution system while preserving the accepted initial Reviewer and making `NEEDS_REVISION` stop safely with its committed report.

**Architecture:** First cut the automatic transition from accepted review into repair, then remove the now-unreachable document-author remediation contract, persisted remediation domain, recovery paths, and UI projections. The final system has one Reviewer path and no repair path; a future remediation design starts from the accepted `review.json` without inheriting this implementation.

**Tech Stack:** TypeScript, Bun tests, Zod delivery-run schema, React workflow task projection, Chrome Web/React acceptance.

## Global Constraints

- Work only in `codex/remediation-clean-slate`.
- Do not modify the native runtime core.
- Preserve the accepted initial Reviewer topology, prompt semantics, `Read,Grep,Glob` envelope, version 2 report schema, and four Dashboard tasks.
- Do not add a replacement remediation scheduler, feature flag, adapter, fallback, alias, migration, or dual-write state.
- Do not preserve resumability for snapshots that contain removed remediation execution state.
- Do not change initial document generation, checklist generation, resources, implementation, or acceptance.
- Use Web/React and fixed service ports for final acceptance.

---

### Task 1: Stop at the Accepted Reviewer Verdict

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts`

**Interfaces:**
- Consumes: an accepted initial `FoundationReviewState` and its canonical `review.json`.
- Produces: `READY -> CHECKLIST_DRAFTING`; `NEEDS_REVISION -> status: 'needs_action'` with the accepted report path and digest still on `foundationReviewState`.

- [ ] **Step 1: Replace remediation-limit coverage with the terminal verdict contract**

In `delivery-workflow-recovery.test.ts`, delete the test `explicit retry cannot reopen a completed Foundation verification`. Add a controller-level regression using the file's existing controller/store/dispatcher helpers:

```ts
test('accepted Foundation NEEDS_REVISION stops without dispatching repair', async () => {
  const dispatched: WorkerDispatchRequest[] = []
  const controller = createDeliveryWorkflowController({
    workspacePath: workspace,
    ownerId,
    workerPort: {
      async start(request) {
        dispatched.push(request)
        return {
          sessionId: request.dispatchId!,
          dispatchId: request.dispatchId!,
        }
      },
      async submit() {},
      async stop() {},
      async status() {
        throw new Error('not used')
      },
    },
  })
  await controller.store.save(completedNeedsRevisionRun)

  await controller.resume(completedNeedsRevisionRun)

  const persisted = await controller.store.load()
  expect(persisted).toMatchObject({
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
    status: 'needs_action',
    foundationReviewState: {
      status: 'completed',
      verdict: 'NEEDS_REVISION',
      finalReportPath,
      finalReportDigest,
    },
  })
  expect(dispatched).toEqual([])
  expect('foundationRemediationState' in persisted!).toBe(false)
})
```

Build `completedNeedsRevisionRun`, `finalReportPath`, and `finalReportDigest` with the existing `createTestDeliveryRun`, `createFoundationReviewState`, and `foundationRecoveryReviewJson` fixtures in that test file. Do not mock the accepted report bytes.

- [ ] **Step 2: Run the regression and verify RED**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts --test-name-pattern "accepted Foundation NEEDS_REVISION"
```

Expected: FAIL because `controller.resume()` creates `foundationRemediationState` or dispatches remediation.

- [ ] **Step 3: Remove the automatic repair and verification transitions**

In `controller.ts`:

- replace the `foundationReviewMayStartRemediation()` branch after an accepted Reviewer terminal with one `needs_action` result;
- remove creation of `foundationRemediationState`;
- remove the `foundation.review.remediation.created` event;
- remove the `resultingRevision` branch that creates `mode: 'verification'`;
- remove remediation replay/session recovery branches;
- leave the `READY` path unchanged.

The terminal branch must reduce to this behavior:

```ts
if (acceptedState.status === 'completed') {
  next = acceptedState.verdict === 'READY'
    ? {
        ...next,
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'CHECKLIST_DRAFTING',
        status: 'running',
        blockedReason: undefined,
      }
    : {
        ...next,
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        status: 'needs_action',
        blockedReason: `Foundation review requires revision; see ${acceptedState.finalReportPath}`,
      }
}
```

In `transition.ts`, remove the bounded-remediation retry guard and remediation retry projection. A completed accepted Reviewer state is not reopened by generic retry.

- [ ] **Step 4: Remove executable verification mode from Reviewer state and dispatch**

In `foundation-review-state.ts`:

- delete `FoundationReviewMode`;
- delete `mode`, `priorReviewPath`, and `priorReviewDigest` from `FoundationReviewState`;
- delete `MAX_FOUNDATION_REVIEW_ATTEMPTS` and `foundationReviewMayStartRemediation`;
- change `createFoundationReviewState` to accept `{ revision: string; attempt?: number }` only;
- keep the four roles, report paths, accepted-final checks, report digest validation, and version 2 report contract unchanged.

In `foundation-review-stage.ts`, remove all receipt, prior-review, affected-path verification, and verification-only projection branches. Every dispatch is the existing initial Reviewer dispatch.

Update focused Reviewer tests to call:

```ts
createFoundationReviewState({ revision, attempt: 1 })
```

Delete verification-only cases; retain initial retry, stale-revision, packet barrier, synthesis, and source-integrity cases.

- [ ] **Step 5: Verify the terminal and Reviewer suites**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
```

Expected: PASS, including the new zero-dispatch assertion.

- [ ] **Step 6: Commit the terminal cutover**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
git commit -m "refactor: stop foundation workflow at reviewer verdict"
```

---

### Task 2: Delete the Document-Author Remediation Path

**Files:**
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.test.ts`
- Delete: `packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`

**Interfaces:**
- Consumes: normal initial and parallel document-author contracts only.
- Produces: no remediation authoring mode, lane request, remediation authority projection, completion handler, or receipt.

- [ ] **Step 1: Add contract-absence regressions**

In `worker-prompts.test.ts`, add:

```ts
import { readFileSync } from 'node:fs'

test('has no Foundation remediation prompt path', () => {
  const source = readFileSync(new URL('./worker-prompts.ts', import.meta.url), 'utf8')
  expect(source).not.toContain("authoringMode === 'remediation'")
  expect(source).not.toContain('contract.remediation')
  expect(source).not.toContain('remediationReceipts')
})
```

In `delivery-worker-session-port.native-documents.test.ts`, retain initial author and Reviewer tests and add a source-boundary assertion that the port contains no `FOUNDATION_REMEDIATION_LANES`, remediation authority validator, or remediation completion branch.

- [ ] **Step 2: Run the absence tests and verify RED**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts
```

Expected: FAIL on the current remediation prompt and port branches.

- [ ] **Step 3: Delete the remediation domain and types**

Delete `foundation-remediation.ts`, `foundation-remediation.test.ts`, and the remediation-only `delivery-workflow-document-order.test.ts`.

From `types.ts`, remove all five `FoundationRemediation*` types and `DeliveryRun.foundationRemediationState`. Remove remediation-only fields from `WorkerDispatchRequest.contract`; keep initial/parallel authoring fields unchanged.

- [ ] **Step 4: Delete document scheduling, dispatch, and completion branches**

In `document-stage.ts`, remove remediation imports, remediation dispatch creation, `completeFoundationRemediationLane`, baseline checking, lane receipt commit, and repair-path revision handling.

In `dispatch.ts`, remove:

- `remediationLaneFor` and `remediationDispatch`;
- remediation-specific active-dispatch lookup;
- remediation start/failure/completion/cancel/usage branches;
- remediation batch exclusion checks.

Keep generic document-author dispatch and initial foundation concurrency unchanged.

- [ ] **Step 5: Delete remediation prompts and session-port validation**

In `worker-prompts.ts`, remove remediation projection, wording, report authority, receipt synthesis wording, checklist-remediation wording, and completion instruction. The document-author prompt has only the existing initial/parallel paths.

In `delivery-worker-session-port.ts`, remove the remediation lane import, authority validation, allowed-path derivation, author mode branches, baseline digest collection, completion handling, and receipt-derived written paths.

Delete remediation-only test cases from the three session-port test files; do not weaken initial author or Reviewer coverage.

- [ ] **Step 6: Verify author and dispatch boundaries**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
```

Expected: PASS; Reviewer remains read-only and initial authors remain unrestricted.

- [ ] **Step 7: Commit the author-path deletion**

```bash
git add -A packages/agent-workflow-server/src/beegame/delivery-workflow packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts
git commit -m "refactor: remove foundation remediation execution"
```

---

### Task 3: Remove Persisted, Recovery, API, and Dashboard Remediation State

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`

**Interfaces:**
- Consumes: current delivery runs containing draft state and initial Reviewer state only.
- Produces: strict persisted/API/UI state with no remediation or verification representation.

- [ ] **Step 1: Add current-schema and task-projection absence tests**

In `delivery-workflow-recovery.test.ts`, add a strict-schema test:

```ts
test('current delivery schema rejects removed remediation state', () => {
  const run = createTestDeliveryRun({
    runId: 'removed-remediation-state',
    projectId: 'project',
    ownerId: 'owner',
  })
  expect(() =>
    parseDeliveryRun({
      ...run,
      foundationRemediationState: { lanes: [] },
    }),
  ).toThrow()
})
```

In `document-display-tasks.test.ts`, delete `projects repair lanes and targeted verification as ordinary tasks` and extend the Reviewer test:

```ts
expect(tasks.map(task => task.id)).toEqual([
  'review:foundation:core-design',
  'review:foundation:technical-assets',
  'review:foundation:presentation',
  'review:foundation:synthesis',
])
expect(tasks.some(task => task.id.startsWith('foundation-remediation:'))).toBe(false)
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts --test-name-pattern "removed remediation state" packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts
```

Expected: the strict-schema case fails while the old optional state is accepted, or compilation fails until the removed fields are deleted.

- [ ] **Step 3: Delete persistence and recovery support**

In `schema.ts`, delete `foundationRemediationStateSchema`, its type import, the delivery-run field, and the completed-foundation exception tied to remediation drafting.

In `run-store.ts`, delete remediation cloning and nested dispatch usage lookup.

In `recovery.ts` and `recovery-projector.ts`, delete remediation snapshot detection, resume/reconcile, schema migration, task reconstruction, and damaged-remediation compatibility branches. Do not translate removed state into current state.

Delete all remediation-only recovery tests, including schema-23 verification migration, schema-24 remediation migration, lane replay, lane receipt barrier, interrupted remediation, and damaged remediation projection cases. Preserve initial Reviewer recovery tests.

- [ ] **Step 4: Delete API and Dashboard projections**

In `document-display-tasks.ts`:

- remove `foundationRemediationLanes` from input;
- remove `repairTaskTitle`;
- remove repair and verification task projection;
- keep the four Reviewer task projection unchanged.

In `display-progress.ts` and `app.ts`, remove remediation lane/report summary fields and `projectFoundationRemediationTaskState`.

Update `session-routes.test.ts` and display tests to assert only the four Reviewer tasks and no repair-specific response fields.

- [ ] **Step 5: Verify persistence, routes, and display**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.test.ts
```

Expected: PASS with no compatibility recovery of removed remediation state.

- [ ] **Step 6: Commit the state and UI deletion**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.ts packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
git commit -m "refactor: remove remediation persistence and projections"
```

---

### Task 4: Remove Superseded Documentation and Prove Static Closure

**Files:**
- Modify: `docs/superpowers/specs/2026-08-17-human-team-foundation-review-design.md`
- Delete: `docs/superpowers/plans/2026-08-17-human-team-foundation-review.md`
- Delete: `docs/superpowers/reviews/2026-08-17-project-workspace-permission-acceptance.md`
- Modify: `docs/superpowers/specs/2026-08-17-foundation-remediation-clean-slate-design.md`
- Create: `docs/superpowers/reviews/2026-08-17-remediation-clean-slate-chrome-acceptance.md`

**Interfaces:**
- Consumes: the remediation-free production tree.
- Produces: one current Reviewer architecture and one Chrome acceptance proving no repair work can start.

- [ ] **Step 1: Remove normative old-remediation documentation**

Delete the old mixed execution plan and old review/remediation acceptance. Rewrite the mixed design so it describes only the accepted initial Reviewer and its terminal verdict behavior. Keep the Reviewer read-only design, plan, and acceptance unchanged.

Do not retain “deprecated”, “legacy”, or fallback implementation instructions in current architecture documents.

- [ ] **Step 2: Run production static closure checks**

Run:

```bash
rg -n "foundationRemediationState|FoundationRemediation|foundation-remediation:|authoringMode === 'remediation'|authoringMode: 'remediation'|foundation\.review\.(remediation|verification)\.created|修订核心设计|修订技术与资产|修订表现体验|修订结果" packages/agent-workflow-server/src
```

Expected: no production or test matches. If a match remains, classify it before editing; do not whitelist it unless it is the clean-slate design or acceptance evidence outside production code.

- [ ] **Step 3: Run the complete affected suite and typecheck**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
```

Expected: zero failures and no diff formatting errors.

- [ ] **Step 4: Run Reviewer-only Chrome acceptance**

Start the fixed-port stack from this worktree and use Chrome/Web React to create a fresh review copy of the accepted eight-document project. Record:

- project and workflow run IDs;
- four Reviewer task states;
- report path, revision, SHA-256, schema result, and verdict;
- native tool calls and absence of write tools;
- pre/post SHA-256 for all eight source documents;
- input, cache input, output, credit, and wall time;
- every dispatch created after the accepted report.

For a `NEEDS_REVISION` report, acceptance requires:

```text
workflow.status = needs_action
post-report remediation dispatches = 0
post-report verification dispatches = 0
source document digest changes = 0
```

Do not test a replacement remediation flow because none exists in this branch.

- [ ] **Step 5: Record the acceptance result**

Write `docs/superpowers/reviews/2026-08-17-remediation-clean-slate-chrome-acceptance.md` with exact observed evidence. Mark it accepted only when the Reviewer remains correct and no repair task starts.

- [ ] **Step 6: Commit documentation and acceptance**

```bash
git add -A docs/superpowers
git commit -m "docs: accept remediation-free reviewer workflow"
```

---

## Plan Self-Review

- **Spec coverage:** Tasks remove scheduling, author execution, state, recovery, API/UI, tests, and normative documentation; the last task proves the absence through static and Chrome evidence.
- **Boundary:** The plan preserves the initial Reviewer and initial document authoring and introduces no replacement remediation path.
- **No compatibility track:** Old remediation snapshots are rejected rather than migrated or projected.
- **No placeholders:** Every task names files, expected behavior, commands, and commit boundaries.
- **Failure discipline:** Any unexpected failure is classified against the clean-slate direction before code changes; tests must not be weakened to preserve removed behavior.
