# Foundation Remediation Section Transaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace multi-turn file-tool remediation with one atomic, structured body-unit transaction per affected Foundation document.

**Architecture:** The workflow projects one target document and its accepted path-scoped conflicts into a structured request. The model authors replacement bodies for canonical document units; a new pure transaction module validates and assembles the final Markdown, and a durable commit module atomically writes it and returns a byte-bound receipt. Existing review verification remains unchanged, while all direct file-tool remediation and compatibility selection paths are deleted.

**Tech Stack:** TypeScript, Bun, Zod v4, Node filesystem primitives, existing Bee Game Studio delivery workflow, React/Vitest, Web/React Chrome acceptance.

## Global Constraints

- Do not modify native Bee Game Studio core source or native file tools.
- Do not change compression, streaming or retry behavior.
- BGS may project authority, validate, persist and route; it must not author replacement prose.
- Keep exactly one runtime remediation protocol; do not retain a legacy fallback or dual track.
- Each affected Foundation document receives exactly one structured model request.
- The request contains the target document once and no other complete Foundation document.
- Any validation or commit failure leaves the target bytes unchanged and exposes the original error.
- Final acceptance runs through Web/React in Chrome on fixed ports 62173-62177.
- Efficiency target: no more than 3,000,000 remediation tokens across all eight documents; correctness is independent of file size.

---

## File Structure

- Create `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation-transaction.ts`: canonical body-unit extraction, request/result schemas, pure assembly and receipt schema.
- Create `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation-transaction.test.ts`: pure contract and assembly tests.
- Create `packages/agent-workflow-server/src/beegame/foundation-remediation-commit.ts`: durable atomic workspace commit and idempotent receipt replay.
- Create `packages/agent-workflow-server/src/beegame/foundation-remediation-commit.test.ts`: filesystem atomicity and replay tests.
- Modify `packages/agent-workflow-server/src/beegame/authored-document-receipt.ts`: expose a pure service-metadata renderer used before the single atomic commit; keep the existing checklist path behavior.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`: carry the committed remediation receipt in the document-author terminal.
- Modify `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`: build the structured request, accept structured output, call the atomic commit and remove direct remediation file mutation detection.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`: replace direct-edit remediation instructions with the single transaction contract.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`: trust and revalidate only the committed transaction receipt before recording lane completion.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.ts`: use the new single-path receipt shape and remove mutation-map logic.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`, `schema.ts`, `run-store.ts`: schema version 27 and one-time persisted-state migration without a runtime protocol branch.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts` and the API projection to preserve one task per document and exact failure text; keep the existing frontend task component unchanged and protect it with a regression test.
- Delete or rewrite tests that assert direct Read/Grep/Edit/Write remediation, grouped lanes, old digest maps or a fallback terminal.

---

### Task 1: Canonical Body-Unit Transaction

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation-transaction.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation-transaction.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/authored-document-receipt.ts`
- Test: `packages/agent-workflow-server/src/beegame/authored-document-receipt.test.ts`

**Interfaces:**
- Produces: `foundationRemediationResultSchema`, `FoundationRemediationTransactionRequest`, `FoundationRemediationTransactionReceipt`, `buildFoundationRemediationTransactionRequest()`, `assembleFoundationRemediationTransaction()` and `renderRemediatedDocumentMetadata()`.
- Consumes: `getGameDocumentContract()`, `validateCompleteGameDocumentMarkdown()` and accepted `FoundationReview` conflicts.

- [ ] **Step 1: Write failing body-unit extraction and assembly tests**

Add tests that build a valid canonical GDD fixture and assert this exact public shape:

```ts
const request = buildFoundationRemediationTransactionRequest({
  sourcePath: 'docs/GDD.md',
  sourceMarkdown,
  reviewDigest: 'a'.repeat(64),
  sourceRevision: 'b'.repeat(64),
  conflicts: [pathScopedConflict],
})

