# Document Audit Runtime Closure Plan

**Goal:** Make the existing single document-audit and revision path complete reliably, preserve exact authority, expose actionable feedback, and prove the full flow with `moonlight-mushroom-defense--5462c252b870`.

**Authority:** `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`

**Design:** `docs/designs/2026-08-25-document-audit-runtime-closure.md`

**Implementation baseline:** branch `codex/document-audit-authority-clean`, design commit `2468fbca`. The worktree currently contains an uncommitted pause-clock recovery experiment in `recovery.ts` and two tests. Task 1 removes that experiment and replaces its tests; do not commit it as an intermediate solution.

## Global constraints

- Keep one `foundationAuditState.tasks[]` collection and the existing revision task collection. Add no dispatcher, queue, recovery path, candidate authority, compatibility reader, or Reviewer-specific UI.
- Fact and semantic packets remain at most 16 KiB. Concurrency remains four. Fact/semantic attempts remain two; strong confirmation remains one.
- No audit worker may receive the Confirmed Brief, workspace path, canonical artifact list, project file authority, or full document.
- Aggregate usage is retained only as telemetry. It must not gate claims or terminal admission.
- Shared phase and round deadlines are removed. Existing per-dispatch timeout and attempt behavior remain the operational boundary.
- Every integrity failure fails closed with exact task evidence. New business issues publish normally and drive the next revision round.
- Preserve unrelated dirty work and stage only files named by the active task.

---

## Task 1 — Remove shared caps, deadlines, and pause-clock recovery

**Files**

- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.test.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-runtime.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-runtime.test.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-schema.test.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`

**Required behavior**

- Delete `FOUNDATION_FACT_MAX_MODEL_TOKENS`, `FOUNDATION_FACT_PHASE_DEADLINE_MS`, `FOUNDATION_SEMANTIC_MAX_MODEL_TOKENS`, `FOUNDATION_SEMANTIC_PHASE_DEADLINE_MS`, `FOUNDATION_DEEP_MAX_MODEL_TOKENS`, and `FOUNDATION_DEEP_PHASE_DEADLINE_MS`.
- `claimFoundationFactTasks()` and `claimFoundationSemanticTasks()` gate only on task status, concurrency, attempt count, and model availability.
- Terminal admission still records aggregate usage but does not reject a valid terminal because cumulative usage or elapsed phase time is high.
- Delete `repairFoundationFactPause()` and the stopped/resumed/deadline pattern tests currently present as dirty changes.
- Remove `FoundationRevisionState.roundDeadlineAt`, its schema field, controller writes, and dispatch checks. Increment `DELIVERY_RUN_SCHEMA_VERSION` once.

**Test cycle**

1. Replace the cap/deadline tests with tests proving an old phase and high aggregate telemetry do not block unopened tasks:

```ts
const claimed = claimFoundationFactTasks(
  { ...seeded, phaseStartedAt: '2020-01-01T00:00:00.000Z', aggregateUsage: usage(200_000) },
  { now: '2026-08-25T00:00:00.000Z', dispatchIdFor: task => `dispatch:${task.taskId}`, modelReady: true },
)
expect(claimed.tasks.filter(task => task.status === 'running')).toHaveLength(4)
```

2. Add the equivalent semantic/confirmation assertion and a revision schema assertion that rejects `roundDeadlineAt` as an unknown field.

3. Add a recovery assertion that resume/retry preserves durable task evidence and never changes `phaseStartedAt`, attempt, usage, duration, terminal digest, or receipt bindings.

4. Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-runtime.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-schema.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts
```

5. Commit only the files listed above with `fix: remove shared document audit deadlines`.

---

## Task 2 — Enforce packet-only prompts and a cardinality-derived fact output limit

**Files**

- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.test.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-state.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-state.test.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`

**Interfaces**

```ts
export function foundationFactOutputTokenLimit(factKeyCount: number): number {
  if (!Number.isInteger(factKeyCount) || factKeyCount < 1) throw new Error('foundation fact key count must be a positive integer')
  return 4_096
}
```

Output admission measures the final structured business payload rather than provider usage. Use one shared deterministic estimator based on the UTF-8 byte length of the JSON payload divided by two (rounded up, conservatively for multilingual text). For facts the payload is `{ status, results }`; for semantic and deep workers it is `{ status, outcome, issues?, reason? }`. Facts use a fixed `4096` token per-dispatch cap; semantic and deep workers use one shared fixed `2048` token per-dispatch cap so confirmation cannot reject a legal issue union admitted by semantic review. `factKeyCount` remains mandatory for packet/state identity and scope validation, but cardinality is not a payload-size proxy because one legal array-valued fact may be larger than several scalar facts. Provider `completion_tokens` and total usage are retained for cost observation and must not reject a valid small payload, even when a native session performed structured-output repairs.

Add `factKeyCount: number` to `FoundationFactTask`; seed it from `packet.keys.length`, persist it in the state schema, and use it to validate packet/task identity and scope. Do not derive the final payload cap from cardinality.

**Required behavior**

- `buildWorkerPrompt()` returns a dedicated packet prompt before constructing the generic workspace/canonical-artifact preamble for fact and semantic workers.
- `delivery-worker-session-port.submit()` excludes `confirmedBriefContext`, document authority blocks, native-tool autonomy text, and confirmed-brief display metadata for packet workers.
- The dedicated prompt contains language, explicit read/write denial, strict result instruction, and the immutable contract containing the packet and service-owned identity.
- Fact model results contain only `key`, `status`, typed `value`, or `reason`; the session port rejects model-supplied provenance and binds exact evidence from each immutable packet catalog-owner section before constructing the durable terminal.
- Other worker prompts and display metadata remain unchanged.
- Increment `FOUNDATION_AUDIT_STATE_SCHEMA_VERSION` once for the required `factKeyCount` field; add no reader for the prior feature-branch schema.

**Test cycle**

1. Add a prompt test that injects unique sentinel values and asserts they are absent:

```ts
expect(prompt).not.toContain('/workspace-secret')
expect(prompt).not.toContain('CONFIRMED_BRIEF_SENTINEL')
expect(prompt).not.toContain('Canonical artifacts:')
expect(prompt).not.toContain('native tools, reasoning')
expect(prompt).toContain('packet is the sole input')
```

2. Add a session-port test that captures `sendWithDisplay()` and proves both the submitted prompt and display payload omit the Brief for fact and semantic workers.

3. Add output-limit tests for 1, 4, 13, and 15 keys: `4096`, `4096`, `4096`, and `4096`; add a multi-item array-valued one-key payload that remains admitted under the fixed cap.

4. Add admission tests proving high provider completion usage with a small final payload is accepted, while an oversized final structured payload is rejected for ordinary facts, impacted facts, semantic checks, and deep confirmation.

5. Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-state.test.ts
```

6. Commit with `fix: isolate document audit packet workers`.

---

## Task 3 — Merge mechanical and worker facts through one finalizer

**Files**

- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-extraction.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-extraction.test.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts`

**Interface**

Add one pure merger beside fact extraction:

```ts
export function mergeFoundationFactResults(input: {
  mechanicalFacts: readonly FoundationFact[]
  workerFacts: readonly FoundationFact[]
  workerReceipts: readonly FoundationFactReceipt[]
}): FoundationFact[]
```

It canonicalizes through `createFoundationFactStore()`, strictly validates unique closed receipts, rejects mechanical overlap and differing present value/evidence, treats absent/uncertain receipts as coverage only, and verifies exact catalog accounting before returning a present-only Fact Store. Semantic packets retain the immutable 16 KiB bound: gameplay selects `GDD#core_loop` + `LEVEL#pacing_beats`, platform selects `TECHNICAL#performance,risks`, and content selects `ART#asset_specifications` + `ASSET#formats_budgets` because normalized fact owners cover the omitted structure. The section index ends marked sections at any next same-level-or-higher Markdown heading, including unmarked `Production Materials` appendices.

