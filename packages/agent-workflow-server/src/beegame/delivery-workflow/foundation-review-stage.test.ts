import { describe, expect, test } from 'bun:test'
import { createFoundationReviewState } from './foundation-review-state'
import { buildFoundationReviewDispatches } from './foundation-review-stage'

const revision = 'a'.repeat(64)

function completedSpecialists() {
  const state = createFoundationReviewState({ mode: 'initial', revision })
  return {
    ...state,
    status: 'running' as const,
    reports: state.reports.map(report =>
      report.role === 'final'
        ? report
        : {
            ...report,
            status: 'completed' as const,
            digest:
              report.role === 'contract-specialist'
                ? 'b'.repeat(64)
                : 'c'.repeat(64),
          },
    ),
  }
}

describe('foundation review dispatch barrier', () => {
  test('dispatches both independent specialists before one final reviewer', () => {
    const initial = createFoundationReviewState({ mode: 'initial', revision })
    const specialistDispatches = buildFoundationReviewDispatches({
      state: initial,
      workspacePath: '/workspace',
      confirmedBriefDigest: 'd'.repeat(64),
    })
    expect(specialistDispatches.map(dispatch => dispatch.role)).toEqual([
      'contract-specialist',
      'integration-specialist',
    ])
    expect(
      specialistDispatches.every(
        dispatch =>
          dispatch.assignment.stagingOutputPaths.length === 1 &&
          dispatch.assignment.committedOutputPaths.length === 1 &&
          dispatch.assignment.sourcePaths.length === 8,
      ),
    ).toBe(true)

    const oneCompleted = {
      ...initial,
      status: 'running' as const,
      reports: initial.reports.map(report =>
        report.role === 'contract-specialist'
          ? { ...report, status: 'completed' as const, digest: 'b'.repeat(64) }
          : report.role === 'integration-specialist'
            ? { ...report, status: 'running' as const }
            : report,
      ),
    }
    expect(
      buildFoundationReviewDispatches({
        state: oneCompleted,
        workspacePath: '/workspace',
        confirmedBriefDigest: 'd'.repeat(64),
      }),
    ).toEqual([])

    const finalDispatches = buildFoundationReviewDispatches({
      state: completedSpecialists(),
      workspacePath: '/workspace',
      confirmedBriefDigest: 'd'.repeat(64),
    })
    expect(finalDispatches.map(dispatch => dispatch.role)).toEqual(['final'])
    expect(finalDispatches[0].contract.packetDigests).toEqual({
      'contract-specialist': 'b'.repeat(64),
      'integration-specialist': 'c'.repeat(64),
    })
  })

  test('dispatches verification as one standalone final reviewer', () => {
    const state = createFoundationReviewState({
      mode: 'verification',
      revision,
      attempt: 2,
      priorReviewPath: '.beegame/reviews/foundation/prior/review.json',
      priorReviewDigest: 'e'.repeat(64),
    })
    const dispatches = buildFoundationReviewDispatches({
      state,
      workspacePath: '/workspace',
      confirmedBriefDigest: 'd'.repeat(64),
    })
    expect(dispatches.map(dispatch => dispatch.role)).toEqual(['final'])
    expect(dispatches[0].contract.reviewMode).toBe('verification')
    expect(dispatches[0].contract.priorReview).toEqual({
      path: '.beegame/reviews/foundation/prior/review.json',
      digest: 'e'.repeat(64),
    })
  })
})
