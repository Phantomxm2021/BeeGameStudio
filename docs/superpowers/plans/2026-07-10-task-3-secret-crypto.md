# Task 3 Secret Crypto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt persisted agent-workflow model, MCP, and service secrets with a versioned AES-256-GCM envelope and migrate legacy plaintext safely.

**Architecture:** A focused crypto module owns key policy and envelope parsing. Local stores encrypt at file persistence boundaries, while the Supabase store encrypts values before REST writes and decrypts only when internal values are needed. Public DTO mappings remain preview-only.

**Tech Stack:** TypeScript, Bun test, Node `crypto`, existing local JSON stores and Supabase REST adapter.

---

### Task 1: Crypto boundary

**Files:**
- Create: `packages/agent-workflow-server/src/security/secret-crypto.ts`
- Create: `packages/agent-workflow-server/src/__tests__/secret-crypto.test.ts`

- [ ] Write failing tests for exact v1 envelope round-trip, AAD/tamper/unknown-version rejection, key validation, and plaintext policy.
- [ ] Run `bun test packages/agent-workflow-server/src/__tests__/secret-crypto.test.ts` and verify failure is due to missing module/behavior.
- [ ] Implement key loading, base64url encoding, AES-256-GCM encryption/decryption, and explicit local plaintext fallback.
- [ ] Run the focused test until green.

### Task 2: Local model and MCP persistence

**Files:**
- Modify: `packages/agent-workflow-server/src/model-config-store.ts`
- Modify: `packages/agent-workflow-server/src/mcp-servers-store.ts`
- Modify: `packages/agent-workflow-server/src/local-data-migration.ts`
- Modify/create focused tests under `packages/agent-workflow-server/src/__tests__/`

- [ ] Add failing tests proving local persisted model keys and MCP env values are envelopes, legacy plaintext is readable and rewritten, migration is idempotent, omitted updates preserve values, explicit empty values clear values, and public DTOs omit raw secrets.
- [ ] Implement encryption/decryption at local store boundaries without changing unrelated stores or frontend contracts.
- [ ] Run the focused local-store and migration tests until green.

### Task 3: Supabase persistence and public redaction

**Files:**
- Modify: `packages/agent-workflow-server/src/supabase-dashboard-store.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/supabase-dashboard-store.test.ts` or a focused new test.

- [ ] Add failing tests for encrypted model/service writes, legacy read compatibility, omitted-vs-clear updates, and DTO redaction.
- [ ] Implement encryption/decryption while retaining existing Supabase columns and request shapes.
- [ ] If runtime secret reads or schema typing make this impossible, preserve the existing contract and report the exact blocker.
- [ ] Run focused Supabase tests.

### Task 4: Verification and commit

- [ ] Run `conda run -n xrmoddemiurge bun test ...` for all focused tests.
- [ ] Run `conda run -n xrmoddemiurge bun --cwd packages/agent-workflow-server run typecheck`.
- [ ] Inspect `git diff` and ensure unrelated frontend changes are untouched.
- [ ] Commit implementation and tests with `security: encrypt persisted agent secrets`.
