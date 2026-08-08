# Workflow Engine Strict Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Workflow Engine's old journal, terminal-result, argument-normalization, and agent-runner paths so current state has one fail-closed protocol.

**Architecture:** `AgentAdapterRegistry` becomes the sole execution authority. The file journal validates the exact current wire contract and reports corruption without truncation or replay. Workflow arguments cross the tool boundary unchanged, and every dead terminal result carries a concrete reason.

**Tech Stack:** TypeScript, Bun test, Zod-free structural validation, Biome, TypeScript compiler.

---

### Task 1: Require an auditable dead terminal result

**Files:**
- Modify: `packages/workflow-engine/src/types.ts`
- Modify: `packages/workflow-engine/src/__tests__/types.test.ts`
- Modify: `packages/workflow-engine/src/__tests__/*.test.ts`
- Modify: `packages/workflow-engine/examples/{registry-demo,smoke,research-report/run}.ts`
- Verify: `src/workflow/backends/claudeCodeBackend.ts`

- [ ] **Step 1: Write the failing type regression**

Add this compile-time assertion to `types.test.ts`:

```ts
// @ts-expect-error dead results require a concrete current-protocol reason
const deadWithoutReason: AgentRunResult = { kind: 'dead' }
void deadWithoutReason
```

Also assert that `unknown` is not a legal reason:

```ts
// @ts-expect-error unclassified terminal state is not durable protocol
const deadWithUnknownReason: AgentRunResult = {
  kind: 'dead',
  reason: 'unknown',
}
void deadWithUnknownReason
```

- [ ] **Step 2: Run TypeScript and verify RED**

Run: `/Users/nswell/.bun/bin/bunx tsc --noEmit`

Expected: FAIL because both `@ts-expect-error` directives are unused under the current optional/unknown contract.

- [ ] **Step 3: Make the type strict and update every producer**

Change the dead branch in `types.ts` to:

```ts
| {
    kind: 'dead'
    reason:
      | 'no-structured-output'
      | 'invalid-structured-output'
      | 'runagent-threw'
      | 'worktree-failed'
    detail?: string
  }
```

