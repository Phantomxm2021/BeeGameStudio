# Foundation Review Worker Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the parent-Reviewer/native-subagent and generic Markdown Reviewer systems with two durable independent Foundation specialists, one canonical JSON synthesis Reviewer, three retained remediation lanes, and one standalone verification Reviewer.

**Architecture:** BGS dispatches and persists `contract-specialist` and `integration-specialist` as separate read-only workflow workers. Their strict bounded JSON packets become immutable inputs to an independent final Reviewer, which alone commits canonical version 2 `review.json`; checklist and resource readiness use deterministic gates instead of LLM Markdown Reviewer scopes. The retained remediation lanes write disjoint document sets and converge through one independent verification Reviewer.

**Tech Stack:** TypeScript, Bun, Zod, React, Vitest, persisted DeliveryRun JSON, native Bee Game Studio workflow sessions, Web/React Chrome acceptance.

## Global Constraints

- Do not modify native Agent core code, native Write/Edit behavior, model configuration, or example project content.
- BGS may route, validate, persist, recover, enforce permissions, and render state; it may not identify, merge, rewrite, prioritize, or resolve semantic conflicts.
- Version 2 `review.json` is the only semantic Foundation review authority.
- Specialist packets contain evidence candidates but no verdict, required change, conflict ID, or replacement prose.
- No Reviewer session may invoke Agent, Task, TaskOutput, teams, or background subagents.
- Remove old execution paths; do not add feature flags, compatibility routes, legacy parsing, or a second Reviewer protocol.
- Preserve exact workflow mutation permissions, three remediation lanes, lane receipts, usage persistence, current-byte revision checks, report digest integrity, and exact UI failures.
- `CHECKLIST_REVIEW`, `COMPREHENSIVE_REVIEW`, Markdown review parts, `review.md`, and `decision.json` are removed.
- Checklist commit and Resource Gate remain deterministic; implementation audit and acceptance validation remain unchanged.
- One automatic remediation cycle and one verification review are permitted. A failed verification stops at `needs_action`.
- All live acceptance uses Web/React through Chrome on a copied completed eight-document project.
- Preserve unrelated user files and stage only the files named by each task.

---

### Task 1: Commit the Valid General Fixes and Drop the Failed Prompt Workaround

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Verify/commit: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`
- Verify/commit: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Verify/commit: `packages/agent-workflow-server/src/app.ts`
- Verify/commit: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- Verify/commit: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts`

**Interfaces:**
- Consumes: existing `FoundationRemediationState.lanes[].dispatch` and `WorkflowUsage`.
- Produces: `RunStore.addWorkflowUsage()` and cloned run projection that recognize every remediation-lane dispatch; display projection with no obsolete aggregate remediation task.

- [ ] **Step 1: Remove only the uncommitted TaskOutput workaround**

Restore the final Foundation prompt to the committed parent-subagent text temporarily by removing only these uncommitted phrases and their assertions:

```text
retrieve both completed results with TaskOutput
Do not read or parse native background output files
```

Do not revert the lane-usage or display cleanup diffs.

- [ ] **Step 2: Verify the retained run-store regression**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts -t "keeps one durable dispatch slot per Foundation remediation lane"
```

Expected: PASS and the persisted lane dispatch usage contains the injected input token count.

- [ ] **Step 3: Verify display cleanup and prompt baseline**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
```

Expected: all tests pass; no obsolete aggregate `foundation-remediation` display row exists; the temporary committed parent prompt still has its original Agent instruction but not the failed TaskOutput workaround.

- [ ] **Step 4: Commit the isolated general fixes**

```bash
git add packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
git commit -m "fix: persist foundation remediation lane usage"
```

---

### Task 2: Delete the Reviewer Native-Subagent Execution Path

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.reviewer-agents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Conditionally delete after reference audit: `packages/agent-workflow-server/src/beegame/native-background-task-output.ts`
- Conditionally delete after reference audit: `packages/agent-workflow-server/src/beegame/native-background-task-output.test.ts`

