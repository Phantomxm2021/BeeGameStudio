import { createHash } from 'node:crypto'
import { createInitialDeliveryRun } from '../beegame/delivery-workflow/run-store'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
  type DocumentReviewCheckId,
} from '../beegame/delivery-workflow/types'

type InitialRunInput = Omit<
  Parameters<typeof createInitialDeliveryRun>[0],
  'confirmedBriefContext' | 'confirmedBriefDigest'
> & {
  confirmedBriefContext?: string
  confirmedBriefDigest?: string
  /** Downstream fixtures default to an already completed Foundation pass. */
  foundationDraftComplete?: boolean
}

/** Builds the same digest-bound authority required by production run creation. */
export function createTestDeliveryRun(input: InitialRunInput) {
  const confirmedBriefContext =
    input.confirmedBriefContext ??
    `Confirmed delivery brief for ${input.projectId}`
  const rest = { ...input }
  delete rest.confirmedBriefDigest
  delete rest.foundationDraftComplete
  const run = createInitialDeliveryRun({
    ...rest,
    confirmedBriefContext,
    confirmedBriefDigest: createHash('sha256')
      .update(confirmedBriefContext)
      .digest('hex'),
  })
  return {
    ...run,
    foundationDraftState: {
      completedPaths:
        input.foundationDraftComplete === false
          ? []
          : [...CANONICAL_FOUNDATION_DOCUMENTS],
    },
  }
}

export function createAcceptedComprehensiveReview(input?: {
  blockingCheckId?: DocumentReviewCheckId
  findingIds?: string[]
}) {
  const requiredCheckIds = [...COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS]
  return {
    requiredCheckIds,
    completedCheckIds: [...requiredCheckIds],
    checks: requiredCheckIds.map(id => {
      const blocked = id === input?.blockingCheckId
      return {
        id,
        status: blocked ? ('block' as const) : ('pass' as const),
        conclusion: blocked
          ? 'Canonical remediation is required.'
          : 'The canonical check passed.',
        evidence: [{ path: 'assets/asset-manifest.json', anchor: '$' }],
        findingIds: blocked ? (input?.findingIds ?? []) : [],
        assessments:
          id in GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA
            ? GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA[
                id as keyof typeof GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA
              ].map(criterion => ({
                criterion,
                status: 'pass' as const,
                evidence: [
                  { path: 'assets/asset-manifest.json', anchor: '$' },
                ],
                derivation: 'The fixture satisfies the canonical criterion.',
                conclusion: 'The criterion passed.',
              }))
            : [],
      }
    }),
  }
}
