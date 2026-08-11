# Remove BGS Document-Author Interference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the existing Idea-to-documents workflow while making document-author execution transparent to Claude Code: native thinking, native tools, normal file delivery, and normal `end_turn`.

**Architecture:** BGS continues to choose workflow nodes and send the existing business prompt and authority context. For `document-author`, BGS stops filtering tools, requesting BeeGame permission decisions, registering a canonical commit tool, and requiring a synthetic terminal event. After Claude Code ends normally, the worker port only observes whether the assigned target file exists and returns the existing `writtenPaths` terminal so the current review node can continue.

**Tech Stack:** TypeScript, Bun test, existing Claude Code QueryEngine runtime, existing BeeGame delivery workflow, Chrome fixed-port acceptance.

---

### Task 1: Remove the rejected staging implementation without losing unrelated fixes

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/query-engine-runner.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/query-engine-runner.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

- [ ] **Step 1: Record the dirty-file boundary**

Run:

```bash
git status --short
git diff -- packages/agent-workflow-server/src/beegame/query-engine-runner.ts packages/agent-workflow-server/src/beegame/model-runtime-host.ts packages/agent-workflow-server/src/__tests__/provider-pinning.test.ts
```

Expected: the rejected staging changes and the separate `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` fix are visible. Preserve the provider fix; do not use a whole-file restore on overlapping files.

- [ ] **Step 2: Remove only staging-specific hunks**

Remove `stagingPath`, `canonicalDocumentStagingPath`, staging-directory creation, staging-only `workflowAllowedPaths`, empty-input commit behavior, staging prompt text, and the staging-only permission test. Restore `native-canonical-document-tool.ts` to its pre-staging behavior temporarily so Task 2 can delete the document-author dependency cleanly.

- [ ] **Step 3: Verify no staging mechanism remains**

Run:

```bash
rg -n "canonicalDocumentStagingPath|service-assigned staging|workflow_document_staging" packages/agent-workflow-server/src
git diff --check
```

Expected: no matches and a clean diff check.

### Task 2: Prove the transparent Claude Code boundary with failing tests

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/query-engine-runner.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

- [ ] **Step 1: Require the native tool inventory unchanged**

Add a test equivalent to:

```ts
const tools = [
  { name: 'Read' },
  { name: 'Write' },
  { name: 'Edit' },
  { name: 'Bash' },
  { name: 'Task' },
]

expect(selectBeeGameWorkerTools(tools, 'document-author', 'initial')).toEqual(
  tools,
)
expect(
  selectBeeGameWorkerTools(tools, 'document-author', 'remediation'),
).toEqual(tools)
expect(
  selectBeeGameWorkerTools(tools, 'document-author', 'repair-planning'),
).toEqual(tools)
```

- [ ] **Step 2: Require no BeeGame permission boundary for document authors**

Add assertions equivalent to:

```ts
expect(
  requiresBeeGameWorkflowBoundaryCheck(
    { workflowWorker: true, workflowWorkerType: 'document-author' },
    'Read',
  ),
).toBe(false)
expect(
  requiresBeeGameWorkflowBoundaryCheck(
    { workflowWorker: true, workflowWorkerType: 'document-author' },
    'Write',
  ),
).toBe(false)
```

Keep the existing assertion that `getBeeGameWorkflowThinkingConfig('document-author')` is `undefined`.

- [ ] **Step 3: Require normal file delivery and normal turn completion**

Create a delivery-port test where the fake Claude session writes the assigned `docs/*.md` target, emits a normal `result`, and never calls `CommitCanonicalDocument`. Assert the returned terminal is:

```ts
{
  workerType: 'document-author',
  status: 'completed',
  writtenPaths: [targetPath],
  resolvedFindingIds: [],
}
```

Also assert that a normal result with no assigned file fails with a missing-output error rather than a missing-tool error.

- [ ] **Step 4: Require prompts to describe the document assignment, not an execution protocol**

Assert document-author prompts contain the assigned target path and complete section contract but do not contain:

```text
CommitCanonicalDocument
terminal JSON
service-assigned staging
only the tools supplied
```

- [ ] **Step 5: Run RED**

Run:

```bash
bun test ./packages/agent-workflow-server/src/__tests__/query-engine-runner.test.ts ./packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts ./packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts ./packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
```

Expected: failures show the current tool filtering, permission boundary, commit-tool requirement, and prompt interference.