**Interfaces:**
- Removes: `BeeGameWorkflowAgentDefinition`, `workflowAgentDefinitions`, Reviewer-specific `--agents=...`, `FOUNDATION_REVIEWER_AGENT_DEFINITIONS`, and the final Reviewer instruction to launch native specialists.
- Preserves: general native runtime streaming, permissions, compaction, tool telemetry, and any background-task accounting still used outside Reviewer workflows.

- [ ] **Step 1: Write negative Reviewer execution tests**

In `worker-prompts.test.ts`, replace the positive native-subagent assertions with:

```ts
expect(finalReviewerPrompt).not.toContain('foundation-contract-specialist')
expect(finalReviewerPrompt).not.toContain('foundation-integration-specialist')
expect(finalReviewerPrompt).not.toContain('TaskOutput')
expect(finalReviewerPrompt).not.toContain('launch both specialists')
```

In `native-cli-process-runner.test.ts`, delete the test that expects
`--agents=<json>` and assert a document-reviewer launch contains no `--agents`
argument.

- [ ] **Step 2: Run RED**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
```

Expected: FAIL because the prompt and runtime still expose Reviewer subagents.

- [ ] **Step 3: Remove the entire Reviewer-specific plumbing**

Delete:

```ts
type BeeGameWorkflowAgentDefinition = ...
workflowAgentDefinitions?: Record<string, BeeGameWorkflowAgentDefinition>
FOUNDATION_REVIEWER_AGENT_DEFINITIONS
foundationReviewerAgentDefinitions()
```

Remove propagation from session creation, stored session records, runner start
payloads, and `nativeRuntimeCommand()`. Remove the dedicated reviewer-agents
test file. Replace the Foundation final prompt with a temporary single-worker
instruction that reviews and writes `review.json` directly; Task 6 replaces it
with the new role-specific prompts.

- [ ] **Step 4: Prove whether background-task parsing has another consumer**

Run:

```bash
rg -n "parseNativeBackgroundTaskLaunch|readNativeBackgroundTaskUsage|parseNativeCompletedTaskOutput|native-background-task-output" packages/agent-workflow-server/src
```

If only deleted Reviewer wiring and its test remain, delete both module and
test. If session-wide usage accounting still imports launch/usage helpers,
retain only those generally used helpers and delete no generic behavior.

- [ ] **Step 5: Run GREEN and commit**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
git add packages/agent-workflow-server/src/beegame
git commit -m "refactor: remove reviewer native subagent orchestration"
```

Expected: no reachable Reviewer code contains Agent, TaskOutput, `--agents`, or
`workflowAgentDefinitions`.

---

### Task 3: Add the Strict Specialist Evidence-Packet Contract

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-evidence.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-evidence.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts`

**Interfaces:**
- Produces:

```ts
export type FoundationReviewSpecialistRole =
  | 'contract-specialist'
  | 'integration-specialist'

export type FoundationReviewEvidencePacket = {
  version: 1
  scope: 'foundation'
  revision: string
  role: FoundationReviewSpecialistRole
  candidates: Array<{
    title: string
    problem: string
    evidence: Array<{
      path: FoundationDocumentPath
      location: string
      observed: string
    }>
    blockingReason: string
  }>
}

export function foundationReviewEvidenceStagingPath(
  workspacePath: string,
  revision: string,
  role: FoundationReviewSpecialistRole,
): string

export function foundationReviewEvidencePath(
  workspacePath: string,
  revision: string,
  role: FoundationReviewSpecialistRole,
): string