Update every test fixture and example returned by `rg -l "kind: 'dead'" packages/workflow-engine src/workflow` to provide the real reason. Backend execution exceptions use `runagent-threw`; absent or unparsable final structured content uses `no-structured-output`; schema rejection uses `invalid-structured-output`; worktree creation failure uses `worktree-failed`. Do not add a generic replacement reason.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
/Users/nswell/.bun/bin/bunx tsc --noEmit
/Users/nswell/.bun/bin/bun test packages/workflow-engine/src/__tests__ src/workflow/__tests__
```

Expected: both commands pass.

- [ ] **Step 5: Commit this isolated task**

```bash
git add packages/workflow-engine/src/types.ts packages/workflow-engine/src/__tests__ packages/workflow-engine/examples src/workflow
git commit -m "refactor: require workflow terminal reasons"
```

### Task 2: Make AgentAdapterRegistry the only execution path

**Files:**
- Modify: `packages/workflow-engine/src/ports.ts`
- Modify: `packages/workflow-engine/src/engine/hooks.ts`
- Modify: `packages/workflow-engine/src/__tests__/ports.test.ts`
- Modify: `packages/workflow-engine/src/__tests__/hooks.test.ts`
- Modify: `packages/workflow-engine/src/__tests__/*.test.ts`
- Modify: `packages/workflow-engine/examples/*.ts`
- Modify: `src/workflow/ports.ts`

- [ ] **Step 1: Write the failing registry-only contract test**

In `ports.test.ts`, construct a `WorkflowPorts` value with `agentAdapterRegistry` and no `agentRunner`:

```ts
const registry = new AgentAdapterRegistry().register({
  id: 'test',
  capabilities: { structuredOutput: true },
  run: async () => ({
    kind: 'dead',
    reason: 'runagent-threw',
  }),
}).default('test')

const ports: WorkflowPorts = {
  agentAdapterRegistry: registry,
  progressEmitter: { emit: noop },
  taskRegistrar,
  journalStore,
  permissionGate: { isAborted: () => false },
  logger: { debug: noop, event: noop },
  hostFactory,
}
```

Add a hooks test whose selected adapter increments a counter and assert that one call increments it exactly once.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/workflow-engine/src/__tests__/ports.test.ts packages/workflow-engine/src/__tests__/hooks.test.ts
```

Expected: FAIL because `agentRunner` is required and registry resolution is optional.

- [ ] **Step 3: Remove the fallback contract**

Change `WorkflowPorts` to require only:

```ts
agentAdapterRegistry: AgentAdapterRegistry
```

Delete `agentRunner` from `WorkflowPorts`, delete the exported `AgentRunner` type, and update comments that name the removed type to refer to `AgentAdapter`. Make `Logger.warn` required and replace optional warning calls with direct calls. In `hooks.ts`, replace optional resolution and fallback invocation with:

```ts
const adapter = ctx.ports.agentAdapterRegistry.resolve(params)
const rawResult = await adapter.run(params, adapterCtx)
return validateStructuredResult(rawResult, params.schema)
```

Remove the unreachable `agentRunner` object from `src/workflow/ports.ts`. Update tests and examples to register their prior runner implementation as the registry default; do not introduce a helper that accepts both forms.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/workflow-engine/src/__tests__ src/workflow/__tests__
/Users/nswell/.bun/bin/bunx tsc --noEmit
```

Expected: all tests and type checking pass.

- [ ] **Step 5: Commit this isolated task**

```bash
git add packages/workflow-engine src/workflow/ports.ts
git commit -m "refactor: use one workflow adapter boundary"
```

### Task 3: Preserve Workflow arguments exactly

**Files:**
- Modify: `packages/workflow-engine/src/tool/WorkflowTool.ts`
- Modify: `packages/workflow-engine/src/__tests__/WorkflowTool.test.ts`

- [ ] **Step 1: Replace the compatibility assertion with a failing preservation test**

Use a JSON-looking string and a script that makes its runtime type observable:

```ts
await tool.call(
  {
    script: `return agent(typeof args === 'string' ? args : 'not-a-string')`,
    args: '{"commit":"abc123"}',
  },
  undefined,
  undefined,
  undefined,
)
expect(capturedPrompts).toContain('{"commit":"abc123"}')
```

- [ ] **Step 2: Run the test and verify RED**

Run: `/Users/nswell/.bun/bin/bun test packages/workflow-engine/src/__tests__/WorkflowTool.test.ts`

Expected: FAIL because the current `normalizeArgs` converts the string into an object.

- [ ] **Step 3: Delete argument reinterpretation**

Pass the field directly:

```ts
...(input.args !== undefined ? { args: input.args } : {}),
```

Delete `normalizeArgs` and its legacy comment. Keep the ordinary non-JSON string test as a second preservation case.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/workflow-engine/src/__tests__/WorkflowTool.test.ts
/Users/nswell/.bun/bin/bunx tsc --noEmit
```

Expected: both commands pass.

```bash
git add packages/workflow-engine/src/tool/WorkflowTool.ts packages/workflow-engine/src/__tests__/WorkflowTool.test.ts
git commit -m "refactor: preserve workflow arguments"
```

### Task 4: Reject malformed journals without replay

**Files:**
- Modify: `packages/workflow-engine/src/engine/journal.ts`
- Modify: `packages/workflow-engine/src/engine/runWorkflow.ts`
- Modify: `packages/workflow-engine/src/engine/errors.ts`
- Modify: `packages/workflow-engine/src/__tests__/journal.test.ts`
- Modify: `packages/workflow-engine/src/__tests__/runWorkflow.test.ts`

- [ ] **Step 1: Write failing journal-boundary tests**

Add table-driven cases that write one invalid line to `journal.jsonl` and expect `store.read(runId)` to reject:

```ts
const invalidEntries = [
  '{',
  JSON.stringify({ key: 'k', result: { kind: 'skipped' } }),
  JSON.stringify({ key: 'k', seq: 0, result: { kind: 'dead' } }),
  JSON.stringify({ key: 'k', seq: 0, result: { kind: 'skipped' }, extra: true }),
]
```

Add a case where `journal.jsonl` is a directory and assert the non-ENOENT read error is propagated. Preserve the existing non-existent-journal assertion.

In `runWorkflow.test.ts`, inject a `JournalStore.read` that throws, resume the run, and assert:

```ts
expect(result.status).toBe('failed')
expect(agentCalls).toBe(0)
expect(events.filter(event => event.type === 'run_done')).toHaveLength(1)
expect(truncateCalls).toBe(0)
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/workflow-engine/src/__tests__/journal.test.ts packages/workflow-engine/src/__tests__/runWorkflow.test.ts
```

Expected: malformed lines currently resolve to `[]` or unchecked entries, and the run-level read error is not converted into a failed result.

- [ ] **Step 3: Add one strict parser and journal error**

Add `WorkflowJournalError extends WorkflowError` in `errors.ts`. In `journal.ts`, implement one `parseJournalEntry(value, lineNumber)` boundary that:

```ts
if (!isExactRecord(value, ['key', 'seq', 'result'])) fail()
if (typeof value.key !== 'string' || value.key.trim() === '') fail()
if (!Number.isInteger(value.seq) || value.seq < 0) fail()
return {
  key: value.key,
  seq: value.seq,
  result: parseAgentRunResult(value.result, lineNumber),
}
```

`parseAgentRunResult` must accept only the exact `ok`, `skipped`, and `dead` field sets defined by `AgentRunResult`. Validate finite non-negative numeric usage and optional display fields. Reject unknown fields and unsupported dead reasons.

Catch only errors whose Node code is `ENOENT` and return `[]`. Wrap JSON, schema, and other I/O failures in `WorkflowJournalError` while preserving the original message. Sort valid entries using `a.seq - b.seq`.

- [ ] **Step 4: Fail the run at journal loading**

Wrap the resume read in `runWorkflow.ts`. On failure, emit exactly one failed `run_done` event and return:

```ts
{
  status: 'failed',
  error: error instanceof Error ? error.message : String(error),
}
```

Do not call `truncate`, create an engine context, emit `run_started`, or dispatch an adapter after this failure.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/workflow-engine/src/__tests__/journal.test.ts packages/workflow-engine/src/__tests__/runWorkflow.test.ts
/Users/nswell/.bun/bin/bun test packages/workflow-engine/src/__tests__
/Users/nswell/.bun/bin/bunx tsc --noEmit
```

Expected: all commands pass.

```bash
git add packages/workflow-engine/src/engine packages/workflow-engine/src/__tests__/journal.test.ts packages/workflow-engine/src/__tests__/runWorkflow.test.ts
git commit -m "fix: fail closed on invalid workflow journals"
```

### Task 5: Final pollution audit and integration verification

**Files:**
- Modify only files required by a failing scoped check.

- [ ] **Step 1: Prove removed production paths are absent**

Run:

```bash
rg -n "AgentRunner|agentRunner|old ports|backward compatibility|legacy.*contract|seq \\?\\? 0|reason\\?:|reason: 'unknown'|normalizeArgs" packages/workflow-engine/src src/workflow --glob '!**/__tests__/**'
```

Expected: no matches related to the removed protocol.

- [ ] **Step 2: Run all affected regression suites**

```bash
/Users/nswell/.bun/bin/bun test packages/workflow-engine/src/__tests__ src/workflow/__tests__
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__
/Users/nswell/.bun/bin/bunx tsc --noEmit
/Users/nswell/.bun/bin/bunx biome check packages/workflow-engine/src src/workflow
git diff --check
```

Expected: zero failures and no formatting errors in changed files.

- [ ] **Step 3: Confirm scope and service shutdown**

```bash
git status --short | rg 'Projects/users|/Projects/'
lsof -nP -iTCP:62173 -iTCP:62174 -iTCP:62175 -iTCP:62176 -iTCP:62177 -sTCP:LISTEN
```

Expected: no generated-project changes and no service listeners.

- [ ] **Step 4: Review commit history and merge only verified commits into `beegame-main`**

Confirm each task commit changes only the listed protocol files. Apply or merge the isolated branch into `beegame-main` without staging unrelated dirty files, then rerun the focused tests in `beegame-main`.
