# Workflow Exact-Resume Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover every managed BeeGame Workflow from its exact durable interruption unit without rerunning accepted work.

**Architecture:** The persisted protocol is version 13 only. Journal accepted semantic units so one current run can be reconstructed when a version-13 `run.json` is invalid. Earlier or newer schema versions fail closed and never enter current execution. The recovery projector creates the sole current `DeliveryRun`; the existing controller then resumes only the one unaccepted active unit.

**Tech Stack:** TypeScript, Bun, Zod, append-only JSONL Workflow journal, React, Vitest.

## Global Constraints

- An accepted phase, task, check, commit, resource operation, audit or acceptance unit is immutable and must never be dispatched again.
- Only the active unit without an accepted terminal may be re-dispatched after its stale worker is stopped.
- Recovery must not rewrite or reacquire documents, Checklist, Manifest modules, resources, JSON/YAML content or implementation files.
- Recovery produces one current run; no old runtime, fallback Workflow, second execution ledger or feedback loop may remain.
- Missing proof returns `recovery_checkpoint_missing`; it never causes silent replay.
- The graph successor is not active-unit proof. Invalid current state may enter Document Drafting only when durable current-unit or dispatch identity proves that exact unfinished canonical document unit.
- GET/read routes never flush pending markers, reconcile workers, persist progress or dispatch work.
- Concurrent and queued Continue requests persist one resume decision and return the same current run without a second controller call.
- Every breaking persisted-state change increments `DELIVERY_RUN_SCHEMA_VERSION` in the same commit.
- Do not use regex, keyword inference, real project content, log text, project names or platform-specific logic.
- Authority: `docs/superpowers/specs/2026-08-05-workflow-exact-resume-recovery-design.md`.

---

### Task 1: Version 13 as the only executable snapshot protocol

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`

- [x] Keep `DELIVERY_RUN_SCHEMA_VERSION = 13` and accept only that exact version in current execution and exact-resume reconstruction.
- [x] Reject earlier versions as `obsolete` and newer versions as `invalid`; neither may be transformed or resumed.
- [x] Keep version-13 schema-invalid snapshots available for journal-based exact reconstruction without rewriting them on reads.
- [x] Remove snapshot migration modules, migration tests and mutable migration loading.
- [x] Require every accepted unit to come from `events.jsonl`; raw version-13 snapshot fields may only validate identity, conflicts and the exact unfinished unit.

### Task 2: Journal accepted units atomically

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/accepted-unit-journal.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/accepted-unit-journal.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`

**Interfaces:**
- Produces: `AcceptedWorkflowUnit`, `WorkflowUnitAcceptedEvent`, `deriveAcceptedWorkflowUnits(previous, next)`.
- Extends: `RunStore.commit(run, event, acceptedUnits?)`.

- [ ] **Step 1: Write failing accepted-unit tests**

Assert before/after run pairs derive document, each packet check, Checklist, inventory, content commit, Resource Gate, atomic plan, implementation task, implementation audit and acceptance units. Representative assertions:

```ts
expect(deriveAcceptedWorkflowUnits(beforePacket, afterPacket)).toEqual([
  expect.objectContaining({ unitId: 'review:brief_alignment' }),
  expect.objectContaining({ unitId: 'review:cross_document_consistency' }),
])
expect(deriveAcceptedWorkflowUnits(beforeGate, afterGate)).toEqual([
  expect.objectContaining({ unitId: 'resource:gate' }),
])
```