export async function acceptFoundationReviewEvidence(input: {
  workspacePath: string
  revision: string
  role: FoundationReviewSpecialistRole
  currentRevision: string
}): Promise<{ path: string; digest: string; packet: FoundationReviewEvidencePacket }>
```

- [ ] **Step 1: Write schema and atomic-acceptance RED tests**

Cover:

```ts
expect(() => schema.parse({ ...valid, verdict: 'READY' })).toThrow()
expect(() => schema.parse({ ...valid, candidates: Array(33).fill(candidate) })).toThrow()
expect(() => schema.parse({ ...valid, role: 'final' })).toThrow()
```

Also test wrong revision, wrong role/path, path escape, invalid UTF-8, invalid
JSON, duplicate committed file, and digest stability. A successful acceptance
must atomically rename the staged packet, fsync its directory, and return the
project-relative committed path plus SHA-256 digest.

- [ ] **Step 2: Run RED**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-evidence.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the bounded contract**

Use strict Zod objects, canonical Foundation path enum, 64-lowercase-hex
revision, maximum 32 candidates, and field bounds no larger than the
corresponding Foundation review fields. Reuse the project-confined atomic
staging/rename/fsync pattern from `foundation-review.ts`; do not add a generic
report abstraction.

- [ ] **Step 4: Run GREEN and commit**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-evidence.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts
/Users/nswell/.bun/bin/bun run typecheck
git add packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-evidence.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-evidence.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts
git commit -m "feat: add bounded foundation review evidence packets"
```

---

### Task 4: Build the Replacement State and Dispatch Components While Unreachable

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

**Interfaces:**
- Defines the exact `FoundationReviewState`, `FoundationReviewReportState`,
  `FoundationReviewRole`, and `FoundationReviewMode` types from the approved
  design without adding them to `DeliveryRun` yet.
- Defines pure dispatch/barrier/terminal-validation helpers. No controller,
  session, persisted run, or UI path may call them in this task.

- [ ] **Step 1: Write state and barrier RED tests**

Assert initial role order is `contract-specialist`, `integration-specialist`,
`final`; verification contains only `final`. Reject duplicate roles,
final-before-specialists, completed reports without digests, invalid revisions,
and mismatched prior-review fields. Assert a new initial state produces two
read-only specialist contracts, one accepted packet does not unlock final, and
two accepted packets unlock exactly one final contract with bytewise-sorted
packet paths and digests.

- [ ] **Step 2: Write strict prompt and terminal RED tests**

Specialists must write one bounded evidence packet, make no verdict, and modify
no canonical document. Final must read both accepted packets, verify cited
bytes, write the sole canonical v2 `review.json`, and launch no Agent/Task.
Terminals must bind run/revision/role/staging path exactly.

- [ ] **Step 3: Run RED**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
```

- [ ] **Step 4: Implement only pure, unreachable replacement components**

Implement creation, invariant validation, dispatch selection, deterministic
barriers, role-specific contracts, prompts, and terminal schemas. Do not add a
feature flag, compatibility adapter, second persisted state, or controller
branch. This task is library construction, not a second execution track.

- [ ] **Step 5: Run GREEN and commit**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
git add packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
git commit -m "feat: build foundation review worker contracts"
```

---

### Task 5: Atomically Cut Over the Workflow and Delete the Old Reviewer System

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/delivery-gate.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.test.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.test.ts`
- Modify focused tests under: `packages/agent-workflow-server/src/__tests__/`

**Interfaces:**
- Adds only `foundationReviewState?: FoundationReviewState` to `DeliveryRun`,
  removes `documentReviewState`, and bumps schema 21 to 22.
- Foundation review dispatches two specialists concurrently, then one final.
- Checklist success goes directly to `RESOURCE_PREPARATION`; passed Resource
  Gate goes directly to `ATOMIC_TASK_PLANNING`.
- Removes `CHECKLIST_REVIEW`, `COMPREHENSIVE_REVIEW`, `review.md`,
  `decision.json`, generic Reviewer roles, attempts, and approvals.

- [ ] **Step 1: Write one atomic-cutover RED suite**

Cover all of the following before implementation:

- one controller resume creates exactly two top-level specialist dispatches;
- accepting one packet does not dispatch final; accepting both dispatches one
  final with both exact packet digests;
- current revision and packet digest mismatch fail closed;
- checklist completion enters `RESOURCE_PREPARATION` with no Reviewer dispatch;
- passed Resource Gate enters `ATOMIC_TASK_PLANNING` with no Reviewer dispatch;
- delivery requires current canonical Foundation `review.json`, checklist and
  resource evidence, implementation audit, and acceptance evidence, but no
  complete-review approval;
- schema-21 migration preserves documents/resources/tasks/evidence/remediation
  receipts, creates no approval from historical report bytes, and restarts at
  `FOUNDATION_REVIEW` when review authority must be re-established.

- [ ] **Step 2: Run RED**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-resource-integration.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
```

