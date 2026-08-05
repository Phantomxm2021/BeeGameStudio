# Canonical Resource Content Commit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic Resource Content file writes and the status-only terminal with one validated canonical content commit fed by a compact frozen Manifest projection.

**Architecture:** A pure canonical validator accepts in-memory content documents and powers both filesystem audit and the native commit tool. `CommitResourceContent` validates the merged candidate set before mutation, serializes JSON/YAML itself, and is the sole terminal; the Workflow request carries exact requirement/resource/binding identities instead of forcing Manifest module reads.

**Tech Stack:** TypeScript, Bun, Zod, YAML, filesystem atomic rename, native BeeGame workflow tools.

---

### Task 1: Canonical in-memory content validation

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/content-contracts.ts`
- Test: `packages/agent-workflow-server/src/beegame/asset-contract-audit.test.ts`

- [x] Add a failing test proving a document without `schema` and a resource registry with invented requirement IDs are rejected by the same in-memory validator.
- [x] Add a failing test proving a project-required mixed JSON/YAML set, exact required coverage, verified resource coverage, and canonical `data.bindings` pass without forcing unused kinds.
- [x] Extract one validator that accepts parsed documents plus a Manifest; make filesystem audit parse files and delegate to it.
- [x] Run the content and asset contract tests and confirm the red-green cycle.

### Task 2: Single native content commit

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/native-resource-content-tool.ts`
- Create: `packages/agent-workflow-server/src/beegame/native-resource-content-tool.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/query-engine-runner.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-workflow-result-tools.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`

- [x] Add a failing test proving an invalid set returns a tool error and leaves the content root unchanged.
- [x] Add a failing test proving a valid complete set is service-serialized and atomically written.
- [x] Add a failing test proving `needs_inventory` accepts only exact current missing requirement IDs.
- [x] Implement `CommitResourceContent` with `commit` and `needs_inventory` as one discriminated union.
- [x] Remove the separate Resource Content status terminal and make the accepted canonical commit the deterministic terminal.
- [x] Run native tool, session-port, runner, and worker-contract tests.

### Task 3: Compact frozen content-author contract

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/query-engine-process-input.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-workflow-resource-integration.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

- [x] Add a failing test proving the dispatch contains exact required IDs, verified resource IDs, and inventory bindings without Manifest module paths.
- [x] Derive the immutable projection from the canonical Manifest audit and inventory receipt.
- [x] Restrict authority paths to approved executable fact owners and instruct the worker not to read Manifest modules.
- [x] Remove generic `Write/Edit/MultiEdit/Glob/Grep/LS` from Resource Content Author; keep only approved document Read plus the canonical tool.
- [x] Run resource-stage, prompt, query-engine input, recovery, and schema tests.

### Task 4: Anti-pollution and end-to-end verification

**Files:**
- Modify: `docs/beegame-resource-production-plan.md`
- Modify: `docs/beegame-resource-content-contract.md`
- Verify all changed files.

- [x] Update authority text so accepted content means canonical commit validation succeeded before mutation.
- [x] Scan for separate Resource Content status terminals, generic Resource Content mutation access, alternative content validators, compatibility parsers, retry limits, and duplicate ledgers.
- [x] Run all agent-workflow server tests and TypeScript checks.
- [x] Start the local stack, verify the UI and terminal behavior in Chrome without modifying an example project, then stop ports 62173–62177.

### Task 5: Durable terminal authority and native-tool runtime contract

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/native-resource-content-tool.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-resource-content-tool.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`

- [x] Add a failing runtime-contract test proving `CommitResourceContent` maps an accepted result into a valid tool-result block.
- [x] Add a failing recovery test proving a committed dispatch receipt advances Resource Content when `tool.completed` is absent.
- [x] Make the native tool definition compile-time complete and add the missing result mapper.
- [x] Persist and reconcile one dispatch-bound terminal receipt for both `commit` and `needs_inventory`.
- [x] Remove Resource Content terminal authority from transient completed-tool input inspection.
- [x] Add negative tests for mismatched dispatch IDs, non-matching final digests, prepared receipts and stale authority.
- [x] Scan for alternate Resource Content completion paths, compatibility branches, retry fallbacks and duplicate ledgers, then run the complete workflow server suite and type checks.

### Task 6: Serialized recovered-terminal consumption

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`

- [x] Add a failing Controller-level recovery test proving a committed Resource Content terminal cannot remain indefinitely in preparation.
- [x] Let recovered-terminal replay invoke the same unlocked terminal handler while the Controller already owns its serialization lane.
- [x] Clear the obsolete transport failure when restoring the committed terminal receipt.
- [x] Run the targeted recovery test, complete Workflow server suite, type checks and residue scan.
