# Canonical Document Staging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let BeeGame document authors incrementally write a service-scoped staging file and atomically publish it through a small final tool call.

**Architecture:** A deterministic staging path is added to the canonical commit contract. The document worker receives native `Read`, `Write`, and `Edit` tools restricted by existing workflow permission checks to that staging path. `CommitCanonicalDocument({})` reads, validates, and atomically promotes the staged Markdown using the existing receipt mechanism.

**Tech Stack:** TypeScript, Bun test, Zod, existing QueryEngine native tools, existing BeeGame workflow permission and receipt infrastructure.

---

### Task 1: Stage and commit canonical Markdown

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.ts`
- Test: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving the tool accepts `{}`, reads `contract.stagingPath`, rejects a missing or invalid staged document, and commits valid staged Markdown without accepting a `body` property.

- [ ] **Step 2: Verify RED**

Run: `bun test packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts`

Expected: FAIL because the contract has no staging path and the tool still requires `body`.

- [ ] **Step 3: Implement the minimal staged commit**

Add `stagingPath` to `CanonicalDocumentCommitContract`, export a deterministic path helper, replace the body schema with a strict empty object, read staged UTF-8 Markdown in `call`, then pass it through the existing validator and `commitCanonicalDocument`.

- [ ] **Step 4: Verify GREEN**

Run the focused tool test and require all cases to pass.

### Task 2: Expose only staging file tools

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/query-engine-runner.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Test: `packages/agent-workflow-server/src/__tests__/query-engine-runner.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

- [ ] **Step 1: Write failing capability and permission tests**

Assert initial/remediation document authors receive `Read`, `Write`, and `Edit`; repair planning remains tool-isolated; writes and reads under the staging path auto-allow; the final `docs/*.md` path auto-denies.

- [ ] **Step 2: Verify RED**

Run the four focused suites and confirm failures identify the absent staging capability.

- [ ] **Step 3: Implement minimal wiring**

Build the staging path from dispatch identity, pass it as the only `workflowAllowedPaths` entry for canonical authors, permit document-author reads only inside that scope, select only `Read`, `Write`, and `Edit`, and update prompts to author the staging file incrementally before calling `CommitCanonicalDocument({})`.

- [ ] **Step 4: Verify GREEN**

Run the focused suites, `bun run typecheck`, and `git diff --check`.

### Task 3: Real workflow verification

**Files:**
- No production file changes unless the real run exposes a reproducible defect.

- [ ] **Step 1: Start the fixed-port stack**

Use frontend `62273`, runtime `62274`, billing `62275`, skills `62276`, and resources `62277` with the configured model environment.

- [ ] **Step 2: Run Chrome acceptance**

Control Chrome to retry the real document workflow, wait for canonical documents to appear, and inspect Deliverables.

- [ ] **Step 3: Validate actual outputs**

Run canonical document validators over generated files and audit the real content for complete human-team production coverage.

- [ ] **Step 4: Final verification and commit**

Run focused tests, document workflow tests, typecheck, and diff-check; commit only intended files.

