# Workflow Stage Card Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the live-only workflow card with a durable old-to-current deck whose completed cards preserve full stage content and whose current card remains live and draggable.

**Architecture:** Freeze completed stage-card projections into the existing append-only workflow event journal at the same commit boundary that advances the durable run. Rebuild `stageSnapshots` by reducing those frozen events and appending the live current projection, then let a focused frontend deck component handle selection, arrows, keyboard navigation, auto-follow, and pointer gestures while the extracted stage-card renderer keeps existing content behavior.

**Tech Stack:** TypeScript, Bun test, Zod 4, React 19, Vitest, Testing Library, Framer Motion, Tailwind CSS.

---

## File map

- Create `packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.ts`: semantic stage-card projection, frozen-event validation, history reduction, and per-stage timing.
- Create `packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.test.ts`: unit coverage for projection, freezing, deduplication, regression truncation, and active timing.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`: attach a frozen previous-stage card to the ordinary journal event when a commit crosses display-stage boundaries.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/accepted-unit-journal.test.ts`: prove snapshot/event atomicity and idempotent reload behavior.
- Modify `packages/agent-workflow-server/src/app.ts`: build the public `stageSnapshots` array from durable events plus the live run and reuse the same projection for the top-level current card.
- Modify `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`: verify the workflow route exposes reached cards only and keeps the newest card live.
- Modify `apps/frontend/src/types/message.ts`: add the normalized stage snapshot contract.
- Modify `apps/frontend/src/viewModels/displayModels.ts`: normalize nested stage snapshots through the same field rules as the current card.
- Modify `apps/frontend/src/viewModels/displayModels.test.ts`: cover valid snapshots, malformed entries, ordering, and the single-card fallback.
- Create `apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx`: extracted single-stage renderer containing the current card content and action UI.
- Create `apps/frontend/src/components/Demiurge/useWorkflowCardDeck.ts`: selected-stage identity, auto-follow reconciliation, navigation bounds, pointer-axis intent, velocity/distance decision, and reduced-motion state.
- Create `apps/frontend/src/components/Demiurge/useWorkflowCardDeck.test.tsx`: deterministic hook tests for selection and gestures.
- Modify `apps/frontend/src/components/Demiurge/WorkflowCard.tsx`: deck shell, stepped layers, counter, arrows, keyboard semantics, and compatibility adaptation.
- Modify `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`: deck rendering, frozen history, action ownership, arrows, keyboard, drag, nested interaction, and compatibility tests.

## Task 1: Add the semantic stage-card projector and history reducer

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.ts:1-106`

- [ ] **Step 1: Write failing projector and reducer tests**

Create tests with generic workflow fixtures rather than product-specific copy:

```ts
import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import type { DeliveryRun, WorkflowEvent } from './types'
import {
  freezePreviousStageCard,
  projectCurrentStageCard,
  projectWorkflowStageCardHistory,
} from './workflow-stage-card-history'
import { transitionDeliveryRun } from './transition'

const workspacePath = process.cwd()

describe('workflow stage card history', () => {
  test('freezes the previous display stage when the next stage is entered', () => {
    const base = createTestDeliveryRun({
      projectId: 'project-stage-history',
      ownerId: 'owner-stage-history',
    })
    const previous: DeliveryRun = { ...base, phase: 'BRIEF_CONFIRMED' }
    const next = transitionDeliveryRun(previous, { type: 'documents_ready' })
    const frozen = freezePreviousStageCard({
      previous,
      next,
      workspacePath,
      stageStartedAt: previous.createdAt,
      stageEndedAt: next.updatedAt,
      elapsedMs: 250,
    })

    expect(frozen).toMatchObject({
      stageId: 'BRIEF_CONFIRMED',
      phaseIndex: 1,
      status: 'completed',
      elapsedMs: 250,
      completedAt: next.updatedAt,
    })
  })

  test('does not freeze an intra-stage substage update', () => {
    const base = createTestDeliveryRun({
      projectId: 'project-same-stage',
      ownerId: 'owner-same-stage',
    })
    const previous: DeliveryRun = {
      ...base,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
    }
    expect(
      freezePreviousStageCard({
        previous,
        next: { ...previous, currentMessage: 'durable progress' },
        workspacePath,
        stageStartedAt: previous.createdAt,
        stageEndedAt: previous.updatedAt,
        elapsedMs: 0,
      }),
    ).toBeUndefined()
  })

  test('keeps the latest frozen value per stage and omits stages after current', () => {
    const base = createTestDeliveryRun({
      projectId: 'project-regressed',
      ownerId: 'owner-regressed',
    })
    const current: DeliveryRun = {
      ...base,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
    }
    const cards = projectWorkflowStageCardHistory({
      run: current,
      workspacePath,
      events: [
        frozenEvent(1, 'BRIEF_CONFIRMED'),
        frozenEvent(2, 'DOCUMENT_DRAFTING'),
        frozenEvent(2, 'DOCUMENT_DRAFTING', { message: 'latest frozen value' }),
        frozenEvent(8, 'IMPLEMENTATION'),
      ],
      now: current.updatedAt,
    })

    expect(cards.map(card => card.phaseIndex)).toEqual([1, 2, 3])
    expect(cards[1]?.message).toBe('latest frozen value')
    expect(cards.at(-1)?.stageId).toBe('DOCUMENT_REVIEW')
  })
})

