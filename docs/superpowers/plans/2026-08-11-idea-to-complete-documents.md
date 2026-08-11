# Idea to Complete Game Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Idea bootstrap flow generate all eight complete human-team Foundation documents without relying on reviewer repair.

**Architecture:** Add one document-contract module shared by dispatch, native commit validation and readiness checks. Initial authors submit structured sections which the service validates and renders to the existing canonical Markdown paths; repair and checklist paths remain unchanged.

**Tech Stack:** TypeScript, Zod v4, Bun tests, existing delivery workflow and atomic canonical document commit service.

---

### Task 1: Complete document contracts

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts`

- [ ] Write a failing test asserting that every canonical Foundation path has a non-empty, ordered, unique section contract and that the combined contracts cover design, production, technical, content, accessibility, risk and acceptance responsibilities.
- [ ] Run `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts` and verify the missing-module failure.
- [ ] Implement the typed eight-document contract map and exact section lookup.
- [ ] Re-run the focused test and commit the contract.

### Task 2: Structured complete-document commit

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/complete-game-document.ts`
- Create: `packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.ts`

- [ ] Write failing tests for a full submission, missing section, duplicate/out-of-order section, empty decisions/details and unauthorized upstream reference.
- [ ] Run the focused tests and verify failures occur before file mutation.
- [ ] Implement strict structured submission validation and deterministic server-owned Markdown rendering.
- [ ] Route initial Foundation commits through the structured schema while preserving body commits for repair/checklist work.
- [ ] Re-run native commit and structured document tests, then commit.

### Task 3: Production dispatch and prompt integration

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.test.ts`

- [ ] Write failing tests proving every initial author receives its complete contract and is instructed to submit all owned content without delegating completeness to reviewers.
- [ ] Add the contract projection to each dispatch and native authoring tool.
- [ ] Replace compact/minimal authoring instructions with complete human-discipline ownership instructions.
- [ ] Run focused worker/session tests and commit.

### Task 4: Idea-to-documents production acceptance

**Files:**
- Create: `packages/agent-workflow-server/src/__tests__/idea-to-complete-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/document-readiness-audit.ts`
- Test: `packages/agent-workflow-server/src/beegame/document-readiness-audit.test.ts`

- [ ] Write a failing integration test that starts from a neutral confirmed idea, drives the real document cursor through every Foundation path, commits structured submissions, and asserts all files and contract sections exist.
- [ ] Make readiness validate the complete document contracts in addition to file presence and canonical metadata.
- [ ] Run the new acceptance test, existing delivery workflow tests and typecheck.
- [ ] Commit only after the real Idea-to-eight-documents flow is green.

### Task 5: Final verification

- [ ] Run all document workflow, bootstrap adapter, readiness, native commit and recovery tests.
- [ ] Run `bun run typecheck` and `git diff --check`.
- [ ] Confirm no test idea, genre, project name or fixture prose appears in production branching logic.
- [ ] Report actual generated file paths and any remaining blocker; do not claim completion if the acceptance test is not green.

