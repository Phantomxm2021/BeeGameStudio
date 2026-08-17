import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import type { FoundationReview } from './foundation-review'
import {
  commitFoundationRemediationReceipt,
  createFoundationRemediationState,
  FOUNDATION_REMEDIATION_LANES,
  foundationRemediationReadyForVerification,
  pendingFoundationRemediationLanes,
  recordFoundationRemediationDispatch,
  recordFoundationRemediationFailure,
  retryFoundationRemediationFailures,
} from './foundation-remediation'
import { parseDeliveryRun } from './schema'
import type { DispatchRecord, FoundationRemediationLaneId } from './types'

const digest = (value: string) => value.repeat(64)

function review(
  revision: string,
  paths: Array<
    'docs/GDD.md' | 'docs/TECHNICAL_DESIGN.md' | 'docs/UI_UX_SPEC.md'
  >,
): FoundationReview {
  return {
    version: 2,
    scope: 'foundation',
    revision,
    verdict: 'NEEDS_REVISION',
    priorConflictStatus: [],
    conflicts: paths.map((path, index) => ({
      id: `B${index + 1}`,
      title: `Conflict ${index + 1}`,
      problem: `The authority for ${path} is inconsistent.`,
      evidence: [{ path, location: 'Authority', observed: 'old value' }],
      requiredOutcome: `Use the canonical value ${index + 1}.`,
      changes: [{ path, action: 'Replace the inconsistent authority.' }],
      acceptance: ['The canonical value is used exactly once.'],
    })),
  }
}

