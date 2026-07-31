import { z } from 'zod/v4'
import { atomicTaskSchema } from './schema'

const base = z.object({ revision: z.string().min(1) }).strict()

export const documentReviewFindingSchema = z
  .object({
    code: z.string().min(1).optional(),
    severity: z.enum(['blocking', 'non_blocking']),
    category: z.enum([
      'cross_document_conflict',
      'missing_spec',
      'calculation',
      'other',
    ]),
    remediationTarget: z.enum(['foundation', 'checklist', 'resource']),
    priorFindingId: z.string().min(1).optional(),
    resourceAction: z.enum(['repair', 'reselection']).optional(),
    resourceRequirementIds: z.array(z.string().min(1)).optional(),
    resourceImportIds: z.array(z.string().min(1)).optional(),
    documents: z.array(z.string().min(1)).min(1),
    description: z.string().min(1),
    requiredAction: z.string().min(1),
  })
  .strict()

export const documentAuthorTerminalSchema = z
  .object({
    workerType: z.literal('document-author'),
    status: z.literal('completed'),
    writtenPaths: z.array(z.string().min(1)).min(1),
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
    findings: Array<{ severity: 'blocking' | 'non_blocking' }>
  },
  context: z.RefinementCtx,
): void {
  const blocking = value.findings.some(
    finding => finding.severity === 'blocking',
  )
  if (value.verdict === 'READY' && blocking) {
    context.addIssue({
      code: 'custom',
      path: ['verdict'],
      message: 'READY cannot contain blocking findings',
    })
  }
  if (value.verdict === 'NEEDS_REVISION' && !blocking) {
    context.addIssue({
      code: 'custom',
      path: ['verdict'],
      message: 'NEEDS_REVISION requires at least one blocking finding',
    })
  }
}

export const documentReviewSubmissionSchema = z
  .object({
    verdict: z.enum(['READY', 'NEEDS_REVISION', 'BLOCKED']),
    findings: z.array(documentReviewFindingSchema),
  })
  .strict()
  .superRefine(requireConsistentDocumentReviewVerdict)

export const documentReviewerTerminalSchema = base
  .extend({
    workerType: z.literal('document-reviewer'),
    verdict: z.enum(['READY', 'NEEDS_REVISION', 'BLOCKED']),
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
    attemptMode: z.enum(['fresh', 'selection', 'repair', 'reselection']),
    status: z.enum(['completed', 'failed', 'blocked']),
    writtenPaths: z.array(z.string().min(1)),
    importIds: z.array(z.string().min(1)),
    compositionIds: z.array(z.string().min(1)),
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
    resourceReferences: z.array(
      z
        .object({
          importId: z.string().min(1),
          references: z.array(z.string().min(1)).min(1),
          runtimeEventIds: z.array(z.string().min(1)).default([]),
        })
        .strict(),
    ),
    compositionIntegrations: z.array(
      z
        .object({
          compositionId: z.string().min(1),
          recipePath: z.string().min(1),
          references: z.array(z.string().min(1)).min(1),
          runtimeEventIds: z.array(z.string().min(1)).default([]),
        })
        .strict(),
    ),
    requirementSatisfactions: z.array(
      z
        .object({
          requirementId: z.string().min(1),
          importIds: z.array(z.string().min(1)).default([]),
          compositionIds: z.array(z.string().min(1)).default([]),
          projectReferences: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ),
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
    importIds: z.array(z.string().min(1)),
    compositionIds: z.array(z.string().min(1)),
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
    importIds: z.array(z.string().min(1)),
    compositionIds: z.array(z.string().min(1)),
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
