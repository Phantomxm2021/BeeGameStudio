# Task 3 Secret Review Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Task 3 secret-storage, startup-validation, explicit-clear, migration, and test-fixture gaps.

**Architecture:** Reuse the existing AES-256-GCM envelope and repository abstractions. Local stores decrypt on read, rewrite legacy plaintext through the existing atomic rename path, and expose only previews. Update contracts distinguish omitted secrets from explicit `clearSecret: true`; startup validation is called before app/server use.

**Tech Stack:** TypeScript, Bun tests, Hono, Supabase REST repository, Node crypto/fs.

---

### Task 1: Establish failing review-gap tests

**Files:** `packages/agent-workflow-server/src/__tests__/*`, `packages/agent-workflow/src/__tests__/model-config.test.ts`

- [ ] Add tests for encrypted web-tools persistence, legacy rewrite idempotence, startup validation/warning, and omitted/empty/explicit-clear semantics across model, MCP, and web-tools contracts.
- [ ] Run each focused test and confirm it fails for the missing behavior.

### Task 2: Complete local secret storage and startup validation

**Files:** `packages/agent-workflow-server/src/web-tools-store.ts`, `packages/agent-workflow-server/src/security/secret-crypto.ts`, `packages/agent-workflow-server/src/app.ts`, `packages/agent-workflow-server/src/index.ts`

- [ ] Encrypt web-tools secrets and migrate legacy plaintext with atomic idempotent rewrites.
- [ ] Add one local plaintext warning without values and shared startup key validation before serving.
- [ ] Keep existing atomic temp-file rename behavior.

### Task 3: Apply explicit clear semantics to all contracts

**Files:** `packages/agent-workflow/src/model-config.ts`, `packages/agent-workflow-server/src/mcp-servers-store.ts`, `packages/agent-workflow-server/src/web-tools-store.ts`, `packages/agent-workflow-server/src/dashboard-repository.ts`, `packages/agent-workflow-server/src/app.ts`, `packages/agent-workflow-server/src/supabase-dashboard-store.ts`

- [ ] Add `clearSecret` fields and propagate them from route payloads to local and Supabase stores.
- [ ] Preserve omitted values, replace with non-empty values, and clear only when explicitly requested.

### Task 4: Add Supabase migration and audit behavior

**Files:** `packages/agent-workflow-server/src/supabase-dashboard-store.ts`, `packages/agent-workflow-server/src/local-data-migration.ts`, `scripts/*`, related tests

- [ ] Implement an idempotent repository-backed legacy plaintext migration with count-only logs.
- [ ] Emit `secret.migrated` through the existing audit mechanism where available.

### Task 5: Verify and commit

- [ ] Run typecheck and focused/affected route/store tests in `conda activate xrmoddemiurge`.
- [ ] Inspect the final diff, preserve unrelated changes, and commit the safe complete subset.