### Task 3: Remove document-author execution overrides

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/query-engine-runner.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-workflow-result-tools.ts`
- Delete when no production import remains: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.ts`
- Delete with the removed tool: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts`

- [ ] **Step 1: Return native tools unchanged**

At the top of `selectBeeGameWorkerTools`, before single-lane filtering, add:

```ts
if (workflowWorkerType === 'document-author') return tools
```

Do not create a document-author allowlist.

- [ ] **Step 2: Bypass the BeeGame permission boundary**

At the start of `requiresBeeGameWorkflowBoundaryCheck`, after confirming it is a workflow worker, add:

```ts
if (input.workflowWorkerType === 'document-author') return false
```

Remove the document-author-specific permission branch from `session-manager.ts`. Claude Code's own native permission mode remains responsible for native tool decisions.

- [ ] **Step 3: Remove the custom document commit tool**

Remove `createNativeCanonicalDocumentTool` registration, `CommitCanonicalDocument` from document-author workflow tool lists, the canonical commit contract passed into the session, receipt reconciliation, and the error `document author completed without CommitCanonicalDocument`.

Delete the tool module and its tests after this command has no production matches:

```bash
rg -n "createNativeCanonicalDocumentTool|CommitCanonicalDocument|workflowCanonicalDocumentCommitContract" packages/agent-workflow-server/src --glob '!**/*.test.ts'
```

- [ ] **Step 4: Accept normal Claude completion by observing the target**

When the delivery port receives a normal `result` for an initial or remediation document author:

```ts
const targetPath = request.allowedPaths?.[0]
if (!targetPath) throw new Error('document author target is missing')
const body = await readFile(resolve(request.workspacePath, targetPath), 'utf8')
if (!body.trim()) throw new Error(`document author output is missing: ${targetPath}`)
return createDeterministicCanonicalDocumentTerminal(request, targetPath)
```

This is observation after Claude Code has finished, not control of its tool use. Do not add a new validator, importer, staging directory, receipt format, or terminal protocol here; the existing review node owns document-quality decisions.

- [ ] **Step 5: Remove protocol language from prompts**

Keep the existing discipline, section, fact-owner, and upstream-authority requirements. Replace commit-tool instructions with one direct assignment:

```text
Author the complete assigned Markdown document at <targetPath> using Claude Code's normal workflow. When the document is complete, end the turn normally.
```

Do not restrict how Claude Code reads or writes the document.

- [ ] **Step 6: Run GREEN and regression suites**

Run:

```bash
bun test ./packages/agent-workflow-server/src/__tests__/query-engine-runner.test.ts ./packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts ./packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts ./packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts ./packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts ./packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts ./packages/agent-workflow-server/src/__tests__/idea-to-complete-documents.test.ts
bun run typecheck
git diff --check
```

Expected: all suites pass, typecheck exits zero, and no commit-tool requirement remains in document-author production code.

- [ ] **Step 7: Commit the boundary fix**

```bash
git add packages/agent-workflow-server/src
git commit -m "fix: stop BGS from controlling document authors"
```

### Task 4: Verify the unchanged workflow through fixed-port Chrome

**Files:**
- No production changes unless the captured direct-vs-BGS evidence identifies a reproducible boundary defect.
- Update only the existing verification ledger with actual commands, run identity, and document evidence.

- [ ] **Step 1: Start the complete stack on fixed ports**

Start frontend `62273`, runtime `62274`, billing `62275`, skills `62276`, and resources `62277` using the configured model environment. Confirm each listener with `lsof` before opening Chrome.

- [ ] **Step 2: Run the real workflow with controlled Chrome**

From the Idea UI, submit an ordinary non-hardcoded game request, proceed through the existing confirmation flow, start document generation, and wait for Claude Code to complete each document-author node.

- [ ] **Step 3: Capture boundary evidence**

For the first document worker, retain:

- the final prompt sent by BGS;
- configured model and provider identity without secrets;
- thinking configuration;
- native tool inventory;
- raw Claude Code event stream;
- filesystem output path and normal terminal reason.

Compare these with the already successful direct Claude Code GDD baseline. No difference may be introduced by BGS except business context and workflow correlation metadata.

- [ ] **Step 4: Audit real generated documents**

Inspect the actual document set for required sections, non-placeholder production detail, cross-document fact consistency, and usefulness to the relevant human game-development disciplines. Combine this output audit with the code-boundary test evidence.

- [ ] **Step 5: Final verification**

Run the focused tests again, `bun run typecheck`, and `git diff --check`. Record the fixed ports, Chrome workflow run ID, produced document paths, test counts, and any remaining externally reproducible failure. Do not declare completion from unit tests alone.