function frozenEvent(
  phaseIndex: number,
  stageId: 'BRIEF_CONFIRMED' | 'DOCUMENT_DRAFTING' | 'IMPLEMENTATION',
  overrides: Record<string, unknown> = {},
): WorkflowEvent {
  const createdAt = `2026-08-06T00:00:0${Math.min(phaseIndex, 9)}.000Z`
  return {
    eventId: `event-${phaseIndex}-${String(overrides.message ?? 'base')}`,
    runId: 'run-stage-history',
    type: 'phase.entered',
    phase: stageId,
    status: 'running',
    revision: { document: 'document-revision', workspace: 'workspace-revision' },
    createdAt,
    stageSnapshot: {
      stageId,
      phaseIndex,
      phaseCount: 11,
      status: 'completed',
      currentPhase: stageId,
      tasks: [],
      completedTaskCount: 0,
      totalTaskCount: 0,
      createdAt,
      updatedAt: createdAt,
      completedAt: createdAt,
      elapsedMs: 0,
      ...overrides,
    },
  }
}
```

- [ ] **Step 2: Run the test and confirm the module is absent**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.test.ts
```

Expected: FAIL because `workflow-stage-card-history.ts` does not exist.

- [ ] **Step 3: Export the semantic progress-stage identity**

Update `display-progress.ts` so callers receive the server-owned stage identifier without inferring it from labels:

```ts
export type DeliveryProgressStage = (typeof DELIVERY_PROGRESS_STAGES)[number]

export type DeliveryProgress = {
  stageId: DeliveryProgressStage
  phaseIndex: number
  phaseCount: number
  substage?: DeliveryProgressSubstage
  convergencePass?: number
}

export function projectDeliveryProgress(
  workflow: Record<string, unknown>,
): DeliveryProgress | undefined {
  // Keep the existing semantic branch logic.
  // Return stageId together with the existing numeric/substage fields.
  return {
    stageId: progressStage,
    phaseIndex: DELIVERY_PROGRESS_STAGES.indexOf(progressStage) + 1,
    phaseCount: DELIVERY_PROGRESS_STAGES.length,
    ...(substage ? { substage } : {}),
    ...(convergencePass ? { convergencePass } : {}),
  }
}
```

Update the existing expectations in `display-progress.test.ts` to include `stageId` for every projection.

- [ ] **Step 4: Implement the stage-card data contract and pure reducer**

Create `workflow-stage-card-history.ts` with explicit structural validation; do not recognize stages from titles or messages:

