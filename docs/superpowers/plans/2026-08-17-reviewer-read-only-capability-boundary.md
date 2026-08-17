# Reviewer Read-Only Capability Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the Foundation Reviewer prompt and design contract with its existing read-only native capability envelope, then prove the unchanged Reviewer topology through Web/React acceptance.

**Architecture:** Keep the production Reviewer runtime unchanged: three disjoint read-only review lanes, packet-only synthesis, `Read`/`Grep`/`Glob`, and schema-backed `StructuredOutput`. Remove only the contradictory claim that all native tools remain unchanged. Bee Game Studio continues to define role-level least privilege and byte-bound persistence without controlling semantic reasoning or individual tool calls.

**Tech Stack:** TypeScript, Bun, Zod JSON Schema, native Bee Game Studio CLI process, React/Vitest, Chrome Web/React acceptance.

## Global Constraints

- Do not modify the native runtime core.
- Do not remove the Foundation Reviewer's `Read,Grep,Glob` tool envelope.
- Do not restrict document-author or remediation Agent tools.
- Do not add a Reviewer fallback, compatibility route, subagent definition, new UI panel, or second report format.
- Keep one canonical version 2 `review.json` and the existing ordinary Workflow Card Tasks.
- Bee Game Studio may define Reviewer role capabilities, paths, schema, revision, and persistence; it must not choose semantic findings or individual read/search calls.
- Use the fixed service ports and Web/React for acceptance.

---

### Task 1: Make the Reviewer Prompt Contract Truthful

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`

**Interfaces:**
- Consumes: `WorkerDispatchRequest.workerType === 'document-reviewer'` and the existing Reviewer assignment contract.
- Produces: a Reviewer prompt that states the actual read/search-only capability boundary and never claims its complete native tool inventory is unchanged.

- [ ] **Step 1: Add a failing Reviewer prompt regression**

Add focused assertions to the existing Reviewer structured-output test, which
already captures the complete prompt sent through `sendWithDisplay`:

```ts
expect(finalReviewerPrompt).toContain(
  'Use native read and search capabilities as needed',
)
expect(finalReviewerPrompt).not.toContain(
  "native tools, reasoning, permissions, context management, and normal completion behavior remain unchanged",
)
```

Keep the existing assertions that the Reviewer must not use `Write` or `Edit`
and must submit through `StructuredOutput`. The full captured prompt, rather
than `buildWorkerPrompt()` alone, is required because the contradictory generic
autonomy sentence is appended by the session port.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts
```

Expected: FAIL because `nativeToolAutonomyInstruction` currently adds the generic “tools remain unchanged” sentence to Reviewer prompts.

- [ ] **Step 3: Exclude Reviewer from the generic autonomy sentence**

Change only the condition that builds `nativeToolAutonomyInstruction`:

```ts
const nativeToolAutonomyInstruction =
  request &&
  request.workerType !== 'document-author' &&
  request.workerType !== 'document-reviewer'
    ? "Bee Game Studio's native tools, reasoning, permissions, context management, and normal completion behavior remain unchanged. Use native capabilities as needed to complete and verify this task."
    : ''
```

Do not change the Reviewer-specific `workflowResultInstruction`; it already describes the true read/search-only and `StructuredOutput` contract.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit the prompt-contract correction**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts
git commit -m "fix: align reviewer prompt with read-only capabilities"
```

---

### Task 2: Lock the Role Boundary Without Affecting Authors

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts`
- Verify unchanged: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts`

**Interfaces:**
- Consumes: `nativeRuntimeCommand(BeeGameSessionRunnerStartInput)`.
- Produces: regression evidence that Reviewer processes expose exactly `Read,Grep,Glob`, schema-backed structured output remains enabled, and document authors receive no BGS tool allowlist.

- [ ] **Step 1: Strengthen the existing command tests**

Assert the exact Reviewer tool value and absence of workflow-injected agents:

```ts
const reviewerCommand = nativeRuntimeCommand({
  sessionId: 'foundation-reviewer',
  cwd: process.cwd(),
  env: {},
  workflowWorker: true,
  workflowWorkerType: 'document-reviewer',
  workflowJsonSchema,
})
expect(reviewerCommand[reviewerCommand.indexOf('--tools') + 1]).toBe(
  'Read,Grep,Glob',
)
expect(reviewerCommand.some(value => value.startsWith('--agents='))).toBe(false)
expect(reviewerCommand).toContain('--json-schema')

const remediationCommand = nativeRuntimeCommand({
  sessionId: 'foundation-remediation',
  cwd: process.cwd(),
  env: {},
  workflowWorker: true,
  workflowWorkerType: 'document-author',
})
expect(remediationCommand).not.toContain('--tools')
expect(remediationCommand).not.toContain('--allowedTools')
```

- [ ] **Step 2: Run the command-contract tests**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
```

