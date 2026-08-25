import { z } from 'zod/v4'
import type {
  AtomicTask,
  AcceptedWorkflowUnit,
  DeliveryPhase,
  DeliveryRun,
  DispatchRecord,
  EvidenceRef,
  FoundationDraftState,
  FoundationRevisionState,
  Revision,
  TasksPlannedEvent,
  TaskVerification,
  WorkflowEvent,
  WorkflowUnitAcceptedEvent,
  WorkerDispatchRequest,
} from './types'
import { foundationAuditStateSchema } from './foundation-audit-state'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  DELIVERY_RUN_SCHEMA_VERSION,
  RESOURCE_PRODUCTION_TASKS,
} from './types'
import { foundationRevisionDocumentReceiptMatches, foundationRevisionPacketPath, foundationRevisionSemanticResultPath, foundationRevisionStagePath } from './foundation-revision-stage'

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
  'foundation-fact-extractor',
  'foundation-semantic-reviewer',
  'foundation-document-reviser',
  'resource-planner',
  'resource-curator',
  'resource-content-author',
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
    protectedPaths: z.array(z.string().min(1)).optional(),
    projectReadScope: z.enum(['empty', 'allowed']).optional(),
    workflowJsonSchema: z.record(z.string(), z.unknown()).optional(),
    contract: z.record(z.string(), z.unknown()),
  })
  .strict()

export const atomicTaskSchema: z.ZodType<AtomicTask> = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    checklistIds: z.array(z.string().min(1)),
    resourceIds: z.array(z.string().min(1)),
    contentIds: z.array(z.string().min(1)),
    dependsOn: z.array(z.string().min(1)),
    allowedPaths: z.array(z.string().min(1)).min(1),
    expectedArtifacts: z.array(z.string().min(1)).min(1),
    verification: z.array(verificationSchema).min(1),
    status: z.enum(ATOMIC_TASK_STATUSES),
    attempt: z.number().int().nonnegative(),
    startedRevision: z.string().min(1).optional(),
    completedRevision: z.string().min(1).optional(),
    evidenceRefs: z.array(z.string().min(1)),
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

const resourceProductionStateSchema = z
  .object({
    currentTask: z.enum(RESOURCE_PRODUCTION_TASKS),
    inventoryReceipt: z
      .object({
        revision: z.string().min(1),
        bindings: z.array(
          z
            .object({
              requirementId: z.string().min(1),
              resourceIds: z.array(z.string().min(1)).min(1),
            })
            .strict(),
        ),
        catalogObserved: z.boolean(),
        acceptedAt: z.string().datetime(),
      })
      .strict()
      .optional(),
    contentReceipt: z
      .object({
        contentDigest: z.string().min(1),
        acceptedAt: z.string().datetime(),
      })
      .strict()
      .optional(),
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
    request: workerDispatchRequestSchema.optional(),
    terminalResult: z.record(z.string(), z.unknown()).optional(),
    startingUsage: workflowUsageSchema.optional(),
    usage: workflowUsageSchema.optional(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().optional(),
  })
  .strict()

const foundationRevisionDigest = z.string().regex(/^[a-f0-9]{64}$/)
const foundationRevisionIdentifier = z.string().regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/)
const foundationRevisionAuthoritySchema = z.object({
  issueAuthority: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('review'), reviewDigest: foundationRevisionDigest, issueRegistryDigest: foundationRevisionDigest }).strict(),
    z.object({ kind: z.literal('publication'), baseRevision: foundationRevisionIdentifier, authorityDigest: foundationRevisionDigest, issueRegistryDigest: foundationRevisionDigest }).strict(),
  ]),
  derivedDigests: z.object({
    sectionIndex: foundationRevisionDigest,
    factStore: foundationRevisionDigest,
    manifest: foundationRevisionDigest,
  }).strict(),
  documentDigests: z.array(z.object({
    path: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
    digest: foundationRevisionDigest,
  }).strict()).length(CANONICAL_FOUNDATION_DOCUMENTS.length),
}).strict()

const foundationRevisionTaskCommonSchema = z.object({
  taskId: foundationRevisionIdentifier,
  revision: foundationRevisionIdentifier,
  round: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  packetPath: z.string().min(1),
  packetDigest: foundationRevisionDigest,
  status: z.enum(['pending', 'running', 'completed', 'retryable', 'needs_action']),
  attempt: z.number().int().min(0).max(2),
  dispatch: dispatchRecordSchema.optional(),
  terminalDigest: foundationRevisionDigest.optional(),
  usage: workflowUsageSchema.optional(),
  durationMs: z.number().int().nonnegative().optional(),
  failureReason: z.string().min(1).optional(),
}).strict()