- [ ] **Step 2: Verify red state**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/accepted-unit-journal.test.ts
```

- [ ] **Step 3: Implement the current accepted-unit contract**

```ts
export type AcceptedWorkflowUnit = {
  eventSchemaVersion: 1
  unitId: string
  kind: 'document' | 'review-check' | 'checklist' |
    'resource-inventory' | 'resource-content' | 'resource-gate' |
    'atomic-plan' | 'implementation-task' |
    'implementation-audit' | 'acceptance'
  phase: DeliveryPhase
  predecessorUnitIds: string[]
  inputRevision: string
  dependencyDigests: Record<string, string>
  receiptRef?: string
  acceptedAt: string
  payload: unknown
}
```

Give each kind a strict Zod payload. Review payload owns one check, its findings and exact dependency digests. Canonical mutations store receipt references, not file bodies.

- [ ] **Step 4: Replace the singular pending marker**

The current version is 13 and owns only `pendingEvents?: WorkflowEvent[]`. One state commit writes its ordinary event plus one `workflow.unit.accepted` event per new unit into the snapshot marker, appends every event idempotently, then removes the marker. Loading flushes the complete marker first. No singular or earlier-version marker is accepted.

- [ ] **Step 5: Emit acceptance only after reconciliation**

Inside serialized `controller.persist`, load the preceding current run, derive accepted units from preceding→next, and pass them to `store.commit`. A worker terminal is not acceptance until controller reconciliation produces the next run.

- [ ] **Step 6: Test crash windows and commit**

Test crashes after snapshot write, after one event append and before marker removal. Assert every event exists once and accepted dispatch counts do not increase.

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/accepted-unit-journal.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
git add packages/agent-workflow-server/src/beegame/delivery-workflow/accepted-unit-journal.ts packages/agent-workflow-server/src/beegame/delivery-workflow/accepted-unit-journal.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts
git commit -m "feat: journal accepted workflow units"
```

### Task 3: Build the sole recovery projector

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`

**Interfaces:**
- Produces: `inspectWorkflowSnapshot()` and `projectExactResumeRun()`.
- Consumes: accepted-unit events, canonical receipts and current schemas.

- [ ] **Step 1: Write failing exact-projection tests**

Use a synthetic current-version-invalid 16-check fixture. Assert 12 completed Foundation checks and passed resource evidence remain, `resource_semantic_fitness` is the active unit, `activeDispatch` is cleared, and no accepted unit is replayed.

```ts
const projection = await projectExactResumeRun(input)
expect(projection.run.schemaVersion).toBe(DELIVERY_RUN_SCHEMA_VERSION)
expect(projection.activeUnitId).toBe('review:resource_semantic_fitness')
expect(projection.run.activeDispatch).toBeUndefined()
expect(projection.replayedUnitIds).not.toContain(projection.activeUnitId)
```

Add failures for missing/conflicting checkpoints, artifact digest mismatch, malformed JSON with complete/incomplete journal, duplicate accepted units and changed snapshot digest.

- [ ] **Step 2: Verify red state**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.test.ts
```

- [ ] **Step 3: Implement read-only snapshot inspection**

```ts
export type WorkflowSnapshotInspection = {
  rawText: string
  digest: string
  parsedValue?: unknown
  currentRun?: DeliveryRun
  error?: WorkflowStoreError
}

export async function inspectWorkflowSnapshot(): Promise<WorkflowSnapshotInspection>
```

The inspector hashes before parsing and never rewrites files.

- [ ] **Step 4: Implement exact projection**

```ts
export async function projectExactResumeRun(input: {
  inspection: WorkflowSnapshotInspection
  events: WorkflowEvent[]
  workspacePath: string
  ownerId: string
  projectId: string
  confirmedBriefContext: string
}): Promise<{
  run: DeliveryRun
  activeUnitId?: string
  replayedUnitIds: string[]
  sourceSnapshotDigest: string
}>
```

Replay the longest contiguous accepted-unit sequence under the current unit graph. Validate dependency digests and receipts. Historical raw state contributes only current-recognized accepted facts that pass current schemas/digests. Unknown pending topology is ignored; unknown completed work is a conflict. Require durable identity for the exact unfinished active unit and verify that it equals the graph successor; never select the graph successor as fallback authority. Preserve original start time, cumulative usage and exact active unit; output one current run without an active dispatch.

