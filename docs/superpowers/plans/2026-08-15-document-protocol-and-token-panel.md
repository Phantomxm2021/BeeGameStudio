# Document Protocol and Token Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all Bee Game Studio Markdown protocol comments to deterministic service ownership, preserve original stream commit failures, reduce the project information panel to four usage rows, and prove the result with a Chrome eight-document acceptance run.

**Architecture:** Normalize service-owned comments immediately before the existing complete-document validator, using exact canonical headings outside fenced blocks as the only insertion anchors. Refresh session events after stream drain so the delivery worker reports the authoritative commit failure. Keep live token values sourced from workflow usage and show billing only as Credit.

**Tech Stack:** TypeScript, Bun test, Zod, React, Vitest, Testing Library, Chrome Web/React acceptance.

## Global Constraints

- Do not modify native core code.
- Bee Game Studio may inject only deterministic machine metadata; it must never repair or author human content.
- Do not add retries, alternate authoring tracks, new usage metrics, or billing formulas in the frontend.
- The project panel displays exactly Input, Cached Input, Output, and Credit.
- Chrome acceptance uses ports 62173 through 62177 and stops before document review.

---

### Task 1: Deterministic Document Protocol Metadata

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.ts`
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/authored-document-receipt.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

**Interfaces:**
- Produces: `normalizeCompleteGameDocumentProtocol(path: FoundationDocumentPath, value: unknown): string`
- Consumes: `getGameDocumentContract(path)` and the existing complete-document validator.

- [ ] **Step 1: Add failing normalization tests**

Add tests proving marker-free canonical Markdown receives every canonical marker, already marked Markdown is idempotent, and missing/duplicate/reordered headings or headings inside fences are rejected.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/complete-game-document.test.ts
```

Expected: FAIL because `normalizeCompleteGameDocumentProtocol` does not exist or marker-free Markdown is rejected.

- [ ] **Step 3: Implement heading-bound normalization**

Implement one fenced-block-aware line scan that removes only recognized protocol marker lines, verifies exact title/section/material heading multiplicity and order, and injects canonical markers immediately before matching headings. Call it from `canonicalizeAuthoredDocument` before `validateCompleteGameDocumentMarkdown`.

- [ ] **Step 4: Remove model ownership of protocol comments**

Change the author prompt projection so `mechanicalMarkdownProtocol` contains canonical headings and formats but no marker strings. State explicitly that Bee Game Studio injects its protocol comments after the turn. Preserve section IDs and production-material contracts needed for content authority.

- [ ] **Step 5: Run focused backend tests and verify GREEN**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/complete-game-document.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/authored-document-receipt.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/agent-workflow-server/src/beegame/complete-game-document.ts packages/agent-workflow-server/src/beegame/complete-game-document.test.ts packages/agent-workflow-server/src/beegame/authored-document-receipt.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
git commit -m "fix: own document protocol metadata"
```

### Task 2: Preserve Original Stream Commit Errors

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`

**Interfaces:**
- Consumes: `input.sessions.waitForWorkflowWorkerIdle(sessionId)` and `sessionEvents(sessionId)`.
- Produces: authoritative `turn.failed` propagation after stream drain.

- [ ] **Step 1: Add a failing stale-event regression**

Create a streamed document case where the first event snapshot contains a successful native result, `waitForWorkflowWorkerIdle` appends `turn.failed` with `complete game document sections must exactly match the canonical order`, and no receipt exists. Assert that `wait()` rejects with that exact original error rather than the missing-receipt fallback.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts
```

Expected: FAIL with `document author completed without a committed Markdown stream receipt`.

- [ ] **Step 3: Refresh terminal events after worker drain**

After `waitForWorkflowWorkerIdle`, obtain a fresh event slice. If its latest authoritative terminal is `turn.failed`, throw its text. Then read the receipt. Retain the generic missing-receipt fallback only when the fresh snapshot has no authoritative failure.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same focused test and expect PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts
git commit -m "fix: preserve document commit failures"
```