- [ ] **Step 3: Perform the cutover as one implementation change**

Wire the Task 4 helpers into controller, dispatch, worker session acceptance,
schema, persistence, and cloning. In the same change, delete every old generic
Reviewer state/route/prompt/path/recovery branch and the two Markdown modules.
Reuse the existing checklist audit, author receipt, metadata validation,
document revision, and Resource Gate; do not synthesize replacement approvals.
`evaluateWorkflowDeliveryGate()` rereads and digests canonical Foundation
`review.json` and keeps all downstream evidence checks unchanged.

- [ ] **Step 4: Prove no broken or dual intermediate runtime exists**

Before committing, run:

```bash
rg -n "document-review-report|document-review-topology|documentReviewState|CHECKLIST_REVIEW|COMPREHENSIVE_REVIEW|review:checklist:|review:complete:" packages/agent-workflow-server/src apps/frontend/src
```

Expected: no production execution reference. Test fixtures may mention removed
values only when asserting schema-21 migration or rejection.

- [ ] **Step 5: Run GREEN and commit the atomic cutover**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-resource-integration.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
git add packages/agent-workflow-server/src
git commit -m "refactor: replace document reviewer workflow"
```

---

### Task 6: Harden Recovery, Explicit Retry, and Standalone Verification

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`

**Interfaces:**
- Recovery uses only persisted report status/digest/dispatch and lane receipts.
- Explicit retry resets only failed work and preserves accepted siblings.
- Completed remediation creates verification mode with only `final`; a failed
  verification stops at `needs_action` and cannot launch another repair cycle.

- [ ] **Step 1: Write restart, retry, and verification RED tests**

Cover restart after one specialist, failed-specialist retry, failed-final retry,
changed-source invalidation, tampered packet rejection, recovery without
transcripts or temporary task output, sibling lane preservation, and one-shot
verification. Reversing specialist completion order must produce identical
final contract ordering. Verification may produce only `READY` or
`needs_action`, never another remediation dispatch.

- [ ] **Step 2: Run RED**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.test.ts
```

- [ ] **Step 3: Implement persisted-cursor recovery and verification**

After required lane receipts complete, create verification state with current
result revision and prior review path/digest. It contains only final. Its prompt
receives prior review, lane receipts, current revision, and eight read-only
paths, and checks prior conflicts plus direct dependencies. No context summary,
mtime, `/tmp` output, or native task state is authoritative.

- [ ] **Step 4: Run GREEN and commit**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
git add packages/agent-workflow-server/src
git commit -m "feat: recover and verify foundation review work"
```

---

### Task 7: Replace API and Dashboard Reviewer Projections

**Files:**
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.ts`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`

**Interfaces:**
- API projects exactly:

```ts
foundationReview: {
  mode: 'initial' | 'verification'
  revision: string
  status: string
  roles: Array<{
    role: 'contract-specialist' | 'integration-specialist' | 'final'
    status: string
    durationMs?: number
    usage?: WorkflowUsage
    failureReason?: string
  }>
  verdict?: 'READY' | 'NEEDS_REVISION'
  conflicts?: FoundationReview['conflicts']
  lanes?: FoundationRemediationLaneProjection[]
}
```