const foundationRevisionReceiptSchema = z.object({
  taskId: foundationRevisionIdentifier,
  round: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
  issueIds: z.array(z.string().min(1)).min(1),
  baseDocumentDigest: foundationRevisionDigest,
  stagedDocumentDigest: foundationRevisionDigest,
  changedSectionIds: z.array(z.string().min(1)).min(1),
  stagedPath: z.string().min(1),
  terminalDigest: foundationRevisionDigest,
}).strict()

const foundationRevisionDocumentTaskSchema = foundationRevisionTaskCommonSchema.extend({
  kind: z.literal('document-revision'),
  documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
  issueIds: z.array(z.string().min(1)).min(1),
  sectionIds: z.array(z.string().min(1)).min(1),
  stagedPath: z.string().min(1),
  baseDocumentDigest: foundationRevisionDigest,
  receipt: foundationRevisionReceiptSchema.optional(),
})
const foundationRevisionImpactedFactsTaskSchema = foundationRevisionTaskCommonSchema.extend({ kind: z.literal('impacted-facts'), modelTier: z.literal('fast'), receiptPath: z.string().min(1).optional(), receiptDigest: foundationRevisionDigest.optional() })
const foundationRevisionSemanticRecheckTaskSchema = foundationRevisionTaskCommonSchema.extend({ kind: z.literal('semantic-recheck'), issueId: z.string().min(1), modelTier: z.enum(['fast', 'balanced', 'strong']), resultPath: z.string().min(1).optional(), resultDigest: foundationRevisionDigest.optional() })
const foundationRevisionTaskSchema = z.discriminatedUnion('kind', [foundationRevisionDocumentTaskSchema, foundationRevisionImpactedFactsTaskSchema, foundationRevisionSemanticRecheckTaskSchema])
const foundationRevisionPublicationBindingSchema = z.object({
  preparedPath: z.string().min(1),
  journalPath: z.string().min(1),
  committedPath: z.string().min(1),
  authorityDigest: foundationRevisionDigest,
  resultingRevision: z.string().min(1),
  resultingIssueRegistryDigest: foundationRevisionDigest,
}).strict()
const foundationIssueSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  blocker: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
}).strict().superRefine((summary, context) => {
  if (summary.total !== summary.blocker + summary.high + summary.medium + summary.low)
    context.addIssue({ code: 'custom', path: ['total'], message: 'foundation issue summary total must equal severity counts' })
})

export const foundationRevisionStateSchema: z.ZodType<FoundationRevisionState> = z.object({
  authority: foundationRevisionAuthoritySchema,
  roundBefore: z.object({ documentRevision: foundationRevisionIdentifier, issueRegistryDigest: foundationRevisionDigest }).strict(),
  revision: foundationRevisionIdentifier,
  round: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  phase: z.enum(['planning', 'revising', 'rebuilding_facts', 'validating', 'semantic_recheck', 'publishing', 'round_closing']),
  status: z.enum(['running', 'completed', 'needs_action']),
  phaseStartedAt: z.string().datetime(),
  knownIssueIds: z.array(z.string().min(1)),
  issueSummary: foundationIssueSummarySchema,
  tasks: z.array(foundationRevisionTaskSchema),
  publication: foundationRevisionPublicationBindingSchema.optional(),
}).strict().superRefine((state, context) => {
  for (const [index, task] of state.tasks.entries()) {
    if (task.packetPath !== foundationRevisionPacketPath(task.revision, task.round, task.taskId))
      context.addIssue({ code: 'custom', path: ['tasks', index, 'packetPath'], message: 'revision packet path must be derived from task identity' })
    if (task.kind === 'document-revision' && task.stagedPath !== foundationRevisionStagePath(task.revision, task.documentPath))
      context.addIssue({ code: 'custom', path: ['tasks', index, 'stagedPath'], message: 'revision stage path must be derived from task identity' })
    if (task.kind === 'document-revision' && task.status === 'completed' && !foundationRevisionDocumentReceiptMatches(task))
      context.addIssue({ code: 'custom', path: ['tasks', index], message: 'completed document revision tasks require receipt and terminalDigest' })
    if (task.kind === 'semantic-recheck' && task.status === 'completed' && (!task.terminalDigest || !task.resultPath || !task.resultDigest))
      context.addIssue({ code: 'custom', path: ['tasks', index], message: 'completed semantic recheck tasks require terminalDigest, resultPath and resultDigest' })
    if (task.kind === 'semantic-recheck' && task.status === 'completed' && task.resultPath !== foundationRevisionSemanticResultPath(task.revision, task.round, task.taskId))
      context.addIssue({ code: 'custom', path: ['tasks', index, 'resultPath'], message: 'completed semantic result path must be derived from task identity' })
  }
})

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