**Required behavior**

- `finalizeFoundationFacts()` reads the eight revision-bound documents, reruns `extractNormalizedFoundationFacts()`, loads worker facts and receipts, validates exact accounting, and publishes the present-only merged store.
- Mechanical keys are never requested from workers and never disappear at publication.
- Admitted absent/uncertain receipts do not become synthetic facts and do not block derived publication; deterministic and semantic review own the resulting issues.
- The zero-packet path calls the same finalizer and publishes a complete Fact Store.

**Test cycle**

1. Add unit tests for mechanical-only, mixed present/absent/uncertain accounting, overlap, receipt/fact disagreement, missing key, and unknown key cases.

2. Add an integration fixture where at least one catalog key resolves mechanically and another requires a worker; assert both appear in committed `derived/fact-store.json`.

3. Add a zero-worker fixture and assert `derived/COMMITTED.json` is created with no dispatch.

4. Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-extraction.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-artifacts.test.ts
```

5. Commit with `fix: publish complete foundation fact store`.

---

## Task 4 — Publish new issues and drive all three revision rounds

**Files**

- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-patch-validation.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-patch-validation.test.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-round-policy.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-round-policy.test.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts`

**Required behavior**

- In `validateRebuiltFoundationFacts()`, only `PatchValidation.status === 'FAIL'` is an operational validation failure. `newImpactedIssues` are valid audit output.
- The publishing phase recomputes and passes the complete new issue set to `publishFoundationRevision()`.
- The next round loads issues only from the committed publication authority.
- Round policy is exact: Round 1 fixes BLOCKER/HIGH/MEDIUM; Round 2 fixes BLOCKER/HIGH; Round 3 fixes BLOCKER; PASS requires no BLOCKER/HIGH; remaining MEDIUM/LOW become Known Issues; BLOCKER/HIGH after Round 3 becomes `needs_action`.
- Every next-round state binds `roundBefore` and `authority` to the preceding committed revision and Issue Registry digest.
- Keep the per-document revision packet at 24 KiB, carry admitted Issue Registry entries without a duplicate `problem` or `evidenceRefs` projection, and reject any genuinely oversized packet at that task boundary.

**Test cycle**

1. Add a controller test where a valid Round 1 patch creates a new HIGH issue. Assert publication commits, Round 2 starts, and its task references the resulting Registry digest.

2. Add Round 2 → Round 3 coverage and terminal-policy cases:

```ts
expect(evaluateFoundationRevisionRoundPolicy(round3WithMediumLow)).toMatchObject({ status: 'pass' })
expect(evaluateFoundationRevisionRoundPolicy(round3WithHigh)).toMatchObject({ status: 'needs_action' })
expect(evaluateFoundationRevisionRoundPolicy(round3WithBlocker)).toMatchObject({ status: 'needs_action' })
```

3. Add replay coverage proving a committed round is not republished and the next-round authority does not change.

4. Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-patch-validation.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-round-policy.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-publication.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts
```

5. Commit with `fix: advance issue driven foundation revisions`.

---

## Task 5 — Preserve exact terminal evidence through failure and recovery

**Files**

- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.test.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-runtime.test.ts`
- Modify `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`

**Required behavior**

- Every failed, blocked, interrupted, completed, or exhausted audit/revision task copies `DispatchRecord.usage`, calculated duration, dispatch terminal status, and exact failure reason into the task.
- Retry clears only the retryable task's transient `failureReason`; it preserves prior attempt evidence in the dispatch record and never clears terminal/receipt evidence.
- Recovery uses persisted task status and receipt/terminal bindings. It does not inspect stopped/resumed timing patterns.
- Conflicting terminal replay and stale packet/revision identity remain fail-closed integrity errors.

**Test cycle**

1. Add failure-path assertions for fact, semantic, impacted-fact, semantic-recheck, and document-revision tasks.

2. Add restart tests for pending, running-with-interrupted-dispatch, retryable, completed-with-receipt, exhausted, and conflicting replay states.

3. Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-runtime.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts
```

4. Commit with `fix: preserve document audit task evidence`.

---

## Task 6 — Project complete audit and revision feedback

**Files**

- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-state.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts`
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.ts`
- Modify `apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx`
- Modify `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`
- Modify `apps/frontend/src/viewModels/displayModels.test.ts`

**Interfaces**

```ts
type FoundationIssueSummary = {
  total: number
  blocker: number
  high: number
  medium: number
  low: number
}

type DocumentDisplayTask = {
  id: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  attempt: number
  operation: 'write' | 'review' | 'revise' | 'produce'
  round?: 1 | 2 | 3
  issueSummary?: FoundationIssueSummary
  knownIssueCount?: number
  usage?: WorkflowUsage
  durationMs?: number
  failureReason?: string
}
```

**Required behavior**

- Add ordinary fact-extraction display tasks; retain deterministic, semantic/deep, issue compilation, per-document revision, and targeted validation tasks.
- Persist only the compact issue summary and Known Issues IDs/count in workflow state. Raw Registry JSON remains artifact-only.
- Failed task cards show the exact task failure reason. Completed task cards show their checkmark. Usage and duration remain optional display metadata and must come from task evidence.
- No Reviewer-specific component or route is added.
- Add `issueSummary` to the committed audit review binding and current revision state, then increment `FOUNDATION_AUDIT_STATE_SCHEMA_VERSION` and `DELIVERY_RUN_SCHEMA_VERSION` once for this task.

**Test cycle**

1. Add projection tests for pending/running/completed/failed fact tasks, Round 2 revision tasks, severity summary, Known Issues count, and usage/duration.

2. Add frontend tests proving the compact summary renders and raw issue bodies/Registry JSON do not.

3. Run:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx apps/frontend/src/viewModels/displayModels.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
```

4. Commit with `feat: expose document audit workflow feedback`.

---

## Task 7 — Full verification and real-project acceptance

**Automated verification**

1. Run the delivery workflow suite:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow
```

2. Run cross-boundary server and frontend tests:

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx apps/frontend/src/viewModels/displayModels.test.ts
```

3. Run typecheck and diff hygiene:

```bash
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
```

4. Run the active dual-track scan:

```bash
rg -n "candidateReferences|Foundation Review Selection|FOUNDATION_REVIEW_VERSION|foundation-review-(assembly|markdown|projection|stage|state)|foundationRevisionCycle|core-design|technical-assets|presentation|synthesis|repairFoundationFactPause|aggregate model token cap|phase deadline exceeded|round deadline exceeded" packages/agent-workflow-server/src/beegame/delivery-workflow apps/frontend/src
```

Expected result: no active legacy Reviewer/revision authority, pause-clock repair, or shared audit deadline remains. Test descriptions that assert absence are allowed.

**Real project**

Use:

```text
/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/moonlight-mushroom-defense--5462c252b870
```

1. Start this worktree with `/Users/nswell/.bun/bin/bun run dev` using the configured model environment.
2. Resume the durable run only if its task identities and revision digests validate under the new schema; otherwise rerun the same eight committed documents through a new audit revision without changing their contents.
3. Verify fact extraction completes all nine packets; no prompt or session snapshot contains the Confirmed Brief or full-document context.
4. Verify `derived/fact-store.json`, `derived/section-index.json`, manifests, and commit markers validate by digest.
5. Verify deterministic and ten semantic checks complete, new issues publish, required revision rounds advance, targeted validation completes, and no BLOCKER/HIGH remains at PASS.
6. Verify Dashboard fact/audit/revision tasks show status, exact failures, usage/duration, round, severity counts, and Known Issues count.
7. Verify the workflow automatically enters `CHECKLIST_DRAFTING`.
8. Record run ID, final document revision, task counts, total usage, elapsed time, final issue summary, and artifact paths in `docs/reviews/2026-08-25-document-audit-runtime-closure-acceptance.md`.

**Final commit**

Commit only acceptance evidence and any test-only correction required by the real run with `test: accept document audit runtime closure`.