expect(request.units.map(unit => unit.unitId)).toEqual([
  'executive-summary',
  ...getGameDocumentContract('docs/GDD.md').sections.map(
    section => `section:${section.sectionId}`,
  ),
  ...getGameDocumentContract('docs/GDD.md').productionMaterials.map(
    material => `material:${material.materialId}`,
  ),
])

const assembled = assembleFoundationRemediationTransaction({
  request,
  result: {
    version: 1,
    sourcePath: request.sourcePath,
    sourceDigest: request.sourceDigest,
    resolvedConflictIds: request.conflicts.map(item => item.id),
    patches: [{
      unitId: request.units[1]!.unitId,
      expectedBodyDigest: request.units[1]!.bodyDigest,
      replacementBody: 'Revised authority with an observable acceptance boundary.',
    }],
  },
  previousMetadata,
  committedAt: '2026-08-17T12:00:00.000Z',
})

expect(assembled.receipt.patchedUnitIds).toEqual([request.units[1]!.unitId])
expect(assembled.markdown).toContain('Revised authority')
```

Add separate failures for stale source digest, stale unit digest, unknown unit, duplicate unit, noncanonical order, missing/extra conflict IDs, empty body, `# ` document title, canonical sibling heading, BGS protocol marker and a final document-contract violation. Assert the original string is unchanged after every pure failure.

- [ ] **Step 2: Run the new test and confirm RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation-transaction.test.ts
```

Expected: FAIL because the transaction module and exports do not exist.

- [ ] **Step 3: Implement strict schemas and pure assembly**

Define these exact types and schemas:

```ts
export type FoundationRemediationBodyUnit = {
  unitId: `executive-summary` | `section:${string}` | `material:${string}`
  bodyDigest: string
  startLine: number
  endLine: number
}

export type FoundationRemediationTransactionRequest = {
  version: 1
  sourcePath: FoundationDocumentPath
  sourceDigest: string
  sourceMarkdown: string
  reviewDigest: string
  sourceRevision: string
  conflicts: FoundationReview['conflicts']
  units: FoundationRemediationBodyUnit[]
}

export type FoundationRemediationTransactionReceipt = {
  reviewDigest: string
  sourceRevision: string
  targetPath: FoundationDocumentPath
  sourceDigest: string
  patchedUnitIds: string[]
  finalDigest: string
  committedAt: string
}

export const foundationRemediationResultSchema = z.object({
  version: z.literal(1),
  sourcePath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
  sourceDigest: digestSchema,
  resolvedConflictIds: z.array(z.string().min(1)),
  patches: z.array(z.object({
    unitId: z.string().min(1),
    expectedBodyDigest: digestSchema,
    replacementBody: z.string().trim().min(1),
  }).strict()).min(1),
}).strict()
```

Parse boundaries from existing canonical protocol markers, hash trimmed body bytes, and expose only unit IDs, source line ranges and digests beside the single `sourceMarkdown` value. Do not copy body text into `units`. During assembly, re-extract bodies from `sourceMarkdown`, preserve every heading and marker, replace only bodies, update only service-owned `version` and `updated_at` in memory, then call `validateCompleteGameDocumentMarkdown()` on the assembled result. Compare IDs bytewise and require exact assigned conflict closure.

Refactor `commitRemediatedDocumentMetadata()` so its metadata transformation delegates to:

```ts
export function renderRemediatedDocumentMetadata(input: {
  markdown: string
  previousVersion: string
  previousUpdatedAt: string
  updatedAt: string
}): string
```

The existing checklist caller may still write the returned bytes through its existing durable helper; Foundation transaction code receives the string before its one atomic commit.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation-transaction.test.ts packages/agent-workflow-server/src/beegame/authored-document-receipt.test.ts
```

Expected: all tests pass; no test writes a Foundation file during pure assembly.

- [ ] **Step 5: Commit the pure transaction boundary**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation-transaction.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation-transaction.test.ts packages/agent-workflow-server/src/beegame/authored-document-receipt.ts packages/agent-workflow-server/src/beegame/authored-document-receipt.test.ts
git commit -m "feat: define atomic foundation remediation transactions"
```

---

### Task 2: Durable Atomic Commit and Terminal Receipt

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/foundation-remediation-commit.ts`
- Create: `packages/agent-workflow-server/src/beegame/foundation-remediation-commit.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts`

