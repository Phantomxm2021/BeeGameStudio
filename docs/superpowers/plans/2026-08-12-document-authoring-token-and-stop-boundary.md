# Document Authoring Token and Stop Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Idea → eight-document workflow complete reliably through Claude Code with bounded write calls, compact authority prompts, exact cancellation, and complete usage/error evidence.

**Architecture:** Keep Claude Code as the only author and BGS as the orchestration boundary. BGS passes paths plus structured contracts instead of document bodies, gives Claude Code a transport-safe bounded-write contract, watches only document-author tool streams for pathological argument growth, terminates workers by durable dispatch identity, and records matching cancellation-tail usage.

**Tech Stack:** TypeScript, Bun test, Hono API, BeeGameSessionManager, process-isolated Claude Code runtime, Chrome UI verification.

---

## File Structure

- Modify `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`: replace inline target/upstream bodies with path-and-section authority references.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`: replace per-section writes with bounded contiguous writes.
- Create `packages/agent-workflow-server/src/beegame/workflow-tool-input-budget.ts`: count streamed document-author native write input bytes without content matching.
- Modify `packages/agent-workflow-server/src/beegame/session-manager.ts`: apply stream safety only to workflow document authors and preserve detailed errors.
- Modify `packages/agent-workflow-server/src/app.ts`: stop the exact session-manager dispatch.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`: accept matching cancellation-tail usage.
- Update the adjacent Bun tests for each boundary.

### Task 1: Remove Inline Document Bodies From Authoring Prompts

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts:315-397`
- Test: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts:42-88`

- [ ] **Step 1: Write the failing authority-projection test**

Require that sentinel source/target text is absent, while exact path and section IDs remain:

```ts
expect(block).not.toContain('Authority content for')
expect(block).not.toContain('STALE TARGET BODY')
for (const source of projection) {
  expect(block).toContain(`upstreamPath=${source.path}`)
  for (const sectionId of source.sectionIds)
    expect(block).toContain(`sectionId=${sectionId}`)
}
expect(block).toContain('Read only the listed sections from disk when needed')
```

- [ ] **Step 2: Run RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
```

Expected: FAIL because the current prompt embeds canonical authority bodies.

- [ ] **Step 3: Implement path-and-section references**

Keep canonical path/order validation and target existence detection, but remove target/upstream `readFile` calls from prompt construction:

```ts
const authorityReferences = getGameDocumentContract(typedTargetPath).upstreamSections
  .flatMap(source => source.sectionIds.map(sectionId =>
    `- upstreamPath=${source.path}; sectionId=${sectionId}`,
  ))
return [
  `Author ${targetPath}. Read only the listed sections from disk when needed.`,
  `The target ${targetExists ? 'exists and may be read as a replacement baseline' : 'does not exist and must be created'}.`,
  'Authorized upstream section references:',
  ...authorityReferences,
].join('\n')
```

Do not summarize content or add keyword matching.

- [ ] **Step 4: Run GREEN and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
git add packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
git commit -m "fix: keep document authority bodies out of prompts"
```

### Task 2: Replace Per-Section Writes With Bounded Contiguous Writes

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts:342-356`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts:7-58`

- [ ] **Step 1: Write failing assertions**

```ts
expect(prompt).not.toContain('one contract section per native file operation')
expect(prompt).not.toContain('one complete native write')
expect(prompt).toContain('no native write or edit input may exceed 12 KiB of UTF-8 content')
expect(prompt).toContain('three to eight contiguous ordered content writes')
expect(prompt).toContain('one final lightweight structural verification')
expect(prompt).toContain('do not reread the complete file after each chunk')
```

- [ ] **Step 2: Run RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
```

- [ ] **Step 3: Replace only the unsafe operation instruction**

```ts
'Write the complete document using three to eight contiguous ordered content writes as needed for its actual size. No native write or edit input may exceed 12 KiB of UTF-8 content. Chunk boundaries are transport boundaries, not one-operation-per-section rules. Do not serialize the complete document into one tool-call argument, and do not reread the complete file after each chunk. After the final chunk, perform one final lightweight structural verification and end the turn normally.'
```

Keep thinking and native tools unchanged.

- [ ] **Step 4: Run GREEN and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
git add packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
git commit -m "fix: bound document author write operations"
```

### Task 3: Fail Explicitly On Oversized Streaming Tool Input

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/workflow-tool-input-budget.ts`
- Create: `packages/agent-workflow-server/src/beegame/workflow-tool-input-budget.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts:395-405,1465-1540,4215-4235`

- [ ] **Step 1: Write failing stream-counter tests**

Feed `content_block_start` for `Write`, followed by `input_json_delta` fragments. Assert 12 KiB is accepted and the next byte produces:

```ts
{
  code: 'document_native_write_input_too_large',
  toolName: 'Write',
  maxBytes: 12 * 1024,
  observedBytes: 12 * 1024 + 1,
}
```

Also prove text deltas, non-write tools, and non-document workers are ignored.

- [ ] **Step 2: Run RED**

```bash
bun test packages/agent-workflow-server/src/beegame/workflow-tool-input-budget.test.ts
```

- [ ] **Step 3: Implement protocol-level counting**

Use `Buffer.byteLength(partialJson, 'utf8')`, stream block indexes, and only native write tool identities (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`). Export:

```ts
export const DOCUMENT_NATIVE_WRITE_MAX_BYTES = 12 * 1024
export function observeWorkflowToolInput(
  state: WorkflowToolInputBudgetState,
  message: DashboardSDKMessage,
): WorkflowToolInputOverflow | undefined
```

- [ ] **Step 4: Wire only document-author workflow sessions**

In `submitToRunner`, observe raw stream fragments only when `record.workflowWorkerType === 'document-author'`. On overflow, save a structured execution error and abort the record's runner; the existing turn failure path must show the exact size/code rather than `Request timed out`.

- [ ] **Step 5: Run GREEN and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/workflow-tool-input-budget.test.ts packages/agent-workflow-server/src/beegame/session-manager.test.ts
git add packages/agent-workflow-server/src/beegame/workflow-tool-input-budget.ts packages/agent-workflow-server/src/beegame/workflow-tool-input-budget.test.ts packages/agent-workflow-server/src/beegame/session-manager.ts packages/agent-workflow-server/src/beegame/session-manager.test.ts
git commit -m "fix: expose oversized document tool streams"
```

### Task 4: Stop The Exact Worker And Preserve Cancellation-Tail Usage

**Files:**
- Modify: `packages/agent-workflow-server/src/app.ts:2740-2780`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts:1058-1086`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts:2610-2670,3060-3110`
- Test: `packages/agent-workflow-server/src/__tests__/project-stop-routes.test.ts`

- [ ] **Step 1: Change the stopped-tail test to require persistence**

```ts
expect(lateUsageResult).toMatchObject({
  status: 'stopped',
  usage: { total_tokens: 1 },
})
expect(
  await store.addWorkflowUsage(initial.runId, delta, 'dispatch-stale'),
).toBeNull()
```

- [ ] **Step 2: Run RED**

```bash
bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
```

- [ ] **Step 3: Accept only matching interrupted-tail usage**

```ts
const dispatch = run.activeDispatch
const acceptsLive = run.status === 'running' && dispatch?.status === 'running'
const acceptsStoppedTail =
  run.status === 'stopped' && dispatch?.status === 'interrupted'
if (
  dispatch?.dispatchId !== dispatchId ||
  (!acceptsLive && !acceptsStoppedTail)
) return null
```

Keep the run's status unchanged when committing the usage event.

- [ ] **Step 4: Add an exact-dispatch route test and run RED**

Exercise `/api/projects/:id/workflow/stop` with a registered live workflow worker. Assert the response waits until that worker is disposed and does not depend on recreating the original controller cache key.

- [ ] **Step 5: Prefer the shared session manager in the stop route**

```ts
sessionIsOpen: async dispatch =>
  beeGameSessions.isWorkflowWorkerOpen(dispatch.dispatchId) ||
  controller.dispatcher.workerIsOpen(dispatch.dispatchId),
stopDispatch: async (dispatchId, stopReason) => {
  const disposed = await beeGameSessions.disposeWorkflowDispatch(dispatchId)
  if (disposed === 0)
    await controller.dispatcher.stop(dispatchId, stopReason)
},
```

- [ ] **Step 6: Run GREEN and commit**

```bash
bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/project-stop-routes.test.ts
git add packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/project-stop-routes.test.ts
git commit -m "fix: terminate exact workflow dispatches"
```

### Task 5: Regression Verification And Chrome Production Run

- [ ] **Step 1: Run focused suites**

```bash
bun test \
  packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts \
  packages/agent-workflow-server/src/beegame/workflow-tool-input-budget.test.ts \
  packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts \
  packages/agent-workflow-server/src/__tests__/project-stop-routes.test.ts
```

- [ ] **Step 2: Run type and diff verification**

```bash
bun run typecheck
git diff --check
```

- [ ] **Step 3: Test through real Chrome on fixed ports**

Use frontend `62273`, runtime `62274`, billing `62275`, skills `62276`, and resources `62277`. Start a new neutral Idea → documents workflow through the UI.

- [ ] **Step 4: Capture runtime evidence**

For every document record prompt characters, model requests, native file operations, largest native input bytes, complete usage, accepted status, and physical file path. Confirm no full source body appears in its initial prompt.

- [ ] **Step 5: Run an independent Chrome Stop test**

Click Stop during a separate authoring dispatch. Confirm the exact worker closes before the response resolves, no further file changes occur, usage stops growing, and matching tail usage remains recorded.

- [ ] **Step 6: Audit the eight actual documents**

Review completeness, discipline ownership, redundancy, human readability, and implementation usefulness. Final acceptance requires both runtime/source evidence and document evidence; tests alone are insufficient.
