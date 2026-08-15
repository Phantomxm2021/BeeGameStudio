# Document Reviewer Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the retired packet-based document Reviewer and replace it with one project-local, report-based Reviewer that preserves automatic remediation and downstream workflow gates.

**Architecture:** Native specialist Reviewers write bounded Markdown reports inside the reviewed project. One Final Reviewer consolidates those reports and writes a minimal routing decision; Bee Game Studio validates paths, revision and file bytes, then mechanically routes `READY` or remediation without parsing review prose. The replacement becomes runnable only when the old Reviewer path is removed.

**Tech Stack:** TypeScript 6, Bun, Zod 4, native Agent read/write tools, SHA-256, React/Vitest, Web/React Chrome acceptance.

## Global Constraints

- Modify only Reviewer-specific implementation and its direct workflow/UI integration.
- Do not modify provider/model configuration, native Agent core, general logs, general permissions, document generation, resource production or atomic task planning.
- Store every report below `<workspacePath>/.beegame/reviews/<scope>/<revision>/`.
- Reviewer sessions may read contracted source paths and write only contracted report paths.
- Bee Game Studio must not create, summarize, deduplicate, repair or reinterpret review conclusions.
- Do not use MCP, terminal findings JSON, check packets, criteria, `referenceId`, a compatibility parser or a legacy Reviewer fallback.
- Preserve the workflow: review -> remediation -> re-review -> checklist -> resources -> complete review -> atomic task planning.
- After a source revision changes, perform a complete new review; do not inherit semantic results.
- Stop after three consecutive `NEEDS_REVISION` decisions for one scope.
- Stop implementation for architecture review when the same failure class occurs twice or a fix requires semantic parsing, a second terminal, source write access or a contradicted Chrome assumption.
- Web/React acceptance uses ports `62173` and `62174` and never mutates the frozen source project.

---

## File Structure

**Create**

- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.ts` — report paths, minimal decision schema and byte-bound acceptance.
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.test.ts` — decision/path/digest tests.
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.ts` — immutable specialist assignments per scope.
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.test.ts` — coverage and bounded-source tests.
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.ts` — report run creation, dispatch, acceptance, recovery and routing state.
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts` — orchestration and revision tests.

**Delete after replacement tests are green**

- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-check-schema.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-findings.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-input.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-input.test.ts`
- `docs/superpowers/plans/2026-08-05-comprehensive-review-packet-consolidation.md`
- `docs/superpowers/plans/2026-08-08-workflow-empty-terminal-recovery.md`

**Modify**

- `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- `packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.ts`
- `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- `packages/agent-workflow-server/src/beegame/native-workflow-result-tools.ts`
- `apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx`
- directly affected backend/frontend tests.

---

### Task 1: Define the Project-Local Report Contract

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.test.ts`

**Interfaces:**
- Produces: `DocumentReviewScope`, `DocumentReviewVerdict`, `DocumentReviewDecision`, `documentReviewDecisionSchema`, `reviewRevisionDirectory()`, `reviewStagingPath()`, `reviewPartPath()`, `reviewReportPath()`, `reviewDecisionPath()`, `acceptReviewDecision()`.
- Consumes: project workspace path and canonical revision digest only.

- [ ] **Step 1: Write failing path and decision tests**

```ts
test('places reports inside the active project revision', () => {
  expect(reviewReportPath('/project', 'foundation', 'a'.repeat(64))).toBe(
    '/project/.beegame/reviews/foundation/' + 'a'.repeat(64) + '/review.md',
  )
})

test('rejects a decision that escapes the project or targets another revision', async () => {
  await expect(acceptReviewDecision({
    workspacePath,
    scope: 'foundation',
    revision: 'a'.repeat(64),
    allowedAffectedPaths: ['docs/GDD.md'],
  })).rejects.toThrow('document review decision revision does not match')
})
```

- [ ] **Step 2: Run RED**

Run:
`bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement the minimal decision and path contract**

```ts
export type DocumentReviewScope = 'foundation' | 'checklist' | 'complete'
export type DocumentReviewVerdict = 'READY' | 'NEEDS_REVISION'

