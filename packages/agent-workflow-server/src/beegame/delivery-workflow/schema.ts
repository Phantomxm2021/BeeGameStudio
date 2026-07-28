import { z } from 'zod/v4'
import type {
  AtomicTask,
  ChecklistRemediation,
  DeliveryPhase,
  DeliveryRun,
  DocumentRemediation,
  DispatchRecord,
  EvidenceRef,
  Revision,
  ResourceRemediation,
  TaskVerification,
  WorkflowEvent,
  WorkerDispatchRequest,
} from './types'

export const DELIVERY_PHASES = [
  'BRIEF_CONFIRMED',
  'DOCUMENT_DRAFTING',
  'DOCUMENT_REVIEW',
  'RESOURCE_PREPARATION',
  'ATOMIC_TASK_PLANNING',
  'IMPLEMENTATION',
  'IMPLEMENTATION_AUDIT',
  'ACCEPTANCE',
  'DELIVERY',
] as const satisfies readonly DeliveryPhase[]

export const DELIVERY_RUN_STATUSES = [
  'running',
  'needs_action',
  'blocked',
  'completed',
  'failed',
  'stopped',
] as const
export const ATOMIC_TASK_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'blocked',
] as const
export const DISPATCH_STATUSES = [
  'running',
  'completed',
  'failed',
  'blocked',
  'interrupted',
  'invalid',
] as const
export const WORKER_TYPES = [
  'document-author',
  'document-reviewer',
  'resource-preparer',
  'atomic-task-planner',
  'implementation-worker',
  'implementation-auditor',
  'acceptance-validator',
  'change-impact-analyzer',
  'question-answerer',
] as const

const revisionSchema: z.ZodType<Revision> = z
  .object({
    document: z.string().min(1),
    resource: z.string().min(1).optional(),
    implementation: z.string().min(1).optional(),
    workspace: z.string().min(1),
  })
  .strict()

const verificationSchema: z.ZodType<TaskVerification> = z
  .object({
    kind: z.enum(['test', 'build', 'runtime', 'file', 'asset']),
    commandOrAction: z.string().min(1),
    expectedResult: z.string().min(1),
  })
  .strict()

const workerDispatchRequestSchema: z.ZodType<WorkerDispatchRequest> = z
  .object({
    dispatchId: z.string().min(1).optional(),
    runId: z.string().min(1),
    ownerId: z.string().min(1),
    projectId: z.string().min(1),
    workspacePath: z.string().min(1),
    workerType: z.enum(WORKER_TYPES),
    phase: z.enum(DELIVERY_PHASES),
    taskId: z.string().min(1).optional(),
    revision: z.string().min(1),
    allowedPaths: z.array(z.string().min(1)).optional(),
    contract: z.record(z.string(), z.unknown()),
  })
  .strict()

export const atomicTaskSchema: z.ZodType<AtomicTask> = z
  .object({
    id: z.string().min(1),
    code: z.string().min(1).optional(),
    title: z.string().min(1),
    sourceRequirementIds: z.array(z.string().min(1)).min(1),
    checklistIds: z.array(z.string().min(1)),
    dependsOn: z.array(z.string().min(1)),
    allowedPaths: z.array(z.string().min(1)).min(1),
    expectedArtifacts: z.array(z.string().min(1)).min(1),
    resourceImportIds: z.array(z.string().min(1)).optional(),
    resourceCompositionIds: z.array(z.string().min(1)).optional(),
    verification: z.array(verificationSchema).min(1),
    status: z.enum(ATOMIC_TASK_STATUSES),
    attempt: z.number().int().nonnegative(),
    startedRevision: z.string().min(1).optional(),
    completedRevision: z.string().min(1).optional(),
    evidenceRefs: z.array(z.string().min(1)),
  })
  .strict()