```ts
import type { WorkflowEvent, DeliveryRun } from './types'
import {
  DELIVERY_PROGRESS_STAGES,
  projectDeliveryProgress,
  type DeliveryProgressStage,
  type DeliveryProgressSubstage,
} from './display-progress'

export type WorkflowStageCardTask = {
  id: string
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'stopped'
  operation?: 'write' | 'review' | 'produce' | 'assemble'
  attempt?: number
  failureReason?: string
}

export type WorkflowStageCardSnapshot = {
  stageId: DeliveryProgressStage
  phaseIndex: number
  phaseCount: number
  status: DeliveryRun['status']
  currentPhase: string
  substage?: DeliveryProgressSubstage
  convergencePass?: number
  documentStep?: string
  reviewMode?: 'initial' | 'closure'
  reviewTarget?: 'foundation' | 'checklist' | 'resource'
  worker?: string
  message?: string
  executionStatus?: string
  currentItemId?: string
  tasks: WorkflowStageCardTask[]
  completedTaskCount: number
  totalTaskCount: number
  createdAt: string
  updatedAt: string
  completedAt?: string
  elapsedMs: number
  activeSince?: string
  block?: { message: string; nextAction?: string }
}

export type FrozenWorkflowStageCardEvent = WorkflowEvent & {
  stageSnapshot: WorkflowStageCardSnapshot
}

export function isWorkflowStageCardSnapshot(
  value: unknown,
): value is WorkflowStageCardSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const card = value as Partial<WorkflowStageCardSnapshot>
  return (
    DELIVERY_PROGRESS_STAGES.includes(card.stageId as DeliveryProgressStage) &&
    Number.isInteger(card.phaseIndex) &&
    card.phaseIndex === DELIVERY_PROGRESS_STAGES.indexOf(card.stageId as DeliveryProgressStage) + 1 &&
    Array.isArray(card.tasks) &&
    typeof card.createdAt === 'string' &&
    typeof card.updatedAt === 'string' &&
    Number.isFinite(card.elapsedMs)
  )
}

export function isFrozenWorkflowStageCardEvent(
  event: WorkflowEvent,
): event is FrozenWorkflowStageCardEvent {
  return isWorkflowStageCardSnapshot(event.stageSnapshot)
}

export function lastStageBoundaryAt(
  runCreatedAt: string,
  events: readonly WorkflowEvent[],
): string {
  return events.reduce((latest, event) => {
    if (!isFrozenWorkflowStageCardEvent(event)) return latest
    return Date.parse(event.stageSnapshot.completedAt ?? '') > Date.parse(latest)
      ? event.stageSnapshot.completedAt!
      : latest
  }, runCreatedAt)
}

export function activeElapsedWithinStage(input: {
  events: readonly WorkflowEvent[]
  stageStartedAt: string
  stageEndedAt: string
}): number {
  const startedAt = Date.parse(input.stageStartedAt)
  const endedAt = Date.parse(input.stageEndedAt)
  let activeSince: number | undefined = startedAt
  let elapsedMs = 0
  for (const event of input.events) {
    const eventAt = Date.parse(event.createdAt)
    if (!Number.isFinite(eventAt) || eventAt < startedAt || eventAt > endedAt) continue
    if (event.status === 'running') activeSince ??= eventAt
    else if (activeSince !== undefined) {
      elapsedMs += Math.max(0, eventAt - activeSince)
      activeSince = undefined
    }
  }
  if (activeSince !== undefined) elapsedMs += Math.max(0, endedAt - activeSince)
  return elapsedMs
}
```

Implement `projectCurrentStageCard` by reusing `projectDocumentDisplayTasks`, `projectAssetDisplayTasks`, `projectReviewFindingDisplayItems`, and the existing atomic-task mapping. Implement `freezePreviousStageCard` by comparing `projectDeliveryProgress(previous).stageId` and `projectDeliveryProgress(next).stageId`, then cloning the previous projection with `status: 'completed'`, no `activeSince`, and the supplied terminal timing. Implement `projectWorkflowStageCardHistory` by reducing validated frozen events into a map keyed by `stageId`, retaining only indices lower than the live current index, sorting by `phaseIndex`, and appending the live projection.

- [ ] **Step 5: Run the focused backend unit tests**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.test.ts
```

Expected: PASS with no stage inferred from display copy.

- [ ] **Step 6: Commit the projector**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.ts packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.ts packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.test.ts
git commit -m "feat: project durable workflow stage cards"
```

## Task 2: Freeze completed cards atomically in the workflow journal

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts:704-760`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/accepted-unit-journal.test.ts:350-420`

- [ ] **Step 1: Write failing atomicity and replay tests**

Add tests that commit an initial run, commit a transition, reload the store, and inspect the ordinary transition event:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('commits the frozen previous-stage card with the phase transition event', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'workflow-stage-card-'))
  const store = createRunStore(workspace, 'owner-stage-event')
  const initial = createTestDeliveryRun({
    projectId: 'project-stage-event',
    ownerId: 'owner-stage-event',
  })
  const saved = await store.commit(initial, {
    runId: initial.runId,
    type: 'run.created',
    phase: initial.phase,
    status: initial.status,
    revision: initial.revision,
  })
  const drafting = transitionDeliveryRun(saved, { type: 'documents_ready' })

  await store.commit(drafting, {
    runId: drafting.runId,
    type: 'phase.entered',
    phase: drafting.phase,
    status: drafting.status,
    revision: drafting.revision,
  })

  const event = (await store.readEvents()).find(candidate => candidate.type === 'phase.entered')
  expect(event?.stageSnapshot).toMatchObject({
    stageId: 'BRIEF_CONFIRMED',
    phaseIndex: 1,
    status: 'completed',
  })
  expect((await store.load())?.phase).toBe('DOCUMENT_DRAFTING')
})
```

Add a replay assertion that loading a pending-marker snapshot twice leaves one event with the same `eventId` and one frozen snapshot.

- [ ] **Step 2: Run the test and verify the event has no snapshot**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/accepted-unit-journal.test.ts
```

