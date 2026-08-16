# Document Reviewer Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five-role Foundation review with three complete coverage domains, persist per-role raw usage, and show the new topology and raw usage in the Dashboard without changing Reviewer integrity or Bee Game Studio's semantic boundary.

**Architecture:** Keep the current report-based Reviewer, immutable project-local Markdown reports, file-derived terminal, revision verification and Final Reviewer. Change only the Foundation assignment table and report prompt, persist the already-computed mechanical `reviewerPerformance` on each report state, and project those fields to the existing workflow card. Complete review and checklist review remain unchanged.

**Tech Stack:** TypeScript, Bun tests, Zod, React, Vitest, Testing Library, existing Bee Game Studio workflow store and Web/React Chrome acceptance.

## Global Constraints

- Do not modify native Agent core code, Write/Edit tools or context management.
- Do not add MCP, a Reviewer submission tool, structured finding packets, server-side semantic parsing or report truncation.
- Keep one Reviewer path only; do not add a feature flag or compatibility execution lane.
- Foundation roles are exactly `core-systems`, `player-experience`, `production-delivery`, followed by `final`.
- Keep the existing concurrency cap of three and existing revision, digest, permission, recovery and routing behavior.
- Dashboard shows only raw input, cache input and output token categories; no weighted token value.
- Chrome acceptance uses the existing fixed ports and stops after the final Foundation report.

---

## File structure

- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.ts`: owns the static three-domain Foundation source matrix.
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.test.ts`: proves exact role/source coverage and unchanged checklist/complete topology.
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.ts`: detects a stale/incompatible active role set and restarts it on the same revision.
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts`: proves three-way dispatch, final sequencing and stale five-role reset.
- `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`: defines dense Markdown responsibilities for specialists and Final Reviewer.
- `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`: rejects duplicated narrative/report-summary instructions.
- `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`: stores optional mechanical duration and raw usage per accepted report.
- `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`: validates persisted report metrics.
- `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`: attaches already-computed Reviewer performance to the matching report before committing state.
- `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`: proves metrics survive persistence/recovery and parallel completions stay isolated.
- `packages/agent-workflow-server/src/app.ts`: projects role metrics and review totals to Web/React.
- `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`: proves the API returns raw role and total Reviewer metrics.
- `apps/frontend/src/types/message.ts`: defines role/review metric display types.
- `apps/frontend/src/viewModels/displayModels.ts`: validates raw metric projections without reconstructing missing history.
- `apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx`: renders product role labels and Reviewer-only usage rows.
- `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`: proves labels, raw usage, unavailable history and unchanged non-Reviewer cards.
- `docs/superpowers/reviews/2026-08-16-document-reviewer-efficiency-chrome-acceptance.md`: records the final Chrome evidence and budget outcome.

---

### Task 1: Replace Foundation topology and fail closed on stale role sets

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts`

**Interfaces:**
- Consumes: `documentReviewAssignments({ scope, workspacePath, revision })` and `createDocumentReviewRun(...)`.
- Produces: Foundation reports for `core-systems`, `player-experience`, `production-delivery`, `final`; `normalizeDocumentReviewTopology(run, workspacePath)` or an equivalent focused helper used before dispatch/recovery.

- [ ] **Step 1: Write failing exact-topology and coverage tests**

```ts
test('assigns the three complete Foundation review domains', () => {
  const assignments = documentReviewAssignments({
    scope: 'foundation',
    workspacePath: '/project',
    revision: REVISION,
  })
  expect(assignments.map(value => value.role)).toEqual([
    'core-systems',
    'player-experience',
    'production-delivery',
  ])
  expect(relativeSources(assignments[0])).toEqual([
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
    'docs/TECHNICAL_DESIGN.md',
  ])
})

