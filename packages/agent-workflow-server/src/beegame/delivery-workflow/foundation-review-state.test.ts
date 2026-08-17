import { describe, expect, test } from 'bun:test'
import {
  assertFoundationReviewState,
  createFoundationReviewState,
} from './foundation-review-state'

const revision = 'a'.repeat(64)

describe('foundation review state', () => {
  test('creates the exact initial Reviewer role topology without remediation authority', () => {
    const state = createFoundationReviewState({ revision, attempt: 1 })
    const root = `.beegame/reviews/foundation/${revision}`

    expect(state.reports.map(report => report.role)).toEqual([
      'core-design',
      'technical-assets',
      'presentation',
      'synthesis',
    ])
    expect(state.reports.map(report => report.path)).toEqual([
      `${root}/parts/core-design.md`,
      `${root}/parts/technical-assets.md`,
      `${root}/parts/presentation.md`,
      `${root}/selection.md`,
    ])
    expect(state).not.toHaveProperty('mode')
    expect(state).not.toHaveProperty('priorReviewPath')
    expect(state).not.toHaveProperty('priorReviewDigest')
  })

  test('rejects topology, completion, barrier, and revision mismatches', () => {
    const initial = createFoundationReviewState({ revision, attempt: 1 })
    expect(() =>
      assertFoundationReviewState({
        ...initial,
        reports: [
          initial.reports[0],
          initial.reports[0],
          initial.reports[2],
          initial.reports[3],
        ],
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
          report.role === 'synthesis'
            ? { ...report, status: 'running' as const }
            : report,
        ),
      }),
    ).toThrow('foundation synthesis requires completed lane packets')
    expect(() =>
      createFoundationReviewState({ revision: 'not-a-digest', attempt: 1 }),
    ).toThrow()

    const completedReports = initial.reports.map(report => ({
      ...report,
      status: 'completed' as const,
      digest: 'b'.repeat(64),
    }))
    expect(() =>
      assertFoundationReviewState({
        ...initial,
        status: 'completed',
        reports: completedReports,
        finalReportPath: `.beegame/reviews/foundation/${revision}/selection.md`,
        finalReportDigest: 'c'.repeat(64),
        verdict: 'READY',
      }),
    ).toThrow('completed foundation review final report path is invalid')
  })
})
