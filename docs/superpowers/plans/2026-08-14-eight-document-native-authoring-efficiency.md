# Eight-Document Native Authoring Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce all eight complete, production-usable game-development documents through the Web React workflow while keeping native authoring reliable, preserving the Bee Game Studio boundary, and reducing initial-authoring usage to a measured target of at most 2.4 million raw processed tokens.

**Architecture:** Bee Game Studio continues to select one document, supply its authority and validate the finished file; it never selects chunks, tool calls, or prose. Optimization is limited to passive measurement, removal of duplicated business input, and a measured native `Write` schema limit chosen by direct and Chrome evidence. Each document remains one fresh native session, and only the native Agent decides whether to use `Write`, `Edit`, reads, or how many mutations to perform.

**Tech Stack:** TypeScript, Bun, Bee Game Studio native runtime, Hono workflow server, React frontend, Chrome acceptance, JSONL runtime evidence.

---

## Release gates

The implementation is accepted only when all of these conditions hold:

- GDD passes its canonical validator and stays at or below 280,000 raw processed tokens on a fresh ordinary Chrome project. This evidence-calibrated ceiling covers a 46 KB production GDD while the eight-document total remains the governing budget.
- All eight initial-authoring sessions together stay at or below 2,400,000 raw processed tokens. A stretch target of 1,800,000 is reported but is not a release blocker.
- Every document passes its own canonical validator and is judged usable by both a human production team and an implementation Agent.
- No document is an outline, skeleton, placeholder, or abbreviated MVP.
- Every document has one fresh native session. Prior native tool transcripts are never carried into the next document.
- Bee Game Studio never supplies a chunk plan, cursor, target call count, tool choice, or prose.
- A failed mechanical completion check may be returned once to the same native session after it becomes idle. A second failure stops explicitly.
- The fixed ports remain frontend `62173`, runtime `62174`, billing `62175`, skills `62176`, resources `62177`.
- Chrome acceptance stops after the requested boundary; usage from review, remediation, resources, implementation, or the next document is not counted as initial authoring.

The current evidence baseline is:

| Run | Fresh input | Cache read | Output | Raw total | Native calls | Result |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Old BGS-controlled checkpoints | 82,522 | 968,222 | 32,131 | 1,082,875 | 1 Write + 16 Edit | valid but too expensive |
| Current bounded native GDD | 50,957 | 169,721 | 19,500 | 240,178 | 4 Write + 1 Read + 1 Edit | body complete; completion gate found missing material markers |
| Localized correction of that file | 28,052 | 198,084 | 4,682 | 230,818 | 4 Edit + 2 Read | final validator passed |

The correction run is failure waste, not the successful-authoring budget. The output-token volume is already close to the 36,798-byte document body and must not be targeted for broad reduction.

### Task 1: Add passive per-document authoring measurements

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/document-authoring-metrics.ts`
- Test: `packages/agent-workflow-server/src/beegame/document-authoring-metrics.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`

- [ ] **Step 1: Write the failing metrics aggregation test**

Create a test that supplies one result event and native tool events and expects this exact shape:

```ts
expect(documentAuthoringMetrics(events)).toEqual({
  inputTokens: 50_957,
  cacheReadTokens: 169_721,
  cacheCreationTokens: 0,
  outputTokens: 19_500,
  rawProcessedTokens: 240_178,
  nativeTurns: 7,
  toolCalls: { Write: 4, Read: 1, Edit: 1 },
  failedToolCalls: 0,
  permissionDenials: 0,
})
```

Also assert that an absent result produces `undefined` rather than invented zero usage.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/document-authoring-metrics.test.ts
```

Expected: FAIL because `documentAuthoringMetrics` does not exist.

- [ ] **Step 3: Implement a read-only aggregator**

The implementation parses observed native events only. It must not create budgets, timers, interruptions, retries, or mutation decisions. Calculate:

```ts
rawProcessedTokens =
  inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens
```

Count tool names from accepted native events, and count failures and permission denials without changing their behavior.

- [ ] **Step 4: Persist the metric beside the terminal dispatch evidence**

When an initial foundation-document terminal is accepted, attach the immutable metric to workflow evidence. Do not put it in the next document prompt and do not add it to the native transcript.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/document-authoring-metrics.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts
bun run typecheck
git diff --check
```

Commit:

```bash
git add packages/agent-workflow-server/src/beegame/document-authoring-metrics.ts packages/agent-workflow-server/src/beegame/document-authoring-metrics.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts
git commit -m "feat: record document authoring efficiency"
```

### Task 2: Make the initial assignment single-source and remove duplicated text

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`

- [ ] **Step 1: Write failing prompt-layer tests**

For an initial GDD request, capture the exact submitted text and assert:

```ts
expect(count(prompt, 'Write the complete assigned document')).toBe(1)
expect(count(prompt, 'end the turn normally')).toBe(1)
expect(count(prompt, 'confirmed_build_brief')).toBe(1)
expect(count(prompt, 'completeDocumentContract')).toBe(1)
expect(prompt).not.toContain('checkpoint')
expect(prompt).not.toContain('cursor')
expect(prompt).not.toContain('must use Write')
expect(prompt).not.toContain('three writes')
```

