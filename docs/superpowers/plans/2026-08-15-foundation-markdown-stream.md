# Foundation Markdown Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate all eight initial Foundation documents as one visible Markdown response stream per document, atomically publish validated files, and remove the automatic draft-calibration lane.

**Architecture:** Initial Foundation document workers launch the existing native CLI with no tools and a pure-Markdown output contract. A focused stream sink consumes raw visible `text_delta` events into a dispatch-owned pending file, validates and canonicalizes the completed bytes, atomically publishes the assigned document, and persists the existing digest receipt. The workflow schedules documents only when their contracted upstream documents are committed, so no later calibration pass is needed.

**Tech Stack:** TypeScript, Bun, native CLI `stream-json`, Node file streams/fsync/rename, Zod v4, existing Foundation document validators and workflow store.

## Global Constraints

- Do not modify the native runtime repository or its `Write`, `Edit`, context, thinking, provider, or retry implementation.
- Initial Foundation authoring has exactly one production lane; do not retain native file authoring as a fallback.
- Bee Game Studio persists model-authored Markdown bytes but never selects chunks, writes prose, repairs content, or silently retries.
- JSON receipts contain identity, length, digest, and status only; they never contain Markdown bodies.
- Review and explicit remediation remain separate existing workflow phases.
- Remove automatic Foundation calibration and its resume behavior.
- Preserve the user's model configuration and fixed-port Chrome acceptance path.

---

### Task 1: Durable Markdown Stream Sink

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/foundation-markdown-stream.ts`
- Create: `packages/agent-workflow-server/src/beegame/foundation-markdown-stream.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/authored-document-receipt.ts`
- Modify: `packages/agent-workflow-server/src/beegame/authored-document-receipt.test.ts`

**Interfaces:**
- Produces: `FoundationMarkdownStreamContract { runId, dispatchId, targetPath, maxBytes }`.
- Produces: `FoundationMarkdownStreamSink.observe(message): void`, `commit(): Promise<AuthoredDocumentReceipt>`, and `abort(reason): Promise<void>`.
- Produces: `commitStreamedFoundationDocument({ workspacePath, dispatchId, targetPath, pendingPath, expectedOriginalDigest? })`.
- Consumes: `validateCompleteGameDocumentMarkdown`, existing canonical metadata injection, receipt paths, SHA-256 helpers, and atomic file primitives.

- [ ] **Step 1: Write failing stream assembly tests**

Add tests proving ordered `message_start`, one visible `content_block_start`, multiple `text_delta` events, `content_block_stop`, and normal result produce byte-identical pending Markdown and one committed receipt. Assert the body is absent from receipt JSON.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/foundation-markdown-stream.test.ts packages/agent-workflow-server/src/beegame/authored-document-receipt.test.ts
```

Expected: failure because `foundation-markdown-stream.ts` and streamed commit APIs do not exist.

- [ ] **Step 3: Add failure-first coverage**

Cover duplicate/replayed deltas, a second visible text block, any `tool_use`, missing normal result, invalid Markdown, invalid UTF-8 boundary handling, byte ceiling overflow, changed target baseline, and interrupted stream. Assert every failure preserves the prior canonical file and retains only dispatch-scoped pending diagnostics.

- [ ] **Step 4: Implement the minimal stream sink and streamed receipt commit**

Use a single append-only UTF-8 file stream. Track provider message identity, visible block index, received bytes, delta count, longest inter-delta gap, terminal state, and first failure. Backpressure is awaited during `commit()`. Close and fsync the pending file before validation; canonicalize service-owned metadata through the existing receipt path; atomically replace the target; fsync the containing directory; then persist the committed receipt.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 1 command and require zero failures.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/agent-workflow-server/src/beegame/foundation-markdown-stream.ts packages/agent-workflow-server/src/beegame/foundation-markdown-stream.test.ts packages/agent-workflow-server/src/beegame/authored-document-receipt.ts packages/agent-workflow-server/src/beegame/authored-document-receipt.test.ts
git commit -m "feat: persist foundation markdown streams"
```

---

### Task 2: Text-only Native Document Turn

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts`

**Interfaces:**
- Extends: `BeeGameSessionRunnerStartInput.workflowMarkdownStreamContract?: FoundationMarkdownStreamContract`.
- Extends: session records with exactly one sink for an initial Foundation turn.
- Consumes: `FoundationMarkdownStreamSink` from Task 1.

- [ ] **Step 1: Write failing native-command tests**

Assert an initial Foundation stream worker launches with `--tools` and an empty tool list while ordinary chat, review, remediation, resource, and implementation workers retain the current command unchanged.

- [ ] **Step 2: Write failing session lifecycle tests**