Expected: FAIL because `stageSnapshot` is absent.

- [ ] **Step 3: Attach the frozen card at the commit boundary**

Refactor `commitUnlocked` and `persistCommitUnlocked` so one timestamp drives the run event and the frozen snapshot:

```ts
async function commitUnlocked(
  run: DeliveryRun,
  event: Omit<WorkflowEvent, 'eventId' | 'createdAt'> &
    Partial<Pick<WorkflowEvent, 'eventId' | 'createdAt'>>,
  acceptedUnits: AcceptedWorkflowUnit[] = [],
): Promise<DeliveryRun> {
  const previous = await loadUnlocked()
  const createdAt = event.createdAt ?? now()
  const stageStartedAt = lastStageBoundaryAt(
    previous?.createdAt ?? run.createdAt,
    await readEventsUnlocked(),
  )
  const elapsedMs = activeElapsedWithinStage({
    events: await readEventsUnlocked(),
    stageStartedAt,
    stageEndedAt: createdAt,
  })
  const stageSnapshot = previous
    ? freezePreviousStageCard({
        previous,
        next: run,
        workspacePath,
        stageStartedAt,
        stageEndedAt: createdAt,
        elapsedMs,
      })
    : undefined
  return persistCommitUnlocked(
    run,
    { ...event, createdAt, ...(stageSnapshot ? { stageSnapshot } : {}) },
    acceptedUnits,
  )
}
```

Make `replaceSnapshotIfDigest` pass the parsed current snapshot through the same helper before `persistCommitUnlocked`. Keep `save` unchanged: only event-backed commits may freeze stage cards. Preserve the existing pending-event write-ahead flow so the run transition and frozen card remain recoverable together.

- [ ] **Step 4: Run journal and schema evolution tests**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/accepted-unit-journal.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts
```

Expected: PASS. The schema fingerprint remains version 13 because `workflowEventSchema` already preserves extra event properties through `catchall(z.unknown())`; no delivery-run schema change is introduced.

- [ ] **Step 5: Commit the atomic journal integration**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts packages/agent-workflow-server/src/beegame/delivery-workflow/accepted-unit-journal.test.ts
git commit -m "feat: freeze workflow cards at stage transitions"
```

## Task 3: Expose frozen history plus the live current stage

**Files:**
- Modify: `packages/agent-workflow-server/src/app.ts:5035-5120,5525-5795`
- Modify: `packages/agent-workflow-server/src/__tests__/session-routes.test.ts:620-720`

- [ ] **Step 1: Write a failing workflow-route contract test**

Persist a run with two frozen stage events and a live third stage, call the existing project workflow route, and assert:

```ts
expect(response.status).toBe(200)
expect(body.workflow.stageSnapshots.map((card: { stageId: string }) => card.stageId)).toEqual([
  'BRIEF_CONFIRMED',
  'DOCUMENT_DRAFTING',
  'DOCUMENT_REVIEW',
])
expect(body.workflow.stageSnapshots[0]).toMatchObject({
  status: 'completed',
  activeSince: undefined,
})
expect(body.workflow.stageSnapshots[2]).toMatchObject({
  stageId: 'DOCUMENT_REVIEW',
  status: 'running',
})
expect(body.workflow.stageSnapshots).toHaveLength(3)
```

Also assert that a legacy run with no frozen stage events returns no invented historical entries and still exposes its live card.

- [ ] **Step 2: Run the route test and verify `stageSnapshots` is absent**

Run:

```bash
bun test packages/agent-workflow-server/src/__tests__/session-routes.test.ts
```

Expected: FAIL on `stageSnapshots`.

- [ ] **Step 3: Build history during the existing read-only snapshot read**

In `readBeeGameWorkflowSnapshot`, read events once and attach the derived collection without writing anything:

```ts
const events = await store.readEvents()
const timing = workflowElapsedTiming(events, run as DeliveryRun)
const stageSnapshots = projectWorkflowStageCardHistory({
  run: run as DeliveryRun,
  events,
  workspacePath,
  now: new Date().toISOString(),
})
return {
  ...(run as unknown as JsonObject),
  ...timing,
  stageSnapshots,
}
```

This preserves the read-only behavior of status polling and keeps history derived from durable journal facts.

- [ ] **Step 4: Add snapshots to the sanitized public workflow view**

Teach `workflowViewForDisplay` to accept only projected stage-card objects and strip action fields from historical entries:

```ts
const stageSnapshots = Array.isArray(workflow.stageSnapshots)
  ? workflow.stageSnapshots.flatMap(value =>
      isWorkflowStageCardSnapshot(value) ? [workflowStageCardForDisplay(value)] : [],
    )
  : []

// Insert this spread in the existing return object immediately after `tasks`.
...(stageSnapshots.length ? { stageSnapshots } : {}),
```