- [ ] **Step 5: Verify and commit**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
git add packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts
git commit -m "feat: reconstruct exact workflow resume state"
```

### Task 4: Serialize recovery and resume one unit

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`

**Interfaces:**
- Produces: `recoverAndResumeRun(input): Promise<DeliveryRun>`.
- Consumes: projector, workspace worker stop callback and current controller resume.

- [x] **Step 1: Write failing storage and barrier tests**

Use two real `RunStore` instances to race the same expected digest and assert exactly one replacement/event. With a real session turn plus real controller/dispatcher, prove worker stop waits for the active turn, terminal reconciliation/commit and usage flush. Cover a terminal landing at the final replacement boundary and restart after reconstruction.

- [x] **Step 2: Verify red state**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
```

- [x] **Step 3: Implement the atomic recovery transaction**

```ts
export async function recoverAndResumeRun(input: {
  store: RunStore
  workspacePath: string
  ownerId: string
  projectId: string
  confirmedBriefContext: string
  stopWorkspaceWorkers: (reason: string) => Promise<void>
  resumeCurrentRun: (run: DeliveryRun) => Promise<void>
}): Promise<DeliveryRun>
```

Add a `RunStore` expected-digest replacement API whose compare and write share the snapshot mutation queue. Acquire a workspace lock independent of `runId`; inspect/hash; stop workspace workers through a barrier that drains active turns, dispatcher terminal handlers and usage writes; inspect again; reconcile active canonical document/Resource Content receipts; project; use the RunStore CAS to write `workflow.run.reconstructed`; release; resume through the current controller. A late terminal either commits before projection or wins the CAS and is never overwritten.

- [x] **Step 4: Enforce exact proof, continuation and read boundaries**

Valid runs use existing resume/retry. Invalid version-13 runs call `recoverAndResumeRun` from project resume, project retry and session continue. Serialize the entire continuation decision per owned workspace; if durable current state already owns an active dispatch, return it without writing another resume event or invoking the controller. Earlier/newer versions, ownership, missing authority and missing exact active-unit proof remain hard failures. No recovery route enters Document Drafting unless the durable interruption unit itself is a current canonical document unit.

Make `readBeeGameWorkflowSnapshot` use only snapshot inspection plus event reads. Project Workflow, Workflow events and runtime-state GETs must not call `load`, `reconcile`, `ensureProgress` or any dispatch path. Test byte-identical snapshot/event files and unchanged dispatch counts.

- [x] **Step 5: Verify and commit**

With the real controller/dispatcher, assert a synthetic current-protocol run dispatches only its exact unfinished check and zero earlier units. Add project resume, project retry and session Continue HTTP tests for valid, recoverable invalid-current and hard-fail version inputs. Remove any test that recovers an unproven snapshot to Document Drafting; retain hard-fail and exact-drafting-proof cases.

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
git add packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/session-manager.ts packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts docs/superpowers/specs/2026-08-05-workflow-exact-resume-recovery-design.md docs/superpowers/plans/2026-08-05-workflow-exact-resume-recovery.md
git commit -m "feat: resume invalid workflows at exact unit"
```

### Task 5: Expose recovery through the existing Workflow card action

**Files:**
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `apps/frontend/src/types/message.ts`
- Modify: `apps/frontend/src/services/beeGameAdapter.ts`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.tsx`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`
- Modify: `apps/frontend/src/services/beeGameAdapter.test.ts`

**Interfaces:**
- Adds display fields `recoverable`, `lastProvenPhase`, `lastProvenUnitId`.
- Reuses `WorkflowCardAction = 'resume' | 'retry'`; no third action.

- [ ] **Step 1: Write failing server/frontend tests**

Assert recoverable invalid state shows “工作流需要恢复”, the current unit title and enabled “继续”. Clicking it sends one POST to `/api/projects/:id/workflow/resume`. Internal Zod JSON and unknown old IDs never render.

