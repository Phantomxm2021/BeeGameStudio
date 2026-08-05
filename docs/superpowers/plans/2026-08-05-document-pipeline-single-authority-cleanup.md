# Document Pipeline Single-Authority Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every identified Reviewer/document-repair double track and stale state path, then close the dispatch, frozen-projection, and repair-graph defects without introducing compatibility behavior.

**Architecture:** `DocumentReviewState.activeCycle` remains the only review ledger, its frozen projection remains the only repair input, and the active durable dispatch remains the only usage owner. Invalid initial checklist output stops as an explicit authoring failure instead of entering an author feedback loop; all review and repair progress is projected from the Cycle ledger.

**Tech Stack:** TypeScript, Bun, Zod, Vitest, filesystem-backed durable workflow snapshots.

---

### Task 1: Normalize the sole authority

**Files:**
- Modify: `docs/beegame-document-reviewer-convergence-plan.md`
- Modify: `docs/beegame-foundation-document-authority-plan.md`

- [x] Remove the retired definition that makes finding subjects the complete change set.
- [x] State that subjects are defect locations, candidate paths are server-owned bounds, and accepted path decisions are the sole change-set source.
- [x] Remove language claiming the server pre-owns final affected paths.
- [x] Specify that invalid initial checklist output fails the author dispatch and never creates an author self-remediation lane.
- [x] Specify that repair planning consumes the frozen Cycle projection and stable schema-owned identities only.

### Task 2: Remove the checklist author feedback lane

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts`

- [x] Write a failing test proving an invalid initial checklist becomes `needs_action` and cannot redispatch Document Author.
- [x] Remove `ChecklistRemediation`, its snapshot field, schema, prompt branch, dispatch contract branch, retry event, and attempt counter.
- [x] Run the targeted workflow tests and confirm the new test passes.

### Task 3: Remove stale review progress and child-run state

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts`

- [x] Write a failing display test proving review task status comes only from Cycle check IDs.
- [x] Remove durable `reviewedDocumentPaths`, reviewer Read-event accumulation, and redundant terminal path coverage.
- [x] Remove unused `DeliveryRun.parentRunId` and its initializer/schema support; retain the change-request event's same-run provenance only.
- [x] Run display, schema, recovery, and controller tests.

### Task 4: Remove obsolete worker cleanup APIs

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Test: `packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts`

- [x] Keep exact `disposeWorkflowDispatch` behavior covered by a test.
- [x] Remove `workflowWorkerSessionIds`, `disposeWorkflowWorkers`, and `readWorkflowWorkerSessionIdsFromLogIndex`.
- [x] Verify no production caller or test references the removed APIs.

### Task 5: Fence Reviewer usage to the emitting packet

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Test: `packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`

- [x] Write a failing test where packet N usage is queued before packet N+1 rebinds.
- [x] Capture the dispatch identity when the usage event is observed.
- [x] Flush packet N usage before Reviewer rebind and reject stale writes explicitly rather than treating an unchanged run as success.
- [x] Verify total usage is neither lost nor attributed to packet N+1.

### Task 6: Use only frozen, schema-owned repair relationships

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-repair-graph.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-input.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts`

- [x] Write a failing test proving a post-review filesystem edit cannot alter Repair Lead input.
- [x] Write a failing table-driven test for shared subject, shared highest owner, and explicit owner dependency grouping.
- [x] Remove inline-code text matching and derive repair references from frozen reference IDs plus the fixed owner dependency matrix.
- [x] Reject repair planning if frozen digests no longer match the accepted Cycle.
- [x] Run all document workflow tests.

### Task 7: Final anti-pollution verification

**Files:**
- Verify all modified files.

- [x] Scan for removed state fields, terminals, self-remediation events, broad worker cleanup APIs, legacy protocol names, fallback parsers, retry/time/token limits, and duplicate ledgers.
- [x] Run the full agent-workflow server test suite.
- [x] Run server and app TypeScript checks.
- [x] Run `git diff --check` and inspect the final diff against both authority documents.
- [x] Stop all BeeGame service ports after verification.
