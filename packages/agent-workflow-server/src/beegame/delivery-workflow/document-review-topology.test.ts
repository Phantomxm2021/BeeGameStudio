import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
} from './types'
import {
  documentReviewAssignments,
  finalReviewAssignment,
} from './document-review-topology'

const workspacePath = '/project'
const revision = 'a'.repeat(64)

describe('bounded document review topology', () => {
  test('reviews all foundation documents once in the final assignment', () => {
    const assignments = documentReviewAssignments({
      scope: 'foundation',
      workspacePath,
      revision,
    })
    const final = finalReviewAssignment({
      scope: 'foundation',
      workspacePath,
      revision,
      specialists: assignments,
    })

    expect(assignments).toEqual([])
    expect(final.sourcePaths).toEqual([])
    expect(final.verificationSourcePaths).toEqual(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => resolve(workspacePath, path)),
    )
    expect(final.stagingOutputPaths).toEqual([
      resolve(
        workspacePath,
        `.beegame/reviews/foundation/${revision}/.staging/review-final/review.json`,
      ),
    ])
    expect(final.committedOutputPaths).toEqual([
      resolve(
        workspacePath,
        `.beegame/reviews/foundation/${revision}/review.json`,
      ),
    ])
  })

  test('uses one bounded checklist review against its accepted foundation authority', () => {
    const assignments = documentReviewAssignments({
      scope: 'checklist',
      workspacePath,
      revision,
      approvedFoundationRevision: revision,
    })

    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({
      role: 'checklist',
      sourcePaths: [
        resolve(workspacePath, 'docs/acceptance/gameplay-checklist.md'),
        resolve(workspacePath, 'docs/GDD.md'),
        resolve(
          workspacePath,
          `.beegame/reviews/foundation/${revision}/review.json`,
        ),
      ],
    })
  })

  test('covers complete delivery without assigning every artifact to one reviewer', () => {
    const assignments = documentReviewAssignments({
      scope: 'complete',
      workspacePath,
      revision,
      approvedFoundationRevision: revision,
    })

    expect(assignments.map(value => value.role)).toEqual([
      'complete-gameplay',
      'complete-technical',
      'complete-experience',
      'complete-production',
    ])
    expect(
      assignments.some(value =>
        value.sourcePaths.includes(
          resolve(workspacePath, CANONICAL_ASSET_MANIFEST),
        ),
      ),
    ).toBe(true)
    expect(assignments.every(value => value.sourcePaths.length <= 3)).toBe(true)
  })

  test('consolidated reviews still consume committed specialist reports', () => {
    const specialists = documentReviewAssignments({
      scope: 'complete',
      workspacePath,
      revision,
    })
    const final = finalReviewAssignment({
      scope: 'complete',
      workspacePath,
      revision,
      specialists,
    })

    expect(final.role).toBe('final')
    expect(final.sourcePaths).toEqual(
      specialists.flatMap(value => value.committedOutputPaths),
    )
    expect(final.stagingOutputPaths).toHaveLength(2)
    expect(final.committedOutputPaths).toEqual([
      resolve(
        workspacePath,
        `.beegame/reviews/complete/${revision}/review.md`,
      ),
      resolve(
        workspacePath,
        `.beegame/reviews/complete/${revision}/decision.json`,
      ),
    ])
  })
})
