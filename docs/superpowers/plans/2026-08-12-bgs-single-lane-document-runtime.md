# BGS Single-Lane Document Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make idea-to-documents use one native Bee Game Studio execution path, one Markdown authority source, guaranteed stream termination, and Chrome-proven document delivery.

**Architecture:** BGS launches the supported non-interactive Bee Game Studio process and passively consumes its stream-json protocol. The native runtime owns provider transport, tools, permissions, retries, and atomic file writes; BGS owns workflow sequencing, selected model configuration, status/log projection, and read-only acceptance. Canonical Markdown is the only document authority; workflow receipts contain only identity, digest, status, usage, and timing.

**Tech Stack:** TypeScript, Bun, stream-json stdio protocol, Zod, SHA-256 receipts, Bun tests, Chrome acceptance.

---

## Locked file structure

- `src/services/api/streamTerminality.ts`: provider-stream terminality state and typed incomplete-response error.
- `src/services/api/claude.ts`: use the terminality state for every provider response and keep recovery inside the native runtime.
- `src/services/api/__tests__/streamTerminality.test.ts`: deterministic silent-mid-tool-JSON regression tests.
- `packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts`: the sole BGS session process adapter for stream-json stdin/stdout and permission control messages.
- `packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts`: process protocol, completion, error, abort, and permission tests using a fixture child.
- `packages/agent-workflow-server/src/beegame/session-manager.ts`: select the sole native process runner; do not retain an embedded-runner fallback.
- `packages/agent-workflow-server/src/beegame/native-runtime-process-path.ts`: resolve the supported development/bundled Bee Game Studio executable fail-closed.
- `packages/agent-workflow-server/src/beegame/authored-document-receipt.ts`: read-only Markdown receipt; no document rewrite and no sidecar.
- `packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts`: path/section/digest references derived from Markdown, without copied authority claims.
- `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`: provide authorized Markdown references only.
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`: accept the native file only after read-only validation.
- `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`: recover from Markdown digest receipts only.
- `packages/agent-workflow-server/src/beegame/complete-game-document.ts`: resolve upstream section references directly against canonical Markdown.
- Delete `packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.ts` and its production/test dependencies.
- Delete the workflow use of `query-engine-process-runner.ts`, `query-engine-worker.ts`, and the manually reconstructed session lifecycle after the native process runner is green.
- `packages/agent-workflow-server/src/beegame/runtime-observability.ts`: passive request/event/tool/file terminal records with no workflow control decisions.
- `packages/agent-workflow-server/src/beegame/fixed-service-ports.ts`: one immutable port allocation and fail-fast collision reporting.
- `docs/testing/bgs-document-chrome-acceptance.md`: exact Chrome acceptance and output-quality audit procedure.

### Task 1: Make provider streams terminal by construction

**Files:**
- Create: `src/services/api/streamTerminality.ts`
- Create: `src/services/api/__tests__/streamTerminality.test.ts`
- Modify: `src/services/api/claude.ts`

- [ ] **Step 1: Write the failing state-machine tests**

```ts
test('rejects a stream that stops inside tool JSON', () => {
  const state = createProviderStreamTerminality({ requestId: 'req-1' })
  state.observe({ type: 'message_start' })
  state.observe({ type: 'content_block_start', contentType: 'tool_use' })
  state.observe({ type: 'input_json_delta', bytes: 17 })
  expect(() => state.completeBody()).toThrow(ProviderStreamIncompleteError)
})