Reuse the same status/task/message sanitizer for the live top-level card and nested cards. Do not pass `nextAction`, recovery controls, usage, internal evidence, or raw diagnostic fields into historical cards.

- [ ] **Step 5: Run route, history, and display-progress tests**

Run:

```bash
bun test packages/agent-workflow-server/src/__tests__/session-routes.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the public contract**

```bash
git add packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
git commit -m "feat: expose workflow stage card history"
```

## Task 4: Normalize the frontend snapshot contract

**Files:**
- Modify: `apps/frontend/src/types/message.ts:31-105`
- Modify: `apps/frontend/src/viewModels/displayModels.ts:123-320`
- Modify: `apps/frontend/src/viewModels/displayModels.test.ts:1-125`

- [ ] **Step 1: Write failing nested-normalization tests**

Add a payload with camel-case and snake-case nested fields and one malformed entry:

```ts
expect(toProjectRuntimeDisplayModel({
  workflow: {
    runId: 'run-stage-cards',
    status: 'running',
    phase: 'DOCUMENT_REVIEW',
    stageSnapshots: [
      {
        stageId: 'DOCUMENT_DRAFTING',
        phaseIndex: 2,
        phaseCount: 11,
        status: 'completed',
        currentPhase: 'DOCUMENT_DRAFTING',
        tasks: [{ id: 'draft-1', title: 'Draft 1', status: 'completed' }],
        completedTaskCount: 1,
        totalTaskCount: 1,
        elapsedMs: 900,
      },
      { stage_id: '', phase_index: 3, status: 'running' },
    ],
  },
})?.workflow?.stageSnapshots).toEqual([
  expect.objectContaining({
    stageId: 'DOCUMENT_DRAFTING',
    phaseIndex: 2,
    status: 'completed',
    elapsedMs: 900,
  }),
])
```

Add a legacy payload assertion where `stageSnapshots` remains undefined.

- [ ] **Step 2: Run the mapper test and verify the type/field is absent**

Run:

```bash
bun run --cwd apps/frontend test:run -- src/viewModels/displayModels.test.ts
```

Expected: FAIL because `WorkflowCardPayload` has no `stageSnapshots`.

- [ ] **Step 3: Add focused snapshot types**

In `message.ts`, separate run-scoped controls from card-scoped content:

```ts
export type WorkflowCardSubstage =
  | 'INITIAL_DRAFTING'
  | 'INITIAL_REVIEW'
  | 'REPAIR_PLANNING'
  | 'REPAIRING'
  | 'CLOSURE_REVIEW'
  | 'CHECKLIST_DRAFTING'
  | 'CHECKLIST_REVIEW'

export interface WorkflowCardStageSnapshot {
  stageId: string
  status: WorkflowCardStatus
  currentPhase?: string
  phaseIndex: number
  phaseCount?: number
  substage?: WorkflowCardSubstage
  convergencePass?: number
  documentStep?: string
  reviewMode?: 'initial' | 'closure'
  reviewTarget?: 'foundation' | 'checklist' | 'resource'
  worker?: string
  thinking?: string
  executionStatus?: string
  currentItemId?: string
  tasks?: WorkflowCardTask[]
  completedTaskCount?: number
  totalTaskCount?: number
  createdAt?: string
  completedAt?: string
  updatedAt?: string
  elapsedMs?: number
  activeSince?: string
  block?: { message: string; nextAction?: string }
}
```

Replace the inline `WorkflowCardPayload['substage']` union with `WorkflowCardSubstage`, leave its other existing fields unchanged, and add this exact property after `usage?: TokenUsage`:

```ts
stageSnapshots?: WorkflowCardStageSnapshot[]
```

- [ ] **Step 4: Extract a shared field normalizer**

Refactor `normalizeWorkflowDisplay` around a non-recursive helper:

```ts
const normalizeWorkflowStage = (
  source: Record<string, unknown>,
): Omit<WorkflowCardStageSnapshot, 'stageId' | 'phaseIndex'> | undefined => {
  const status = WORKFLOW_STATUS[trimString(source.status).toLowerCase()]
  if (!status) return undefined
  return {
    status,
    currentPhase: trimString(source.currentPhase ?? source.current_phase ?? source.phase) || undefined,
    tasks: normalizeWorkflowTasks(source.tasks),
    // map the remaining existing card-scoped fields exactly once
  }
}
```

Map nested snapshots only when `stageId` is non-empty and `phaseIndex` is a positive integer; keep server ordering and discard malformed entries without synthesizing replacements.

- [ ] **Step 5: Run mapper tests**

Run:

```bash
bun run --cwd apps/frontend test:run -- src/viewModels/displayModels.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the frontend contract**

