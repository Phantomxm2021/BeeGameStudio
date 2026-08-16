import { describe, expect, test } from 'bun:test'
import {
  assertFoundationReviewState,
  createFoundationReviewState,
} from './foundation-review-state'

const revision = 'a'.repeat(64)

describe('foundation review state', () => {
  test('creates the exact initial and verification role topologies', () => {
    expect(
      createFoundationReviewState({ mode: 'initial', revision }).reports.map(
        report => report.role,
      ),
    ).toEqual(['contract-specialist', 'integration-specialist', 'final'])
    expect(
      createFoundationReviewState({
        mode: 'verification',
        revision,
        priorReviewPath: '.beegame/reviews/foundation/prior/review.json',
        priorReviewDigest: 'b'.repeat(64),
      }).reports.map(report => report.role),
    ).toEqual(['final'])
  })

  test('rejects topology, completion, barrier, revision, and prior-review mismatches', () => {
    const initial = createFoundationReviewState({ mode: 'initial', revision })
    expect(() =>
      assertFoundationReviewState({
        ...initial,
        reports: [initial.reports[0], initial.reports[0], initial.reports[2]],
      }),
    ).toThrow('foundation review report topology does not match mode')
    expect(() =>
      assertFoundationReviewState({
        ...initial,
        reports: initial.reports.map((report, index) =>
          index === 0 ? { ...report, status: 'completed' as const } : report,
        ),
      }),
    ).toThrow('completed foundation review report requires a digest')
    expect(() =>
      assertFoundationReviewState({
        ...initial,
        reports: initial.reports.map(report =>
          report.role === 'final'
            ? { ...report, status: 'running' as const }
            : report,
        ),
      }),
    ).toThrow('foundation final review requires completed specialist packets')
    expect(() =>
      createFoundationReviewState({ mode: 'initial', revision: 'not-a-digest' }),
    ).toThrow()
    expect(() =>
      createFoundationReviewState({
        mode: 'verification',
        revision,
        priorReviewPath: '.beegame/reviews/foundation/prior/review.json',
      }),
    ).toThrow('verification review requires prior review path and digest')
    expect(() =>
      createFoundationReviewState({
        mode: 'initial',
        revision,
        priorReviewPath: '.beegame/reviews/foundation/prior/review.json',
        priorReviewDigest: 'b'.repeat(64),
      }),
    ).toThrow('initial review cannot contain prior review authority')
  })
})