- [ ] **Step 2: Verify red state**

```bash
/Users/nswell/.bun/bin/bun run --cwd apps/frontend test:run src/components/Demiurge/WorkflowCard.test.tsx src/services/beeGameAdapter.test.ts
```

- [ ] **Step 3: Implement the recoverable view**

`createWorkflowStateErrorView` returns `recoverable: true`, `nextAction: 'resume'`, diagnostic ID and read-only last-proven summary. Remove the instruction to create a new project. The frontend uses the current resume action, card layout, timer origin and error popover. GET remains read-only; no new endpoint/button/state machine is added.

- [ ] **Step 4: Verify and commit**

```bash
/Users/nswell/.bun/bin/bun run --cwd apps/frontend test:run src/components/Demiurge/WorkflowCard.test.tsx src/services/beeGameAdapter.test.ts
git add packages/agent-workflow-server/src/app.ts apps/frontend/src/types/message.ts apps/frontend/src/services/beeGameAdapter.ts apps/frontend/src/components/Demiurge/WorkflowCard.tsx apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx apps/frontend/src/services/beeGameAdapter.test.ts
git commit -m "feat: expose exact workflow recovery action"
```

### Task 6: Enforce schema evolution and complete verification

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Modify: `docs/superpowers/specs/2026-08-05-workflow-exact-resume-recovery-design.md`

**Interfaces:**
- Produces no runtime API; enforces structural versioning and the full recovery matrix.

- [ ] **Step 1: Add a structural version guard**

Compute a deterministic fingerprint from persisted enum values and strict schema topology. Store its expected value beside version 13. A fingerprint change without a version change fails with a direct instruction to increment `DELIVERY_RUN_SCHEMA_VERSION`. Do not inspect source text with regex.

- [ ] **Step 2: Complete the exact-resume matrix**

For every worker type, test interruption before dispatch, while open, after terminal acceptance and after unit acceptance. For `document-author` and `resource-content-author`, which alone own an independently persisted canonical commit receipt, additionally test the receipt-only crash window before terminal acceptance. Do not invent a receipt contract for other workers. Also test earlier-version rejection, same-version invalid state, truncated JSON with complete journal, stale worker, duplicate Continue and restart during reconstruction. Every accepted unit dispatch count must remain unchanged.

- [ ] **Step 3: Run complete verification**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src
/Users/nswell/.bun/bin/bun run --cwd apps/frontend test:run src/components/Demiurge/WorkflowCard.test.tsx src/services/beeGameAdapter.test.ts
/Users/nswell/.bun/bin/bun run --cwd packages/agent-workflow-server typecheck
/Users/nswell/.bun/bin/bun run typecheck
/Users/nswell/.bun/bin/bunx biome check packages/agent-workflow-server/src/beegame/delivery-workflow packages/agent-workflow-server/src/app.ts apps/frontend/src/components/Demiurge/WorkflowCard.tsx apps/frontend/src/services/beeGameAdapter.ts apps/frontend/src/types/message.ts
git diff --check
```

- [ ] **Step 4: Run anti-pollution scan**

```bash
rg -n 'snapshot-migrations|migrateWorkflowSnapshot|pendingEvent:' packages/agent-workflow-server/src apps/frontend/src
```

Expected: no matches.

- [ ] **Step 5: Chrome self-test and service cleanup**

Use a synthetic project under the test workspace, never a user project. In the user's Chrome, verify the card shows the exact active unit, Continue creates one current run, accepted dispatch counts remain unchanged, timer origin is preserved and console has zero errors. Remove the synthetic workspace and stop ports 62173–62177.

- [ ] **Step 6: Record results and commit**

Update the approved spec with measured test counts and guarantees, then:

```bash
git add packages/agent-workflow-server/src apps/frontend/src docs/superpowers/specs/2026-08-05-workflow-exact-resume-recovery-design.md
git commit -m "test: enforce exact workflow resume recovery"
```
