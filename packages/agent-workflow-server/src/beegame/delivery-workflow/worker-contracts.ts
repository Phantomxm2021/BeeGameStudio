import { z } from 'zod/v4'
import { atomicTaskSchema } from './schema'
import { documentReviewCheckSchema } from './document-review-check-schema'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  DOCUMENT_REVIEW_CHECK_IDS,
  GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
  type DocumentReviewCheckId,
  type DocumentReviewCriterionId,
  type GameDesignDocumentReviewCheckId,
} from './types'

const base = z.object({ revision: z.string().min(1) }).strict()

const documentReviewFindingShape = {
  findingId: z.string().trim().min(1),
  checkId: z.enum(DOCUMENT_REVIEW_CHECK_IDS),
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
              'Canonical artifact path whose current content contains the observed defect; contextual evidence and downstream consumers are not subjects.',
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
      'Exact defect locations in the frozen revision. Repair impact paths are selected later by the single Repair Lead contract.',
    ),
  observation: z.string().trim().min(1),
  blockingImpact: z.string().trim().min(1),
  requiredOutcome: z
    .string()
    .min(1)
    .describe(
      'One authority-preserving result that must be true after repair; do not provide alternative repairs or editing steps.',
    ),
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
    regressionPaths: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .superRefine(refineDocumentReviewFinding)

const documentReviewSubmissionFindingShape = {
  findingId: documentReviewFindingShape.findingId,
  evidence: documentReviewFindingShape.evidence,
  subjects: documentReviewFindingShape.subjects,
  observation: documentReviewFindingShape.observation,
  blockingImpact: documentReviewFindingShape.blockingImpact,
  requiredOutcome: documentReviewFindingShape.requiredOutcome,
}

