import { z } from 'zod/v4'
import { atomicTaskSchema } from './schema'
import { documentReviewCheckSchema } from './document-review-check-schema'
import {
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
} from './types'

const base = z.object({ revision: z.string().min(1) }).strict()

const documentReviewFindingShape = {
    findingId: z.string().trim().min(1),
    checkId: z.enum(COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS),
    severity: z.literal('blocking'),
    owner: z.enum(['foundation', 'checklist', 'resource']),
    subjects: z.array(z.object({
      path: z.string().min(1),
      anchor: z.string().trim().min(1),
      requirementId: z.string().min(1).optional(),
      resourceId: z.string().min(1).optional(),
      contentId: z.string().min(1).optional(),
    }).strict()).min(1),
    observation: z.string().trim().min(1),
    blockingReason: z.string().trim().min(1),
    requiredAction: z.string().min(1),
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
  const semanticSubjectCount = finding.subjects.filter(subject =>
    subject.requirementId || subject.resourceId || subject.contentId,
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
  checkId: documentReviewFindingShape.checkId,
  subjects: documentReviewFindingShape.subjects,
  observation: documentReviewFindingShape.observation,
  blockingReason: documentReviewFindingShape.blockingReason,
  requiredAction: documentReviewFindingShape.requiredAction,
  closureCondition: documentReviewFindingShape.closureCondition,
}

function documentReviewSubmissionFindingSchema(
  mode: 'initial' | 'closure',
  scope: 'foundation' | 'complete',
) {
  const subjects = scope === 'foundation'
    ? z.array(z.object({
        path: z.string().min(1),
        anchor: z.string().trim().min(1),
      }).strict()).min(1)
    : documentReviewSubmissionFindingShape.subjects
  return z.object({
    ...documentReviewSubmissionFindingShape,
    subjects,
    ...(mode === 'closure'
      ? { regressionPaths: z.array(z.string().min(1)).optional() }
      : {}),
  }).strict()
}

export { documentReviewCheckSchema } from './document-review-check-schema'

export const documentAuthorTerminalSchema = z
  .object({
    workerType: z.literal('document-author'),
    status: z.literal('completed'),
    writtenPaths: z.array(z.string().min(1)),
    resolvedFindingIds: z.array(z.string().min(1)).optional(),
  })
  .strict()

export const documentAuthorSubmissionSchema = z
  .object({
    resolvedFindingIds: z.array(z.string().min(1)),
  })
  .strict()

function requireConsistentDocumentReviewVerdict(
  value: {
    verdict: 'READY' | 'NEEDS_REVISION' | 'BLOCKED'
    checks: Array<{
      id: string
      status: 'pass' | 'block'
      findingIds: string[]
    }>
    findings: Array<{ findingId: string; checkId: string }>
  },
  context: z.RefinementCtx,
): void {
  const checkIds = value.checks.map(check => check.id)
  if (new Set(checkIds).size !== checkIds.length)
    context.addIssue({
      code: 'custom',
      path: ['checks'],
      message: 'document review check IDs must be unique',
    })
  const findingIds = value.findings.map(finding => finding.findingId)
  if (new Set(findingIds).size !== findingIds.length)
    context.addIssue({
      code: 'custom',
      path: ['findings'],
      message: 'document review finding codes must be unique',
    })
  const knownFindingIds = new Set(findingIds)
  const referencedFindingIds = new Set<string>()
  for (const [index, check] of value.checks.entries()) {
    if (check.status === 'pass' && check.findingIds.length > 0)
      context.addIssue({
        code: 'custom',
        path: ['checks', index, 'findingIds'],
        message: 'passing checks cannot reference findings',
      })
    if (check.status === 'block' && check.findingIds.length === 0)
      context.addIssue({
        code: 'custom',
        path: ['checks', index, 'findingIds'],
        message: 'blocking checks require at least one finding code',
      })
    for (const findingId of check.findingIds) {
      referencedFindingIds.add(findingId)
      if (!knownFindingIds.has(findingId))
        context.addIssue({
          code: 'custom',
          path: ['checks', index, 'findingIds'],
          message: `unknown document review finding ID: ${findingId}`,
        })
    }
  }
  for (const [index, finding] of value.findings.entries())
    if (!referencedFindingIds.has(finding.findingId))
      context.addIssue({
        code: 'custom',
        path: ['findings', index, 'findingId'],
        message: 'every finding must be referenced by a blocking check',
      })
  for (const [index, finding] of value.findings.entries()) {
    const owningCheck = value.checks.find(check => check.id === finding.checkId)
    if (!owningCheck?.findingIds.includes(finding.findingId))
      context.addIssue({
        code: 'custom',
        path: ['findings', index, 'checkId'],
        message: 'finding checkId must reference the finding ID',
      })
  }
  const hasBlockingCheck = value.checks.some(check => check.status === 'block')
  if (
    value.verdict === 'READY' &&
    (value.findings.length > 0 || hasBlockingCheck)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['verdict'],
      message: 'READY requires passing checks and no findings',
    })
  }
  if (
    value.verdict === 'NEEDS_REVISION' &&
    (value.findings.length === 0 || !hasBlockingCheck)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['verdict'],
      message: 'NEEDS_REVISION requires blocking checks and findings',
    })
  }
  if (value.verdict === 'BLOCKED' && value.findings.length > 0)
    context.addIssue({
      code: 'custom',
      path: ['findings'],
      message: 'BLOCKED cannot contain semantic findings',
    })
}

function documentReviewSubmissionSchema<
  FindingSchema extends z.ZodType<{
    findingId: string
    checkId: string
  }>,
>(findingSchema: FindingSchema) {
  return z.object({
    verdict: z.enum(['READY', 'NEEDS_REVISION', 'BLOCKED']),
    checks: z.array(documentReviewCheckSchema).min(1),
    findings: z.array(findingSchema),
  })
  .strict()
  .superRefine(requireConsistentDocumentReviewVerdict)
}

export function documentReviewSubmissionSchemaForMode(
  mode: 'initial' | 'closure',
  scope: 'foundation' | 'complete' = 'complete',
) {
  return documentReviewSubmissionSchema(
    documentReviewSubmissionFindingSchema(mode, scope),
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
  .superRefine(requireConsistentDocumentReviewVerdict)

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