### Task 3: Four-Value Project Usage Panel

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/BeeGameLivePreviewPage.tsx`
- Modify: `apps/frontend/src/components/Demiurge/DashboardView.test.tsx`
- Modify: `apps/frontend/src/i18n/locales/en.json`
- Modify: `apps/frontend/src/i18n/locales/zh.json`
- Modify: `apps/frontend/src/i18n/locales/zh-TW.json`

**Interfaces:**
- Consumes: live `TokenUsage` and billing `credits.consumedCredits`.
- Produces: `normalizeProjectTokenUsage` values `{ input, cachedInput, output }` and exactly four rendered rows.

- [ ] **Step 1: Replace existing UI expectations with a failing four-row test**

Use a workflow snapshot with nonzero cache-read and cache-creation. Assert the tooltip contains Input, Cached Input equal to their sum, Output, and Credit. Assert platform, execution status, raw processed, cache subtypes, and weighted consumption are absent.

- [ ] **Step 2: Run the focused frontend test and verify RED**

Run:

```bash
cd apps/frontend
TMPDIR=/private/tmp /Users/nswell/.bun/bin/bun --bun node_modules/vitest/vitest.mjs run --config vitest.config.ts src/components/Demiurge/DashboardView.test.tsx
```

Expected: FAIL because the existing panel renders extra rows and does not combine cached input.

- [ ] **Step 3: Implement the four-row panel**

Render only Credit, Input, Cached Input, and Output. Compute cached input as nonnegative cache-read plus cache-creation. Remove the raw-processed and weighted rows and their unused normalized return fields. Update the three locale labels to the concise approved wording.

- [ ] **Step 4: Run the focused frontend test and verify GREEN**

Run the same focused frontend test and expect PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/frontend/src/components/Demiurge/BeeGameLivePreviewPage.tsx apps/frontend/src/components/Demiurge/DashboardView.test.tsx apps/frontend/src/i18n/locales/en.json apps/frontend/src/i18n/locales/zh.json apps/frontend/src/i18n/locales/zh-TW.json
git commit -m "fix: simplify project usage metrics"
```

### Task 4: Verification and Chrome Eight-Document Acceptance

**Files:**
- No production files unless a failing verification exposes a root-cause defect.
- Create runtime evidence only in the generated project workspace.

**Interfaces:**
- Consumes: fixed-port development stack, Chrome Web/React UI, workflow events, document receipts, and readiness audit.
- Produces: acceptance evidence for exactly eight documents.

- [ ] **Step 1: Run backend, frontend, and type verification**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/complete-game-document.test.ts packages/agent-workflow-server/src/beegame/authored-document-receipt.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
```

From `apps/frontend`, run the focused Dashboard test. Expected: all PASS and clean diff check.

- [ ] **Step 2: Start the fixed-port Web/React stack**

Start frontend 62173, runtime 62174, billing 62175, skills 62176, and resources 62177 with the configured model environment. Confirm all five listeners before opening Chrome.

- [ ] **Step 3: Run Chrome acceptance**

Create a new non-example game project through Chrome, explicitly select Web and React, and start document generation. Observe rather than mutate the generated project. Stop immediately when all eight foundation documents commit, before review begins. On any failure, stop and diagnose before retrying.

- [ ] **Step 4: Audit acceptance evidence**

Require exactly eight unique `dispatch.started` document targets, eight `dispatch.completed`, zero `dispatch.failed`, zero `run.retry_requested`, eight committed receipts, eight canonical files, and a passing complete-foundation readiness audit. Record elapsed time, Input, Cached Input, Output, Credit, document byte counts, and duplicate dispatch count.

- [ ] **Step 5: Verify the Chrome panel**

Open project information and confirm it shows only Input, Cached Input, Output, and Credit with values matching workflow usage and billing authority.

- [ ] **Step 6: Final repository verification**

Run the relevant suites again, `bun run typecheck`, `git diff --check`, and `git status --short`. Mark the Chrome handoff and stop all fixed-port services.