- Raw packet content and raw JSON are not projected.

- [ ] **Step 1: Write backend projection RED tests**

Assert role order, per-role status/usage/failure, structured final conflicts,
lane status, and verification mode. Assert API output has no specialist packet
body, Markdown, `reviewReports`, old role aliases, checklist/complete approval,
or aggregate remediation task.

- [ ] **Step 2: Write frontend RED tests**

Render fixtures for concurrent specialists, synthesis, three lanes, verification
READY, verification `needs_action`, and two distinct role failures. Assert the
card shows input/cache input/output/credit and duration per role, exact failures,
conflict details, and lane ownership. Assert no `0 / 8` audit tasks, raw JSON,
Markdown report, or old Reviewer stage labels.

- [ ] **Step 3: Run RED**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/session-routes.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts
/Users/nswell/.bun/bin/bunx vitest run apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
```

- [ ] **Step 4: Implement the single projection and card**

Use accepted `review.json` bytes only when persisted digest matches. Display
specialists as evidence-stage status rows and the final Reviewer as synthesis
or verification. Keep conflict and lane rendering structured; do not render a
human-facing second report.

- [ ] **Step 5: Run GREEN and commit**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/session-routes.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts
/Users/nswell/.bun/bin/bunx vitest run apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx apps/frontend/src/components/Demiurge/useWorkflowCardDeck.test.tsx
/Users/nswell/.bun/bin/bun run typecheck
git add packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.ts apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
git commit -m "feat: show durable foundation reviewer workers"
```

---

### Task 8: Prove Legacy Reviewer Removal and Run Full Automated Verification

**Files:**
- Modify or delete any remaining source/tests reported by the static audit.
- Modify: `docs/superpowers/specs/2026-08-17-foundation-review-worker-pipeline-design.md`

**Interfaces:**
- Produces no new runtime interface; this task proves only the approved
  Reviewer protocol remains reachable.

- [ ] **Step 1: Run the legacy reference audit**

```bash
rg -n "CHECKLIST_REVIEW|COMPREHENSIVE_REVIEW|complete-gameplay|complete-technical|complete-experience|complete-production|core-systems|player-experience|production-delivery|brief-and-gameplay|cross-document-consistency|review\.md|decision\.json|workflowAgentDefinitions|foundation-contract-specialist|foundation-integration-specialist|TaskOutput" packages/agent-workflow-server/src apps/frontend/src
```

Expected: no Reviewer implementation reference. A generic native runtime
`TaskOutput` telemetry reference may remain only when its caller is demonstrably
unrelated to Reviewer workflows; document that exact caller in the design
evidence instead of deleting generic core behavior.

- [ ] **Step 2: Run orphan and diff audits**

```bash
rg -n "document-review-report|document-review-topology|documentReviewState|approvals\.complete|approvals\.checklist" packages/agent-workflow-server/src apps/frontend/src
git diff --check
```

Expected: no obsolete source references and no whitespace errors.

