# Continuous Bounded Document Turn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep section-sized native file checkpoints while completing all remaining groups of one foundation document in one native model turn.

**Architecture:** Extend the existing foundation draft prompt to serialize the ordered remainder of the current document, and keep the existing mutation authorizer as the per-tool-call gate. Remove the delivery port's per-group resubmission loop; a native result is terminal only when the on-disk cursor reports the complete document.

**Tech Stack:** TypeScript, Bun test, existing native stream-json runtime, Chrome Web React.

---

### Task 1: Serialize the remaining checkpoint sequence

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/foundation-document-draft.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/foundation-document-draft.ts`

- [ ] **Step 1: Write the failing prompt tests**

Assert a fresh GDD prompt contains groups 1 through 13 in canonical order, explicitly requires each checkpoint to succeed before generating the next, and never authorizes a multi-section tool argument. Assert a cursor at group 6 produces only groups 7 through 13.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/foundation-document-draft.test.ts
```

Expected: failure because the existing prompt contains only the active group.

- [ ] **Step 3: Implement the ordered remaining-group prompt**

Keep `FoundationDocumentDraftGroup`, `inspectFoundationDocumentDraft`, byte targets, and cursor syntax unchanged. Refactor prompt construction so it maps from the current group/part through the final production-material checkpoint. Each serialized item must contain exactly one canonical native `Write` or `Edit` mutation contract and retain the existing ownership, no-reread, no-frontmatter, and quality requirements.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 1 command. Expected: all prompt/draft tests pass.

- [ ] **Step 5: Commit the prompt change**

```bash
git add packages/agent-workflow-server/src/beegame/foundation-document-draft.ts packages/agent-workflow-server/src/beegame/foundation-document-draft.test.ts
git commit -m "fix: author bounded document groups continuously"
```

### Task 2: Remove the per-group native-turn loop

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.segmented-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`

- [ ] **Step 1: Write the failing delivery tests**

Change the complete GDD fixture so one `sendWithDisplay` call applies every ordered checkpoint and assert exactly one prompt. Add a second test whose native turn applies only the first group and returns; assert `waitForTerminal` rejects the incomplete document and does not call `sendWithDisplay` again.

- [ ] **Step 2: Run the delivery test and verify RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.segmented-documents.test.ts
```

Expected: the existing port sends one new prompt per incomplete group.

- [ ] **Step 3: Fail closed after an incomplete native result**

In the initial foundation-document terminal path, inspect the on-disk draft once after the worker is idle. If it is incomplete, throw a `WorkerNeedsActionError` containing the remaining cursor; do not update the event offset and do not call `sendWithDisplay` again. Preserve complete document terminal creation unchanged.

- [ ] **Step 4: Run the delivery test and verify GREEN**

Run the Task 2 command. Expected: both one-turn completion and premature-end rejection pass.

- [ ] **Step 5: Commit the delivery change**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.segmented-documents.test.ts
git commit -m "fix: require one continuous document turn"
```

### Task 3: Proportional regression verification

**Files:**
- No production additions

- [ ] **Step 1: Run foundation document regression suites**

```bash
bun test packages/agent-workflow-server/src/beegame/foundation-document-draft.test.ts packages/agent-workflow-server/src/beegame/foundation-document-mutation.test.ts packages/agent-workflow-server/src/beegame/complete-game-document.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.segmented-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run static verification**

```bash
bun run typecheck
git diff --check
```

Expected: typecheck exits zero and diff check emits no output.

### Task 4: Chrome Web React acceptance

**Files:**
- Runtime output only under canonical `Projects/users/...`
- Create an exact evidence review under `docs/superpowers/reviews/` after acceptance

- [ ] **Step 1: Start fixed ports**

Start frontend `62173`, runtime `62174`, billing `62175`, skills `62176`, resources `62177`, then verify every listener.

- [ ] **Step 2: Generate one fresh non-tower-defense GDD through Chrome**

Use the configured Web React flow. Stop after GDD completion and before the second document writes content. Do not alter the test project to make the test pass.

- [ ] **Step 3: Audit quality, durability, time, and tokens**

Require the canonical validator and receipt digest to pass, all sections/materials to exist without repeated substantive content, each native mutation to advance exactly one checkpoint, no intermediate per-group terminal reply, no completed-prefix rewrite, and no response gap above 45 seconds. Compare raw token categories against the prior 1,660,669-token run and report any remaining dominant source.

- [ ] **Step 4: Stop and diagnose on failure**

If any acceptance condition fails, stop the workflow and services, inspect native raw/runtime/workflow logs, and identify the root cause before changing code or rerunning.