**Interfaces:**
- Consumes: `assembleFoundationRemediationTransaction()` and its request/result types.
- Produces: `commitFoundationRemediationTransaction()` and terminal field `remediationReceipt`.

- [ ] **Step 1: Write failing filesystem and terminal tests**

Cover success, stale target bytes immediately before commit, malformed result, injected staging-write failure, injected rename failure and idempotent replay. Assert failures leave the exact original target bytes in place. Assert replay returns the existing receipt only when the target digest equals `finalDigest`.

Add a terminal schema assertion:

```ts
expect(documentAuthorTerminalSchema.parse({
  workerType: 'document-author',
  status: 'completed',
  writtenPaths: ['docs/GDD.md'],
  remediationReceipt: receipt,
})).toMatchObject({ remediationReceipt: receipt })
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/foundation-remediation-commit.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts
```

Expected: FAIL because the commit API and terminal receipt do not exist.

- [ ] **Step 3: Implement one fsync-and-rename commit**

Implement:

```ts
export async function commitFoundationRemediationTransaction(input: {
  workspacePath: string
  dispatchId: string
  request: FoundationRemediationTransactionRequest
  result: unknown
  previousMetadata: { version: string; updatedAt: string }
  committedAt: string
}): Promise<FoundationRemediationTransactionReceipt>
```

Resolve and verify the project-confined target, reread and hash it, assemble entirely in memory, write a dispatch-specific staging file under `.beegame/workflow/.staging/remediation/`, fsync the file, rename it over the target and fsync the target directory. Persist a canonical receipt beside workflow evidence. On replay, verify receipt identity plus current target digest before returning it. Do not invoke Edit, Write or `commitRemediatedDocumentMetadata()` after rename.

Add a strict optional `remediationReceipt` object to `documentAuthorTerminalSchema`; `document-stage.ts` will require it specifically when `authoringMode === 'remediation'`.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/foundation-remediation-commit.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts
```

Expected: all tests pass, including injected failure byte equality.

- [ ] **Step 5: Commit the durable transaction**

```bash
git add packages/agent-workflow-server/src/beegame/foundation-remediation-commit.ts packages/agent-workflow-server/src/beegame/foundation-remediation-commit.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts
git commit -m "feat: commit foundation remediation atomically"
```

---

### Task 3: Wire One Structured Remediation Turn and Delete Direct Editing

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts`

**Interfaces:**
- Consumes: transaction result JSON schema and `commitFoundationRemediationTransaction()`.
- Produces: exactly one structured document-author remediation terminal with a committed receipt.

- [ ] **Step 1: Replace old happy-path tests with failing structured-turn tests**

Require the remediation session start to carry `z.toJSONSchema(foundationRemediationResultSchema)`. Require the authority block to include exactly one target document, its body units and only conflicts whose `changes[].path` equals that target. Assert it excludes every other complete Foundation document.

Simulate one `result` event containing `structured_output`, then assert:

```ts
expect(terminal).toMatchObject({
  workerType: 'document-author',
  status: 'completed',
  writtenPaths: ['docs/GDD.md'],
  remediationReceipt: {
    targetPath: 'docs/GDD.md',
    patchedUnitIds: expect.any(Array),
  },
})
```