export const documentReviewDecisionSchema = z.object({
  version: z.literal(1),
  scope: z.enum(['foundation', 'checklist', 'complete']),
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
  verdict: z.enum(['READY', 'NEEDS_REVISION']),
  affectedPaths: z.array(z.string().min(1)).max(32),
  reportPath: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.verdict === 'READY' && value.affectedPaths.length)
    context.addIssue({ code: 'custom', path: ['affectedPaths'], message: 'READY cannot affect paths' })
  if (value.verdict === 'NEEDS_REVISION' && !value.affectedPaths.length)
    context.addIssue({ code: 'custom', path: ['affectedPaths'], message: 'NEEDS_REVISION requires affected paths' })
})
```

Resolve every returned path with `resolve()` and reject it unless it remains
below `resolve(workspacePath)`. Require `reportPath` to equal the canonical
project-relative report path for the active scope/revision. Read `review.md`,
compute SHA-256 from its bytes, and return the parsed decision plus digest.

- [ ] **Step 4: Run GREEN and typecheck**

Run:
`bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.test.ts`

Run: `bun run typecheck`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.test.ts
git commit -m "feat: define project-local review reports"
```

---

### Task 2: Define Bounded Reviewer Topology

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.test.ts`

**Interfaces:**
- Consumes: `DocumentReviewScope` and revision path helpers from Task 1.
- Produces: `DocumentReviewRole`, `DocumentReviewAssignment`, `documentReviewAssignments()` and `finalReviewAssignment()`.

- [ ] **Step 1: Write failing foundation coverage tests**

```ts
test('covers all foundation documents with five bounded roles', () => {
  const assignments = documentReviewAssignments('foundation', workspacePath, revision)
  expect(assignments.map(value => value.role)).toEqual([
    'gameplay', 'technical', 'experience', 'presentation', 'production',
  ])
  expect(new Set(assignments.flatMap(value => value.sourcePaths))).toEqual(
    new Set(CANONICAL_FOUNDATION_DOCUMENTS.map(path => resolve(workspacePath, path))),
  )
  expect(assignments.every(value => value.sourcePaths.length <= 3)).toBe(true)
  expect(assignments.every(value => value.stagingOutputPaths.length === 1)).toBe(true)
  expect(assignments.every(value => value.committedOutputPaths.length === 1)).toBe(true)
})
```

- [ ] **Step 2: Run RED**

Run:
`bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement literal assignments**

```ts
export type DocumentReviewAssignment = {
  role: string
  sourcePaths: string[]
  stagingOutputPaths: string[]
  committedOutputPaths: string[]
}

const FOUNDATION_ROLE_PATHS = {
  gameplay: ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md', 'docs/BALANCE_DESIGN.md'],
  technical: ['docs/GDD.md', 'docs/TECHNICAL_DESIGN.md', 'docs/ASSET_PLAN.md'],
  experience: ['docs/GDD.md', 'docs/ART_DIRECTION.md', 'docs/UI_UX_SPEC.md'],
  presentation: ['docs/GDD.md', 'docs/UI_UX_SPEC.md', 'docs/AUDIO_DESIGN.md'],
  production: ['docs/ART_DIRECTION.md', 'docs/AUDIO_DESIGN.md', 'docs/ASSET_PLAN.md'],
} as const
```

Checklist returns one assignment containing GDD, the checklist and the accepted
foundation report. Complete review returns bounded gameplay-acceptance,
technical-resource, experience-delivery and production-delivery assignments.
The Final Reviewer source list contains only committed part reports; cited
source paths are supplied separately as read-only verification paths.

- [ ] **Step 4: Add checklist/complete exact-set tests and run GREEN**

Run:
`bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.test.ts`

Expected: all assignments, paths and output locations match literal contracts.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.test.ts
git commit -m "feat: define bounded review roles"
```

---

### Task 3: Accept Markdown Reports as the Only Semantic Authority

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.test.ts`

**Interfaces:**
- Consumes: `DocumentReviewAssignment` from Task 2.
- Produces: `acceptSpecialistReport()` and `acceptFinalReport()`.

- [ ] **Step 1: Write failing report-integrity tests**