```bash
git add apps/frontend/src/types/message.ts apps/frontend/src/viewModels/displayModels.ts apps/frontend/src/viewModels/displayModels.test.ts
git commit -m "feat: normalize workflow stage snapshots"
```

## Task 5: Extract the single-stage renderer and add deck selection

**Files:**
- Create: `apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx`
- Create: `apps/frontend/src/components/Demiurge/useWorkflowCardDeck.ts`
- Create: `apps/frontend/src/components/Demiurge/useWorkflowCardDeck.test.tsx`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.tsx:1-610`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx:1-600`

- [ ] **Step 1: Write failing selection and auto-follow hook tests**

Use stable semantic IDs instead of titles:

```tsx
it('follows an appended stage only while viewing the newest card', () => {
  const { result, rerender } = renderHook(
    ({ cards }) => useWorkflowCardDeck(cards),
    { initialProps: { cards: cardsThrough(2) } },
  )
  expect(result.current.selectedStageId).toBe('stage-2')

  rerender({ cards: cardsThrough(3) })
  expect(result.current.selectedStageId).toBe('stage-3')

  act(() => result.current.selectPrevious())
  expect(result.current.selectedStageId).toBe('stage-2')
  rerender({ cards: cardsThrough(4) })
  expect(result.current.selectedStageId).toBe('stage-2')
})

it('anchors selection by stage identity when cards refresh', () => {
  const { result, rerender } = renderHook(
    ({ cards }) => useWorkflowCardDeck(cards),
    { initialProps: { cards: cardsThrough(3) } },
  )
  act(() => result.current.selectPrevious())
  rerender({ cards: cardsThrough(3).map(card => ({ ...card })) })
  expect(result.current.selectedStageId).toBe('stage-2')
})
```

- [ ] **Step 2: Run the hook test and verify the hook is absent**

Run:

```bash
bun run --cwd apps/frontend test:run -- src/components/Demiurge/useWorkflowCardDeck.test.tsx
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Extract `WorkflowStageCard` without visual changes**

Move the existing single-card body, helpers, timer, Markdown renderer, task list, failure copy, and action handling into `WorkflowStageCard.tsx`. Use this interface:

```ts
export function WorkflowStageCard({
  runId,
  stage,
  isLatest,
  nextAction,
  recoverable,
  recovery,
  onAction,
  className,
}: {
  runId: string
  stage: WorkflowCardStageSnapshot
  isLatest: boolean
  nextAction?: WorkflowCardAction
  recoverable?: boolean
  recovery?: Pick<WorkflowCardPayload, 'lastProvenPhase' | 'lastProvenUnitId' | 'lastProvenUnitKind' | 'lastProvenItemId'>
  onAction?: (action: WorkflowCardAction) => Promise<void> | void
  className?: string
})
```

Gate the action with `isLatest && nextAction && onAction`. Keep all current card tests passing against the wrapper.

- [ ] **Step 4: Implement identity-based deck state**

Create the hook with a selected `stageId`, not a numeric index:

```ts
export function useWorkflowCardDeck(cards: readonly WorkflowCardStageSnapshot[]) {
  const newestId = cards.at(-1)?.stageId
  const [selectedStageId, setSelectedStageId] = useState(newestId)
  const previousNewestRef = useRef(newestId)

  useEffect(() => {
    const previousNewest = previousNewestRef.current
    setSelectedStageId(selected => {
      const wasFollowing = !selected || selected === previousNewest
      if (wasFollowing) return newestId
      return cards.some(card => card.stageId === selected) ? selected : newestId
    })
    previousNewestRef.current = newestId
  }, [cards, newestId])

  const selectedIndex = Math.max(0, cards.findIndex(card => card.stageId === selectedStageId))
  return {
    selectedStageId,
    selectedIndex,
    canSelectPrevious: selectedIndex > 0,
    canSelectNext: selectedIndex < cards.length - 1,
    selectPrevious: () => setSelectedStageId(cards[selectedIndex - 1]?.stageId ?? selectedStageId),
    selectNext: () => setSelectedStageId(cards[selectedIndex + 1]?.stageId ?? selectedStageId),
  }
}
```

- [ ] **Step 5: Build the non-drag deck shell and compatibility adapter**

In `WorkflowCard.tsx`, adapt a legacy payload to one current snapshot when `stageSnapshots` is absent:

```ts
const cards = workflow.stageSnapshots?.length
  ? workflow.stageSnapshots
  : [{
      ...workflow,
      stageId: workflow.currentPhase || `current:${workflow.runId}`,
      phaseIndex: workflow.phaseIndex ?? 1,
    }]
