import { z } from 'zod/v4'
import type {
  AtomicTask,
  AcceptedWorkflowUnit,
  DocumentReviewState,
  DeliveryPhase,
  DeliveryRun,
  DispatchRecord,
  EvidenceRef,
  FoundationDraftState,
  FoundationRemediationState,
  Revision,
  TasksPlannedEvent,
  TaskVerification,
  WorkflowEvent,
  WorkflowUnitAcceptedEvent,
  WorkerDispatchRequest,
} from './types'
import { FOUNDATION_REMEDIATION_LANES } from './foundation-remediation'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  DELIVERY_RUN_SCHEMA_VERSION,
  RESOURCE_PRODUCTION_TASKS,
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

const documentReviewStateSchema: z.ZodType<DocumentReviewState> = z
  .object({
    activeRun: z
      .object({
        scope: z.enum(['foundation', 'checklist', 'complete']),
        revision: z.string().regex(/^[a-f0-9]{64}$/u),
        status: z.enum(['pending', 'running', 'completed', 'failed']),
        reports: z.array(
          z
            .object({
              role: z.string().min(1),
              path: z.string().min(1),
              digest: z
                .string()
                .regex(/^[a-f0-9]{64}$/u)
                .optional(),
              status: z.enum(['pending', 'running', 'completed', 'failed']),
              dispatch: dispatchRecordSchema.optional(),
              failureReason: z.string().min(1).optional(),
              durationMs: z.number().finite().nonnegative().optional(),
              usage: workflowUsageSchema.optional(),
            })
            .strict(),
        ),
        finalReportPath: z.string().min(1).optional(),
        finalReportDigest: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
        priorReviewPath: z.string().min(1).optional(),
        priorReviewDigest: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
        verdict: z.enum(['READY', 'NEEDS_REVISION']).optional(),
        affectedPaths: z.array(z.string().min(1)).optional(),
        remediatedPaths: z.array(z.string().min(1)).optional(),
        attempt: z.number().int().positive(),
        approvedFoundationRevision: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
        failureReason: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    approvals: z
      .object({
        foundation: z
          .object({
            scope: z.literal('foundation'),
            revision: z.string().regex(/^[a-f0-9]{64}$/u),
            reportPath: z.string().min(1),
            reportDigest: z.string().regex(/^[a-f0-9]{64}$/u),
            approvedAt: z.string().datetime(),
          })
          .strict()
          .optional(),
        checklist: z
          .object({
            scope: z.literal('checklist'),
            revision: z.string().regex(/^[a-f0-9]{64}$/u),
            reportPath: z.string().min(1),
            reportDigest: z.string().regex(/^[a-f0-9]{64}$/u),
            approvedAt: z.string().datetime(),
          })
          .strict()
          .optional(),
        complete: z
          .object({
            scope: z.literal('complete'),
            revision: z.string().regex(/^[a-f0-9]{64}$/u),
            reportPath: z.string().min(1),
            reportDigest: z.string().regex(/^[a-f0-9]{64}$/u),
            approvedAt: z.string().datetime(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .default({}),
    attempts: z
      .object({
        foundation: z.number().int().nonnegative(),
        checklist: z.number().int().nonnegative(),
        complete: z.number().int().nonnegative(),
      })
      .strict()
      .default({ foundation: 0, checklist: 0, complete: 0 }),
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

const foundationRemediationStateSchema: z.ZodType<FoundationRemediationState> = z
  .object({
    reviewPath: z.string().min(1),
    reviewDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceRevision: z.string().regex(/^[a-f0-9]{64}$/u),
    lanes: z.array(
      z
        .object({
          id: z.enum(['core-design', 'technical-assets', 'presentation']),
          ownedPaths: z.array(z.enum(CANONICAL_FOUNDATION_DOCUMENTS)),
          affectedPaths: z.array(z.enum(CANONICAL_FOUNDATION_DOCUMENTS)),
          status: z.enum([
            'not_required',
            'pending',
            'running',
            'completed',
            'failed',
          ]),
          dispatch: dispatchRecordSchema.optional(),
          receipt: z
            .object({
              reviewDigest: z.string().regex(/^[a-f0-9]{64}$/u),
              sourceRevision: z.string().regex(/^[a-f0-9]{64}$/u),
              ownedPaths: z.array(z.enum(CANONICAL_FOUNDATION_DOCUMENTS)),
              beforeDigests: z.record(
                z.string().min(1),
                z.string().regex(/^[a-f0-9]{64}$/u),
              ),
              afterDigests: z.record(
                z.string().min(1),
                z.string().regex(/^[a-f0-9]{64}$/u),
              ),
              committedAt: z.string().datetime(),
            })
            .strict()
            .optional(),
          failureReason: z.string().min(1).optional(),
        })
        .strict(),
    ),
    resultingRevision: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  })
  .strict()
  .superRefine((state, context) => {
    if (
      state.lanes.length !== FOUNDATION_REMEDIATION_LANES.length ||
      state.lanes.some((lane, index) => {
        const expected = FOUNDATION_REMEDIATION_LANES[index]
        return (
          !expected ||
          lane.id !== expected.id ||
          JSON.stringify(lane.ownedPaths) !==
            JSON.stringify(expected.ownedPaths)
        )
      })
    )
      context.addIssue({
        code: 'custom',
        path: ['lanes'],
        message: 'foundation remediation lanes must use canonical definitions',
      })
    for (const [index, lane] of state.lanes.entries()) {
      const expectedAffected = lane.ownedPaths.filter(path =>
        lane.affectedPaths.includes(path),
      )
      if (
        JSON.stringify(lane.affectedPaths) !== JSON.stringify(expectedAffected)
      )
        context.addIssue({
          code: 'custom',
          path: ['lanes', index, 'affectedPaths'],
          message:
            'foundation remediation affected paths must be unique canonical owned paths',
        })
      if (
        (lane.status === 'not_required') !==
        (lane.affectedPaths.length === 0)
      )
        context.addIssue({
          code: 'custom',
          path: ['lanes', index, 'status'],
          message:
            'foundation remediation not-required state must match empty affected paths',
        })
      if (
        lane.status === 'not_required' &&
        (lane.dispatch || lane.receipt || lane.failureReason)
      )
        context.addIssue({
          code: 'custom',
          path: ['lanes', index],
          message: 'not-required remediation lane cannot contain execution state',
        })
      if (lane.status === 'completed' && !lane.receipt)
        context.addIssue({
          code: 'custom',
          path: ['lanes', index, 'receipt'],
          message: 'completed remediation lane requires one receipt',
        })
      if (lane.status === 'running' && !lane.dispatch)
        context.addIssue({
          code: 'custom',
          path: ['lanes', index, 'dispatch'],
          message: 'running remediation lane requires one dispatch',
        })
      if (
        lane.status === 'pending' &&
        (lane.dispatch || lane.receipt || lane.failureReason)
      )
        context.addIssue({
          code: 'custom',
          path: ['lanes', index],
          message: 'pending remediation lane cannot contain execution state',
        })
      if (
        lane.status === 'failed' &&
        (!lane.dispatch || !lane.failureReason)
      )
        context.addIssue({
          code: 'custom',
          path: ['lanes', index],
          message: 'failed remediation lane requires its dispatch and reason',
        })
      if (lane.receipt && lane.status !== 'completed')
        context.addIssue({
          code: 'custom',
          path: ['lanes', index, 'receipt'],
          message: 'only a completed remediation lane may contain a receipt',
        })
      if (lane.receipt) {
        if (
          lane.receipt.reviewDigest !== state.reviewDigest ||
          lane.receipt.sourceRevision !== state.sourceRevision ||
          JSON.stringify(lane.receipt.ownedPaths) !==
            JSON.stringify(lane.ownedPaths)
        )
          context.addIssue({
            code: 'custom',
            path: ['lanes', index, 'receipt'],
            message:
              'foundation remediation receipt must match its review and lane authority',
          })
        const expectedKeys = [...lane.ownedPaths].sort()
        if (
          JSON.stringify(Object.keys(lane.receipt.beforeDigests).sort()) !==
            JSON.stringify(expectedKeys) ||
          JSON.stringify(Object.keys(lane.receipt.afterDigests).sort()) !==
            JSON.stringify(expectedKeys)
        )
          context.addIssue({
            code: 'custom',
            path: ['lanes', index, 'receipt'],
            message:
              'foundation remediation receipt must cover every owned path digest',
          })
      }
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
        'CHECKLIST_REVIEW',
        'COMPREHENSIVE_REVIEW',
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
          'CHECKLIST_REVIEW',
          'COMPREHENSIVE_REVIEW',
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
        'CHECKLIST_REVIEW',
        'COMPREHENSIVE_REVIEW',
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
    documentReviewState: documentReviewStateSchema,
    foundationDraftState: foundationDraftStateSchema,
    foundationRemediationState: foundationRemediationStateSchema.optional(),
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
      run.phase === 'DELIVERY' ||
      (run.phase === 'DOCUMENT_DRAFTING' &&
        run.documentReviewState.activeRun?.verdict === 'NEEDS_REVISION')
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

    const requiresFrozenChecklistApproval =
      run.status !== 'completed' &&
      (run.phase === 'RESOURCE_PREPARATION' ||
        run.phase === 'ATOMIC_TASK_PLANNING' ||
        run.phase === 'IMPLEMENTATION' ||
        run.phase === 'IMPLEMENTATION_AUDIT' ||
        run.phase === 'ACCEPTANCE' ||
        run.phase === 'DELIVERY' ||
        (run.phase === 'DOCUMENT_REVIEW' &&
          run.documentStep === 'COMPREHENSIVE_REVIEW'))
    const checklistApproval = run.documentReviewState.approvals.checklist
    if (
      requiresFrozenChecklistApproval &&
      (!checklistApproval ||
        checklistApproval.revision !== run.revision.document)
    )
      context.addIssue({
        code: 'custom',
        path: ['documentReviewState', 'approvals', 'checklist'],
        message:
          'resource and downstream phases require the frozen current checklist approval',
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
