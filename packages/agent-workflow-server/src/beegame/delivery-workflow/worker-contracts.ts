import { z } from 'zod/v4'
import { atomicTaskSchema } from './schema'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

const base = z.object({ revision: z.string().min(1) }).strict()

const foundationFactEvidenceSchema = z
  .object({
    documentPath: z.string().min(1),
    sectionId: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

const foundationFactResultSchema = z
  .object({
    key: z.string().min(1),
    status: z.enum(['present', 'absent', 'uncertain']),
    value: z.unknown().optional(),
    evidence: foundationFactEvidenceSchema.optional(),
    reason: z.string().min(1).optional(),
  })
  .strict()

export const foundationFactExtractorTerminalSchema = z
  .object({
    workerType: z.literal('foundation-fact-extractor'),
    status: z.enum(['completed', 'failed', 'blocked']),
    runId: z.string().min(1),
    dispatchId: z.string().min(1),
    taskId: z.string().min(1),
    revision: z.string().min(1),
    packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    results: z.array(foundationFactResultSchema),
  })
  .strict()

export const foundationFactStructuredOutputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    workerType: { const: 'foundation-fact-extractor' },
    status: { enum: ['completed', 'failed', 'blocked'] },
    runId: { type: 'string', minLength: 1 },
    dispatchId: { type: 'string', minLength: 1 },
    taskId: { type: 'string', minLength: 1 },
    revision: { type: 'string', minLength: 1 },
    packetDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    results: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      key: { type: 'string', minLength: 1 },
      status: { enum: ['present', 'absent', 'uncertain'] },
      value: {},
      evidence: { type: 'object', additionalProperties: false, properties: {
        documentPath: { type: 'string', minLength: 1 }, sectionId: { type: 'string', minLength: 1 },
        startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 }, digest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      }, required: ['documentPath', 'sectionId', 'startLine', 'endLine', 'digest'] },
      reason: { type: 'string', minLength: 1 },
    }, required: ['key', 'status'] } },
  },
  required: ['workerType', 'status', 'runId', 'dispatchId', 'taskId', 'revision', 'packetDigest', 'results'],
} as const

const foundationSemanticIssueSchema = z.object({
  problem: z.string().min(1),
  expected: z.string().min(1),
  actual: z.string().min(1),
  sourceSectionKey: z.string().min(1),
  fixSectionKey: z.string().min(1),
  reasonCode: z.string().min(1).optional(),
}).strict()

export const foundationSemanticReviewerTerminalSchema = z.object({
  workerType: z.literal('foundation-semantic-reviewer'),
  status: z.enum(['completed', 'failed', 'blocked']),
  runId: z.string().min(1),
  dispatchId: z.string().min(1),
  taskId: z.string().min(1),
  revision: z.string().min(1),
  packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
  outcome: z.enum(['PASS', 'ISSUES', 'UNDECIDABLE']),
  issues: z.array(foundationSemanticIssueSchema).optional(),
  reason: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
  const issues = value.issues ?? []
  if (value.outcome === 'PASS' && issues.length) context.addIssue({ code: 'custom', path: ['issues'], message: 'PASS cannot contain issues' })
  if (value.outcome === 'ISSUES' && !issues.length) context.addIssue({ code: 'custom', path: ['issues'], message: 'ISSUES requires issue drafts' })
  if (value.outcome === 'UNDECIDABLE' && (issues.length || !value.reason)) context.addIssue({ code: 'custom', path: ['reason'], message: 'UNDECIDABLE requires a reason and no issue drafts' })
  if (value.outcome !== 'UNDECIDABLE' && value.reason !== undefined) context.addIssue({ code: 'custom', path: ['reason'], message: 'PASS/ISSUES cannot contain reason' })
})

export const foundationSemanticReviewerStructuredOutputJsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    workerType: { const: 'foundation-semantic-reviewer' }, status: { enum: ['completed', 'failed', 'blocked'] },
    runId: { type: 'string', minLength: 1 }, dispatchId: { type: 'string', minLength: 1 }, taskId: { type: 'string', minLength: 1 }, revision: { type: 'string', minLength: 1 }, packetDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' }, outcome: { enum: ['PASS', 'ISSUES', 'UNDECIDABLE'] },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { problem: { type: 'string', minLength: 1 }, expected: { type: 'string', minLength: 1 }, actual: { type: 'string', minLength: 1 }, sourceSectionKey: { type: 'string', minLength: 1 }, fixSectionKey: { type: 'string', minLength: 1 }, reasonCode: { type: 'string', minLength: 1 } }, required: ['problem', 'expected', 'actual', 'sourceSectionKey', 'fixSectionKey'] } }, reason: { type: 'string', minLength: 1 },
  }, required: ['workerType', 'status', 'runId', 'dispatchId', 'taskId', 'revision', 'packetDigest', 'outcome'],
} as const

export const documentAuthorTerminalSchema = z
  .object({
    workerType: z.literal('document-author'),
    status: z.literal('completed'),
    writtenPaths: z.array(z.string().min(1)),
    resolvedFindingIds: z.array(z.string().min(1)).optional(),
    authoringMetrics: z
      .object({
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
  foundationFactExtractorTerminalSchema,
  foundationSemanticReviewerTerminalSchema,
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

export type WorkerTerminalResult =
  z.infer<typeof workerTerminalSchema>

export function parseWorkerTerminalResult(
  value: unknown,
): WorkerTerminalResult {
  return workerTerminalSchema.parse(value)
}
