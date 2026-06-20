# Claude Code Runtime Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard server's fake run-start behavior with a runtime adapter boundary that can drive workflow state from Claude Code runtime events.

**Architecture:** `packages/agent-workflow-server` owns HTTP routes and adapter orchestration; `packages/agent-workflow` owns run/project/artifact state transitions. The route creates a queued run, maps `modelConfigId` to runtime env, then delegates start/cancel/retry/resume to an adapter whose events update phases, logs, artifacts, and terminal status.

**Tech Stack:** Bun, Hono, TypeScript, `bun:test`, existing `@claude-code-best/agent-workflow` package.

---

### Task 1: Runtime Adapter Contract

**Files:**
- Create: `packages/agent-workflow-server/src/runtime/types.ts`
- Create: `packages/agent-workflow-server/src/runtime/null-runtime-adapter.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Test: `packages/agent-workflow-server/src/__tests__/runtime-routes.test.ts`

- [ ] Write a failing route test where `POST /api/runs` calls an injected adapter with the run, project, runtime model env, and event sink.
- [ ] Run `PATH=/Users/nswell/.bun/bin:$PATH bun test packages/agent-workflow-server/src/__tests__/runtime-routes.test.ts` and confirm the adapter option is missing.
- [ ] Add the runtime adapter types and inject the adapter through `createAgentWorkflowApp({ runtimeAdapter })`.
- [ ] Replace route-level `updateRunPhase(..., 'running')` with `runtimeAdapter.startRun(...)`.
- [ ] Run the route test and confirm it passes.

### Task 2: Runtime Event Application

**Files:**
- Modify: `packages/agent-workflow/src/workflow.ts`
- Modify: `packages/agent-workflow-server/src/runtime/types.ts`
- Create: `packages/agent-workflow-server/src/runtime/events.ts`
- Test: `packages/agent-workflow-server/src/__tests__/runtime-events.test.ts`

- [ ] Write failing tests for `phase_started`, `phase_done`, `agent_progress`, `artifact_created`, `run_done`, and permission request events.
- [ ] Add domain functions for terminal run status and `requires_action`.
- [ ] Implement `applyRuntimeEvent(runId, event)` with explicit event payloads, not log parsing.
- [ ] Run server tests and domain tests.

### Task 3: Control Routes

**Files:**
- Modify: `packages/agent-workflow-server/src/app.ts`
- Test: `packages/agent-workflow-server/src/__tests__/runtime-routes.test.ts`

- [ ] Add failing tests for `POST /api/runs/:id/cancel`, `POST /api/runs/:id/retry`, and `POST /api/runs/:id/resume`.
- [ ] Implement the routes by delegating to the runtime adapter.
- [ ] Ensure missing runs return 404 and adapter errors return 400.

### Task 4: Claude Code Runtime Hook

**Files:**
- Create: `packages/agent-workflow-server/src/runtime/claude-code-runtime-adapter.ts`
- Modify: `packages/agent-workflow-server/src/index.ts`
- Test: focused typecheck plus server route tests with injected fake launcher.

- [ ] Add an adapter that accepts a Claude Code workflow launcher dependency instead of importing UI state into the server.
- [ ] Pass runtime env from model config into the launcher boundary.
- [ ] Map launcher progress events to runtime events.
- [ ] Keep the default server explicit when no Claude Code host is attached, so the dashboard cannot claim a real backend connection by accident.

### Verification

- [ ] `PATH=/Users/nswell/.bun/bin:$PATH bun test packages/agent-workflow/src/__tests__`
- [ ] `PATH=/Users/nswell/.bun/bin:$PATH bun test packages/agent-workflow-server/src/__tests__`
- [ ] `PATH=/Users/nswell/.bun/bin:$PATH bun run --cwd packages/agent-workflow typecheck`
- [ ] `PATH=/Users/nswell/.bun/bin:$PATH bun run --cwd packages/agent-workflow-server typecheck`
