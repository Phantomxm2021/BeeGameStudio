# Reviewer Self-Contained Packets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Reviewer continuation packet independently reviewable and submittable after context compaction, while preserving the single canonical projection and strict submission boundary.

**Architecture:** Add one deterministic packet projection in `worker-prompts.ts` that filters frozen artifacts and reference-index entries from the existing request contract by `artifactPathsByCheck`. Reuse it for continuation prompts only; canonical persistence and submission validation stay unchanged. Preserve the last rejected native-tool contract error at terminal construction when no accepted call exists.

**Tech Stack:** TypeScript, Bun test runner, Zod-backed native tool validation.

---

### Task 1: Specify self-contained continuation projection

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`

- [ ] **Step 1: Write the failing prompt tests**

Assert that a continuation prompt contains the active packet's artifact blocks and matching stable references, excludes artifacts outside the packet dependency union, and no longer claims the reference index only exists earlier in the conversation.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`

Expected: FAIL because continuation prompts currently omit every artifact and reference-index block.

- [ ] **Step 3: Implement the canonical packet projection**

Add a private projection that derives the allowed path union from `artifactPathsByCheck` for `currentCheckIds`, filters `reviewArtifacts`, filters `referenceIndex.artifacts`, and filters `referenceIndex.references` by the retained artifact IDs. Format those blocks inside `buildReviewerContinuationPrompt`; do not persist the projection or add another contract field.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the command from Step 2.

Expected: PASS.

### Task 2: Preserve deterministic rejection detail

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`

- [ ] **Step 1: Write the failing terminal-error test**

Create a Reviewer dispatch whose native submission is rejected with `unknown document review referenceId: a3` and then ends without an accepted call. Assert that `waitForTerminal` reports that rejection rather than `worker terminal result is missing a valid SubmitDocumentReviewPacket call`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`

Expected: FAIL with the current generic missing-call error.

- [ ] **Step 3: Use the existing failed-tool event as the single diagnostic source**

When `completedToolInputs` has no accepted candidate, inspect failed `SubmitDocumentReviewPacket` events already owned by the same dispatch and surface the last deterministic tool rejection. Keep the generic error only when no submission was attempted. Do not add persisted feedback or a second error ledger.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2.

Expected: PASS.

### Task 3: Regression verification

**Files:**
- Verify only; no new production files.

- [ ] **Step 1: Run Reviewer and session suites**

Run: `/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-input.test.ts packages/agent-workflow-server/src/beegame/native-workflow-result-tools.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts`

Expected: PASS.

- [ ] **Step 2: Run type checking and whitespace validation**

Run: `/Users/nswell/.bun/bin/bun run typecheck`

Expected: PASS.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 3: Audit prohibited alternatives**

Verify that Reviewer still exposes only `SubmitDocumentReviewPacket`, no transcript/file lookup was added, submission validation remains strict, and continuation projection is derived only from the existing canonical request contract.