const foundationDraftStateSchema: z.ZodType<FoundationDraftState> = z
  .object({
    completedPaths: z.array(z.enum(CANONICAL_FOUNDATION_DOCUMENTS)),
    documents: z
      .array(
        z
          .object({
            path: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
            status: z.enum([
              'pending',
              'drafting',
              'committed',
              'needs_action',
            ]),
            upstreamDigests: z
              .record(z.string().min(1), z.string().regex(/^[a-f0-9]{64}$/))
              .optional(),
            dispatch: dispatchRecordSchema.optional(),
            failureReason: z.string().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
  .superRefine((state, context) => {
    const expected = CANONICAL_FOUNDATION_DOCUMENTS.slice(
      0,
      state.completedPaths.length,
    )
    if (
      state.completedPaths.length > CANONICAL_FOUNDATION_DOCUMENTS.length ||
      state.completedPaths.some((path, index) => path !== expected[index])
    )
      context.addIssue({
        code: 'custom',
        message:
          'foundation draft checkpoints must be a canonical dependency-order prefix',
      })
    if (state.documents) {
      const expectedPaths = [...CANONICAL_FOUNDATION_DOCUMENTS]
      if (
        state.documents.length !== expectedPaths.length ||
        state.documents.some(
          (document, index) => document.path !== expectedPaths[index],
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['documents'],
          message:
            'parallel foundation document checkpoints must exactly match canonical order',
        })
    }
  })

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
      ])
      .optional(),
    status: z.enum(DELIVERY_RUN_STATUSES),
    revision: revisionSchema,
    createdAt: z.string().datetime(),
  })
  .catchall(z.unknown()) as z.ZodType<WorkflowEvent>

export const tasksPlannedEventSchema: z.ZodType<TasksPlannedEvent> = z
  .object({
    eventId: z.string().min(1),
    runId: z.string().min(1),
    type: z.literal('tasks.planned'),
    phase: z.literal('IMPLEMENTATION'),
    status: z.literal('running'),
    revision: revisionSchema,
    activeTaskId: z.string().min(1).optional(),
    taskGraph: z.array(atomicTaskSchema).min(1),
    createdAt: z.string().datetime(),
  })
  .strict()

const acceptedWorkflowUnitBase = {
  eventSchemaVersion: z.literal(1),
  unitId: z.string().min(1),
  phase: z.enum(DELIVERY_PHASES),
  predecessorUnitIds: z.array(z.string().min(1)),
  inputRevision: z.string().min(1),
  dependencyDigests: z.record(z.string(), z.string().min(1)),
  dispatchId: z.string().min(1).optional(),
  receiptRef: z.string().min(1).optional(),
  acceptedAt: z.string().datetime(),
}

const receiptPayloadSchema = z
  .object({ receiptRef: z.string().min(1) })
  .strict()

export const acceptedWorkflowUnitSchema: z.ZodType<AcceptedWorkflowUnit> =
  z.discriminatedUnion('kind', [
    z
      .object({
        ...acceptedWorkflowUnitBase,
        kind: z.literal('document'),
        dispatchId: z.string().min(1),
        receiptRef: z.string().min(1),
        payload: z
          .object({ path: z.string().min(1), revision: z.string().min(1) })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...acceptedWorkflowUnitBase,
        kind: z.literal('resource-inventory'),
        payload: z
          .object({
            bindings: z.array(
              z
                .object({
                  requirementId: z.string().min(1),
                  resourceIds: z.array(z.string().min(1)).min(1),
                })
                .strict(),
            ),
            catalogObserved: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...acceptedWorkflowUnitBase,
        kind: z.literal('resource-content'),
        dispatchId: z.string().min(1),
        receiptRef: z.string().min(1),
        payload: z.object({ contentDigest: z.string().min(1) }).strict(),
      })
      .strict(),
    z
      .object({
        ...acceptedWorkflowUnitBase,
        kind: z.literal('resource-gate'),
        payload: receiptPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...acceptedWorkflowUnitBase,
        kind: z.literal('atomic-plan'),
        payload: z
          .object({ taskIds: z.array(z.string().min(1)).min(1) })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...acceptedWorkflowUnitBase,
        kind: z.literal('implementation-task'),
        payload: z
          .object({
            taskId: z.string().min(1),
            evidenceRefs: z.array(z.string().min(1)).min(1),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...acceptedWorkflowUnitBase,
        kind: z.literal('implementation-audit'),
        payload: receiptPayloadSchema,
      })
      .strict(),
    z
      .object({
        ...acceptedWorkflowUnitBase,
        kind: z.literal('acceptance'),
        payload: receiptPayloadSchema,
      })
      .strict(),
  ])

export const workflowUnitAcceptedEventSchema: z.ZodType<WorkflowUnitAcceptedEvent> =
  z
    .object({
      eventId: z.string().min(1),
      runId: z.string().min(1),
      type: z.literal('workflow.unit.accepted'),
      phase: z.enum(DELIVERY_PHASES),
      documentStep: z
        .enum([
          'FOUNDATION_DRAFTING',
          'FOUNDATION_REVIEW',
          'CHECKLIST_DRAFTING',
        ])
        .optional(),
      status: z.enum(DELIVERY_RUN_STATUSES),
      revision: revisionSchema,
      createdAt: z.string().datetime(),
      projectId: z.string().min(1),
      ownerId: z.string().min(1),
      unit: acceptedWorkflowUnitSchema,
    })
    .catchall(z.unknown()) as z.ZodType<WorkflowUnitAcceptedEvent>

export function parseWorkflowEvent(value: unknown): WorkflowEvent {
  const event = workflowEventSchema.parse(value)
  if (event.type === 'workflow.unit.accepted')
    return workflowUnitAcceptedEventSchema.parse(value)
  if (event.type === 'tasks.planned') {
    const parsed = tasksPlannedEventSchema.safeParse(value)
    if (!parsed.success)
      throw new Error(`invalid tasks.planned workflow event: ${parsed.error}`)
    return parsed.data
  }
  return event
}

const pendingWorkflowEventsSchema = z
  .array(workflowEventSchema)
  .min(1)
  .superRefine((events, context) => {
    for (const [index, event] of events.entries()) {
      if (
        event.type !== 'workflow.unit.accepted' &&
        event.type !== 'tasks.planned'
      )
        continue
      const parsed =
        event.type === 'workflow.unit.accepted'
          ? workflowUnitAcceptedEventSchema.safeParse(event)
          : tasksPlannedEventSchema.safeParse(event)
      if (!parsed.success)
        context.addIssue({
          code: 'custom',
          path: [index],
          message: `${event.type} event is invalid`,
        })
    }
  })

export const deliveryRunSchema: z.ZodType<DeliveryRun> = z
  .object({
    schemaVersion: z.literal(DELIVERY_RUN_SCHEMA_VERSION),
    runId: z.string().min(1),
    projectId: z.string().min(1),
    ownerId: z.string().min(1),
    confirmedBriefDigest: z.string().min(1),
    confirmedBriefContext: z.string().min(1),
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
        resourcePreparation: evidenceRefSchema.optional(),
        implementationAudit: evidenceRefSchema.optional(),
        acceptance: evidenceRefSchema.optional(),
      })
      .strict(),
    foundationDraftState: foundationDraftStateSchema,
    foundationAuditState: foundationAuditStateSchema.optional(),
    foundationRevisionState: foundationRevisionStateSchema.optional(),
    resourceProductionState: resourceProductionStateSchema,
    usage: workflowUsageSchema.optional(),
    currentMessage: z.string().min(1).optional(),
    thinking: z.enum(['working', 'waiting', 'idle']).optional(),
    lastProgressAt: z.string().datetime().optional(),
    pendingEvents: pendingWorkflowEventsSchema.optional(),
    lastAnswer: z.string().min(1).optional(),
    blockedReason: z.string().min(1).optional(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((run, context) => {
    const requiresCompletedFoundation =
      run.phase === 'DOCUMENT_REVIEW' ||
      run.phase === 'RESOURCE_PREPARATION' ||
      run.phase === 'ATOMIC_TASK_PLANNING' ||
      run.phase === 'IMPLEMENTATION' ||
      run.phase === 'IMPLEMENTATION_AUDIT' ||
      run.phase === 'ACCEPTANCE' ||
      run.phase === 'DELIVERY'
    if (
      requiresCompletedFoundation &&
      run.foundationDraftState.completedPaths.length !==
        CANONICAL_FOUNDATION_DOCUMENTS.length
    )
      context.addIssue({
        code: 'custom',
        path: ['foundationDraftState', 'completedPaths'],
        message:
          'foundation review and downstream phases require all durable authoring checkpoints',
      })

  })

export const parseDeliveryRun = (value: unknown): DeliveryRun =>
  deliveryRunSchema.parse(value)
export const parseAtomicTask = (value: unknown): AtomicTask =>
  atomicTaskSchema.parse(value)
export const parseDispatchRecord = (value: unknown): DispatchRecord =>
  dispatchRecordSchema.parse(value)
export const parseEvidenceRef = (value: unknown): EvidenceRef =>
  evidenceRefSchema.parse(value)