Feed raw stream events through a fake runtime and assert the session manager observes them before presentation mapping, awaits sink commit before `turn.completed`, converts sink failure into `turn.failed`, and aborts without publishing when stopped.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
bun test packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts
```

- [ ] **Step 4: Implement text-only command selection and sink lifecycle**

Pass the stream contract from the session record to the runner. Add `--tools`, `''` only for that contract. Observe raw messages in the sink before dashboard mapping. After the native result resolves, commit the sink before recording `turn.completed`; on any failure, abort it and surface the concrete error. Do not add a timeout, continuation, or API retry.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 2 command and require zero failures.

- [ ] **Step 6: Commit Task 2**

```bash
git add packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts packages/agent-workflow-server/src/beegame/session-manager.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts
git commit -m "feat: run foundation authors as markdown streams"
```

---

### Task 3: Worker Contract and Atomic Completion

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

**Interfaces:**
- Consumes: `FoundationMarkdownStreamContract` and committed authored-document receipt.
- Produces: one deterministic document-author terminal derived from the committed receipt and stream metrics.

- [ ] **Step 1: Write failing prompt and start-contract tests**

Assert every `initial` and `parallel-draft` Foundation assignment says to return exactly the raw Markdown body, contains no request to use file tools, receives a stream contract with exact run/dispatch/path identity, and never receives a custom terminal JSON instruction.

- [ ] **Step 2: Write failing completion tests**

Assert polling waits for worker idle and a matching committed receipt, does not reread a partially written target after the raw result event, does not send the current automatic validation-correction turn, and fails visibly when no receipt exists.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
```

- [ ] **Step 4: Implement the worker stream contract**

Pass the contract at session creation for initial Foundation authors only. Change the prompt from “write at path” to the pure-Markdown response contract. Derive terminal identity, written path, digest, and metrics from the committed receipt. Remove the hidden mechanical correction message for this lane; validation failure is the dispatch failure.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 3 command and require zero failures.

- [ ] **Step 6: Commit Task 3**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
git commit -m "fix: complete streamed document dispatches atomically"
```

---

### Task 4: Remove Automatic Calibration and Schedule by Authority

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-order.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- Modify affected tests that explicitly assert `drafted`/`calibrating` states.

**Interfaces:**
- Changes: `readyDraftPaths(state)` returns only pending documents whose complete contracted upstream set is committed, bounded by the existing concurrency ceiling.
- Removes: `readyCalibrationPaths`, calibration dispatch creation, calibration result handling, calibration resume, and `calibrating` durable/display state.
- Changes: a successfully streamed draft transitions directly to `committed` after digest receipt validation.

- [ ] **Step 1: Write failing dependency-wave tests**

Assert GDD commits first; downstream documents become ready only when all contracted upstream paths are committed; up to four ready documents may run; success commits directly; and no state or dispatch can produce `authoringMode: 'calibration'`.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-order.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts
```

- [ ] **Step 3: Delete the calibration lane and update schema/state projection**

Remove production branches rather than retaining compatibility aliases. Keep process-restart recovery for currently running streamed dispatches, committed receipts, and explicit failures. Do not migrate or reinterpret obsolete in-progress calibration snapshots.

- [ ] **Step 4: Run focused workflow tests and verify GREEN**

Run the Task 4 command and require zero failures.

- [ ] **Step 5: Commit Task 4**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow
git commit -m "refactor: remove foundation calibration authoring"
```

---

### Task 5: Regression, Usage Evidence, and Chrome Acceptance

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/document-authoring-metrics.ts`
- Modify: `packages/agent-workflow-server/src/beegame/document-authoring-metrics.test.ts`
- Modify: `docs/beegame-completion-ledger.md`
- Add or modify the existing controlled Chrome acceptance harness only for generic stream assertions; do not embed a game idea or generated wording.

**Interfaces:**
- Extends per-dispatch evidence with streamed bytes, delta count, maximum inter-delta silence, tool-call count, and authoring channel.
- Preserves separated prompt/cache/output usage fields.

- [ ] **Step 1: Write failing metric tests**

Assert a streamed dispatch records zero document file-tool calls, exact output bytes, delta count, longest silence, elapsed time, and separated usage. Assert aggregate evidence detects any calibration or hidden retry.

- [ ] **Step 2: Run the complete relevant server suite**

```bash
bun test packages/agent-workflow-server/src/beegame packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts
bun run typecheck
git diff --check
```

Expected before implementation completion: any regression is fixed without weakening stream, atomicity, or workflow-boundary assertions.

- [ ] **Step 3: Commit automated verification changes**

```bash
git add packages/agent-workflow-server/src docs/beegame-completion-ledger.md
git commit -m "test: verify streamed foundation authoring"
```

- [ ] **Step 4: Run controlled Chrome acceptance on fixed ports**

Use the user's configured model through the React UI. Generate a new ordinary project and complete all eight Foundation documents. Stop on the first stream, validation, workflow, or API error and diagnose from raw/runtime logs before any change.

- [ ] **Step 5: Record acceptance evidence**

Record commit, fixed ports, project/run IDs, eight document paths/sizes/digests, per-document elapsed time and token categories, total wall time, absence of file tool calls/calibration, longest stream silence, and human/Agent document-quality audit. Do not commit credentials or the acceptance idea into product code.

- [ ] **Step 6: Final verification and commit**

Re-run the Task 5 automated command, `git status --short`, and `git diff --check`. Commit only evidence and generalized fixes that were proven necessary by the acceptance run.

