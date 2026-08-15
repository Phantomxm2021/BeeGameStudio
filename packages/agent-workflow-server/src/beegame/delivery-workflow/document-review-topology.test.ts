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
  test('covers all foundation documents with five bounded specialist roles', () => {
    const assignments = documentReviewAssignments({
      scope: 'foundation',
      workspacePath,
      revision,
    })

    expect(assignments.map(value => value.role)).toEqual([
      'gameplay',
      'technical',
      'experience',
      'presentation',
      'production',
    ])
    expect(new Set(assignments.flatMap(value => value.sourcePaths))).toEqual(
      new Set(
        CANONICAL_FOUNDATION_DOCUMENTS.map(path =>
          resolve(workspacePath, path),
        ),
      ),
    )
    expect(assignments.every(value => value.sourcePaths.length <= 3)).toBe(true)
    expect(
      assignments.every(value => value.stagingOutputPaths.length === 1),
    ).toBe(true)
    expect(
      assignments.every(value => value.committedOutputPaths.length === 1),
    ).toBe(true)
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
          `.beegame/reviews/foundation/${revision}/review.md`,
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
        value.sourcePaths.includes(resolve(workspacePath, CANONICAL_ASSET_MANIFEST)),
      ),
    ).toBe(true)
    expect(assignments.every(value => value.sourcePaths.length <= 3)).toBe(true)
  })

  test('final review consumes committed specialist reports and owns two outputs', () => {
    const specialists = documentReviewAssignments({
      scope: 'foundation',
      workspacePath,
      revision,
    })
    const final = finalReviewAssignment({
      scope: 'foundation',
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
        `.beegame/reviews/foundation/${revision}/review.md`,
      ),
      resolve(
        workspacePath,
        `.beegame/reviews/foundation/${revision}/decision.json`,
      ),
    ])
  })
})