Expected: PASS without changing `native-cli-process-runner.ts`. If it fails, stop and audit the runtime command instead of weakening the assertions.

- [ ] **Step 3: Run the Reviewer boundary suite**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-document-lanes.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
```

Expected: all Reviewer, persistence, task-projection, and capability tests pass.

- [ ] **Step 4: Run static boundary checks**

Run:

```bash
rg -n "workflowWorkerType === 'document-reviewer'|Read,Grep,Glob|--agents=|native tools, reasoning, permissions" packages/agent-workflow-server/src/beegame
```

Expected production result:

- one Reviewer tool-envelope branch in `native-cli-process-runner.ts`;
- no injected Reviewer `--agents` definition;
- no Reviewer prompt claiming the complete tool inventory is unchanged;
- no worker-type or remediation-mode tool override; the separate accepted
  Foundation Markdown stream branch remains unchanged.

- [ ] **Step 5: Commit the regression coverage**

```bash
git add packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
git commit -m "test: preserve reviewer read-only tool boundary"
```

---

### Task 3: Verify the Current Reviewer Through Web/React

**Files:**
- Create: `docs/superpowers/reviews/2026-08-17-human-team-foundation-review-chrome-acceptance.md`

**Interfaces:**
- Consumes: a fresh review copy of an already completed canonical eight-document project and the fixed-port Web/React stack.
- Produces: one acceptance record containing project/run IDs, task states, immutable source comparison, Reviewer tool evidence, report digest, semantic quality findings, duration, input, cache input, output, and credit.

- [ ] **Step 1: Establish the immutable acceptance baseline**

Create a new review copy through the Dashboard. Before starting review, record SHA-256 digests for all eight canonical documents. Do not edit the copied project or use an example-specific fixture.

- [ ] **Step 2: Start Foundation Review through Web/React**

Use Chrome and the Dashboard only. Confirm the ordinary Task list shows:

```text
核心设计
技术与资产
表现体验
阻塞问题汇总
```

Do not use a backend-only route to start or complete the workflow.

- [ ] **Step 3: Capture runtime evidence for every Reviewer task**

From the project-local runtime logs, record:

- tools offered to the worker;
- every native tool call;
- number and bytes of full document reads;
- projection reads;
- compaction events;
- uncached input, cache input, output, credit, and elapsed time.

Acceptance requires no `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `Bash`, or `Agent` call and exactly one structured terminal result per Reviewer task.

- [ ] **Step 4: Stop at the accepted canonical report event**

When the synthesis task commits `.beegame/reviews/foundation/<revision>/review.json`, stop the workflow before assessing remediation. The acceptance project is disposable, but Reviewer measurement must not include repair tokens or file mutations.

- [ ] **Step 5: Verify source immutability and report authority**

Recompute all eight document digests and require exact equality with Step 1. Verify the report path, SHA-256 digest, version, revision, verdict, conflict IDs, evidence paths, per-path actions, shared outcomes, and mechanically checkable acceptance conditions.

- [ ] **Step 6: Perform semantic quality review**

Judge the canonical `review.json` against these fixed criteria:

- only implementation-, production-, gameplay-, or acceptance-blocking defects;
- no prose critique, correct-content summary, preservation narrative, or replacement document draft;
- every conflict tells a repair Agent what is wrong, where it is, which paths change, what each path must do, and how closure is verified;
- no duplicate conflicts across lane packets;
- no unsupported fact introduced by synthesis.

- [ ] **Step 7: Record acceptance and decide**

Write the observed evidence to:

```text
docs/superpowers/reviews/2026-08-17-human-team-foundation-review-chrome-acceptance.md
```

The result is `ACCEPTED` only when tool isolation, source immutability, report quality, Dashboard Tasks, and measurements all pass. Any failure must be classified before changes:

- capability-contract failure;
- Reviewer semantic-quality failure;
- workflow persistence/revision failure;
- endpoint/runtime transport failure.

Do not patch during acceptance. Return to root-cause analysis with the captured evidence.

- [ ] **Step 8: Run final verification**

Run:

```bash
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
git status --short
```

Expected: typecheck and diff check pass; only the planned source, tests, design, plan, and acceptance record differ from the branch baseline.

- [ ] **Step 9: Commit the acceptance record**

```bash
git add docs/superpowers/reviews/2026-08-17-human-team-foundation-review-chrome-acceptance.md
git commit -m "docs: accept reviewer read-only capability boundary"
```

## Plan Self-Review

- Spec coverage: the plan preserves the exact Reviewer tool envelope, removes only contradictory prompt language, protects document-author/remediation autonomy, and requires Web/React acceptance.
- Scope: no remediation redesign, native-core change, UI redesign, new Reviewer topology, fallback, migration, or compatibility execution path is included.
- Type consistency: all referenced worker types, request fields, functions, paths, and test files exist in the current tree.
- Placeholder scan: the plan contains no TBD, TODO, deferred implementation, or unspecified test step.
