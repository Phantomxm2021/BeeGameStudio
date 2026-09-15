import { z } from 'zod/v4'

const base = z.object({ revision: z.string().min(1) }).strict()

export const documentAuthorTerminalSchema = z
  .object({
    workerType: z.literal('document-author'),
    status: z.literal('completed'),
    writtenPaths: z.array(z.string().min(1)),
    resolvedFindingIds: z.array(z.string().min(1)).optional(),
    authoringMetrics: z
      .object({
        usageStatus: z.enum(['measured', 'unavailable']),
        inputTokens: z.number().int().nonnegative(),
        cacheReadTokens: z.number().int().nonnegative(),
        cacheCreationTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        rawProcessedTokens: z.number().int().nonnegative(),
        nativeTurns: z.number().int().nonnegative(),
        toolCalls: z.record(z.string(), z.number().int().nonnegative()),
        failedToolCalls: z.number().int().nonnegative(),
        permissionDenials: z.number().int().nonnegative(),
        authorityProjection: z
          .object({
            byteLength: z.number().int().nonnegative(),
            modelByteLength: z.number().int().nonnegative().optional(),
            promptByteLength: z.number().int().nonnegative().optional(),
            rangeCount: z.number().int().nonnegative(),
            projectedLineCount: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const resourcePlannerTerminalSchema = base
  .extend({
    workerType: z.literal('resource-planner'),
    status: z.literal('completed'),
    writtenPaths: z.array(z.string().min(1)),
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

export const acceptanceValidatorTerminalSchema = base
  .extend({
    workerType: z.literal('acceptance-validator'),
    status: z.enum(['passed', 'failed', 'blocked']),
    validatedTaskIds: z.array(z.string().min(1)),
    checklistIds: z.array(z.string().min(1)),
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

export const questionAnswerTerminalSchema = z
  .object({
    workerType: z.literal('question-answerer'),
    answer: z.string().min(1),
    evidencePath: z.string().min(1),
  })
  .strict()

export const workerTerminalSchema = z.discriminatedUnion('workerType', [
  documentAuthorTerminalSchema,
  resourcePlannerTerminalSchema,
  implementationWorkerTerminalSchema,
  acceptanceValidatorTerminalSchema,
  changeImpactTerminalSchema,
  questionAnswerTerminalSchema,
])

export type WorkerTerminalResult =
  z.infer<typeof workerTerminalSchema>

export function parseWorkerTerminalResult(
  value: unknown,
): WorkerTerminalResult {
  return workerTerminalSchema.parse(value)
}