```ts
test('accepts only the assigned nonempty Markdown report', async () => {
  await writeFile(assignment.stagingOutputPaths[0], '# Technical review\n\n## Blocking findings\nNone.\n')
  const accepted = await acceptSpecialistReport({ assignment, workspacePath, revision })
  expect(accepted.path).toBe(relative(workspacePath, assignment.committedOutputPaths[0]))
  expect(accepted.digest).toMatch(/^[a-f0-9]{64}$/u)
})

test('rejects success when a source digest changed during review', async () => {
  await expect(acceptSpecialistReport({
    assignment, workspacePath, revision, currentRevision: 'b'.repeat(64),
  })).rejects.toThrow('canonical artifacts changed during document review')
})
```

- [ ] **Step 2: Run RED**

Expected: missing acceptance functions.

- [ ] **Step 3: Implement byte-bound report acceptance**

Require the exact assigned staging path, regular file, UTF-8 Markdown, at least
one non-heading content line, unchanged revision and no writes to source paths.
Atomically rename the accepted staged file to the exact committed path and
fsync its parent directory. Return only `{ role, path, digest }`. Do not parse
findings, headings or prose.

`acceptFinalReport()` requires all contracted part report digests, validates
`review.md`, then calls `acceptReviewDecision()` from Task 1.

- [ ] **Step 4: Run GREEN**

Run:
`bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.test.ts`

Expected: report/decision/path/revision tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.test.ts
git commit -m "feat: accept immutable review reports"
```

---

### Task 4: Replace Reviewer Prompt and Terminal Transport

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-workflow-result-tools.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-workflow-result-tools.test.ts`

**Interfaces:**
- Consumes: report assignments and acceptance functions from Tasks 2-3.
- Produces: file-derived `documentReviewerTerminalSchema` and report-only Reviewer dispatch behavior.

- [ ] **Step 1: Write failing worker-boundary tests**

```ts
test('does not expose SubmitDocumentReviewPacket', () => {
  expect(structuredSubmissionToolName('document-reviewer')).toBeUndefined()
})

test('derives Reviewer completion from committed files, not provider result text', async () => {
  sessions.events.mockReturnValue([{ type: 'result', text: 'anything' }])
  await writeFile(expectedReportPath, '# Gameplay review\n\nNo blocking issues.\n')
  await expect(port.waitForTerminal(dispatchId)).resolves.toMatchObject({
    workerType: 'document-reviewer', status: 'completed', role: 'gameplay',
    reportPaths: [relative(workspacePath, expectedReportPath)],
  })
})
```

- [ ] **Step 2: Run RED**

Run the four focused worker/session test files. Expected: old tool and old
terminal assertions fail.

- [ ] **Step 3: Replace the terminal contract**

```ts
export const documentReviewerTerminalSchema = base.extend({
  workerType: z.literal('document-reviewer'),
  status: z.literal('completed'),
  scope: z.enum(['foundation', 'checklist', 'complete']),
  role: z.string().min(1),
  reportPaths: z.array(z.string().min(1)).min(1).max(2),
  verdict: z.enum(['READY', 'NEEDS_REVISION']).optional(),
  affectedPaths: z.array(z.string().min(1)).optional(),
}).strict()
```

Specialist terminals contain one part report and no verdict. Final terminals
contain `review.md`, `decision.json`, verdict and affected paths accepted from
the files. Provider final text is diagnostic only.

- [ ] **Step 4: Replace Reviewer prompts and permissions**

The specialist prompt names exact source paths, exact output path and report
responsibility. The Final prompt names exact part reports, verification source
paths, final report and decision path. Enable native `Read`, `Grep`, `Glob` and
`Write`; use the existing permission hook to allow writes only to output paths.
Remove every Reviewer use of `SubmitDocumentReviewPacket` from
`native-workflow-result-tools.ts`.

- [ ] **Step 5: Run GREEN and typecheck**

Run:
`bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/beegame/native-workflow-result-tools.test.ts`

Run: `bun run typecheck`

- [ ] **Step 6: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/beegame/native-workflow-result-tools.ts packages/agent-workflow-server/src/beegame/native-workflow-result-tools.test.ts
git commit -m "refactor: deliver reviewer results as project reports"
```

---

### Task 5: Build the Minimal Review Run Orchestrator

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts`

**Interfaces:**
- Consumes: assignment and report acceptance APIs from Tasks 1-4.
- Produces: `DocumentReviewRun`, `createDocumentReviewRun()`, `buildDocumentReviewDispatches()`, `acceptDocumentReviewTerminal()`, `recoverDocumentReviewRun()`.