Assert remediation emits no `workflowMarkdownStreamContract`, no remediation-specific `--tools` argument, no resume session and no second submit. Assert malformed or missing structured output fails without changing the target.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
```

Expected: failures show the old remediation path still expects direct file mutation and no structured schema.

- [ ] **Step 3: Implement the single structured turn**

In `buildDocumentAuthorAuthorityBlock()`, read the accepted review, filter conflicts and evidence to the target path, read the target once and call `buildFoundationRemediationTransactionRequest()`. Serialize only that request.

When starting a remediation worker, set `workflowJsonSchema` to the result schema and set no Markdown stream contract. Keep the native runtime command unchanged except for receiving the existing generic `--json-schema` option; do not add a remediation `--tools`, allowlist or denylist.

In `createDeterministicStructuredTerminal()`, route only remediation document authors to a new `createDeterministicFoundationRemediationTerminal()`. It reads the sole structured result, commits it atomically and returns the receipt terminal. Initial and parallel document authoring continue through their existing raw Markdown stream path.

Delete:

- `changedRemediationPaths()`;
- remediation direct-file completion detection;
- remediation prompt language telling the Agent to repair files or use file tools;
- any remediation-specific tool inventory assertions or flags;
- any fallback from malformed structured output to current workspace bytes.

The replacement prompt states that the Agent authors replacement bodies and submits one contracted object; BGS validates and commits it.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the same four test files from Step 2. Expected: all pass and the native command contains no remediation-specific tool control.

- [ ] **Step 5: Commit wiring and old-path deletion**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
git commit -m "refactor: replace remediation edit loops with transactions"
```

---

### Task 4: Receipt-Driven Workflow State and One-Time Migration

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts`

**Interfaces:**
- Consumes: terminal `remediationReceipt` from Task 3.
- Produces: schema version 27 state whose completed lanes are proved only by transaction receipts.

- [ ] **Step 1: Write failing state, recovery and migration tests**

Change the expected receipt shape to:

```ts
type FoundationRemediationReceipt = {
  reviewDigest: string
  sourceRevision: string
  targetPath: FoundationDocumentPath
  sourceDigest: string
  patchedUnitIds: string[]
  finalDigest: string
  committedAt: string
}
```

Test that completion rejects a receipt with the wrong review, source revision, target, source digest, final digest, unit order or dispatch. Test the all-lane barrier and verification transition.

For schema 26 migration, prove:

- an unstarted lane becomes the equivalent pending/not-required version 27 lane;
- a failed lane remains failed with its exact reason;
- a running legacy lane becomes failed with `legacy remediation transaction must be restarted` and has no dispatch;
- a completed legacy lane in an active Foundation remediation becomes failed with `legacy remediation transaction must be restarted`, because its map receipt cannot prove patched body-unit identity;
- a run that already advanced beyond Foundation review drops its historical legacy remediation state after preserving its immutable workflow events;
- after migration, runtime dispatch contains no protocol selector or legacy receipt branch.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
```

Expected: receipt-shape and version assertions fail against schema 26 behavior.

- [ ] **Step 3: Implement receipt-only completion and migration**

Set `DELIVERY_RUN_SCHEMA_VERSION = 27`. Replace map-based baseline/receipt fields with `sourceDigest` and the exact transaction receipt. `recordFoundationRemediationDispatch()` freezes the target digest from the request. `commitFoundationRemediationReceipt()` accepts the terminal receipt and verifies equality with the lane authority instead of rereading mutation maps.

In `document-stage.ts`, remove Foundation calls to `commitRemediatedDocumentMetadata()`, `changed paths` derivation and before/after digest maps. Re-read the target, compare it with `terminal.remediationReceipt.finalDigest`, run the existing canonical readiness checks, record the receipt and enter the unchanged verification review only after all required lanes complete.

Keep historical schema parsing only inside the storage migration chain. Do not branch runtime behavior on schema version, missing fields or old authoring modes. Delete superseded remediation protocol selectors after migration returns the single version 27 shape.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run the same three test files. Expected: all pass, including fail-closed running legacy state.

- [ ] **Step 5: Commit state cutover**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
git commit -m "refactor: cut over remediation state to transaction receipts"
```

---

### Task 5: Remove Remaining Dual Track and Preserve Dashboard Tasks

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`
- Test: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`

**Interfaces:**
- Consumes: version 27 lane status and exact failure reasons.
- Produces: one visible remediation task per affected document with pending/running/completed/failed state.

- [ ] **Step 1: Write failing no-dual-track and dashboard tests**

Assert dispatch creates exactly one `foundation-remediation:<laneId>` request for each affected document and its contract contains one `foundationDocumentPath`, one source digest and no grouped paths. Assert the API/UI list contains one task per document, displays a check for completed receipts and displays the original transaction error for a failed lane.

Add repository scans to the focused test or verification script for removed phrases and functions:

```bash
rg -n "changedRemediationPaths|Apply every conflict change across exactly|repair files directly|beforeDigests|afterDigests" packages/agent-workflow-server/src/beegame
```

Expected after implementation: no runtime remediation match; migration fixtures may contain old serialized field names only where required to test schema 26 conversion.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
```