- [ ] **Step 3: Run full backend/frontend verification**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src
/Users/nswell/.bun/bin/bunx vitest run apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx apps/frontend/src/components/Demiurge/useWorkflowCardDeck.test.tsx
/Users/nswell/.bun/bin/bun run typecheck
```

Expected: all tests pass and typecheck exits 0.

- [ ] **Step 4: Record automated evidence and commit cleanup**

Append exact test counts, typecheck result, removed files, and any retained
generic native telemetry rationale to the design specification.

```bash
git add packages/agent-workflow-server/src apps/frontend/src docs/superpowers/specs/2026-08-17-foundation-review-worker-pipeline-design.md
git commit -m "refactor: remove legacy reviewer protocols"
```

---

### Task 9: Chrome End-to-End Acceptance and Evidence

**Files:**
- Modify: `docs/superpowers/specs/2026-08-17-foundation-review-worker-pipeline-design.md`

**Interfaces:**
- Consumes the fixed development ports and the Web/React UI.
- Produces one acceptance record with project ID, run ID, role dispatch IDs,
  timings, usage, credits, packet/report digests, lane receipts, document
  digests, and final verdict.

- [ ] **Step 1: Start the fixed-port stack**

```bash
/Users/nswell/.bun/bin/bun run beegame:dev
```

Verify frontend/runtime/billing/skills/resources use the repository's fixed
ports. Do not alter model configuration or example project data.

- [ ] **Step 2: Create the acceptance copy through Chrome**

Using Chrome and Web/React only, copy the already completed eight-document
project and start Foundation review. Record copied project ID and workflow run
ID. Do not edit the copied documents manually.

- [ ] **Step 3: Verify initial Reviewer execution**

Through UI plus project-local read-only logs/state, prove:

- contract and integration specialists start concurrently;
- each has its own dispatch/log/usage/evidence packet/digest;
- no Reviewer log contains Agent, TaskOutput, background-output-file reads, or
  permission prompts;
- final synthesis starts once after both packets;
- exactly one valid canonical initial `review.json` is accepted.

If any condition fails, stop the workflow through Chrome and diagnose before
changing code. Do not retry unchanged code.

- [ ] **Step 4: Verify remediation and standalone verification**

For `NEEDS_REVISION`, prove only affected lanes start, required lanes run
concurrently, lane usage persists, successful sibling receipts survive a
failed-lane retry, and no `workflow run disappeared before usage was persisted`
error occurs. Prove verification starts once with only `final`, no specialist
dispatches, and ends in `READY` or one explicit `needs_action`.

- [ ] **Step 5: Verify Dashboard and downstream routing**

Confirm the card shows role metrics/failures, conflicts, lanes, and verification
without raw packets, Markdown, old roles, or 0/8 review tasks. If review reaches
READY, confirm checklist drafting proceeds and successful checklist validation
advances to Resource Production without `CHECKLIST_REVIEW`; confirm a passed
Resource Gate advances without `COMPREHENSIVE_REVIEW`.

- [ ] **Step 6: Record performance and correctness evidence**

Append to the design specification:

- project/run/dispatch IDs;
- specialist, synthesis, remediation, and verification durations;
- input, cache input, output, credit, and retries per unit and total;
- conflict count and actionable-shape audit;
- packet, review, lane receipt, and final document digests;
- final workflow state;
- comparison against the stopped parent-subagent run
  `ea0812f1-f7f5-4a5b-be17-a2f22b7b6068`, explicitly noting its compaction
  recovery and duplicate specialist dispatch.

- [ ] **Step 7: Stop the development stack, verify, and commit evidence**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src
/Users/nswell/.bun/bin/bunx vitest run apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx apps/frontend/src/components/Demiurge/useWorkflowCardDeck.test.tsx
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
git status --short
git add docs/superpowers/specs/2026-08-17-foundation-review-worker-pipeline-design.md
git commit -m "test: accept durable foundation reviewer pipeline"
```

Expected: automated verification is green, only known unrelated user files are
untracked or modified, and the Chrome acceptance evidence is committed.

## Plan Self-Review

- Every approved design requirement maps to a task and an acceptance check.
- New packet/state components are initially unreachable; the old runtime path
  is removed in the same cutover that makes the replacement reachable, so no
  dual execution track ships.
- The plan retains general native runtime behavior unless a reference audit
  proves it exists only for the removed Reviewer path.
- Checklist and resource transitions remain guarded by existing deterministic
  receipts, schemas, digests, and evidence rather than unvalidated advancement.
- State migration does not infer approval from legacy artifacts.
- Recovery uses persisted dispatches and digests, never model context.
- No task changes native Agent core, model configuration, example content, or
  Write/Edit behavior.
- The plan contains no placeholder implementation step, compatibility route,
  feature flag, second automatic repair loop, or example-specific behavior.