function documentReviewCheckSubmissionFindingSchema(
  mode: 'initial' | 'closure',
  _scope: 'foundation' | 'checklist' | 'complete',
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
      blockingImpact: documentReviewSubmissionFindingShape.blockingImpact,
      requiredOutcome: documentReviewSubmissionFindingShape.requiredOutcome,
      ...(mode === 'closure'
        ? { regressionPaths: z.array(z.string().min(1)).min(1).optional() }
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

function documentReviewAssessmentSubmissionSchema(
  criterionIds: readonly DocumentReviewCriterionId[],
) {
  const visibleCriterionIds = (
    criterionIds.length ? criterionIds : documentReviewCriterionIds
  ) as [DocumentReviewCriterionId, ...DocumentReviewCriterionId[]]
  return z
    .object({
      criterion: z.enum(visibleCriterionIds),
      status: z.enum(['pass', 'block']),
      evidence: z.array(documentReviewReferenceSchema).min(1),
      derivation: z.string().trim().min(1),
      conclusion: z.string().trim().min(1),
    })
    .strict()
}

const documentReviewCheckSubmissionShape = {
  conclusion: z.string().trim().min(1),
  evidence: z.array(documentReviewReferenceSchema).min(1),
  assessments: z
    .array(documentReviewAssessmentSubmissionSchema(documentReviewCriterionIds))
    .max(3),
}

export { documentReviewCheckSchema } from './document-review-check-schema'

export const documentRepairPlanSubmissionSchema = z
  .object({
    decisions: z
      .array(
        z
          .object({
            groupDecision: z.string().trim().min(1),
            pathDecisions: z
              .array(
                z
                  .object({
                    path: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
                    decision: z.string().trim().min(1),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

export type DocumentRepairPlanSubmissionContract = {
  groups: Array<{
    subjectPaths: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number][]
    candidatePaths: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number][]
  }>
}

export function documentRepairPlanSubmissionSchemaForContract(
  contract: DocumentRepairPlanSubmissionContract,
) {
  if (!Array.isArray(contract.groups) || contract.groups.length === 0)
    throw new Error('document repair plan contract is invalid')
  return documentRepairPlanSubmissionSchema.superRefine((value, context) => {
    if (value.decisions.length !== contract.groups.length) {
      context.addIssue({
        code: 'custom',
        path: ['decisions'],
        message: `document repair plan requires exactly ${contract.groups.length} decisions`,
      })
      return
    }
    value.decisions.forEach((decision, index) => {
      const group = contract.groups[index]!
      const paths = decision.pathDecisions.map(item => item.path)
      if (new Set(paths).size !== paths.length)
        context.addIssue({
          code: 'custom',
          path: ['decisions', index, 'pathDecisions'],
          message: 'document repair path decisions must be unique',
        })
      if (group.subjectPaths.some(path => !paths.includes(path)))
        context.addIssue({
          code: 'custom',
          path: ['decisions', index, 'pathDecisions'],
          message:
            'document repair path decisions must cover every subject path',
        })
      if (paths.some(path => !group.candidatePaths.includes(path)))
        context.addIssue({
          code: 'custom',
          path: ['decisions', index, 'pathDecisions'],
          message:
            'document repair path decision is outside the impact candidates',
        })
    })
  })
}

export const documentAuthorTerminalSchema = z
  .object({
    workerType: z.literal('document-author'),
    status: z.literal('completed'),
    writtenPaths: z.array(z.string().min(1)),
    resolvedFindingIds: z.array(z.string().min(1)).optional(),
    repairPlan: documentRepairPlanSubmissionSchema.optional(),
  })
  .strict()

function visibleDocumentReviewCheckSubmissionSchema<
  FindingSchema extends z.ZodType<{
    findingId: string
  }>,
>(
  findingSchema: FindingSchema,
  criterionIds: readonly DocumentReviewCriterionId[],
) {
  const designCheck = criterionIds.length > 0
  return z
    .object({
      ...(designCheck
        ? {}
        : {
            conclusion: documentReviewCheckSubmissionShape.conclusion,
            evidence: documentReviewCheckSubmissionShape.evidence,
          }),
      assessments: z
        .array(documentReviewAssessmentSubmissionSchema(criterionIds))
        .length(designCheck ? criterionIds.length : 0),
      findings: z.array(findingSchema),
    })
    .strict()
    .superRefine((value, context) => {
      if (!designCheck) return
      const assessmentBlocks = value.assessments.some(
        assessment => assessment.status === 'block',
      )
      if (assessmentBlocks !== value.findings.length > 0)
        context.addIssue({
          code: 'custom',
          path: ['findings'],
          message: 'blocked design assessments and findings must agree',
        })
    })
}

const fixedDocumentReviewFindingWireSchema = z
  .object({
    findingId: documentReviewSubmissionFindingShape.findingId,
    evidence: z.array(documentReviewReferenceSchema).min(1),
    subjects: z
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
      .min(1),
    observation: documentReviewSubmissionFindingShape.observation,
    blockingImpact: documentReviewSubmissionFindingShape.blockingImpact,
    requiredOutcome: documentReviewSubmissionFindingShape.requiredOutcome,
    regressionPaths: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()

/** Stable model-facing wire schema. Contract-specific semantics stay server-owned. */
export const documentReviewPacketWireSchema = z
  .object({
    checks: z
      .array(
        z
          .object({
            conclusion:
              documentReviewCheckSubmissionShape.conclusion.optional(),
            evidence: documentReviewCheckSubmissionShape.evidence.optional(),
            assessments: z
              .array(
                documentReviewAssessmentSubmissionSchema(
                  documentReviewCriterionIds,
                ),
              )
              .max(3),
            findings: z.array(fixedDocumentReviewFindingWireSchema),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict()

export function documentReviewPacketSubmissionSchemaForContract(contract: {
  mode: 'initial' | 'closure'
  scope: 'foundation' | 'checklist' | 'complete'
  currentCheckIds: DocumentReviewCheckId[]
}) {
  const findingSchema = documentReviewCheckSubmissionFindingSchema(
    contract.mode,
    contract.scope,
  )
  return documentReviewPacketWireSchema.superRefine((value, context) => {
    if (value.checks.length !== contract.currentCheckIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['checks'],
        message: 'document review packet must exactly cover currentCheckIds',
      })
      return
    }
    for (const [index, checkId] of contract.currentCheckIds.entries()) {
      const criterionIds =
        GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA[
          checkId as GameDesignDocumentReviewCheckId
        ] ?? []
      const parsed = visibleDocumentReviewCheckSubmissionSchema(
        findingSchema,
        criterionIds,
      ).safeParse(value.checks[index])
      if (!parsed.success)
        for (const issue of parsed.error.issues)
          context.addIssue({
            ...issue,
            path: ['checks', index, ...issue.path],
          })
    }
  })
}

export const documentReviewerTerminalSchema = base
  .extend({
    workerType: z.literal('document-reviewer'),
    verdict: z.enum(['READY', 'NEEDS_REVISION', 'BLOCKED']),
    checks: z.array(documentReviewCheckSchema).min(1),
    checklistIds: z.array(z.string().min(1)),
    findings: z.array(documentReviewFindingSchema),
    evidencePath: z.string().min(1),
    rejectedSubmissionCount: z.number().int().nonnegative(),
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

const resourceTaskMetricsSchema = z
  .object({
    catalogPayloadBytes: z.number().int().nonnegative(),
    catalogCallTypes: z.array(z.string().min(1)),
    canonicalMutationCount: z.number().int().nonnegative(),
  })
  .strict()

export const resourcePlannerTerminalSchema = base
  .extend({
    workerType: z.literal('resource-planner'),
    status: z.literal('completed'),
    writtenPaths: z.array(z.string().min(1)),
    taskMetrics: resourceTaskMetricsSchema,
  })
  .strict()

export const resourceCuratorTerminalSchema = base
  .extend({
    workerType: z.literal('resource-curator'),
    status: z.literal('completed'),
    catalogObserved: z.boolean(),
    resourceIds: z.array(z.string().min(1)),
    bindings: z.array(
      z
        .object({
          requirementId: z.string().min(1),
          resourceIds: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
    writtenPaths: z.array(z.string().min(1)),
    taskMetrics: resourceTaskMetricsSchema,
  })
  .strict()

export const resourceContentAuthorTerminalSchema = base
  .extend({
    workerType: z.literal('resource-content-author'),
    status: z.enum(['completed', 'needs_inventory']),
    contentIds: z.array(z.string().min(1)),
    writtenPaths: z.array(z.string().min(1)),
    missingRequirementIds: z.array(z.string().min(1)),
    taskMetrics: resourceTaskMetricsSchema,
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
  resourcePlannerTerminalSchema,
  resourceCuratorTerminalSchema,
  resourceContentAuthorTerminalSchema,
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