- [ ] **Step 1: Write failing state and orchestration tests**

```ts
test('dispatches at most three pending specialist roles concurrently', () => {
  const run = createDocumentReviewRun({ scope: 'foundation', revision })
  expect(buildDocumentReviewDispatches({ run, workspacePath })).toHaveLength(3)
})

test('dispatches the final Reviewer only after every specialist report commits', () => {
  const completed = foundationRunWithCompletedReports()
  expect(buildDocumentReviewDispatches({ run: completed, workspacePath })).toEqual([
    expect.objectContaining({ contract: expect.objectContaining({ reviewRole: 'final' }) }),
  ])
})
```

- [ ] **Step 2: Run RED**

Expected: new stage and state do not exist.

- [ ] **Step 3: Replace old state types with minimal operational state**

```ts
export type DocumentReviewReportState = {
  role: string
  path: string
  digest?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  dispatch?: DispatchRecord
  failureReason?: string
}

export type DocumentReviewRun = {
  scope: DocumentReviewScope
  revision: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  reports: DocumentReviewReportState[]
  finalReportPath?: string
  finalReportDigest?: string
  verdict?: DocumentReviewVerdict
  affectedPaths?: string[]
  attempt: number
  failureReason?: string
}
```

Replace `DocumentReviewState` with `{ activeRun?, approvals, attempts }`, where
each approval stores only scope, revision, final report path/digest and time.
Increment `DELIVERY_RUN_SCHEMA_VERSION` once.

- [ ] **Step 4: Implement deterministic dispatch/accept/recovery**

Use topology order for report states and idempotency. Preserve accepted sibling
reports only when revision and file digest still match. Any revision change
invalidates the whole run. A failed role remains failed until an explicit
workflow resume redispatches that role; there is no hidden API retry.

- [ ] **Step 5: Add old-state migration tests**

Incomplete persisted workflows at or beyond old review return to foundation
review on the current revision. Completed workflows remain completed. Assert
that migrated state contains no old checks, findings, cycle or closure mode.

- [ ] **Step 6: Run GREEN and commit**

Run the new stage test, schema evolution test and typecheck.

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts
git commit -m "feat: orchestrate project-local review reports"
```

---

### Task 6: Switch the Workflow and Remove the Old Reviewer

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/accepted-unit-journal.ts`
- Delete: old dedicated Reviewer files listed under File Structure.
- Test: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts`

**Interfaces:**
- Consumes: `document-review-stage.ts` from Task 5.
- Produces: the single runnable Reviewer path and unchanged downstream phase semantics.

- [ ] **Step 1: Replace old integration tests with report-flow tests**

Test this exact sequence:

```ts
const foundationReview = await startFoundationReview(eightDocumentRun)
const withParts = await completeAllSpecialists(foundationReview)
const blocked = await completeFinalReview(withParts, {
  verdict: 'NEEDS_REVISION', affectedPaths: ['docs/GDD.md'],
})
expect(blocked.phase).toBe('DOCUMENT_DRAFTING')
expect(blocked.documentReviewState.activeRun?.attempt).toBe(1)
```

Also assert `READY` foundation -> checklist drafting, checklist `READY` ->
resource preparation, and complete `READY` -> atomic task planning.

- [ ] **Step 2: Run RED**

Run the two focused workflow tests. Expected: old packet/cycle behavior differs.

- [ ] **Step 3: Replace stage/controller/dispatch integration**

Delegate Reviewer creation, dispatch, terminal acceptance and recovery to the
new stage. Idempotency uses
`runId:scope:revision:role:attempt`. Delete packet cursor, closure mode,
accepted-check merge and finding-ledger branches.

- [ ] **Step 4: Remove old dedicated files and imports**

Delete the three old production modules and their tests. Remove old types,
schemas, prompts, native tool wiring and journal entries. Do not leave feature
flags, fallback branches or unused exports.

- [ ] **Step 5: Run focused workflow tests, typecheck and diff check**

Run:
`bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts`

Run: `bun run typecheck`

Run: `git diff --check`

- [ ] **Step 6: Architecture reflection checkpoint**

Inspect failures before fixing. If two failures require reconstructing old
check/finding semantics, stop and revise the design instead of adding an
adapter.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-workflow-server/src
git commit -m "refactor: replace packet reviewer with report workflow"
```

