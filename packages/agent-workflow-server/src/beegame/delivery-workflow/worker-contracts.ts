import { z } from 'zod/v4'
import { atomicTaskSchema } from './schema'
import { documentReviewCheckSchema } from './document-review-check-schema'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
  type DocumentReviewCheckId,
  type DocumentReviewCriterionId,
  type GameDesignDocumentReviewCheckId,
} from './types'

const base = z.object({ revision: z.string().min(1) }).strict()

const documentReviewFindingShape = {
  findingId: z.string().trim().min(1),
  checkId: z.enum(COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS),
  severity: z.literal('blocking'),
  owner: z.enum(['foundation', 'checklist', 'resource']),
  evidence: z
    .array(
      z
        .object({
          path: z.string().min(1),
          anchor: z.string().trim().min(1),
        })
        .strict(),
    )
    .min(1),
  subjects: z
    .array(
      z
        .object({
          path: z
            .string()
            .min(1)
            .describe(
              'Canonical artifact path that the finding requiredAction requires to change; contextual or already-correct evidence is not a subject.',
            ),
          anchor: z.string().trim().min(1),
          requirementId: z.string().min(1).optional(),
          resourceId: z.string().min(1).optional(),
          contentId: z.string().min(1).optional(),
        })
        .strict(),
    )
    .min(1)
    .describe(
      'Complete mutation scope for this finding. Every listed artifact must change, and every artifact required to change must be listed.',
    ),
  observation: z.string().trim().min(1),
  blockingReason: z.string().trim().min(1),
  requiredAction: z
    .string()
    .min(1)
    .describe(
      'Required correction whose complete canonical mutation paths are exactly the finding subjects.',
    ),
  closureCondition: z.string().trim().min(1),
} as const

function refineDocumentReviewFinding(
  finding: {
    owner: 'foundation' | 'checklist' | 'resource'
    subjects: Array<{
      requirementId?: string
      resourceId?: string
      contentId?: string
    }>
  },
  context: z.RefinementCtx,
): void {
  const semanticSubjectCount = finding.subjects.filter(
    subject => subject.requirementId || subject.resourceId || subject.contentId,
  ).length
  if (finding.owner === 'resource' && semanticSubjectCount === 0)
    context.addIssue({
      code: 'custom',
      path: ['subjects'],
      message:
        'resource findings require at least one current manifest subject',
    })
  if (finding.owner !== 'resource' && semanticSubjectCount > 0)
    context.addIssue({
      code: 'custom',
      path: ['subjects'],
      message:
        'foundation and checklist findings cannot carry resource subjects',
    })
}

export const documentReviewInitialFindingSchema = z
  .object(documentReviewFindingShape)
  .strict()
  .superRefine(refineDocumentReviewFinding)

