import { createHash } from 'node:crypto'
import { createInitialDeliveryRun } from '../beegame/delivery-workflow/run-store'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
  type DeliveryRun,
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
  /** Resource and later phases must opt into a current frozen Checklist pass. */
  checklistApproved?: boolean
}

/** Builds the same digest-bound authority required by production run creation. */
export function createTestDeliveryRun(input: InitialRunInput): DeliveryRun {
  const confirmedBriefContext =
    input.confirmedBriefContext ??
    `Confirmed delivery brief for ${input.projectId}`
  const rest = { ...input }
  delete rest.confirmedBriefDigest
  delete rest.foundationDraftComplete
  delete rest.checklistApproved
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
    resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
    ...(input.checklistApproved
      ? {
          documentReviewState: {
            ...run.documentReviewState,
            checklistApproval: {
              scope: 'checklist' as const,
              revision: run.revision.document,
              checks: [
                {
                  id: 'checklist_traceability' as const,
                  status: 'pass' as const,
                  conclusion: 'The current Checklist is approved.',
                  evidence: [
                    {
                      path: 'docs/acceptance/gameplay-checklist.md',
                      anchor: '$',
                    },
                  ],
                  findingIds: [],
                  assessments: [],
                },
              ],
              checkEvidenceDigests: {},
              evidencePath: '.beegame/workflow/evidence/checklist.json',
              approvedAt: '2026-08-05T00:00:00.000Z',
            },
          },
        }
      : {}),
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
                evidence: [{ path: 'assets/asset-manifest.json', anchor: '$' }],
                derivation: 'The fixture satisfies the canonical criterion.',
                conclusion: 'The criterion passed.',
              }))
            : [],
      }
    }),
  }
}
