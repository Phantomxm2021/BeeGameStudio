# Bounded Native Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent unrecoverable oversized native Write calls while preserving native ownership of document content and file-operation sequencing.

**Architecture:** Extend the existing FileWriteTool schema with a generation-visible content limit and an optimistic-concurrency append mode. Reuse the current FileWriteTool execution pipeline so permissions, hooks, diagnostics, history and atomic replacement remain single-track.

**Tech Stack:** TypeScript, Bun, Zod v4, existing builtin-tools test harness.

---

### Task 1: Prove the schema boundary

**Files:**
- Modify: `packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.test.ts`
- Modify: `packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.ts`

- [ ] Add a test that `FileWriteTool.inputSchema.safeParse()` rejects 16,385 characters and accepts 16,384 characters.
- [ ] Add a test that the generated tool JSON Schema contains `maxLength: 16384` for `content`.
- [ ] Run the focused test and confirm RED because content is currently unbounded.
- [ ] Add the exported `MAX_WRITE_CONTENT_CHARS` constant and `z.string().max(MAX_WRITE_CONTENT_CHARS)`.
- [ ] Run the focused test and confirm GREEN.

### Task 2: Add optimistic append semantics

**Files:**
- Modify: `packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.test.ts`
- Modify: `packages/builtin-tools/src/tools/FileWriteTool/FileWriteTool.ts`
- Modify: `packages/builtin-tools/src/tools/FileWriteTool/prompt.ts`

- [ ] Add a failing test that three bounded calls produce the exact bytes of one larger reference string.
- [ ] Add failing tests for missing target, wrong `expected_bytes`, and replayed append; each must leave bytes unchanged.
- [ ] Add optional `mode: "overwrite" | "append"` and `expected_bytes` fields, with cross-field validation requiring the byte count for append.
- [ ] In validation, read the current file for append, check `Buffer.byteLength`, and scan the resulting complete content for secrets.
- [ ] In call, form `existing + content` only after validation and pass the result through the existing atomic write/history/diff path.
- [ ] Update the native Write description with bounded overwrite/append usage and optimistic byte-count semantics.
- [ ] Run focused tests and confirm GREEN.

### Task 3: Preserve core integrations

**Files:**
- Modify only if a failing compatibility test requires it: `src/services/tools/toolExecution.ts`
- Test: existing FileWrite, permission, hook and message suites.

- [ ] Run all FileWriteTool tests.
- [ ] Run tool execution and session file access hook tests.
- [ ] Run `bun run typecheck`.
- [ ] Build the native distribution used by Bee Game Studio.
- [ ] Run `git diff --check` and inspect the diff for any document-specific or BGS content-control logic.

### Task 4: Production acceptance

**Files:**
- No source changes during acceptance.

- [ ] Start the fixed Bee Game Studio ports.
- [ ] Use Chrome to create a new neutral game project and start the eight-document workflow.
- [ ] Stop after the GDD reaches the normal completed state.
- [ ] Verify the GDD with `validateCompleteGameDocumentMarkdown`.
- [ ] Record Write call count, largest per-call content, elapsed time, input/cache/output tokens and any API stalls.
- [ ] Compare against the prior 32,316-byte direct success and the zero-byte stalled production run.

