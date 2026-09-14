import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import type { DeliveryRun, WorkflowEvent } from './types'
import { transitionDeliveryRun } from './transition'
import { DELIVERY_PROGRESS_STAGES } from './display-progress'
import {
  activeElapsedWithinStage,
  freezePreviousStageCard,
  isFrozenWorkflowStageCardEvent,
  isWorkflowStageCardSnapshot,
  lastStageBoundaryAt,
  projectCurrentStageCard,
  projectWorkflowStageCardHistory,
} from './workflow-stage-card-history'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

const workspacePath = process.cwd()

describe('workflow stage card history', () => {
  test('uses the public author result before legacy document state', () => {
    const base = createTestDeliveryRun({
      projectId: 'project-public-author-display',
      ownerId: 'owner-public-author-display',
      foundationDraftComplete: false,
    })
    const digest = 'a'.repeat(64)
    const run: DeliveryRun = {
      ...base,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      authorStage: {
        protocolVersion: 1,
        requestId: 'author-request',
        inputDigest: digest,
        status: 'completed',
        handle: {
          protocolVersion: 1,
          producer: 'foundation-authoring',
          id: '550e8400-e29b-41d4-a716-446655440000',
        },
        result: {
          protocolVersion: 1,
          producer: 'foundation-authoring',
          kind: 'foundation_documents',
          resultId: 'b'.repeat(64),
          inputDigest: digest,
          ownerId: base.ownerId,
          projectId: base.projectId,
          confirmedBriefDigest: base.confirmedBriefDigest,
          documents: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest, byteLength: 1, artifactPath: `.beegame/workflow/foundation-authoring/artifacts/${path}` })),
          documentRevision: 'document-revision',
          workspaceRevision: 'workspace-revision',
          receiptSetDigest: 'c'.repeat(64),
        },
        control: { sequence: 1, action: 'run', requestId: 'author-request' },
      },
    }
    const card = projectCurrentStageCard({ run, workspacePath })
    expect(card?.stageId).toBe('DOCUMENT_DRAFTING')
    expect(card?.substage).toBe('INITIAL_DRAFTING')
    expect(card?.tasks).toHaveLength(8)
    expect(card?.tasks.every(task => task.status === 'completed')).toBe(true)
    const running: DeliveryRun = { ...run, status: 'running', phase: 'DOCUMENT_DRAFTING',
      authorStage: { ...run.authorStage!, status: 'running', result: undefined } }
    expect(projectCurrentStageCard({ run: running, workspacePath })?.thinking).toBe('working')
  })
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
    expect(frozen?.activeSince).toBeUndefined()
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
      runId: 'run-stage-history',
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
    }
    const cards = projectWorkflowStageCardHistory({
      run: current,
      workspacePath,
      events: [
        frozenEvent(1, 'BRIEF_CONFIRMED'),
        frozenEvent(2, 'DOCUMENT_DRAFTING'),
        frozenEvent(2, 'DOCUMENT_DRAFTING', {
          message: 'latest frozen value',
          completedAt: '2026-08-06T00:00:09.000Z',
        }),
        frozenEvent(2, 'DOCUMENT_DRAFTING', {
          message: 'older frozen value',
          completedAt: '2026-08-06T00:00:08.000Z',
        }),
        {
          ...frozenEvent(2, 'DOCUMENT_DRAFTING', {
            message: 'foreign run value',
            completedAt: '2026-08-06T00:00:10.000Z',
          }),
          runId: 'another-run',
        },
        frozenEvent(8, 'IMPLEMENTATION'),
      ],
      now: current.updatedAt,
    })

    expect(cards.map(card => card.phaseIndex)).toEqual([1, 2, 3])
    expect(cards[1]?.message).toBe('latest frozen value')
    expect(cards.at(-1)?.stageId).toBe('DOCUMENT_REVIEW')
  })

  test('projects document display tasks and sanitized workflow fields', () => {
    const run = createTestDeliveryRun({
      projectId: 'project-projection',
      ownerId: 'owner-projection',
      foundationDraftComplete: false,
    })
    const card = projectCurrentStageCard({
      run: {
        ...run,
        createdAt: '2026-08-06T00:00:00.000Z',
        updatedAt: '2026-08-06T00:00:00.000Z',
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        currentMessage: 'visible progress',
        thinking: 'working',
        blockedReason: 'must not leak worker protocol',
      },
      workspacePath,
      timing: { now: '2026-08-06T00:00:10.000Z' },
    })

    expect(card?.stageId).toBe('DOCUMENT_DRAFTING')
    expect(card?.currentPhase).toBe('DOCUMENT_DRAFTING')
    expect(card?.documentStep).toBe('FOUNDATION_DRAFTING')
    expect(card?.message).toBe('visible progress')
    expect(Array.isArray(card?.tasks)).toBe(true)
    expect(card?.totalTaskCount).toBe(8)
    expect(card?.elapsedMs).toBe(0)
    expect(card?.activeSince).toBe('2026-08-06T00:00:00.000Z')
    expect(card?.block).toMatchObject({
      message: 'Workflow dispatch failed.',
      code: 'dispatch_failed',
      diagnosticId: expect.stringMatching(/^workflow-[0-9a-f]{12}$/),
      nextAction: 'retry',
    })
    expect(card?.tasks?.some(task => task.operation === 'write')).toBe(true)
  })

  test('does not project stale runtime activity after a workflow is stopped', () => {
    const run = createTestDeliveryRun({
      projectId: 'project-stopped-activity',
      ownerId: 'owner-stopped-activity',
      foundationDraftComplete: false,
    })
    const card = projectCurrentStageCard({
      run: {
        ...run,
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        status: 'stopped',
        currentMessage: '正在准备文档修改…',
        thinking: 'idle',
        blockedReason: 'user stopped workflow',
      },
      workspacePath,
    })

    expect(card?.message).toBeUndefined()
    expect(card?.block).toMatchObject({
      message: 'Workflow stopped by user.',
      code: 'user_stopped',
      diagnosticId: expect.stringMatching(/^workflow-[0-9a-f]{12}$/),
    })
  })

  test('keeps an open running interval out of durable elapsed time', () => {
    const run = createTestDeliveryRun({
      projectId: 'project-open-interval',
      ownerId: 'owner-open-interval',
      foundationDraftComplete: false,
    })
    const card = projectCurrentStageCard({
      run: {
        ...run,
        createdAt: '2026-08-06T00:00:00.000Z',
        updatedAt: '2026-08-06T00:00:02.000Z',
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
      },
      workspacePath,
      timing: {
        now: '2026-08-06T00:00:10.000Z',
        events: [eventAt('2026-08-06T00:00:02.000Z', 'running')],
      },
    })
    expect(card?.elapsedMs).toBe(0)
    expect(card?.activeSince).toBe('2026-08-06T00:00:02.000Z')
  })

  test('validates snapshots and frozen events structurally', () => {
    const event = frozenEvent(1, 'BRIEF_CONFIRMED')
    const snapshot = event.stageSnapshot as Record<string, unknown>
    expect(isWorkflowStageCardSnapshot(event.stageSnapshot)).toBe(true)
    expect(isFrozenWorkflowStageCardEvent(event)).toBe(true)
    expect(isFrozenWorkflowStageCardEvent({ ...event, eventId: '' })).toBe(
      false,
    )
    expect(
      isFrozenWorkflowStageCardEvent({ ...event, revision: undefined }),
    ).toBe(false)
    expect(
      isWorkflowStageCardSnapshot({
        ...snapshot,
        stageId: 'DOCUMENT_DRAFTING',
      }),
    ).toBe(false)
    expect(
      isWorkflowStageCardSnapshot({
        ...snapshot,
        phaseCount: 9,
      }),
    ).toBe(false)
    expect(
      isWorkflowStageCardSnapshot({
        ...snapshot,
        tasks: [{ id: 'x' }],
      }),
    ).toBe(false)
    expect(
      isWorkflowStageCardSnapshot({
        ...snapshot,
        convergencePass: 2,
      }),
    ).toBe(false)
    expect(
      isFrozenWorkflowStageCardEvent({
        ...event,
        stageSnapshot: { ...snapshot, phaseIndex: 2 },
      }),
    ).toBe(false)
    expect(
      isFrozenWorkflowStageCardEvent({
        ...event,
        stageSnapshot: { ...snapshot, status: 'running' },
      }),
    ).toBe(false)
    expect(
      isFrozenWorkflowStageCardEvent({
        ...event,
        stageSnapshot: { ...snapshot, completedAt: undefined },
      }),
    ).toBe(false)
    expect(
      isFrozenWorkflowStageCardEvent({
        ...event,
        stageSnapshot: {
          ...snapshot,
          activeSince: '2026-08-06T00:00:01.000Z',
        },
      }),
    ).toBe(false)
  })

  test('computes the latest stage boundary and active elapsed time safely', () => {
    const events = [
      frozenEvent(1, 'BRIEF_CONFIRMED', {
        completedAt: '2026-08-06T00:00:03.000Z',
      }),
      {
        ...frozenEvent(2, 'DOCUMENT_DRAFTING'),
        createdAt: '2026-08-06T00:00:05.000Z',
        status: 'running' as const,
        stageSnapshot: {
          ...(frozenEvent(2, 'DOCUMENT_DRAFTING').stageSnapshot as Record<
            string,
            unknown
          >),
          completedAt: undefined,
        },
      },
    ]
    expect(lastStageBoundaryAt('2026-08-06T00:00:00.000Z', events)).toBe(
      '2026-08-06T00:00:03.000Z',
    )
    expect(
      activeElapsedWithinStage({
        events: [
          eventAt('2026-08-06T00:00:02.000Z', 'running'),
          eventAt('2026-08-06T00:00:05.000Z', 'completed'),
          eventAt('2026-08-06T00:00:07.000Z', 'running'),
        ],
        stageStartedAt: '2026-08-06T00:00:00.000Z',
        stageEndedAt: '2026-08-06T00:00:10.000Z',
      }),
    ).toBe(8000)
  })
})

