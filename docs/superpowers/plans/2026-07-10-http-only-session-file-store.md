# HttpOnly Session File Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist encrypted HttpOnly auth sessions in an atomic file-backed store that survives route registration/restart while preserving existing flag, cookie, and CSRF behavior.

**Architecture:** Keep the store private to `session-routes.ts`, loading a JSON map of session ids to `auth:session` encrypted envelopes on each read/mutation. Resolve the file from `sessionStorePath`, `AGENT_WORKFLOW_DATA_DIR`, or `~/.beegame/dashboard`, and persist mutations via a sibling temp file plus rename. Document this as a single persistent local backend, not distributed consistency.

**Tech Stack:** TypeScript, Bun tests, Hono, Node `fs`/`path`, existing AES-256-GCM `secret-crypto`.

---

### Task 1: Add persistence and expiry regression tests

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`

- [ ] **Step 1: Add temp-directory cleanup and explicit store paths**

Import `mkdtemp`, `rm`, `readFile`, `tmpdir`, and `join`; make `createApp` accept `sessionStorePath`; track created temp directories and remove them in `afterEach`.

- [ ] **Step 2: Write the failing restart persistence test**

Create a session through one Hono app, register a second app with the same `sessionStorePath`, then request `/api/auth/session` with the original cookie and assert `authenticated: true` and the original user id.

- [ ] **Step 3: Run the focused test and verify the expected failure**

Run `conda run -n xrmoddemiurge bun test packages/agent-workflow-server/src/__tests__/session-routes.test.ts`; expect the new test to fail because `sessionStorePath` is not yet supported and route registrations do not share records.

- [ ] **Step 4: Add mutation and expiry tests**

Assert refresh through a second registration updates the persisted record by reading it from a third registration; assert both POST and DELETE logout remove the record; create an encrypted expired record in the store and assert a session request returns 401.

### Task 2: Implement the encrypted atomic file store

**Files:**
- Modify: `packages/agent-workflow-server/src/auth/session-routes.ts`

- [ ] **Step 1: Add store path resolution and file helpers**

Add `sessionStorePath?: string` to `BeeGameSessionRouteOptions`; resolve it from the option, `AGENT_WORKFLOW_DATA_DIR`, or `join(homedir(), '.beegame', 'dashboard', 'auth-sessions.json')`. Add helpers to load a JSON object map, decrypt/validate a record, and persist the complete map with `mkdir(dirname(path), { recursive: true })`, `writeFile(tempPath, JSON)`, and `rename(tempPath, path)`.

- [ ] **Step 2: Replace the process-local Map reads and writes**

Make `getRecord` load the file, read the cookie id, decrypt with `SESSION_RECORD_TYPE`, reject malformed records, and reject/remove records whose `expiresAt <= Date.now()`. Make `saveRecord` load the latest map, encrypt with the same AAD, write atomically, and return the id.

- [ ] **Step 3: Persist refresh and logout/delete mutations**

On refresh failure, load and delete the current id before persisting. On successful refresh, save the updated record under the same id. In both logout route methods, delete the cookie id from the loaded map and persist the deletion. Preserve all response status, cookie, feature-flag, and Origin validation behavior.

- [ ] **Step 4: Run the focused tests and refactor only after green**

Run `conda run -n xrmoddemiurge bun test packages/agent-workflow-server/src/__tests__/session-routes.test.ts`; then simplify duplicated store operations without changing behavior.

### Task 3: Add operational documentation and environment guidance

**Files:**
- Create: `docs/security/service-hardening-runbook.md`
- Modify: `.env.example`

- [ ] **Step 1: Document required session configuration and rollout**

Document `BEEGAME_CONFIG_ENCRYPTION_KEY`, `BEEGAME_HTTPONLY_SESSIONS`, the default/override session store path, atomic local persistence, backup/permissions, staged disabled → staging → internal → broad rollout, and rollback behavior.

- [ ] **Step 2: Document limits and deployment topology**

Document outbound host/port policy configuration and upload count/byte/type/archive limits using the names already present in the repository. State plainly that the file store does not provide distributed consistency and multi-process/multi-instance deployments require a shared persistent backend with coordination.

- [ ] **Step 3: Update `.env.example`**

Add commented examples for the encryption key, HttpOnly session flag/store path, outbound policy limits, upload limits, and migration rollout notes without adding secrets or test-specific values to application logic.

### Task 4: Verify, review, and commit

**Files:**
- Verify: changed source, tests, docs, and environment example

- [ ] **Step 1: Run package typecheck and focused tests**

Run `conda run -n xrmoddemiurge bun --cwd packages/agent-workflow-server run typecheck` and `conda run -n xrmoddemiurge bun test packages/agent-workflow-server/src/__tests__/session-routes.test.ts`.

- [ ] **Step 2: Run diff hygiene checks**

Run `git diff --check` and inspect `git diff --stat` plus the complete diff for accidental secrets, hardcoded fixture logic, or changed cookie/CSRF behavior.

- [ ] **Step 3: Stage and commit**

Stage the implementation, tests, spec, plan, runbook, and `.env.example`, then commit with `security: persist HttpOnly sessions atomically`. Report the resulting commit SHA; if Git metadata remains blocked, report that exact blocker and the verified uncommitted state.
