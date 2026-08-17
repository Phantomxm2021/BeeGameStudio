# Project Workspace Permission Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically resolve project-confined file permissions while immediately rejecting project-boundary escapes so workflow workers never wait for a user click on ordinary project work.

**Architecture:** Extend the existing `BeeGameSessionManager.requestPermission()` authority chain with one focused read/search authority beside the existing mutation authority. It canonicalizes every target against `record.session.cwd`, allows project-local reads/searches, denies external or symlink-escaped targets, and leaves shell/network/non-file permissions untouched. Existing workflow mutation assignment rules remain authoritative.

**Tech Stack:** TypeScript, Bun test, React/Vitest for existing Dashboard regression coverage, Chrome Web/React acceptance.

## Global Constraints

- Do not modify the native Agent core.
- Do not enable global `bypassPermissions`.
- Bee Game Studio enforces only project and workflow ownership boundaries; it does not author document content or schedule Agent tool calls.
- Project-local reads/searches are automatic; mutations remain limited to assigned workflow paths.
- External, ambiguous, and symlink-escaped file targets fail closed without a pending permission gate.
- Bash, network, platform mutations, and non-file tools retain their existing permission rules.

---

### Task 1: Project-local read and search authority

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`

**Interfaces:**
- Consumes: `DashboardPermissionRequest`, `SessionRecord`, `resolveProspectivePath(cwd, path)` and the existing `requestPermission()` authority chain.
- Produces: `projectWorkspaceFileAccessAuthority(record, request): { behavior: 'allow' | 'deny'; reason: 'project_workspace_file_access' | 'project_workspace_boundary' | 'project_workspace_target_invalid'; message?: string } | undefined`.

- [ ] **Step 1: Add failing tests for project-local read/search requests**

  Add one table-driven test that submits `Read.file_path`, `Grep.path`, and `Glob.path` requests using both relative and absolute workspace paths. Assert every decision is `{ behavior: 'allow', scope: 'once' }`, no pending permission exists, and each `permission.resolved` payload contains `autoApproved: true` and `reason: 'project_workspace_file_access'`.

- [ ] **Step 2: Run the focused test and verify RED**

  Run:

  ```bash
  /Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts --test-name-pattern "project-local read"
  ```

  Expected: FAIL because `Read`, `Grep`, and `Glob` currently create pending permission gates.

- [ ] **Step 3: Implement the minimal project file-access authority**

  In `session-manager.ts`, recognize only `Read`, `Grep`, and `Glob`. Extract `file_path` for `Read` and `path` for `Grep`/`Glob`; an omitted `Grep`/`Glob` path means the session workspace root. Resolve the target with `resolveProspectivePath`, compare its canonical relative path to the canonical workspace root, and return allow or deny without touching mutation authority.

  Insert this authority after workflow mutation handling and before the generic pending-permission branch. Append one `permission.resolved` event containing the tool name, decision, exact input, `autoApproved`/`autoDenied`, and the authority reason.

- [ ] **Step 4: Run the focused test and verify GREEN**

  Run the Step 2 command. Expected: PASS with no pending permission.

- [ ] **Step 5: Commit the read/search authority**

  ```bash
  git add packages/agent-workflow-server/src/beegame/session-manager.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts
  git commit -m "fix: auto-resolve project file permissions"
  ```

---

### Task 2: Boundary escapes fail closed without broad approval

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`

**Interfaces:**
- Consumes: `projectWorkspaceFileAccessAuthority()` from Task 1 and existing workflow mutation authority.
- Produces: deterministic denial decisions for parent-directory, absolute external, symlink-escaped, and invalid targets; unsupported tools remain pending under the existing native flow.

- [ ] **Step 1: Add failing boundary and non-file tests**

  Add tests that request:

  - `Read` through `../outside.json`;
  - `Read` through a workspace symlink pointing outside;
  - `Grep` with an absolute external directory;
  - `Read` without `file_path`;
  - `Bash` with the project as cwd.

  Assert the four invalid file requests resolve immediately as deny-once with `autoDenied: true`, contain the offending input and a clear workspace-boundary message, and create no pending permissions. Assert `Bash` is not auto-approved and still follows the existing pending permission path.

- [ ] **Step 2: Run the boundary tests and verify RED**

  ```bash
  /Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts --test-name-pattern "workspace boundary|unsupported tools"
  ```

  Expected: at least the new file-boundary assertions FAIL before the final authority handling is complete.