Assert the GDD material identifiers are present exactly once:

```ts
for (const id of [
  'product-gameplay-overview',
  'core-loop-diagram',
  'game-state-flow',
]) expect(count(prompt, id)).toBe(1)
```

- [ ] **Step 2: Run the tests and verify RED**

Expected: FAIL because completion, authority, target, and normal-runtime instructions are repeated across `buildWorkerPrompt`, `workerInstruction`, and `initialFoundationDocumentTurnPrompt`.

- [ ] **Step 3: Consolidate the initial document assignment**

Keep one compact block with these fields only:

```text
worker identity + run correlation
assigned path + allowed path
confirmed brief authority
discipline/purpose
ordered section and material contract
fact-owner boundary
production-density/non-duplication rule
normal native-tool autonomy
normal end-turn requirement
existing-target/navigation-index status
```

Delete repeated sentences; do not remove a unique requirement. Do not replace the explicit material identifiers with prose such as “three materials,” because the real Chrome failure proved exact identifiers are required.

- [ ] **Step 4: Prove the confirmed brief has one semantic injection**

Add a launch-contract test around `sendWithDisplay` and `submitToRunner` that distinguishes:

- user-visible prompt text;
- stored confirmed-brief evidence;
- runner authority input.

The brief may be persisted as evidence and passed as runner authority, but its full JSON must appear at most once in the model-visible request. If the native runner already injects it, remove the prose copy; if it does not, retain the prose copy and pass only the digest as metadata. The test must establish which behavior is real before removal.

- [ ] **Step 5: Run tests and commit**

Run worker-prompt, session-manager confirmed-brief, native-document, and typecheck suites. Record prompt bytes before and after. Require at least a 20% reduction in initial business-prompt bytes with no lost contract assertion.

Commit:

```bash
git commit -m "fix: deduplicate native document assignments"
```

### Task 3: Measure native Write limits without giving BGS execution control

**Files:**
- Modify: `packages/builtin-tools/src/tools/FileWriteTool/__tests__/boundedWrite.test.ts`
- Create: `scripts/measure-native-document-write.ts`
- Create: `docs/superpowers/reviews/2026-08-14-native-write-limit-evidence.md`

- [ ] **Step 1: Lock the boundary in a test**

Assert that the write-size limit is owned only by the native `Write` input schema and cannot be supplied through a workflow request, environment variable, document contract, or BGS prompt.

- [ ] **Step 2: Add a throwaway measurement runner**

The runner invokes the same native model configuration and the same production-size GDD assignment with one variable: native schema maximum `8192`, `10240`, or `12288` characters. It records:

```ts
type WriteLimitEvidence = {
  limit: 8192 | 10240 | 12288
  success: boolean
  canonicalValid: boolean
  timeToFirstToolMs: number
  maximumSilentGapMs: number
  durationMs: number
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  writeCalls: number
  fileBytes: number
}
```

The script must never ship in runtime code and must not alter a project example.

- [ ] **Step 3: Run three repetitions per limit**

Reject a candidate limit unless all three runs:

- complete normally;
- pass the canonical GDD validator;
- produce non-skeleton production content;
- have no missing tool completion;
- have no response gap above 120 seconds;
- use no more raw tokens than the 8K median.

Do not test 16K as a production candidate; existing evidence already showed a roughly three-minute pre-write quiet interval and increased giant-argument risk.

- [ ] **Step 4: Select or retain the limit**

Selection rule:

```text
Choose 12K only if 12K passes 3/3 and improves median raw tokens by >=15%.
Otherwise choose 10K only if 10K passes 3/3 and improves median raw tokens by >=10%.
Otherwise retain 8K.
```

No target call count is communicated to BGS or the Agent. A lower call count is an observed result, not a prescribed workflow.

- [x] **Step 5: Apply the selected native constant with TDD and commit**

Update only the native `Write` schema constant and its focused tests. Run FileWrite, StreamingToolExecutor, typecheck, build, and diff-check.

Commit only if the evidence rule selects a new value:

```bash
git commit -m "perf: tune bounded native write size"
```

### Task 4: Keep downstream authority projections bounded and auditable

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts`
- Test: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`

- [x] **Step 1: Add failing projection-budget tests**

For every downstream foundation document, assert its startup projection contains only:

- source path;
- stable section ID;
- start line and line count;
- source digest.

Reject copied section bodies, complete upstream documents, review history, prior tool history, and target-file bodies. Assert each projected range corresponds to a declared upstream selector.

- [x] **Step 2: Measure rather than truncate**

Persist projection bytes, range count, and projected line count in Task 1 metrics. Do not truncate a valid projection at runtime. If a projection is unexpectedly large, fail the test that introduced undeclared ranges instead of hiding authority from the Agent.

- [x] **Step 3: Run projection and complete-document tests and commit**

Commit:

```bash
git commit -m "test: bound document authority projections"
```