Expected: backend projections still expect legacy receipt fields or UI status lacks the new failure/receipt assertion.

- [ ] **Step 3: Delete remaining old branches and adapt the task projection**

Remove grouped remediation assumptions, direct-edit wording, legacy terminal selection and stale receipt fields from runtime/API projection. Keep the established tasks UI; adapt only its data projection so completed transaction receipts render as checked tasks and failures render exact error text. Do not add a second reviewer/remediation panel or expose raw transaction JSON to users.

- [ ] **Step 4: Run focused tests and repository scan**

Run the Step 2 tests and the `rg` command from Step 1. Expected: tests pass and only explicit schema-26 migration fixtures contain old serialized field names.

- [ ] **Step 5: Commit cleanup and dashboard continuity**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
git commit -m "refactor: remove legacy remediation runtime paths"
```

---

### Task 6: Full Automated Verification and Chrome Eight-Document Acceptance

**Files:**
- Create: `docs/acceptance/2026-08-17-foundation-remediation-section-transaction-acceptance.md`
- Evidence: project-local `.beegame` run logs, transaction receipts and token summaries from the fresh acceptance project.

**Interfaces:**
- Consumes: the only production transaction path from Tasks 1-5.
- Produces: objective correctness, latency and token evidence.

- [ ] **Step 1: Run the complete focused automated suite**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation-transaction.test.ts packages/agent-workflow-server/src/beegame/foundation-remediation-commit.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
bun run typecheck
git diff --check
```

Expected: all tests pass, typecheck exits 0 and diff-check prints nothing.

- [ ] **Step 2: Start fixed-port services and create a fresh acceptance project through Web/React**

Start the existing development command with its fixed allocation: frontend 62173, runtime 62174, billing 62175, skills 62176 and resources 62177. Using Chrome, copy the previously accepted eight-document source project; do not retry either partially remediated acceptance project.

- [ ] **Step 3: Run review, remediation and verification through the visible UI**

Observe the Dashboard tasks until review produces accepted conflicts, affected document transactions complete and verification returns READY or an actionable remaining conflict. Do not edit the test project to make it pass. Stop immediately on a repeated or systemic failure and compare code, events and raw logs before changing implementation.

- [ ] **Step 4: Audit correctness and runtime behavior**

For every affected document, verify:

- one model request and one structured result;
- zero remediation Read/Grep/Edit/Write tool calls;
- one committed receipt with matching source/final digests;
- unchanged bytes outside patched units;
- no partial staging artifact presented as completed;
- Dashboard task completion and exact failure visibility;
- verification review accounts for every prior conflict.

- [ ] **Step 5: Report token and time evidence**

Report per reviewer, per document remediation and verification synthesis:

- input tokens;
- cache-input tokens;
- output tokens;
- credit;
- elapsed time.

Compare remediation total with the 10.2 million baseline and the 3 million target. If correctness passes but the target fails, do not tune prompts or add tool controls. Stop and re-audit whether the single structured transaction is actually the executed production path.

- [ ] **Step 6: Record and commit acceptance evidence**

Write the exact project ID, run ID, revision, per-task usage table, elapsed time, receipt/digest checks, verification verdict and baseline comparison to `docs/acceptance/2026-08-17-foundation-remediation-section-transaction-acceptance.md`. After all automated and Chrome checks pass:

```bash
git add docs/acceptance/2026-08-17-foundation-remediation-section-transaction-acceptance.md
git commit -m "docs: record atomic remediation acceptance"
```

If acceptance exposes a systemic failure, do not write a passing report or make this commit. Stop, report the evidence and reassess the design before preparing a separate corrective plan.