test('covers every Foundation document without sample-specific routing', () => {
  const covered = new Set(assignments.flatMap(value => relativeSources(value)))
  expect([...CANONICAL_FOUNDATION_DOCUMENTS].every(path => covered.has(path))).toBe(true)
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts
```

Expected: old `gameplay`, `technical`, `experience`, `presentation`, `production` role expectations fail.

- [ ] **Step 3: Replace only the Foundation role table**

```ts
const FOUNDATION_ROLE_PATHS = {
  'core-systems': [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
    'docs/TECHNICAL_DESIGN.md',
  ],
  'player-experience': [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/ART_DIRECTION.md',
    'docs/UI_UX_SPEC.md',
    'docs/AUDIO_DESIGN.md',
  ],
  'production-delivery': [
    'docs/TECHNICAL_DESIGN.md',
    'docs/ART_DIRECTION.md',
    'docs/AUDIO_DESIGN.md',
    'docs/ASSET_PLAN.md',
  ],
} as const
```

Update `DocumentReviewRole` to remove the five retired Foundation role names and add the three domain names. Do not alter checklist or complete roles.

- [ ] **Step 4: Add stale-role-set reset before dispatch**

The helper compares the persisted non-final report roles to the exact current assignment roles. If they differ and the run is incomplete, return a new `createDocumentReviewRun` for the same scope/revision/attempt instead of converting reports.

```ts
export function normalizeDocumentReviewTopology(input: {
  run: DocumentReviewRun
  workspacePath: string
}): DocumentReviewRun {
  const expected = assignmentsForRun(input.run, input.workspacePath)
    .map(value => value.role)
    .sort(bytewiseCompare)
  const actual = input.run.reports
    .filter(value => value.role !== 'final')
    .map(value => value.role)
    .sort(bytewiseCompare)
  if (stableValue(actual) === stableValue(expected)) return input.run
  if (input.run.status === 'completed') return input.run
  return createDocumentReviewRun({
    scope: input.run.scope,
    revision: input.run.revision,
    attempt: input.run.attempt,
    ...(input.run.approvedFoundationRevision
      ? { approvedFoundationRevision: input.run.approvedFoundationRevision }
      : {}),
  })
}
```

Use the repository's existing bytewise/stable helper rather than `localeCompare`. Call the normalization at the controller boundary before building dispatches and in recovery before accepting persisted active work.

- [ ] **Step 5: Run focused and controller/recovery tests**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-controller-review.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
```

Expected: PASS, with exactly three concurrent Foundation specialists and no conversion of completed historical reports.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts
git commit -m "refactor: consolidate foundation review domains"
```

---

### Task 2: Make report authorship production-dense without server semantics

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

**Interfaces:**
- Consumes: `workerTaskPrompt(request)` with `contract.reviewRole`.
- Produces: specialist and Final Reviewer Markdown instructions; no new tool or structured contract.

- [ ] **Step 1: Write failing prompt-contract tests**

```ts
test('requires one dense evidence row per specialist finding', () => {
  const prompt = workerTaskPrompt(foundationReviewerRequest('core-systems'))
  expect(prompt).toContain('one finding row')
  expect(prompt).toContain('owner path')
  expect(prompt).toContain('required outcome')
  expect(prompt).toContain('Do not reproduce source sections')
})

test('makes final consolidation deduplicated instead of a report recap', () => {
  const prompt = workerTaskPrompt(foundationReviewerRequest('final'))
  expect(prompt).toContain('deduplicated owner-grouped blocking register')
  expect(prompt).toContain('Do not restate each specialist report')
})
```

- [ ] **Step 2: Run the test and verify RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
```

- [ ] **Step 3: Replace the generic Reviewer prose with role-aware dense Markdown responsibility**

Keep the current source/output/path instructions. Add one static responsibility sentence for each of the three roles, followed by the shared table contract. The Final Reviewer gets the consolidated register contract. Do not add byte or finding-count limits.

- [ ] **Step 4: Prove no new transport or semantic parser exists**

```bash
rg -n "SubmitDocumentReviewPacket|structured finding|review finding parser|MCP" packages/agent-workflow-server/src/beegame --glob '!**/*.test.*'
```

Expected: no retired Reviewer submission path or new semantic parser.

- [ ] **Step 5: Run prompt, worker and report tests**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
git commit -m "fix: focus reviewer reports on production evidence"
```

---

### Task 3: Persist and project exact per-role Reviewer usage

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`

**Interfaces:**
- Produces on `DocumentReviewReportState`: `durationMs?: number`, `usage?: WorkflowUsage`.
- Produces on API `documentReview`: role metrics and `usage: { input_tokens, cache_read_tokens, completion_tokens }`, plus `elapsedMs`.

- [ ] **Step 1: Write failing persistence and API projection tests**

```ts
expect(completedReport).toMatchObject({
  durationMs: 12_000,
  usage: {
    input_tokens: 120,
    cache_read_tokens: 340,
    cache_creation_tokens: 0,
    completion_tokens: 56,
    total_tokens: 516,
  },
})

expect(response.documentReview).toMatchObject({
  elapsedMs: 20_000,
  usage: {
    input_tokens: 220,
    cache_read_tokens: 640,
    completion_tokens: 96,
  },
})
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
```

- [ ] **Step 3: Add strict optional persisted metric fields**

```ts
export type DocumentReviewReportState = {
  // existing fields
  durationMs?: number
  usage?: WorkflowUsage
}
```

The Zod schema accepts only finite non-negative `durationMs` and the existing strict `workflowUsageSchema`.

- [ ] **Step 4: Attach performance before committing the completed dispatch**

Compute `reviewerPerformance` before `withReviewerDispatch`. Pass its mechanical `durationMs` and `usage` into a focused `withReviewerPerformance` or extend `withReviewerDispatch` with an optional metrics argument. Do not derive usage from report bytes.

- [ ] **Step 5: Project deterministic totals**

In `documentReviewForDisplay`, include each report's metrics when valid. Sum only persisted role usage fields. Calculate wall elapsed as `max(finishedAt) - min(startedAt)` across report dispatches; do not sum parallel durations. If no persisted role metrics exist, omit review totals.

- [ ] **Step 6: Run persistence, route and full backend tests**

```bash
bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
bun test packages/agent-workflow-server/src
```

- [ ] **Step 7: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
git commit -m "feat: persist reviewer role usage"
```

---

### Task 4: Update the Dashboard for three domains and raw Reviewer usage

**Files:**
- Modify: `apps/frontend/src/types/message.ts`
- Modify: `apps/frontend/src/viewModels/displayModels.ts`
- Modify: `apps/frontend/src/viewModels/displayModels.test.ts`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`
- Modify: `apps/frontend/src/i18n/locales/en.json`
- Modify: `apps/frontend/src/i18n/locales/zh.json`

**Interfaces:**
- Consumes: backend `documentReview.reports[].durationMs/usage`, `documentReview.elapsedMs/usage`.
- Produces: product labels and Reviewer-only input/cache/output/duration display.

- [ ] **Step 1: Write failing normalization and rendering tests**

```tsx
expect(screen.getByText('核心系统')).toBeInTheDocument()
expect(screen.getByText('输入 120')).toBeInTheDocument()
expect(screen.getByText('缓存输入 340')).toBeInTheDocument()
expect(screen.getByText('输出 56')).toBeInTheDocument()
expect(screen.getByText('总计 · 输入 220 · 缓存输入 640 · 输出 96')).toBeInTheDocument()
expect(screen.queryByText(/计权/)).not.toBeInTheDocument()
```

Keep the existing test that a non-Reviewer workflow card does not render token usage.

- [ ] **Step 2: Run frontend tests and verify RED**

```bash
cd apps/frontend
./node_modules/.bin/vitest run src/viewModels/displayModels.test.ts src/components/Demiurge/WorkflowCard.test.tsx
```

- [ ] **Step 3: Add strict display types and normalization**

```ts
export interface WorkflowReviewUsage {
  input_tokens: number
  cache_read_tokens: number
  completion_tokens: number
}
```

Reject negative, non-finite or partial usage objects rather than filling missing historical values with zero.

- [ ] **Step 4: Render the Reviewer role rows and total**

Use static labels for the three domain IDs and `final`. Show role duration and raw usage only when present. Preserve exact failure reasons and the existing final Markdown panel.

- [ ] **Step 5: Run frontend tests and typecheck**

```bash
cd apps/frontend
./node_modules/.bin/vitest run src/viewModels/displayModels.test.ts src/components/Demiurge/WorkflowCard.test.tsx
cd ../..
bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/types/message.ts apps/frontend/src/viewModels/displayModels.ts apps/frontend/src/viewModels/displayModels.test.ts apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx apps/frontend/src/i18n/locales/en.json apps/frontend/src/i18n/locales/zh.json
git commit -m "feat: show reviewer domains and raw usage"
```

---

### Task 5: Verify the final code and perform Web/React Chrome acceptance

**Files:**
- Create: `docs/superpowers/reviews/2026-08-16-document-reviewer-efficiency-chrome-acceptance.md`

**Interfaces:**
- Consumes: final code, fixed-port Web/React services, isolated review-copy route and native transcripts.
- Produces: measured quality/performance acceptance evidence; no sample-specific production behavior.

- [ ] **Step 1: Run the complete automated gate**

```bash
bun test packages/agent-workflow-server/src
cd apps/frontend
./node_modules/.bin/vitest run src/viewModels/displayModels.test.ts src/components/Demiurge/WorkflowCard.test.tsx
cd ../..
bun run typecheck
git diff --check
```

- [ ] **Step 2: Start all services on the established fixed ports**

Use frontend `62173`, runtime `62174`, billing `62175`, skills `62176` and resources `62177`. Preserve the user's configured model and permission settings.

- [ ] **Step 3: Create a fresh review copy through Web/React Chrome**

Use the already accepted eight-document source project. Confirm the copy is a new project and source hashes remain unchanged.

- [ ] **Step 4: Observe exactly three concurrent domains and one Final Reviewer**

Do not use API-only acceptance. Capture visible role labels, statuses, exact errors, final verdict, affected paths, final Markdown and Dashboard raw usage.

- [ ] **Step 5: Stop immediately after the Foundation final report**

Do not allow remediation, checklist, resources or implementation to contaminate the Foundation Reviewer measurements.

- [ ] **Step 6: Audit transcript and report evidence**

Record per-role and total input/cache/output, wall elapsed, report bytes, source hash comparison, substantive defect coverage, duplicates, false blockers and readability. Compare Dashboard totals byte-for-byte/numerically with transcript-derived totals.

- [ ] **Step 7: Apply the architecture reflection gate**

If any budget or quality gate fails, stop. Do not add retries, watchdogs, report truncation, source coverage reduction or server semantic parsing. Identify the responsible read/tool/output flow and revise the design explicitly.

- [ ] **Step 8: Commit acceptance evidence**

```bash
git add docs/superpowers/reviews/2026-08-16-document-reviewer-efficiency-chrome-acceptance.md
git commit -m "docs: record efficient reviewer chrome acceptance"
```

---

## Plan self-review

- Every design requirement maps to one task.
- Foundation topology changes once; checklist and complete topology are untouched.
- No implementation step introduces native-core changes, semantic parsing, report truncation, provider retries or dual execution.
- Dashboard usage comes only from persisted role deltas and omits unavailable history.
- Automated tests precede implementation in every code task.
- Chrome acceptance measures final code and stops before remediation.
