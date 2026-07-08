# BeeGame Project Lifecycle Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose project lifecycle quota and cleanup visibility to administrators without changing project storage semantics.

**Architecture:** Add a read-only admin lifecycle endpoint backed by the existing project list and audit event stores. Surface the endpoint in the existing Settings > Platform modal as a permission-gated project lifecycle tab.

**Tech Stack:** Bun/Hono server, existing dashboard repository, React/Vitest frontend.

---

### Task 1: Backend Lifecycle Overview

**Files:**
- Modify: `packages/agent-workflow-server/src/dashboard-repository.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Test: `packages/agent-workflow-server/src/__tests__/routes.test.ts`

- [ ] Write a failing route test for `/api/admin/projects/lifecycle` requiring `audit.read`.
- [ ] Add a repository method that returns quota usage, project roots, runtime snapshot hints, storage mode, and recent project deletion audit events.
- [ ] Add the admin route with `audit.read` permission.
- [ ] Run the targeted Bun route tests.

### Task 2: Frontend Lifecycle Tab

**Files:**
- Create: `apps/frontend/src/services/projectLifecycleApi.ts`
- Modify: `apps/frontend/src/components/Demiurge/Landing/SettingsMenu.tsx`
- Modify: `apps/frontend/src/components/Demiurge/Landing/SettingsMenu.test.tsx`
- Modify: `apps/frontend/src/components/Demiurge/LandingView.test.tsx`

- [ ] Write failing SettingsMenu/LandingView tests for permission-gated project lifecycle visibility.
- [ ] Add a small API client for the lifecycle endpoint.
- [ ] Add a Settings > Platform project lifecycle tab.
- [ ] Run targeted Vitest tests and frontend typecheck.

### Task 3: Product TODO Update

**Files:**
- Modify: `docs/beegame-product-todo.md`

- [ ] Mark lifecycle admin visibility complete if tests pass.
- [ ] Leave remaining lifecycle scope limited to future retention automation if still needed.