---

### Task 7: Reconnect Remediation Without a Finding Ledger

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: directly affected document-author tests.

**Interfaces:**
- Consumes: final report path, affected paths and attempt from `DocumentReviewRun`.
- Produces: report-based repair planning, owned document edits and complete re-review.

- [ ] **Step 1: Write failing remediation tests**

```ts
test('gives remediation the persisted report without projecting findings', () => {
  const dispatch = buildFoundationRemediationDispatch(blockedRun)
  expect(dispatch.contract.remediation).toEqual({
    reviewReportPath: blockedRun.documentReviewState.activeRun!.finalReportPath,
    affectedPaths: ['docs/GDD.md', 'docs/BALANCE_DESIGN.md'],
    sourceRevision: blockedRun.documentReviewState.activeRun!.revision,
  })
  expect(dispatch.contract.remediation).not.toHaveProperty('findings')
})
```

- [ ] **Step 2: Run RED**

Expected: current remediation requires findings and repair groups.

- [ ] **Step 3: Implement report-based remediation**

The native remediation planner reads `review.md` and writes a project-local
repair plan. Document authors receive the plan and may write only affected
owned paths. Bee Game Studio validates affected paths against canonical path
ownership but does not parse repair prose.

After edits commit, calculate a new revision and create a new full Review Run.
Do not carry part reports, verdicts or affected paths into the new revision.

- [ ] **Step 4: Enforce attempt limit**

On the third consecutive `NEEDS_REVISION` for the same scope, set
`status: 'needs_action'`, preserve the latest final report and dispatch no
further repair Agent.

- [ ] **Step 5: Run remediation/recovery tests and commit**

Run the focused document-stage, session-port and recovery suites, then
typecheck.

```bash
git add packages/agent-workflow-server/src
git commit -m "refactor: drive document remediation from review reports"
```

---

### Task 8: Project Report Progress and Markdown in Web/React

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.ts`
- Modify: relevant backend display tests.
- Modify: `apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`

**Interfaces:**
- Consumes: operational `DocumentReviewRun` and persisted final report.
- Produces: role progress, verdict, affected paths, Markdown report link/content and original failure.

- [ ] **Step 1: Write failing projection/UI tests**

```ts
expect(projectWorkflowCard(run)).toMatchObject({
  review: {
    verdict: 'NEEDS_REVISION',
    affectedPaths: ['docs/GDD.md'],
    reportPath: expect.stringContaining('/review.md'),
    roles: [expect.objectContaining({ role: 'gameplay', status: 'completed' })],
  },
})
```

Render the card and assert the Markdown finding text, affected document label
and exact backend failure are visible. Assert old criterion/check labels are
absent.

- [ ] **Step 2: Run RED**

Run backend display tests and frontend `WorkflowCard.test.tsx` from
`apps/frontend`.

- [ ] **Step 3: Implement operational projection and rendering**

Project only stored operational fields and persisted Markdown. Do not derive a
summary from report text. Remove old check packet and finding ledger UI.

- [ ] **Step 4: Run GREEN and commit**

Run:
`bun test packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.test.ts`

Run from `apps/frontend`:
`bun run test:run -- src/components/Demiurge/WorkflowCard.test.tsx`

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow apps/frontend/src/components/Demiurge
git commit -m "feat: display project-local review reports"
```

---