test('accepts only message_delta with a stop reason followed by message_stop', () => {
  const state = createProviderStreamTerminality({ requestId: 'req-2' })
  state.observe({ type: 'message_start' })
  state.observe({ type: 'message_delta', stopReason: 'tool_use' })
  state.observe({ type: 'message_stop' })
  expect(state.completeBody()).toMatchObject({ requestId: 'req-2' })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test src/services/api/__tests__/streamTerminality.test.ts`

Expected: FAIL because `streamTerminality.ts` does not exist.

- [ ] **Step 3: Implement the minimal state machine**

```ts
export class ProviderStreamIncompleteError extends Error {
  readonly retryable = true
  constructor(readonly evidence: ProviderStreamEvidence) {
    super(`Provider response ended without a terminal message: ${evidence.requestId}`)
  }
}

export function createProviderStreamTerminality(input: { requestId: string }) {
  let sawMessageStart = false
  let sawMessageStop = false
  let stopReason: string | null = null
  let openToolJson = 0
  let eventCount = 0
  let byteCount = 0
  return {
    observe(event: ProviderTerminalEvent) {
      eventCount += 1
      if (event.type === 'message_start') sawMessageStart = true
      if (event.type === 'content_block_start' && event.contentType === 'tool_use') openToolJson += 1
      if (event.type === 'input_json_delta') byteCount += event.bytes
      if (event.type === 'content_block_stop' && openToolJson > 0) openToolJson -= 1
      if (event.type === 'message_delta') stopReason = event.stopReason
      if (event.type === 'message_stop') sawMessageStop = true
    },
    completeBody() {
      const evidence = { requestId: input.requestId, sawMessageStart, sawMessageStop, stopReason, openToolJson, eventCount, byteCount }
      if (!sawMessageStart || !sawMessageStop || !stopReason || openToolJson !== 0)
        throw new ProviderStreamIncompleteError(evidence)
      return Object.freeze(evidence)
    },
  }
}
```

- [ ] **Step 4: Integrate it into every response-body attempt**

Create the state after the response request ID is known, observe every provider stream event, and call `completeBody()` after the `for await` loop. Remove the environment gate around the idle deadline: the native runtime always owns a bounded body-idle timeout. On incomplete response, discard the incomplete assistant response and retry only through the existing pre-side-effect request recovery path. Emit a typed terminal error after the bounded retry budget.

- [ ] **Step 5: Verify GREEN and transport regressions**

Run:

```bash
bun test src/services/api/__tests__/streamTerminality.test.ts
bun test src/services/api/claude.test.ts
```

Expected: all selected tests pass with no timeout or unhandled rejection.

- [ ] **Step 6: Commit**

```bash
git add src/services/api/streamTerminality.ts src/services/api/__tests__/streamTerminality.test.ts src/services/api/claude.ts
git commit -m "fix: guarantee provider stream terminality"
```

### Task 2: Add the sole native process adapter

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts`
- Create: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts`
- Create: `packages/agent-workflow-server/src/beegame/native-runtime-process-path.ts`
- Create: `packages/agent-workflow-server/src/beegame/fixtures/native-runtime-fixture.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`

- [ ] **Step 1: Write failing process-protocol tests**

Cover: one user turn becomes one stream-json user envelope; assistant/system/progress messages are forwarded unchanged; `result` resolves the turn; `control_request/can_use_tool` is answered from the dashboard permission callback; a structured API error rejects; EOF without `result` rejects; abort terminates the child; stderr is captured as diagnostic evidence.

- [ ] **Step 2: Run and verify RED**

Run: `bun test packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts`

Expected: FAIL because the runner module does not exist.

- [ ] **Step 3: Implement exact process launch**

The child command must be one supported entrypoint with these fixed semantics:

```ts
[
  executable,
  '--print',
  '--verbose',
  '--input-format=stream-json',
  '--output-format=stream-json',
  '--include-partial-messages',
  '--replay-user-messages',
  '--permission-prompt-tool=stdio',
  `--permission-mode=${input.permissionMode}`,
]
```

Use `cwd: input.cwd`; pass only the safe base environment plus the UI-selected model environment. Parse stdout one NDJSON line at a time. Do not inspect or rewrite assistant content. Treat exactly one `result` or explicit error as terminal. EOF without a result is an error.

- [ ] **Step 4: Switch session manager atomically**

Replace `createProcessIsolatedQueryEngineRunner()` with `createNativeCliProcessRunner()`. Do not keep a runtime flag or fallback to the embedded runner.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
bun test packages/agent-workflow-server/src/beegame/session-manager.test.ts
bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts packages/agent-workflow-server/src/beegame/native-runtime-process-path.ts packages/agent-workflow-server/src/beegame/fixtures/native-runtime-fixture.ts packages/agent-workflow-server/src/beegame/session-manager.ts
git commit -m "refactor: use one native Bee Game Studio runtime"
```

### Task 3: Remove the embedded workflow runtime lane

**Files:**
- Delete workflow-only uses: `packages/agent-workflow-server/src/beegame/query-engine-process-runner.ts`
- Delete workflow-only uses: `packages/agent-workflow-server/src/beegame/query-engine-worker.ts`
- Delete workflow-only uses: `packages/agent-workflow-server/src/beegame/query-engine-worker-protocol.ts`
- Delete workflow-only uses: `packages/agent-workflow-server/src/beegame/query-engine-process-input.ts`
- Modify or delete workflow-only parts: `packages/agent-workflow-server/src/beegame/query-engine-runner.ts`
- Modify affected tests and exports.

- [ ] **Step 1: Add a failing source-boundary test**

The test reads the production session-manager dependency graph and fails if it imports any embedded engine runner or internal engine bootstrap module.

- [ ] **Step 2: Run the boundary test and verify RED**

- [ ] **Step 3: Delete the obsolete workflow lane**

Preserve a module only if a non-session feature still imports it; split that non-session responsibility into a specifically named module. There must be no alternate `BeeGameSessionRunner` implementation in production.

- [ ] **Step 4: Verify the runner tests, typecheck, and source search**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts packages/agent-workflow-server/src/beegame/session-manager.test.ts
rg -n "createProcessIsolatedQueryEngineRunner|createQueryEngineRunner" packages/agent-workflow-server/src/beegame
bun run typecheck
```

Expected: the search returns no production session runner.

- [ ] **Step 5: Commit**

```bash
git add -A packages/agent-workflow-server/src/beegame
git commit -m "refactor: remove embedded workflow runtime lane"
```

### Task 4: Make Markdown the sole document authority

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/authored-document-receipt.ts`
- Modify: `packages/agent-workflow-server/src/beegame/authored-document-receipt.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts`
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts`
- Delete: `packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.ts`
- Delete: `packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.test.ts`

- [ ] **Step 1: Write failing receipt tests**

Assert that committing an authored document never writes or rewrites the target Markdown, stores only the existing file digest and identity, and reconciles using only that digest. Assert that no `.authority.json` file is created.

- [ ] **Step 2: Write failing projection tests**

The projection must be exactly:

```ts
{
  targetPath,
  sources: [{ path, sectionIds, digest }],
}
```

It must not contain copied statements, facts, records, priorities, or model-authored authority.

- [ ] **Step 3: Verify RED**

Run the two focused test files and confirm they fail on current sidecar behavior.

- [ ] **Step 4: Implement read-only receipts and reference projections**

Read the native-authored Markdown, validate its canonical contract, hash the exact bytes, and atomically write only the workflow receipt. Never rewrite the Markdown. Build projections from contracted upstream paths/section IDs and the exact Markdown digests.

- [ ] **Step 5: Delete sidecar implementation and verify GREEN**

Run focused tests plus `rg -n "authoritySidecar|\.authority\.json|sidecar_only|document_and_sidecar" packages/agent-workflow-server/src/beegame` and require zero production matches.

- [ ] **Step 6: Commit**

```bash
git add -A packages/agent-workflow-server/src/beegame
git commit -m "refactor: make Markdown the sole document authority"
```

### Task 5: Remove sidecar dependencies from drafting, recovery, and downstream reads

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.ts`
- Modify corresponding focused tests.

- [ ] **Step 1: Write failing downstream tests**

Create valid upstream Markdown without any sidecar and assert that the next document dispatch succeeds, projection references the contracted sections, recovery accepts the Markdown receipt, and upstream reference validation checks the path/section/digest directly.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Remove every sidecar gate and metric**

Replace `authorityPath/authorityDigest/sidecarBytes/authorityMode` with the single Markdown digest and projection byte count. Validation may parse stable Markdown markers and headings, but must not create a second content artifact.

- [ ] **Step 4: Verify GREEN and full source search**

Run all document-stage, recovery, dispatch, projection, and complete-document tests, then typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame
git commit -m "refactor: remove document sidecar dependencies"
```

### Task 6: Add passive diagnostics and fixed ports

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/runtime-observability.ts`
- Create: `packages/agent-workflow-server/src/beegame/runtime-observability.test.ts`
- Create or consolidate: `packages/agent-workflow-server/src/beegame/fixed-service-ports.ts`
- Modify service launch scripts and frontend configuration that currently discover or vary ports.

- [ ] **Step 1: Write failing diagnostic and port tests**

Assert that a silent incomplete response records request ID, provider/model identity, timestamps, event/byte counts, last event type, abort/retry outcome, terminal error, tool start/stop, and file receipt without secrets or prompt bodies. Assert the fixed port table rejects overrides and reports occupied ports before startup.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement passive recording and fixed allocation**

Diagnostics receive events but return no control decision. Port allocation is a frozen constant imported by every service and frontend dev launcher; startup fails with the exact occupied port/process evidence.

- [ ] **Step 4: Verify GREEN**

Run focused tests, service launcher tests, frontend configuration tests, and typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server apps scripts
git commit -m "feat: expose native runtime diagnostics on fixed ports"
```

### Task 7: Delete retired protocol, prompt, and compatibility code

**Files:**
- Delete custom document commit/part writer/server renderer modules and tests that no production import uses.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts` only to remove references to deleted protocols; do not add chunking instructions or transport workarounds.
- Modify user-facing strings and comments in the changed BGS surface to use “Bee Game Studio” or “native runtime”.

- [ ] **Step 1: Add failing static-boundary tests/search assertions**

Reject production references to custom document commit tools, document-part writers, server-owned Markdown renderers, sidecar modes, tool-input size gates, BGS stream watchdog injection, and the old branded runtime wording.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Delete, do not deprecate**

Remove obsolete modules, exports, feature flags, branches, fixtures, and compatibility tests. Do not retain aliases or fallbacks.

- [ ] **Step 4: Verify GREEN**

Run the complete backend test suite, frontend unit tests, typecheck, `git diff --check`, and static searches.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete retired document runtime protocols"
```

### Task 8: Chrome acceptance and document-quality audit

**Files:**
- Create: `docs/testing/bgs-document-chrome-acceptance.md`
- Update the implementation ledger with measured evidence only after the run.
- Do not modify any example or generated test output to pass acceptance.

- [ ] **Step 1: Build and start every service on the fixed ports**

Verify every health endpoint and record the exact process/port table.

- [ ] **Step 2: Use Chrome to create a new neutral project**

Submit a normal game idea through the visible UI. Do not use a named example from prior debugging and do not seed generated document content.

- [ ] **Step 3: Observe real native authoring**

Record provider request IDs, stream terminal evidence, tool operations, file receipts, time, and tokens. A running UI state is not acceptance.

- [ ] **Step 4: Require every canonical Markdown document to exist on disk**

Reject any run with missing documents, lingering running state, sidecars, custom document transports, half-written files, or unclear API errors.

- [ ] **Step 5: Audit output and code together**

For each document measure completeness, human readability, agent implementation usefulness, professional discipline coverage, responsibility overlap, redundancy, length, tokens, and generation time. Code inspection must separately confirm the single runner, single authority, terminality state, and no BGS writer.

- [ ] **Step 6: Run final verification**

```bash
bun test
bun run typecheck
git diff --check
```

Also preserve Chrome screenshots, raw event logs, receipts, generated document paths, token/time table, and quality findings.

- [ ] **Step 7: Commit measured acceptance evidence**

```bash
git add docs/testing docs/superpowers/plans
git commit -m "test: verify single-lane document delivery in Chrome"
```

## Self-review

- Spec coverage: one production runner, native terminality, no BGS writer, Markdown-only authority, no compatibility lane, fixed ports, error visibility, Chrome output and quality audit are each assigned to a task.
- Placeholder scan: the plan contains no deferred implementation placeholder; Task 8 evidence is intentionally produced only by the real acceptance run.
- Type consistency: the runner implements the existing `BeeGameSessionRunner` boundary; receipt and projection types are replaced once and consumed directly by downstream tasks; no sidecar type survives Task 5.
