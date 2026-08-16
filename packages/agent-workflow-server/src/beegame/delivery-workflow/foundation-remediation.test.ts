import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import type { FoundationReview } from './foundation-review'
import {
  createFoundationRemediationState,
  FOUNDATION_REMEDIATION_LANES,
} from './foundation-remediation'
import { parseDeliveryRun } from './schema'

const digest = (value: string) => value.repeat(64)

function review(
  revision: string,
  paths: Array<
    | 'docs/GDD.md'
    | 'docs/TECHNICAL_DESIGN.md'
    | 'docs/UI_UX_SPEC.md'
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
  test('partitions all foundation paths and marks unaffected lanes not required', () => {
    const sourceRevision = digest('a')
    const state = createFoundationRemediationState({
      reviewPath: `.beegame/reviews/foundation/${sourceRevision}/review.json`,
      reviewDigest: digest('b'),
      review: review(sourceRevision, ['docs/GDD.md', 'docs/UI_UX_SPEC.md']),
    })

    expect(state.lanes.map(lane => lane.id)).toEqual([
      'core-design',
      'technical-assets',
      'presentation',
    ])
    expect(state.lanes.map(lane => [lane.status, lane.affectedPaths])).toEqual([
      ['pending', ['docs/GDD.md']],
      ['not_required', []],
      ['pending', ['docs/UI_UX_SPEC.md']],
    ])
    expect(state.lanes.flatMap(lane => lane.ownedPaths)).toEqual([
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/BALANCE_DESIGN.md',
      'docs/TECHNICAL_DESIGN.md',
      'docs/ASSET_PLAN.md',
      'docs/ART_DIRECTION.md',
      'docs/UI_UX_SPEC.md',
      'docs/AUDIO_DESIGN.md',
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

    const duplicated = structuredClone(state)
    duplicated.lanes[1] = {
      ...duplicated.lanes[1],
      id: 'core-design',
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
})

function foundationRemediationLanesAreFrozen(): boolean {
  return (
    Object.isFrozen(FOUNDATION_REMEDIATION_LANES) &&
    FOUNDATION_REMEDIATION_LANES.every(
      lane => Object.isFrozen(lane) && Object.isFrozen(lane.ownedPaths),
    )
  )
}
