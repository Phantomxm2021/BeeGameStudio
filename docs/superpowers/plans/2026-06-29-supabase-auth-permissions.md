# Supabase Auth Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep users signed in until they explicitly sign out, and move account/permission state toward Supabase-owned roles and policies.

**Architecture:** BeeGame keeps the local runtime server for filesystem, preview process, and agent execution. Supabase owns auth session refresh, persisted user/member roles, credits, audit, and storage policies. The app backend verifies Supabase JWTs and mirrors permissions for local runtime routes.

**Tech Stack:** Supabase Auth/SQL/RLS/RPC, Bun, Vite/React, Hono server.

---

### Task 1: Persistent Supabase Session Refresh

**Files:**
- Modify: `apps/frontend/src/services/supabaseAuthApi.ts`
- Modify: `apps/frontend/src/services/apiClient.ts`
- Test: `apps/frontend/src/services/supabaseAuthApi.test.ts`
- Test: `apps/frontend/src/services/apiClient.test.ts`

- [x] Add a refresh-token request that calls `/auth/v1/token?grant_type=refresh_token`.
- [x] Keep expired sessions in localStorage while a refresh token exists.
- [x] Make API requests obtain an async valid token before sending.
- [x] Retry one failed 401 request after a successful refresh.
- [x] Clear the session only when refresh fails.

### Task 2: Safe Role Defaults

**Files:**
- Modify: `packages/agent-workflow-server/src/auth/user-context.ts`
- Test: `packages/agent-workflow-server/src/__tests__/user-context.test.ts`

- [x] Change unknown or missing roles to `viewer`, not `owner`.
- [x] Keep explicit `owner`, `developer`, `reviewer`, and `viewer` unchanged.
- [x] Update tests so OAuth users without explicit BeeGame role are viewers.

### Task 3: Supabase Permission Foundation

**Files:**
- Modify: `docs/beegame-supabase-schema.sql`

- [x] Add idempotent helper functions for workspace role lookup.
- [x] Add idempotent profile/workspace bootstrap trigger for new auth users.
- [x] Keep SQL re-runnable with `create or replace function` and `drop trigger if exists`.
- [x] Do not move local runtime, preview, or filesystem work into Supabase.

### Task 4: Verification

**Commands:**
- `cd apps/frontend && /Users/nswell/.bun/bin/bun run test:run src/services/supabaseAuthApi.test.ts src/services/apiClient.test.ts`
- `/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/user-context.test.ts`
- `/Users/nswell/.bun/bin/bun run typecheck`
- `git diff --check`
