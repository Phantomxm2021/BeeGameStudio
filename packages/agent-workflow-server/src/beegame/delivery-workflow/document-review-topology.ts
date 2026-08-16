import { resolve } from 'node:path'
import {
  reviewDecisionPath,
  reviewPartPath,
  reviewReportPath,
  reviewStagingPath,
  type DocumentReviewScope,
} from './document-review-report'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
} from './types'

export type DocumentReviewRole =
  | 'core-systems'
  | 'player-experience'
  | 'production-delivery'
  | 'checklist'
  | 'complete-gameplay'
  | 'complete-technical'
  | 'complete-experience'
  | 'complete-production'
  | 'final'

export type DocumentReviewAssignment = {
  scope: DocumentReviewScope
  role: DocumentReviewRole
  sourcePaths: string[]
  stagingOutputPaths: string[]
  committedOutputPaths: string[]
  verificationSourcePaths: string[]
}

const COMPLETE_ROLE_PATHS = {
  'complete-gameplay': [
    'docs/GDD.md',
    'docs/acceptance/gameplay-checklist.md',
    CANONICAL_ASSET_MANIFEST,
  ],
  'complete-technical': [
    'docs/TECHNICAL_DESIGN.md',
    'docs/ASSET_PLAN.md',
    CANONICAL_ASSET_MANIFEST,
  ],
  'complete-experience': [
    'docs/ART_DIRECTION.md',
    'docs/UI_UX_SPEC.md',
    'docs/AUDIO_DESIGN.md',
  ],
  'complete-production': [
    'docs/ASSET_PLAN.md',
    CANONICAL_ASSET_MANIFEST,
    'assets/content/resource-registry.json',
  ],
} as const

function specialistAssignment(input: {
  scope: DocumentReviewScope
  role: Exclude<DocumentReviewRole, 'final'>
  relativeSourcePaths: readonly string[]
  workspacePath: string
  revision: string
}): DocumentReviewAssignment {
  return {
    scope: input.scope,
    role: input.role,
    sourcePaths: input.relativeSourcePaths.map(path =>
      resolve(input.workspacePath, path),
    ),
    stagingOutputPaths: [
      reviewStagingPath(
        input.workspacePath,
        input.scope,
        input.revision,
        `review-${input.role}`,
        `${input.role}.md`,
      ),
    ],
    committedOutputPaths: [
      reviewPartPath(
        input.workspacePath,
        input.scope,
        input.revision,
        input.role,
      ),
    ],
    verificationSourcePaths: [],
  }
}

export function documentReviewAssignments(input: {
  scope: DocumentReviewScope
  workspacePath: string
  revision: string
  approvedFoundationRevision?: string
}): DocumentReviewAssignment[] {
  if (input.scope === 'foundation') return []

  if (input.scope === 'checklist') {
    if (!input.approvedFoundationRevision)
      throw new Error(
        'checklist review requires the accepted foundation revision',
      )
    return [
      specialistAssignment({
        ...input,
        role: 'checklist',
        relativeSourcePaths: [
          'docs/acceptance/gameplay-checklist.md',
          'docs/GDD.md',
          reviewReportPath(
            input.workspacePath,
            'foundation',
            input.approvedFoundationRevision,
          ),
        ],
      }),
    ]
  }

  return Object.entries(COMPLETE_ROLE_PATHS).map(([role, paths]) =>
    specialistAssignment({
      ...input,
      role: role as keyof typeof COMPLETE_ROLE_PATHS,
      relativeSourcePaths: paths,
    }),
  )
}

export function finalReviewAssignment(input: {
  scope: DocumentReviewScope
  workspacePath: string
  revision: string
  specialists: readonly DocumentReviewAssignment[]
  previousReportPath?: string
}): DocumentReviewAssignment {
  if (
    input.specialists.some(
      assignment =>
        assignment.scope !== input.scope || assignment.role === 'final',
    )
  )
    throw new Error('final review specialists do not match the active scope')
  const sourcePaths = [
    ...(input.previousReportPath
      ? [resolve(input.workspacePath, input.previousReportPath)]
      : []),
    ...input.specialists.flatMap(assignment => assignment.committedOutputPaths),
  ]
  const verificationSourcePaths =
    input.scope === 'foundation' && input.specialists.length === 0
      ? CANONICAL_FOUNDATION_DOCUMENTS.map(path =>
          resolve(input.workspacePath, path),
        )
      : [
          ...new Set(
            input.specialists.flatMap(assignment => assignment.sourcePaths),
          ),
        ]
  return {
    scope: input.scope,
    role: 'final',
    sourcePaths,
    stagingOutputPaths: [
      reviewStagingPath(
        input.workspacePath,
        input.scope,
        input.revision,
        'review-final',
        'review.md',
      ),
      reviewStagingPath(
        input.workspacePath,
        input.scope,
        input.revision,
        'review-final',
        'decision.json',
      ),
    ],
    committedOutputPaths: [
      reviewReportPath(input.workspacePath, input.scope, input.revision),
      reviewDecisionPath(input.workspacePath, input.scope, input.revision),
    ],
    verificationSourcePaths,
  }
}