describe('foundation remediation lanes', () => {
  test('isolates every remediation writer to one canonical document', () => {
    expect(FOUNDATION_REMEDIATION_LANES).toHaveLength(8)
    expect(
      FOUNDATION_REMEDIATION_LANES.every(lane => lane.ownedPaths.length === 1),
    ).toBe(true)
    expect(
      FOUNDATION_REMEDIATION_LANES.flatMap(lane => lane.ownedPaths),
    ).toEqual([
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/BALANCE_DESIGN.md',
      'docs/TECHNICAL_DESIGN.md',
      'docs/ART_DIRECTION.md',
      'docs/UI_UX_SPEC.md',
      'docs/AUDIO_DESIGN.md',
      'docs/ASSET_PLAN.md',
    ])
  })

  test('partitions all foundation paths and marks unaffected lanes not required', () => {
    const sourceRevision = digest('a')
    const state = createFoundationRemediationState({
      reviewPath: `.beegame/reviews/foundation/${sourceRevision}/review.json`,
      reviewDigest: digest('b'),
      review: review(sourceRevision, ['docs/GDD.md', 'docs/UI_UX_SPEC.md']),
    })

    expect(state.lanes.map(lane => lane.id)).toEqual([
      'gdd',
      'level-scene-design',
      'balance-design',
      'technical-design',
      'art-direction',
      'ui-ux-spec',
      'audio-design',
      'asset-plan',
    ])
    expect(state.lanes.map(lane => [lane.status, lane.affectedPaths])).toEqual([
      ['pending', ['docs/GDD.md']],
      ['not_required', []],
      ['not_required', []],
      ['not_required', []],
      ['not_required', []],
      ['pending', ['docs/UI_UX_SPEC.md']],
      ['not_required', []],
      ['not_required', []],
    ])
    expect(state.lanes.flatMap(lane => lane.ownedPaths)).toEqual([
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/BALANCE_DESIGN.md',
      'docs/TECHNICAL_DESIGN.md',
      'docs/ART_DIRECTION.md',
      'docs/UI_UX_SPEC.md',
      'docs/AUDIO_DESIGN.md',
      'docs/ASSET_PLAN.md',
    ])
    expect(foundationRemediationLanesAreFrozen()).toBe(true)
  })

  test('persists only canonical lane states and rejects impossible completion', () => {
    const run = createTestDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'user-1',
    })
    const sourceRevision = digest('a')
    const state = createFoundationRemediationState({
      reviewPath: `.beegame/reviews/foundation/${sourceRevision}/review.json`,
      reviewDigest: digest('b'),
      review: review(sourceRevision, ['docs/GDD.md']),
    })

    expect(
      parseDeliveryRun({ ...run, foundationRemediationState: state }),
    ).toMatchObject({ foundationRemediationState: state })

    const impossible = structuredClone(state)
    impossible.lanes[0] = {
      ...impossible.lanes[0],
      status: 'completed',
    }
    expect(() =>
      parseDeliveryRun({ ...run, foundationRemediationState: impossible }),
    ).toThrow('completed remediation lane requires one receipt')

    const runningWithoutDispatch = structuredClone(state)
    runningWithoutDispatch.lanes[0] = {
      ...runningWithoutDispatch.lanes[0],
      status: 'running',
    }
    expect(() =>
      parseDeliveryRun({
        ...run,
        foundationRemediationState: runningWithoutDispatch,
      }),
    ).toThrow('running remediation lane requires one dispatch')

    const duplicated = structuredClone(state)
    duplicated.lanes[1] = {
      ...duplicated.lanes[1],
      id: 'gdd',
    }
    expect(() =>
      parseDeliveryRun({ ...run, foundationRemediationState: duplicated }),
    ).toThrow('foundation remediation lanes must use canonical definitions')

    const noncanonicalAffectedPaths = structuredClone(state)
    noncanonicalAffectedPaths.lanes[0] = {
      ...noncanonicalAffectedPaths.lanes[0],
      affectedPaths: ['docs/LEVEL_SCENE_DESIGN.md', 'docs/GDD.md'],
    }
    expect(() =>
      parseDeliveryRun({
        ...run,
        foundationRemediationState: noncanonicalAffectedPaths,
      }),
    ).toThrow(
      'foundation remediation affected paths must be unique canonical owned paths',
    )

    const executedNotRequired = structuredClone(state)
    executedNotRequired.lanes[1] = {
      ...executedNotRequired.lanes[1],
      failureReason: 'must not execute',
    }
    expect(() =>
      parseDeliveryRun({
        ...run,
        foundationRemediationState: executedNotRequired,
      }),
    ).toThrow('not-required remediation lane cannot contain execution state')

    expect(() =>
      parseDeliveryRun({
        ...run,
        foundationRemediationState: { ...state, reviewDigest: 'invalid' },
      }),
    ).toThrow()
  })

  test('preserves completed siblings while retrying only a failed lane behind the receipt barrier', () => {
    const sourceRevision = digest('a')
    const state = createFoundationRemediationState({
      reviewPath: `.beegame/reviews/foundation/${sourceRevision}/review.json`,
      reviewDigest: digest('b'),
      review: review(sourceRevision, ['docs/GDD.md', 'docs/UI_UX_SPEC.md']),
    })
    const coreDispatch = dispatch('gdd')
    const presentationDispatch = dispatch('ui-ux-spec')
    let updated = recordFoundationRemediationDispatch(
      state,
      'gdd',
      coreDispatch,
    )
    updated = recordFoundationRemediationDispatch(
      updated,
      'ui-ux-spec',
      presentationDispatch,
    )

    updated = commitFoundationRemediationReceipt(updated, {
      laneId: 'gdd',
      dispatchId: coreDispatch.dispatchId,
      receipt: remediationReceipt('gdd', state, 'c', 'd'),
    })
    updated = recordFoundationRemediationFailure(
      updated,
      'ui-ux-spec',
      'provider disconnected',
    )

    expect(foundationRemediationReadyForVerification(updated)).toBe(false)
    const retried = retryFoundationRemediationFailures(updated)
    expect(retried.lanes.map(lane => lane.status)).toEqual([
      'completed',
      'not_required',
      'not_required',
      'not_required',
      'not_required',
      'pending',
      'not_required',
      'not_required',
    ])
    expect(retried.lanes[0]?.receipt).toEqual(updated.lanes[0]?.receipt)
    expect(
      pendingFoundationRemediationLanes(retried).map(lane => lane.id),
    ).toEqual(['ui-ux-spec'])

    const redispatched = recordFoundationRemediationDispatch(
      retried,
      'ui-ux-spec',
      presentationDispatch,
    )
    const completed = commitFoundationRemediationReceipt(redispatched, {
      laneId: 'ui-ux-spec',
      dispatchId: presentationDispatch.dispatchId,
      receipt: remediationReceipt('ui-ux-spec', state, 'c', 'f'),
    })
    expect(foundationRemediationReadyForVerification(completed)).toBe(true)
    expect(() =>
      commitFoundationRemediationReceipt(redispatched, {
        laneId: 'ui-ux-spec',
        dispatchId: presentationDispatch.dispatchId,
        receipt: {
          ...remediationReceipt('ui-ux-spec', state, 'c', 'f'),
          targetPath: 'docs/AUDIO_DESIGN.md',
        },
      }),
    ).toThrow('foundation remediation receipt target does not match lane')
  })

  test('preserves the first source digest across an interrupted retry', () => {
    const sourceRevision = digest('a')
    const state = createFoundationRemediationState({
      reviewPath: `.beegame/reviews/foundation/${sourceRevision}/review.json`,
      reviewDigest: digest('b'),
      review: review(sourceRevision, ['docs/GDD.md']),
    })
    const sourceDigest = digest('c')
    const firstDispatch: DispatchRecord = {
      ...dispatch('gdd'),
      request: {
        dispatchId: 'dispatch-gdd',
        runId: 'run-1',
        ownerId: 'owner-1',
        projectId: 'project-1',
        workspacePath: '/workspace',
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        taskId: 'foundation-remediation:gdd',
        revision: sourceRevision,
        contract: { remediation: { sourceDigest } },
      },
    }
    const failed = recordFoundationRemediationFailure(
      recordFoundationRemediationDispatch(state, 'gdd', firstDispatch),
      'gdd',
      'interrupted',
    )
    const retried = retryFoundationRemediationFailures(failed)

    expect(retried.lanes[0]?.status).toBe('pending')
    expect(retried.lanes[0]?.sourceDigest).toBe(sourceDigest)
    expect(
      parseDeliveryRun({
        ...createTestDeliveryRun({
          runId: 'run-1',
          projectId: 'project-1',
          ownerId: 'owner-1',
        }),
        foundationRemediationState: retried,
      }).foundationRemediationState?.lanes[0]?.sourceDigest,
    ).toBe(sourceDigest)
  })
})