### Task 9: Prove Runtime Removal and Full Workflow Behavior

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-workflow-result-tools.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts`
- Modify: affected backend integration and idea-to-complete tests.
- Delete: `docs/superpowers/plans/2026-08-05-comprehensive-review-packet-consolidation.md`
- Delete: `docs/superpowers/plans/2026-08-08-workflow-empty-terminal-recovery.md`

**Interfaces:**
- Consumes: final replacement system.
- Produces: runtime rejection of retired contracts and full automated workflow evidence.

- [ ] **Step 1: Add runtime legacy-rejection tests**

Assert the production terminal parser rejects an old packet terminal, the
native tool catalog has no document-review submission tool, and persisted old
cycle/check/finding state is migrated to a new pending report run rather than
executed. These tests exercise public runtime boundaries; they do not grep
source text.

- [ ] **Step 2: Add full simulated workflow tests**

Cover foundation block/repair/re-review/pass, checklist pass, resource pass,
complete pass and atomic planning. Cover failed specialist resume, revision
invalidation, malformed decision and third-attempt stop.

- [ ] **Step 3: Run the complete backend/frontend suites**

Run:
`bun test packages/agent-workflow-server/src/beegame/delivery-workflow packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts packages/agent-workflow-server/src/__tests__/idea-to-complete-documents.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`

Run: `bun run typecheck`

Run from `apps/frontend`: `bun run test:run`

Run: `git diff --check`

Run the following as an explicit removal audit, not as a test:

```bash
rg -n "SubmitDocumentReviewPacket|DOCUMENT_REVIEW_CHECK_PACKETS|GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA|acceptedSemanticResult" packages/agent-workflow-server/src apps/frontend/src
```

Expected: no production-code matches. Historical comments in retained evidence
documents are outside this command's scope.

- [ ] **Step 4: Delete obsolete Reviewer documents and commit**

Keep the approved 2026-08-16 design and this implementation plan. Delete only
the two old Reviewer plans listed above. Do not delete broader workflow
specifications or historical engineering reviews that merely mention document
review.

```bash
git add packages apps docs/superpowers
git commit -m "test: prove single-track report reviewer"
```

---

### Task 10: Web/React Chrome Acceptance

**Files:**
- Do not modify the frozen source project.
- Persist acceptance logs and measurements in the acceptance project and an evidence document under `docs/superpowers/evidence/`.

**Interfaces:**
- Consumes: finished Reviewer implementation and fixed ports.
- Produces: real workflow evidence for behavior, report quality, time and token efficiency.

- [ ] **Step 1: Record frozen hashes and create the acceptance copy through Web/React**

Record SHA-256 for all eight source documents. Use Chrome through the Web/React
surface to create or select a project-local acceptance copy. Do not edit the
frozen source project.

- [ ] **Step 2: Start fixed services and run foundation review**

Use frontend `62173` and runtime `62174`. Start review from the dashboard. Do
not use direct API acceptance as a substitute.

- [ ] **Step 3: Stop on the first real failure and inspect raw logs**

If a role fails, stop the workflow. Preserve `agent.raw.jsonl`, runtime logs,
API error, report files and usage snapshot. Classify whether the failed design
assumption is transport, permission, source scope, persistence or model
behavior. Do not retry before the root cause is identified.

- [ ] **Step 4: Verify report quality and integrity**

Confirm five specialist reports, final report and decision exist under the
acceptance project. Confirm source hashes did not change during review. Audit
the final report for actionable line evidence, correct responsibility, useful
required outcomes, readability for humans and suitability for repair Agents.

- [ ] **Step 5: Verify remediation and re-review on the acceptance copy**

If the decision is `NEEDS_REVISION`, allow the acceptance copy to execute the
declared repair. Verify only affected owned paths changed, revision changed and
a new complete review directory was created. Stop after proving the new review
started; do not alter the frozen source project.

- [ ] **Step 6: Measure efficiency**

Record fresh input, cache input, output, credit and elapsed wall time from the
review start to final decision. Foundation review must complete with no more
than approximately 1.03 million incremental tokens, half the measured
incomplete seventeen-task attempt.

- [ ] **Step 7: Run the final reflection gate**

If Chrome contradicts a core assumption or the same failure class occurs twice,
do not patch. Update the design with the invalid assumption and obtain renewed
approval before implementation continues.

- [ ] **Step 8: Commit acceptance evidence**

```bash
git add docs/superpowers/evidence
git commit -m "docs: record report reviewer chrome acceptance"
```

---

## Final Completion Gate

Do not declare completion until all of the following are true:

- old Reviewer symbols and files are absent from production code;
- backend, frontend and typecheck suites pass;
- the only runnable Reviewer writes project-local reports;
- automatic remediation and re-review work from persisted reports;
- Web/React Chrome acceptance completes on fixed ports;
- frozen source hashes remain unchanged;
- report quality and token/time measurements are recorded;
- `git diff --check` is clean;
- the worktree contains no unrelated tracked changes.
