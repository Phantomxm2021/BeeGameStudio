# Comprehensive Review Packet Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Comprehensive Review from four repeated LLM dispatches to two semantic packets and use the existing deterministic phase transition as the sole implementation-entry gate.

**Architecture:** Keep one durable Review Cycle, one ordered check ledger and one finding ledger. Preserve three independently validated resource checks, group them into a resource-semantics packet and a two-check content-integration packet, and remove the redundant fourth Reviewer check from types, prompts, dependencies and display state. The existing transition from an approved complete-scope Cycle to `ATOMIC_TASK_PLANNING` remains the only readiness decision and gains tests proving all canonical prerequisites are required.

**Tech Stack:** TypeScript, Bun test, Zod, BeeGame durable Workflow state.

---

### Task 1: Freeze the new check and packet topology

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`

- [x] Change the topology test to require 12 Foundation checks, one Checklist check, three Comprehensive additions and two fixed Comprehensive packets.
- [x] Run the document-order test and confirm it fails because additions are still emitted as four singleton packets.
- [x] Add `COMPREHENSIVE_DOCUMENT_REVIEW_ADDITIONAL_CHECK_PACKETS` with `resource_semantic_fitness` followed by the ordered pair `content_structure_fitness`, `resource_content_consistency`; remove the redundant fourth Reviewer check from all identities and owner mappings.
- [x] Run the document-order test and confirm the topology assertion passes.

### Task 2: Preserve atomic two-check submission and Closure ownership

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-input.ts`

- [x] Add a failing test proving the first Comprehensive dispatch contains only `resource_semantic_fitness`, while the next dispatch atomically contains `content_structure_fitness` and `resource_content_consistency` in that order.
- [x] Add a failing test proving a Closure change that affects one content check selects the complete content-integration packet but persists each check and finding independently.
- [x] Update the fixed packet lookup and Closure candidate set to use the new topology; remove the obsolete all-artifact dependency.
- [x] Run the document-order and document-review-input tests and confirm both packet and Closure assertions pass.

### Task 3: Make implementation entry purely deterministic

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`

- [x] Add a failing test proving a complete-scope Cycle enters `ATOMIC_TASK_PLANNING` only after all 15 ordered checks pass with no open finding.
- [x] Add a failing negative test proving an incomplete content-integration packet cannot manufacture Comprehensive approval or implementation entry.
- [x] Reuse the existing accepted-Cycle transition as the sole gate; do not add a readiness field, ledger, terminal or compatibility parser.
- [x] Run document-order and schema tests and confirm an incomplete packet is rejected instead of being normalized into approval.

### Task 4: Remove obsolete prompt and display behavior

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/query-engine-process-runner.test.ts`

- [x] Add failing prompt and display tests proving Comprehensive describes three checks in two packets and never presents a fourth Agent task.
- [x] Remove obsolete prompt wording, test fixtures and display labels while preserving thinking and per-check status for the three semantic checks.
- [x] Run prompt, display and process-runner tests and confirm they pass.

### Task 5: Anti-pollution and complete verification

**Files:**
- Modify: `docs/beegame-document-reviewer-convergence-plan.md`
- Verify all changed Reviewer and Workflow files.

- [x] Scan production code and authority docs for a fourth Comprehensive check, four singleton packets, alternate readiness state, compatibility parsing, feedback artifacts and duplicate ledgers.
- [x] Run `bun test packages/agent-workflow-server/src` and confirm zero failures.
- [x] Run package and root TypeScript checks, Biome on changed files and `git diff --check`.
- [x] Verify the two-packet task presentation with the frontend contract test; start the local stack for a read-only Chrome smoke test without creating a new project, confirm zero console issues and no obsolete label, then stop ports 62173–62177.
