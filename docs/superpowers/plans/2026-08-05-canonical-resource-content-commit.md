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

- [ ] Add a failing test proving a document without `schema` and a resource registry with invented requirement IDs are rejected by the same in-memory validator.
- [ ] Add a failing test proving a project-required mixed JSON/YAML set, exact required coverage, verified resource coverage, and canonical `data.bindings` pass without forcing unused kinds.
- [ ] Extract one validator that accepts parsed documents plus a Manifest; make filesystem audit parse files and delegate to it.
- [ ] Run the content and asset contract tests and confirm the red-green cycle.

### Task 2: Single native content commit

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/native-resource-content-tool.ts`
- Create: `packages/agent-workflow-server/src/beegame/native-resource-content-tool.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/query-engine-runner.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-workflow-result-tools.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`

- [ ] Add a failing test proving an invalid set returns a tool error and leaves the content root unchanged.
- [ ] Add a failing test proving a valid complete set is service-serialized and atomically written.
- [ ] Add a failing test proving `needs_inventory` accepts only exact current missing requirement IDs.
- [ ] Implement `CommitResourceContent` with `commit` and `needs_inventory` as one discriminated union.
- [ ] Remove Resource Content Author from `SubmitResourceContentResult` and make the accepted canonical commit the deterministic terminal.
- [ ] Run native tool, session-port, runner, and worker-contract tests.

### Task 3: Compact frozen content-author contract

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/query-engine-process-input.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-workflow-resource-integration.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

- [ ] Add a failing test proving the dispatch contains exact required IDs, verified resource IDs, and inventory bindings without Manifest module paths.
- [ ] Derive the immutable projection from the canonical Manifest audit and inventory receipt.
- [ ] Restrict authority paths to approved executable fact owners and instruct the worker not to read Manifest modules.
- [ ] Remove generic `Write/Edit/MultiEdit/Glob/Grep/LS` from Resource Content Author; keep only approved document Read plus the canonical tool.
- [ ] Run resource-stage, prompt, query-engine input, recovery, and schema tests.

### Task 4: Anti-pollution and end-to-end verification

**Files:**
- Modify: `docs/beegame-resource-production-plan.md`
- Modify: `docs/beegame-resource-content-contract.md`
- Verify all changed files.

- [ ] Update authority text so accepted content means canonical commit validation succeeded before mutation.
- [ ] Scan for `SubmitResourceContentResult`, generic Resource Content mutation access, alternative content validators, compatibility parsers, retry limits, and duplicate ledgers.
- [ ] Run all agent-workflow server tests and TypeScript checks.
- [ ] Start the local stack, verify the UI and terminal behavior in Chrome without modifying an example project, then stop ports 62173–62177.