function frozenEvent(
  eventIndex: number,
  stageId: 'BRIEF_CONFIRMED' | 'DOCUMENT_DRAFTING' | 'IMPLEMENTATION',
  overrides: Record<string, unknown> = {},
): WorkflowEvent {
  const phaseIndex = DELIVERY_PROGRESS_STAGES.indexOf(stageId) + 1
  const createdAt = `2026-08-06T00:00:0${Math.min(eventIndex, 9)}.000Z`
  return {
    eventId: `event-${eventIndex}-${String(overrides.message ?? 'base')}`,
    runId: 'run-stage-history',
    type: 'phase.entered',
    phase: stageId,
    status: 'running',
    revision: {
      document: 'document-revision',
      workspace: 'workspace-revision',
    },
    createdAt,
    stageSnapshot: {
      stageId,
      phaseIndex,
      phaseCount: DELIVERY_PROGRESS_STAGES.length,
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

function eventAt(
  createdAt: string,
  status: WorkflowEvent['status'],
): WorkflowEvent {
  return {
    eventId: createdAt,
    runId: 'run-stage-timing',
    type: 'progress.updated',
    phase: 'DOCUMENT_DRAFTING',
    status,
    revision: {
      document: 'document-revision',
      workspace: 'workspace-revision',
    },
    createdAt,
  }
}