```

Render the selected `WorkflowStageCard`, the `selectedIndex + 1 / cards.length` counter, and previous/next buttons. Wire `ArrowLeft` and `ArrowRight` on a focusable deck region. Use accessible labels `查看上一阶段` and `查看下一阶段`, and disable boundary controls.

- [ ] **Step 6: Run the hook and existing card suites**

Run:

```bash
bun run --cwd apps/frontend test:run -- src/components/Demiurge/useWorkflowCardDeck.test.tsx src/components/Demiurge/WorkflowCard.test.tsx
```

Expected: PASS, including the original 40 card tests.

- [ ] **Step 7: Commit extraction and selection**

```bash
git add apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx apps/frontend/src/components/Demiurge/useWorkflowCardDeck.ts apps/frontend/src/components/Demiurge/useWorkflowCardDeck.test.tsx apps/frontend/src/components/Demiurge/WorkflowCard.tsx apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
git commit -m "feat: render workflow cards as a navigable deck"
```

## Task 6: Add pointer dragging, snapping, stepped layers, and reduced motion

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/useWorkflowCardDeck.ts`
- Modify: `apps/frontend/src/components/Demiurge/useWorkflowCardDeck.test.tsx`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.tsx`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`

- [ ] **Step 1: Write failing gesture tests**

Cover distance, velocity, vertical intent, boundary resistance, and nested controls:

```tsx
it('moves one card after a deliberate horizontal drag', () => {
  render(<WorkflowCard workflow={workflowThrough(3)} />)
  const deck = screen.getByTestId('workflow-card-deck')
  fireEvent.pointerDown(deck, { pointerId: 1, clientX: 110, clientY: 100, timeStamp: 0 })
  fireEvent.pointerMove(deck, { pointerId: 1, clientX: 200, clientY: 104, timeStamp: 120 })
  fireEvent.pointerUp(deck, { pointerId: 1, clientX: 200, clientY: 104, timeStamp: 140 })
  expect(screen.getByText('2 / 3')).toBeInTheDocument()
})

it('does not navigate for vertical intent or nested actions', () => {
  render(<WorkflowCard workflow={workflowThrough(3)} onAction={vi.fn()} />)
  const deck = screen.getByTestId('workflow-card-deck')
  fireEvent.pointerDown(deck, { pointerId: 2, clientX: 150, clientY: 50 })
  fireEvent.pointerMove(deck, { pointerId: 2, clientX: 154, clientY: 130 })
  fireEvent.pointerUp(deck, { pointerId: 2, clientX: 154, clientY: 130 })
  expect(screen.getByText('3 / 3')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(screen.getByText('3 / 3')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the gesture tests and verify drag is inert**

Run:

```bash
bun run --cwd apps/frontend test:run -- src/components/Demiurge/WorkflowCard.test.tsx src/components/Demiurge/useWorkflowCardDeck.test.tsx
```

Expected: FAIL because pointer movement does not change selection.

- [ ] **Step 3: Implement axis-locked pointer state**

Extend the hook with these constants and semantic target exclusion:

```ts
const AXIS_LOCK_PX = 8
const DISTANCE_THRESHOLD_PX = 64
const VELOCITY_THRESHOLD_PX_PER_MS = 0.45
const INTERACTIVE_SELECTOR = 'button,a,input,textarea,select,option,[role="button"],[data-no-card-drag]'

const interactiveTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && Boolean(target.closest(INTERACTIVE_SELECTOR))
```

Track `{ pointerId, startX, startY, startedAt, intent }` in a ref. Lock only when horizontal movement exceeds `AXIS_LOCK_PX` and dominates vertical movement. Capture the pointer after lock, expose a resisted `dragX`, and on release call exactly one navigation function when distance or velocity crosses its threshold. Reset on pointer cancel and lost capture. At the older/newer boundaries, multiply outward `dragX` by `0.18` and never wrap.

- [ ] **Step 4: Render the selected card and two stepped back layers**

Use `motion.div` only for presentation, with pointer decisions owned by the hook:

```tsx
const reducedMotion = useReducedMotion()
const backCards = [1, 2].filter(depth => cards.length > depth)