export const dispatchRecordSchema: z.ZodType<DispatchRecord> = z
  .object({
    dispatchId: z.string().min(1),
    workerType: z.enum(WORKER_TYPES),
    phase: z.enum(DELIVERY_PHASES),
    taskId: z.string().min(1).optional(),
    revision: z.string().min(1),
    status: z.enum(DISPATCH_STATUSES),
    terminalEvidencePath: z.string().min(1).optional(),
    failureReason: z.string().min(1).optional(),
    terminalOutput: z.string().min(1).optional(),
    request: workerDispatchRequestSchema.optional(),
    terminalResult: z.record(z.string(), z.unknown()).optional(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().optional(),
  })
  .strict()

export const evidenceRefSchema: z.ZodType<EvidenceRef> = z
  .object({
    path: z.string().min(1),
    kind: z.enum([
      'document_review',
      'resource_preparation',
      'implementation_audit',
      'acceptance',
    ]),
    revision: z.string().min(1),
    status: z.enum(['ready', 'passed', 'failed', 'blocked']),
    observedAt: z.string().datetime(),
  })
  .strict()

const workflowUsageSchema = z
  .object({
    input_tokens: z.number().nonnegative(),
    cache_read_tokens: z.number().nonnegative(),
    cache_creation_tokens: z.number().nonnegative(),
    completion_tokens: z.number().nonnegative(),
    total_tokens: z.number().nonnegative(),
  })
  .strict()

const resourceEvidenceSchema = z.union([
  z.object({ state: z.literal('missing') }).strict(),
  z
    .object({
      state: z.enum(['stale', 'current']),
      actions: z.array(z.string().min(1)),
      failedActions: z.array(z.string().min(1)),
      successfulImportCount: z.number().int().nonnegative(),
      failedImportCount: z.number().int().nonnegative(),
      observedAt: z.string().datetime(),
    })
    .strict(),
])

const documentReviewFindingSchema = z
  .object({
    id: z.string().min(1),
    severity: z.enum(['blocking', 'non_blocking']),
    category: z.enum([
      'cross_document_conflict',
      'missing_spec',
      'calculation',
      'other',
    ]),
    documents: z.array(z.string().min(1)).min(1),
    description: z.string().min(1),
    requiredAction: z.string().min(1),
  })
  .strict()

const documentRemediationSchema: z.ZodType<DocumentRemediation> = z
  .object({
    sourceRevision: z.string().min(1),
    evidencePath: z.string().min(1),
    attempt: z.number().int().positive(),
    findings: z.array(documentReviewFindingSchema).min(1),
    resolvedFindingIds: z.array(z.string().min(1)).optional(),
  })
  .strict()

const checklistRemediationSchema: z.ZodType<ChecklistRemediation> = z
  .object({
    sourceRevision: z.string().min(1),
    attempt: z.number().int().positive(),
    issues: z.array(z.string().min(1)).min(1),
  })
  .strict()

const resourceRemediationSchema: z.ZodType<ResourceRemediation> = z
  .object({
    sourceRevision: z.string().min(1),
    attempt: z.number().int().positive(),
    issues: z.array(z.string().min(1)).min(1),
    preserveImportIds: z.array(z.string().min(1)),
    preserveCompositionIds: z.array(z.string().min(1)),
  })
  .strict()

const workflowEventSchema: z.ZodType<WorkflowEvent> = z
  .object({
    eventId: z.string().min(1),
    runId: z.string().min(1),
    type: z.string().min(1),
    phase: z.enum(DELIVERY_PHASES),
    documentStep: z
      .enum([
        'FOUNDATION_DRAFTING',
        'FOUNDATION_REVIEW',
        'CHECKLIST_DRAFTING',
        'CHECKLIST_REVIEW',
      ])
      .optional(),
    status: z.enum(DELIVERY_RUN_STATUSES),
    revision: revisionSchema,
    createdAt: z.string().datetime(),
  })
  .catchall(z.unknown()) as z.ZodType<WorkflowEvent>

export const deliveryRunSchema: z.ZodType<DeliveryRun> = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    projectId: z.string().min(1),
    ownerId: z.string().min(1),
    parentRunId: z.string().min(1).optional(),
    confirmedBriefDigest: z.string().min(1),
    confirmedBriefContext: z.string().min(1).optional(),
    changeRequest: z.string().min(1).optional(),
    changeRoute: z
      .enum(['question', 'implementation_only', 'documents_required'])
      .optional(),
    changeAffectedRequirementIds: z.array(z.string().min(1)).optional(),
    changeAffectedChecklistIds: z.array(z.string().min(1)).optional(),
    changeRationale: z.string().min(1).optional(),
    phase: z.enum(DELIVERY_PHASES),
    documentStep: z
      .enum([
        'FOUNDATION_DRAFTING',
        'FOUNDATION_REVIEW',
        'CHECKLIST_DRAFTING',
        'CHECKLIST_REVIEW',
      ])
      .optional(),
    status: z.enum(DELIVERY_RUN_STATUSES),
    revision: revisionSchema,
    activeTaskId: z.string().min(1).optional(),
    currentItemId: z.string().min(1).optional(),
    tasks: z.array(atomicTaskSchema),
    activeDispatch: dispatchRecordSchema.optional(),
    evidence: z
      .object({
        documentReview: evidenceRefSchema.optional(),
        resourcePreparation: evidenceRefSchema.optional(),
        implementationAudit: evidenceRefSchema.optional(),
        acceptance: evidenceRefSchema.optional(),
      })
      .strict(),
    documentRemediation: documentRemediationSchema.optional(),
    documentAdvisories: z.array(documentReviewFindingSchema).optional(),
    documentReviewCycleCount: z.number().int().positive().optional(),
    checklistRemediation: checklistRemediationSchema.optional(),
    resourceRemediation: resourceRemediationSchema.optional(),
    usage: workflowUsageSchema.optional(),
    resourceEvidence: resourceEvidenceSchema.optional(),
    currentMessage: z.string().min(1).optional(),
    currentMessageKey: z.string().min(1).optional(),
    thinking: z.enum(['working', 'waiting', 'idle']).optional(),
    lastProgressAt: z.string().datetime().optional(),
    pendingEvent: workflowEventSchema.optional(),
    lastAnswer: z.string().min(1).optional(),
    blockedReason: z.string().min(1).optional(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime(),
  })
  .strict()

export const parseDeliveryRun = (value: unknown): DeliveryRun =>
  deliveryRunSchema.parse(value)
export const parseAtomicTask = (value: unknown): AtomicTask =>
  atomicTaskSchema.parse(value)
export const parseDispatchRecord = (value: unknown): DispatchRecord =>
  dispatchRecordSchema.parse(value)
export const parseEvidenceRef = (value: unknown): EvidenceRef =>
  evidenceRefSchema.parse(value)