- [ ] **Step 3: Complete fail-closed handling**

  Ensure invalid path shapes return `project_workspace_target_invalid`; external and symlink-escaped paths return `project_workspace_boundary`. Both return a deny-once decision instead of inserting into `pendingPermissions`. Do not add `Bash`, network, or platform tools to the file-access tool set.

- [ ] **Step 4: Run focused and regression tests**

  ```bash
  /Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts
  /Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.test.ts
  ```

  Expected: PASS; existing assigned-write allow and unassigned-write deny tests remain unchanged.

- [ ] **Step 5: Commit boundary enforcement**

  ```bash
  git add packages/agent-workflow-server/src/beegame/session-manager.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts
  git commit -m "fix: reject workflow file boundary escapes"
  ```

---

### Task 3: Workflow and Dashboard regression verification

**Files:**
- Modify only if the RED test proves projection is missing: `packages/agent-workflow-server/src/app.ts`
- Modify only if the RED test proves rendering is missing: `apps/frontend/src/components/Demiurge/WorkflowCard.tsx`
- Test: `packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts`
- Test: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`

**Interfaces:**
- Consumes: `permission.resolved` events with `autoDenied`, reason, and input.
- Produces: a stopped/failed workflow presentation that retains the original boundary message when the runtime cannot recover from denial.

- [ ] **Step 1: Prove whether existing projection preserves automatic denial**

  Add the smallest backend/frontend regression fixture containing an automatic boundary denial followed by worker failure. Assert the API/view model and Workflow Card display the original boundary message and do not show a generic missing-receipt message.

- [ ] **Step 2: Run the regression and verify RED or existing coverage**

  ```bash
  /Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts --test-name-pattern "boundary denial"
  /Users/nswell/.bun/bin/bunx vitest run apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
  ```

  If the new assertion already passes, do not modify production projection/UI code. If it fails, record the exact lost boundary and proceed to Step 3.

- [ ] **Step 3: Apply only the proven projection fix**

  Preserve the original automatic-denial message in the existing run/task failure field. Do not create a new permission panel, Reviewer panel, retry path, or alternate error channel.

- [ ] **Step 4: Run backend, frontend, type, and diff verification**

  ```bash
  /Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.test.ts
  /Users/nswell/.bun/bin/bunx vitest run apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
  /Users/nswell/.bun/bin/bun run typecheck
  git diff --check
  ```

  Expected: all commands pass.

- [ ] **Step 5: Commit the verified workflow behavior**

  ```bash
  git add packages/agent-workflow-server/src apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
  git commit -m "test: preserve workspace permission failures"
  ```

---

### Task 4: Chrome review/remediation acceptance

**Files:**
- Modify: `docs/superpowers/reviews/2026-08-17-project-workspace-permission-acceptance.md`

**Interfaces:**
- Consumes: the Web/React Dashboard on fixed service ports and the accepted eight-document source project.
- Produces: one isolated review-copy run with per-dispatch token evidence and a pass/fail verdict.

- [ ] **Step 1: Start or confirm the fixed-port Web/React stack**

  Confirm the current configured ports are unchanged and open Bee Game Studio in Chrome. Do not use a direct backend-only path as acceptance evidence.

- [ ] **Step 2: Create a fresh review copy in Chrome**

  Use History → project actions → Create review copy on the accepted eight-document project. Record the new project ID and run ID before any dispatch completes.

- [ ] **Step 3: Observe initial review, remediation, and verification**

  Require project-local `Read/Grep/Glob` calls to proceed without user permission clicks. Stop immediately if an external path is requested; acceptance then requires an immediate explicit denial/failure rather than a running permission wait. Do not use retry to conceal failures.

- [ ] **Step 4: Stop at the next workflow stage and aggregate usage**

  After verification reaches READY, stop before checklist/resource work. Sum each dispatch's final `dispatchUsage` into initial review, remediation, verification, failed attempts, and overall input/cache-input/output/Credit/wall-time totals.

- [ ] **Step 5: Write acceptance evidence and commit**

  Record project/run/dispatch IDs, permission events, token totals, timing, and verdict in the acceptance document.

  ```bash
  git add docs/superpowers/reviews/2026-08-17-project-workspace-permission-acceptance.md
  git commit -m "test: accept project-local permission flow"
  ```