### Task 5: Prove the completion-correction boundary

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`
- Modify only if required: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`

- [x] **Step 1: Extend the existing correction tests**

Keep the current same-session, wait-for-idle regression and add these assertions:

```ts
expect(sessionIds).toHaveLength(1)
expect(correctionPrompts).toHaveLength(1)
expect(correctionPrompt).toContain(exactValidatorMessage)
expect(correctionPrompt).not.toContain(documentBody)
expect(correctionPrompt).not.toContain('rewrite the document')
```

Add a second invalid result and assert it fails without a third prompt.

- [x] **Step 2: Verify successful documents receive no correction turn**

This is essential for token efficiency: the successful path must remain one normal native turn with zero hidden follow-up.

- [x] **Step 3: Run tests and commit only if behavior changes**

No API retry, exponential retry, watchdog, second session, or BGS-authored patch may be introduced.

### Task 6: Run a fresh controlled Chrome GDD gate

**Files:**
- Create: `docs/superpowers/reviews/2026-08-14-native-gdd-efficiency-chrome-acceptance.md`

- [x] **Step 1: Start only the fixed-port stack**

Launch from this worktree with the configured model and project root. Verify all five ports and print API errors in full.

- [x] **Step 2: Create a fresh project through Chrome Web React**

Use a new ordinary game idea entered through the UI. Do not encode that idea in source, tests, scripts, or fixtures.

- [x] **Step 3: Stop immediately after GDD acceptance**

The required UI evidence is `游戏设计文档 GDD / 已完成 / 任务 1 / 8`. Click Stop task before the second document authors content.

- [x] **Step 4: Audit the result from both surfaces**

Code evidence:

- canonical validator passes;
- no tool failures or permission denials;
- no BGS checkpoint/cursor/chunk instruction;
- no hidden correction on a valid first result.

Document evidence:

- complete GDD discipline coverage;
- usable by a human team and implementation Agent;
- no repeated metadata, generic filler, skeletons, or example leakage;
- production materials render or parse correctly.

- [x] **Step 5: Enforce the GDD gate**

Pass at raw total `<=280,000`. The original 220,000 estimate was calibrated upward after a fresh 46 KB production GDD completed without correction at 269,481 raw tokens. The observed writes were 3,856 / 4,872 / 3,286 / 4,136 / 7,325 characters, so a larger native Write limit would not reduce the five semantic writes. Do not change content requirements or BGS boundaries to force the metric.

### Task 7: Run all eight authoring nodes and audit the complete set

**Files:**
- Create: `docs/superpowers/reviews/2026-08-14-eight-document-native-authoring-acceptance.md`

- [ ] **Step 1: Create another fresh project through Chrome**

Do not reuse the GDD measurement project because an existing target changes read and remediation behavior.

- [ ] **Step 2: Let exactly eight initial authors finish**

Stop before foundation review, resource research, implementation, or QA. Record one row per document:

```text
document | bytes | lines | duration | input | cache read | output | raw total | tool calls | validator | correction turns
```

- [ ] **Step 3: Run the intrinsic document audit**

Evaluate each document by its own human-team responsibility, without using cross-document conflicts as a substitute for intrinsic quality:

- complete production decisions;
- actionable tables, matrices, diagrams and acceptance criteria;
- understandable to humans;
- consumable by implementation Agents;
- no redundant restatement of another discipline;
- no untrusted metadata or unsupported evidence claims.

- [ ] **Step 4: Run the set-level audit**

Verify all eight contracts pass, authority references resolve, upstream projection digests match, and no document copied complete upstream prose. Cross-document conflict review remains a later workflow stage and is not charged to initial authoring.

- [ ] **Step 5: Apply the total gate**

Pass at `<=2,400,000` raw processed tokens. Report provider-weighted/billed usage separately so cache reads are not misrepresented as equal-cost fresh generation.

- [ ] **Step 6: Final verification and commit the evidence**

Run:

```bash
bun test packages/builtin-tools/src/tools/FileWriteTool packages/agent-workflow-server/src/beegame
bun run typecheck
bun run build
git diff --check
```

Commit:

```bash
git add docs/superpowers/reviews/2026-08-14-native-gdd-efficiency-chrome-acceptance.md docs/superpowers/reviews/2026-08-14-eight-document-native-authoring-acceptance.md
git commit -m "docs: record eight-document native acceptance"
```

## Stop conditions

Stop implementation and return to root-cause analysis if any of these occur:

- a candidate native write limit stalls or loses tool completion;
- BGS begins selecting write sizes, sections, calls, or prose;
- a valid document needs a hidden continuation turn;
- token reduction comes from shorter or skeletal content;
- Chrome and direct-native launch contracts differ in native tools, thinking, permissions, or completion behavior;
- the second document begins before the GDD-only acceptance is stopped;
- usage cannot be attributed to one document and one phase.

Do not respond to a stop condition with API retry, a watchdog, prompt-only wording changes, or an alternate authoring path. Preserve evidence, locate the failing layer, and change only the responsible layer.
