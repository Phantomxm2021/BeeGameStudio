# Independent Agent Workflow Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the temporary RCS-hosted dashboard direction with independent agent workflow dashboard modules.

**Architecture:** `packages/agent-workflow` owns dashboard domain state for model configs, projects, runs, phases, events, workers, and artifacts. `packages/agent-workflow-server` exposes that domain over HTTP. `apps/dashboard` is the visual workflow dashboard app and does not live under Remote Control Server.

**Tech Stack:** Bun workspaces, TypeScript, Hono, React, Vite, bun:test.

---

### Task 1: Domain Package

**Files:**
- Create `packages/agent-workflow/package.json`
- Create `packages/agent-workflow/tsconfig.json`
- Create `packages/agent-workflow/src/index.ts`
- Create `packages/agent-workflow/src/model-config.ts`
- Create `packages/agent-workflow/src/workflow.ts`
- Create `packages/agent-workflow/src/__tests__/model-config.test.ts`
- Create `packages/agent-workflow/src/__tests__/workflow.test.ts`

- [ ] Write failing tests for masked LLM configs, workflow run creation, phase updates, event logs, and artifact ownership.
- [ ] Implement minimal in-memory domain APIs.
- [ ] Run `bun test packages/agent-workflow/src/__tests__`.
- [ ] Commit `feat: add agent workflow domain package`.

### Task 2: Server Package

**Files:**
- Create `packages/agent-workflow-server/package.json`
- Create `packages/agent-workflow-server/tsconfig.json`
- Create `packages/agent-workflow-server/src/app.ts`
- Create `packages/agent-workflow-server/src/index.ts`
- Create `packages/agent-workflow-server/src/__tests__/routes.test.ts`

- [ ] Write failing route tests for models, projects, runs, run detail, events, artifacts, and worker summaries.
- [ ] Implement Hono routes backed by `@claude-code-best/agent-workflow`.
- [ ] Run server tests and typecheck.
- [ ] Commit `feat: add agent workflow server`.

### Task 3: Dashboard App

**Files:**
- Modify `package.json`
- Modify `tsconfig.json`
- Create `apps/dashboard/package.json`
- Create `apps/dashboard/tsconfig.json`
- Create `apps/dashboard/vite.config.ts`
- Create `apps/dashboard/index.html`
- Create `apps/dashboard/src/main.tsx`
- Create `apps/dashboard/src/App.tsx`
- Create `apps/dashboard/src/api.ts`
- Create `apps/dashboard/src/index.css`

- [ ] Add `apps/*` to workspaces and package path aliases.
- [ ] Build a visual agent workflow dashboard: sidebar, workflow timeline, event log, artifacts, workers, and model panel.
- [ ] Run app typecheck and build.
- [ ] Commit `feat: add independent agent workflow dashboard app`.
