import { z } from 'zod/v4'
import {
  DOCUMENT_REVIEW_CHECK_IDS,
  GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
  type DocumentReviewCheck,
  type DocumentReviewCriterionId,
  type GameDesignDocumentReviewCheckId,
} from './types'

const criterionIds = Object.values(
  GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
).flat() as DocumentReviewCriterionId[]

const evidenceSchema = z
  .object({
    path: z.string().min(1),
    anchor: z.string().trim().min(1),
  })
  .strict()

const assessmentSchema = z
  .object({
    criterion: z.enum(criterionIds),
    status: z.enum(['pass', 'block']),
    evidence: z.array(evidenceSchema).min(1),
    derivation: z.string().trim().min(1),
    conclusion: z.string().trim().min(1),
  })
  .strict()

export const documentReviewCheckSchema: z.ZodType<DocumentReviewCheck> = z
  .object({
    id: z.enum(DOCUMENT_REVIEW_CHECK_IDS),
    status: z.enum(['pass', 'block']),
    conclusion: z.string().trim().min(1),
    evidence: z.array(evidenceSchema).min(1),
    findingIds: z.array(z.string().min(1)),
    assessments: z.array(assessmentSchema).max(3),
  })
  .strict()
  .superRefine((check, context) => {
    const criteria =
      GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA[
        check.id as GameDesignDocumentReviewCheckId
      ]
    if (!criteria) {
      if (check.assessments.length > 0)
        context.addIssue({
          code: 'custom',
          path: ['assessments'],
          message: 'non-design review checks cannot submit design criteria',
        })
      return
    }

    const submittedCriteria = check.assessments.map(item => item.criterion)
    if (
      submittedCriteria.length !== criteria.length ||
      new Set(submittedCriteria).size !== criteria.length ||
      criteria.some(criterion => !submittedCriteria.includes(criterion))
    )
      context.addIssue({
        code: 'custom',
        path: ['assessments'],
        message: `design review check ${check.id} requires its exact criterion set`,
      })

    const assessmentBlocks = check.assessments.some(
      assessment => assessment.status === 'block',
    )
    if ((check.status === 'block') !== assessmentBlocks)
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'design review check status must match its criterion statuses',
      })
  })