return (
  <section
    data-testid="workflow-card-deck"
    tabIndex={0}
    aria-roledescription="workflow stage card deck"
    className="relative box-border w-full max-w-[46rem] touch-pan-y pb-6 pr-6 outline-none"
    {...pointerHandlers}
  >
    {backCards.reverse().map(depth => (
      <div
        key={depth}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-3xl border border-white/10 bg-zinc-950/95"
        style={{ transform: `translate(${depth * 12}px, ${depth * 12}px)`, opacity: depth === 1 ? 0.68 : 0.38 }}
      />
    ))}
    <motion.div
      animate={{ x: dragX }}
      transition={reducedMotion ? { duration: 0.08 } : { type: 'spring', stiffness: 430, damping: 36 }}
    >
      <WorkflowStageCard /* selected stage props */ />
    </motion.div>
  </section>
)
```

After selection changes, animate the outgoing card in the gesture direction and the incoming card from the opposite side. Under reduced motion, use opacity plus a small translation and no rotation or spring.

- [ ] **Step 5: Add counter and arrow control assertions**

Ensure the counter is `selectedIndex + 1 / cards.length`, not `phaseIndex / phaseCount`. Verify button disabled states at both ends, focus-visible styling, and `aria-live="polite"` on the counter without announcing drag-frame updates.

- [ ] **Step 6: Run all frontend deck tests**

Run:

```bash
bun run --cwd apps/frontend test:run -- src/components/Demiurge/useWorkflowCardDeck.test.tsx src/components/Demiurge/WorkflowCard.test.tsx src/viewModels/displayModels.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit gestures and visual stacking**

```bash
git add apps/frontend/src/components/Demiurge/useWorkflowCardDeck.ts apps/frontend/src/components/Demiurge/useWorkflowCardDeck.test.tsx apps/frontend/src/components/Demiurge/WorkflowCard.tsx apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
git commit -m "feat: add draggable workflow card stacking"
```

## Task 7: Verify runtime integration and compatibility

**Files:**
- Modify if an uncovered contract requires it: `apps/frontend/src/components/Demiurge/DashboardView.test.tsx`
- Modify if an uncovered feed contract requires it: `apps/frontend/src/components/Demiurge/Sidebar/ChatPanel.test.tsx`

- [ ] **Step 1: Run the focused server regression suite**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/accepted-unit-journal.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
```

Expected: PASS with zero failures.

- [ ] **Step 2: Run the focused frontend regression suite**

Run:

```bash
bun run --cwd apps/frontend test:run -- src/viewModels/displayModels.test.ts src/components/Demiurge/WorkflowCard.test.tsx src/components/Demiurge/useWorkflowCardDeck.test.tsx src/components/Demiurge/DashboardView.test.tsx src/components/Demiurge/Sidebar/ChatPanel.test.tsx
```

Expected: PASS with zero failures.

- [ ] **Step 3: Run type checks and the frontend production build**

Run:

```bash
bun run typecheck
bun run --cwd apps/frontend build
```

Expected: both commands exit 0. Existing Vite deprecation warnings are acceptable; TypeScript errors and build failures are not.

- [ ] **Step 4: Inspect the final diff for scope and accidental generated files**

Run:

```bash
git status --short
git diff --check
git diff --stat beegame-main...HEAD
```

Expected: only the planned server workflow, frontend card, tests, and plan files are changed; no `node_modules`, lockfile, `.superpowers`, or generated build output is tracked.

- [ ] **Step 5: Commit any final integration-only test adjustments**

If Task 7 required changes, commit only those verified files:

```bash
git add apps/frontend/src/components/Demiurge/DashboardView.test.tsx apps/frontend/src/components/Demiurge/Sidebar/ChatPanel.test.tsx
git commit -m "test: verify workflow card deck integration"
```

If no files changed in Task 7, do not create an empty commit.

## Task 8: Final verification and handoff

**Files:**
- Verify: all files changed by Tasks 1-7

- [ ] **Step 1: Run final diff-sensitive checks**

```bash
git diff --check beegame-main...HEAD
git status --short
```

Expected: no whitespace errors and a clean worktree after all planned commits.

- [ ] **Step 2: Run the complete focused acceptance command once more**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/accepted-unit-journal.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
bun run --cwd apps/frontend test:run -- src/viewModels/displayModels.test.ts src/components/Demiurge/WorkflowCard.test.tsx src/components/Demiurge/useWorkflowCardDeck.test.tsx src/components/Demiurge/DashboardView.test.tsx src/components/Demiurge/Sidebar/ChatPanel.test.tsx
bun run typecheck
bun run --cwd apps/frontend build
```

Expected: all tests pass, type checking exits 0, and the frontend build succeeds.

- [ ] **Step 3: Record the verification evidence in the handoff**

Report the exact test counts, typecheck/build exit status, branch name `codex/workflow-stage-card-deck`, and worktree path. Do not claim completion from earlier test output; use only the fresh Task 8 results.