function foundationRemediationLanesAreFrozen(): boolean {
  return (
    Object.isFrozen(FOUNDATION_REMEDIATION_LANES) &&
    FOUNDATION_REMEDIATION_LANES.every(
      lane => Object.isFrozen(lane) && Object.isFrozen(lane.ownedPaths),
    )
  )
}

function dispatch(laneId: FoundationRemediationLaneId): DispatchRecord {
  const sourceDigest = digest('c')
  return {
    dispatchId: `dispatch-${laneId}`,
    workerType: 'document-author',
    phase: 'DOCUMENT_DRAFTING',
    taskId: `foundation-remediation:${laneId}`,
    revision: digest('a'),
    status: 'running',
    startedAt: '2026-08-16T00:00:00.000Z',
    request: {
      dispatchId: `dispatch-${laneId}`,
      runId: 'run-1',
      ownerId: 'owner-1',
      projectId: 'project-1',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      taskId: `foundation-remediation:${laneId}`,
      revision: digest('a'),
      contract: { remediation: { sourceDigest } },
    },
  }
}

function remediationReceipt(
  laneId: FoundationRemediationLaneId,
  state: ReturnType<typeof createFoundationRemediationState>,
  sourceValue: string,
  finalValue: string,
) {
  const lane = FOUNDATION_REMEDIATION_LANES.find(entry => entry.id === laneId)!
  return {
    reviewDigest: state.reviewDigest,
    sourceRevision: state.sourceRevision,
    targetPath: lane.ownedPaths[0],
    sourceDigest: digest(sourceValue),
    patchedUnitIds: ['section:authority'],
    finalDigest: digest(finalValue),
    committedAt: '2026-08-16T00:01:00.000Z',
  }
}