export const documentReviewFindingSchema = z
  .object({
    ...documentReviewFindingShape,
    regressionPaths: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .superRefine(refineDocumentReviewFinding)

const documentReviewSubmissionFindingShape = {
  findingId: documentReviewFindingShape.findingId,
  evidence: documentReviewFindingShape.evidence,
  subjects: documentReviewFindingShape.subjects,
  observation: documentReviewFindingShape.observation,
  blockingReason: documentReviewFindingShape.blockingReason,
  requiredAction: documentReviewFindingShape.requiredAction,
  closureCondition: documentReviewFindingShape.closureCondition,
}

function documentReviewCheckSubmissionFindingSchema(
  mode: 'initial' | 'closure',
  _scope: 'foundation' | 'complete',
) {
  const subjects = z
    .array(
      z
        .object({
          referenceId: z.string().trim().min(1),
          requirementId: z.string().min(1).optional(),
          resourceId: z.string().min(1).optional(),
          contentId: z.string().min(1).optional(),
        })
        .strict(),
    )
    .min(1)
  return z
    .object({
      findingId: documentReviewSubmissionFindingShape.findingId,
      evidence: z.array(documentReviewReferenceSchema).min(1),
      subjects,
      observation: documentReviewSubmissionFindingShape.observation,
      blockingReason: documentReviewSubmissionFindingShape.blockingReason,
      requiredAction: documentReviewSubmissionFindingShape.requiredAction,
      closureCondition: documentReviewSubmissionFindingShape.closureCondition,
      ...(mode === 'closure'
        ? { regressionPaths: z.array(z.string().min(1)).optional() }
        : {}),
    })
    .strict()
}

const documentReviewReferenceSchema = z
  .object({ referenceId: z.string().trim().min(1) })
  .strict()

const documentReviewCriterionIds = Object.values(
  GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
).flat() as DocumentReviewCriterionId[]

function documentReviewCheckSubmissionSchemaForCheck(
  currentCheckId: (typeof COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS)[number],
) {
  return z
    .object({
      conclusion: z.string().trim().min(1),
      evidence: z.array(documentReviewReferenceSchema).min(1),
      assessments: z
        .array(
          z
            .object({
              criterion: z.enum(documentReviewCriterionIds),
              status: z.enum(['pass', 'block']),
              evidence: z.array(documentReviewReferenceSchema).min(1),
              derivation: z.string().trim().min(1),
              conclusion: z.string().trim().min(1),
            })
            .strict(),
        )
        .max(3),
    })
    .strict()
    .superRefine((check, context) => {
      const criteria =
        GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA[
          currentCheckId as GameDesignDocumentReviewCheckId
        ]
      if (!criteria) {
        if (check.assessments.length)
          context.addIssue({
            code: 'custom',
            path: ['assessments'],
            message: 'non-design review checks cannot submit assessments',
          })
        return
      }
      const submitted = check.assessments.map(item => item.criterion)
      if (
        submitted.length !== criteria.length ||
        new Set(submitted).size !== criteria.length ||
        criteria.some(id => !submitted.includes(id))
      )
        context.addIssue({
          code: 'custom',
          path: ['assessments'],
          message: `design review check ${currentCheckId} requires its exact criterion set`,
        })
    })
}

export { documentReviewCheckSchema } from './document-review-check-schema'

export const documentRepairDecisionSubmissionSchema = z
  .object({
    decision: z.string().trim().min(1),
  })
  .strict()

export const documentAuthorTerminalSchema = z
  .object({
    workerType: z.literal('document-author'),
    status: z.literal('completed'),
    writtenPaths: z.array(z.string().min(1)),
    resolvedFindingIds: z.array(z.string().min(1)).optional(),
    repairDecision: documentRepairDecisionSubmissionSchema.optional(),
  })
  .strict()

export const documentAuthorSubmissionSchema = z
  .object({
    resolvedFindingIds: z.array(z.string().min(1)),
  })
  .strict()

function requireConsistentDocumentReviewCheck(
  value: {
    check: { assessments: Array<{ status: 'pass' | 'block' }> }
    findings: Array<{ findingId: string }>
  },
  context: z.RefinementCtx,
): void {
  const findingIds = value.findings.map(finding => finding.findingId)
  if (new Set(findingIds).size !== findingIds.length)
    context.addIssue({
      code: 'custom',
      path: ['findings'],
      message: 'document review finding codes must be unique',
    })
  const assessmentBlocks = value.check.assessments.some(
    item => item.status === 'block',
  )
  if (
    value.check.assessments.length > 0 &&
    assessmentBlocks !== value.findings.length > 0
  )
    context.addIssue({
      code: 'custom',
      path: ['findings'],
      message: 'blocked design assessments and findings must agree',
    })
}

function documentReviewCheckSubmissionContractSchema<
  FindingSchema extends z.ZodType<{
    findingId: string
  }>,
>(findingSchema: FindingSchema, currentCheckId: DocumentReviewCheckId) {
  return z
    .object({
      check: documentReviewCheckSubmissionSchemaForCheck(currentCheckId),
      findings: z.array(findingSchema),
    })
    .strict()
    .superRefine(requireConsistentDocumentReviewCheck)
}

export function documentReviewCheckSubmissionSchemaForMode(
  mode: 'initial' | 'closure',
  scope: 'foundation' | 'complete' = 'complete',
  currentCheckId: DocumentReviewCheckId = COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS[0],
) {
  return documentReviewCheckSubmissionContractSchema(
    documentReviewCheckSubmissionFindingSchema(mode, scope),
    currentCheckId,
  )
}

export const documentReviewerTerminalSchema = base
  .extend({
    workerType: z.literal('document-reviewer'),
    verdict: z.enum(['READY', 'NEEDS_REVISION', 'BLOCKED']),
    checks: z.array(documentReviewCheckSchema).min(1),
    reviewedDocumentPaths: z.array(z.string().min(1)),
    checklistIds: z.array(z.string().min(1)),
    findings: z.array(documentReviewFindingSchema),
    evidencePath: z.string().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const checks = value.checks
    const findings = value.findings
    const findingIds = new Set(findings.map(finding => finding.findingId))
    if (new Set(checks.map(check => check.id)).size !== checks.length)
      context.addIssue({
        code: 'custom',
        path: ['checks'],
        message: 'document review check IDs must be unique',
      })
    for (const [index, check] of checks.entries()) {
      if (check.status === 'pass' && check.findingIds.length)
        context.addIssue({
          code: 'custom',
          path: ['checks', index, 'findingIds'],
          message: 'passing checks cannot reference findings',
        })
      if (
        check.status === 'block' &&
        (!check.findingIds.length ||
          check.findingIds.some(id => !findingIds.has(id)))
      )
        context.addIssue({
          code: 'custom',
          path: ['checks', index, 'findingIds'],
          message: 'blocking checks require known findings',
        })
    }
    const blocked = checks.some(check => check.status === 'block')
    if ((value.verdict === 'READY') !== (!blocked && findings.length === 0))
      context.addIssue({
        code: 'custom',
        path: ['verdict'],
        message: 'document review verdict does not match the canonical ledger',
      })
  })

export const resourcePreparerTerminalSchema = base
  .extend({
    workerType: z.literal('resource-preparer'),
    status: z.enum(['completed', 'failed', 'blocked']),
    writtenPaths: z.array(z.string().min(1)),
    resourceIds: z.array(z.string().min(1)),
    contentIds: z.array(z.string().min(1)),
    evidencePath: z.string().min(1),
  })
  .strict()

export const atomicTaskPlannerTerminalSchema = base
  .extend({
    workerType: z.literal('atomic-task-planner'),
    status: z.literal('completed'),
    tasks: z.array(atomicTaskSchema).min(1),
    evidencePath: z.string().min(1),
  })
  .strict()

export const implementationWorkerTerminalSchema = base
  .extend({
    workerType: z.literal('implementation-worker'),
    taskId: z.string().min(1),
    status: z.enum(['completed', 'failed', 'blocked']),
    changedPaths: z.array(z.string().min(1)),
    verifiedArtifacts: z.array(z.string().min(1)),
    verificationResults: z.array(
      z
        .object({
          verificationIndex: z.number().int().nonnegative(),
          status: z.enum(['passed', 'deferred']),
          observations: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    // These values are service-owned. The parser installs an internal
    // placeholder so the persisted workflow type stays uniform; dispatch
    // replaces it with the canonical dispatch-scoped path before validation.
    evidenceRefs: z.array(z.string().min(1)),
    evidencePath: z.string().min(1),
  })
  .strict()

const implementationFindingSchema = z
  .object({
    taskIds: z.array(z.string().min(1)),
    checklistIds: z.array(z.string().min(1)),
    artifactPaths: z.array(z.string().min(1)).min(1),
    description: z.string().min(1),
    requiredAction: z.string().min(1),
  })
  .strict()

function requireActionableFindings(
  value: { status: 'passed' | 'failed' | 'blocked'; findings: unknown[] },
  context: z.RefinementCtx,
): void {
  if (value.status !== 'passed' && value.findings.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['findings'],
      message: 'failed or blocked validation requires actionable findings',
    })
  }
  if (value.status === 'passed' && value.findings.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['findings'],
      message: 'passed validation cannot contain findings',
    })
  }
}

export const implementationAuditorTerminalSchema = base
  .extend({
    workerType: z.literal('implementation-auditor'),
    status: z.enum(['passed', 'failed', 'blocked']),
    auditedTaskIds: z.array(z.string().min(1)),
    checklistIds: z.array(z.string().min(1)),
    resourceIds: z.array(z.string().min(1)),
    contentIds: z.array(z.string().min(1)),
    findings: z.array(implementationFindingSchema),
    evidencePath: z.string().min(1),
  })
  .strict()
  .superRefine(requireActionableFindings)

export const acceptanceValidatorTerminalSchema = base
  .extend({
    workerType: z.literal('acceptance-validator'),
    status: z.enum(['passed', 'failed', 'blocked']),
    validatedTaskIds: z.array(z.string().min(1)),
    checklistIds: z.array(z.string().min(1)),
    resourceIds: z.array(z.string().min(1)),
    contentIds: z.array(z.string().min(1)),
    findings: z.array(implementationFindingSchema),
    evidencePath: z.string().min(1),
  })
  .strict()
  .superRefine(requireActionableFindings)

export const changeImpactTerminalSchema = z
  .object({
    workerType: z.literal('change-impact-analyzer'),
    classification: z.enum([
      'question',
      'implementation_only',
      'documents_required',
    ]),
    affectedRequirementIds: z.array(z.string().min(1)),
    affectedChecklistIds: z.array(z.string().min(1)),
    rationale: z.string().min(1),
    evidencePath: z.string().min(1),
  })
  .strict()

export const changeImpactSubmissionSchema = changeImpactTerminalSchema.omit({
  workerType: true,
  evidencePath: true,
})

export const questionAnswerTerminalSchema = z
  .object({
    workerType: z.literal('question-answerer'),
    answer: z.string().min(1),
    evidencePath: z.string().min(1),
  })
  .strict()

export const questionAnswerSubmissionSchema = questionAnswerTerminalSchema.omit(
  {
    workerType: true,
    evidencePath: true,
  },
)

export const workerTerminalSchema = z.discriminatedUnion('workerType', [
  documentAuthorTerminalSchema,
  documentReviewerTerminalSchema,
  resourcePreparerTerminalSchema,
  atomicTaskPlannerTerminalSchema,
  implementationWorkerTerminalSchema,
  implementationAuditorTerminalSchema,
  acceptanceValidatorTerminalSchema,
  changeImpactTerminalSchema,
  questionAnswerTerminalSchema,
])

export type WorkerTerminalResult = z.infer<typeof workerTerminalSchema>

export function parseWorkerTerminalResult(
  value: unknown,
): WorkerTerminalResult {
  return workerTerminalSchema.parse(value)
}
