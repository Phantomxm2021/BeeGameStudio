import { z } from 'zod/v4'
import { gameIrStageLinkSchema } from './game-ir-link'
import type { HistoricalAuthorDraftState } from './historical-author-checkpoint'
import { createFoundationReviewLinkSchema } from './foundation-review-link-schema'
import { assertImportedFoundationAuthorBoundary } from './foundation-review-link'
import type {
  ImplementationTask,
  AcceptedWorkflowUnit,
  AuthorStageLink,
  DeliveryPhase,
  DeliveryRun,
  DispatchRecord,
  EvidenceRef,
  Revision,
  WorkflowEvent,
  WorkflowUnitAcceptedEvent,
  WorkerDispatchRequest,
} from './types'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  DELIVERY_RUN_SCHEMA_VERSION,
  RESOURCE_PRODUCTION_TASKS,
} from './types'
import type {
  AuthorDocumentsResult,
  AuthorHandle,
} from '../stage-modules/foundation-authoring/public'

export const DELIVERY_PHASES = [
  'BRIEF_CONFIRMED',
  'DOCUMENT_DRAFTING',
  'DOCUMENT_REVIEW',
  'RESOURCE_PREPARATION',
  'IMPLEMENTATION',
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
export const IMPLEMENTATION_TASK_STATUSES = [
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
  'resource-planner',
  'implementation-worker',
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
    contract: z.record(z.string(), z.unknown()),
  })
  .strict()

export const implementationTaskSchema: z.ZodType<ImplementationTask> = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    checklistIds: z.array(z.string().min(1)),
    resourceIds: z.array(z.string().min(1)),
    contentIds: z.array(z.string().min(1)),
    allowedPaths: z.array(z.string().min(1)).min(1),
    status: z.enum(IMPLEMENTATION_TASK_STATUSES),
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
    irResultId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    deliveryReceipt: z
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
        contentDigest: z.string().min(1),
        acceptedAt: z.string().datetime(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((state, context) => {
    if (
      state.currentTask === 'RESOURCE_DELIVERED' &&
      (!state.irResultId || !state.deliveryReceipt)
    )
      context.addIssue({
        code: 'custom',
        message: 'delivered resources require their published IR binding and delivery receipt',
      })
    if (
      state.currentTask === 'RESOURCE_DELIVERY' &&
      state.deliveryReceipt
    )
      context.addIssue({
        code: 'custom',
        path: ['deliveryReceipt'],
        message: 'an in-progress resource delivery cannot retain an accepted receipt',
      })
  })

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
      'acceptance',
    ]),
    revision: z.string().min(1),
    status: z.enum(['ready', 'passed', 'failed', 'blocked']),
    observedAt: z.string().datetime(),
  })
  .strict()

// Historical wire format only; new Author state is validated by authorStage below.
const historicalAuthorDraftStateSchema: z.ZodType<HistoricalAuthorDraftState> = z
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

const sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/)

// This is deliberately a local mirror of the foundation-authoring public
// contract. Delivery persistence must not import or parse private author
// checkpoints.
const authorHandleSchema: z.ZodType<AuthorHandle> = z
  .strictObject({
    protocolVersion: z.literal(1),
    producer: z.literal('foundation-authoring'),
    id: z.string().uuid(),
  })

const authorDocumentArtifactSchema = z
  .strictObject({
    path: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
    digest: sha256DigestSchema,
    byteLength: z.number().int().nonnegative(),
    artifactPath: z.string().min(1).max(1024),
  })

const authorDocumentsResultSchema: z.ZodType<AuthorDocumentsResult> = z
  .strictObject({
    protocolVersion: z.literal(1),
    producer: z.literal('foundation-authoring'),
    kind: z.literal('foundation_documents'),
    resultId: sha256DigestSchema,
    inputDigest: sha256DigestSchema,
    ownerId: z.string().min(1).max(256),
    projectId: z.string().min(1).max(256),
    confirmedBriefDigest: sha256DigestSchema,
    documents: z
      .array(authorDocumentArtifactSchema)
      .length(CANONICAL_FOUNDATION_DOCUMENTS.length)
      .superRefine((documents, context) => {
        for (const [index, document] of documents.entries()) {
          if (document.path !== CANONICAL_FOUNDATION_DOCUMENTS[index])
            context.addIssue({
              code: 'custom',
              path: [index, 'path'],
              message: 'author result documents must use canonical order',
            })
        }
      }),
    documentRevision: z.string().min(1),
    workspaceRevision: z.string().min(1),
    receiptSetDigest: sha256DigestSchema,
  })

export const authorStageLinkSchema: z.ZodType<AuthorStageLink> = z
  .strictObject({
    timing: z.strictObject({ currentCallElapsedMs: z.number().nonnegative(), historicalElapsedMs: z.number().nonnegative() }).optional(),
    protocolVersion: z.literal(1),
    requestId: z.string().min(1).max(256),
    inputDigest: sha256DigestSchema,
    handle: authorHandleSchema.optional(),
    status: z.enum([
      'starting',
      'running',
      'stopped',
      'needs_action',
      'failed',
      'completed',
    ]),
    result: authorDocumentsResultSchema.optional(),
    control: z
      .strictObject({
        sequence: z.number().int().nonnegative(),
        action: z.enum(['run', 'stop']),
        requestId: z.string().min(1).max(256),
        reason: z.string().min(1).max(2000).optional(),
      }),
  })
  .superRefine((link, context) => {
    if (link.control.requestId !== link.requestId)
      context.addIssue({
        code: 'custom',
        path: ['control', 'requestId'],
        message: 'author control request must bind the stage request',
      })
    const handleRequired =
      link.status === 'running' ||
      link.status === 'needs_action' ||
      link.status === 'completed'
    if (handleRequired && !link.handle)
      context.addIssue({
        code: 'custom',
        path: ['handle'],
        message: `${link.status} author stage link requires a handle`,
      })
    if (
      link.status === 'stopped' &&
      !link.handle &&
      link.control.action !== 'stop'
    )
      context.addIssue({
        code: 'custom',
        path: ['control', 'action'],
        message: 'a stopped author stage without a handle must be stop-before-start',
      })
    if (link.status === 'completed' && !link.result)
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'completed author stage link requires a result',
      })
    if (link.result && link.status !== 'completed')
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'author result is only valid for completed stage links',
      })
    if (link.result && link.result.inputDigest !== link.inputDigest)
      context.addIssue({
        code: 'custom',
        path: ['result', 'inputDigest'],
        message: 'author result input digest does not match the stage link',
      })
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
        'GAME_IR_COMPILATION',
        'CHECKLIST_DRAFTING',
      ])
      .optional(),
    status: z.enum(DELIVERY_RUN_STATUSES),
    revision: revisionSchema,
    createdAt: z.string().datetime(),
  })
  .catchall(z.unknown()) as z.ZodType<WorkflowEvent>

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
        kind: z.literal('resource-delivery'),
        payload: receiptPayloadSchema.extend({
          bindings: z
            .array(
              z
                .object({
                  requirementId: z.string().min(1),
                  resourceIds: z.array(z.string().min(1)).min(1),
                })
                .strict(),
            )
            .optional(),
          catalogObserved: z.boolean().optional(),
        }),
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
        'GAME_IR_COMPILATION',
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
  return event
}

const pendingWorkflowEventsSchema = z
  .array(workflowEventSchema)
  .min(1)
  .superRefine((events, context) => {
    for (const [index, event] of events.entries()) {
      if (event.type !== 'workflow.unit.accepted') continue
      const parsed = workflowUnitAcceptedEventSchema.safeParse(event)
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
        'GAME_IR_COMPILATION',
        'CHECKLIST_DRAFTING',
      ])
      .optional(),
    status: z.enum(DELIVERY_RUN_STATUSES),
    revision: revisionSchema,
    activeTaskId: z.string().min(1).optional(),
    currentItemId: z.string().min(1).optional(),
    tasks: z.array(implementationTaskSchema),
    activeDispatch: dispatchRecordSchema.optional(),
    evidence: z
      .object({
        resourcePreparation: evidenceRefSchema.optional(),
        acceptance: evidenceRefSchema.optional(),
      })
      .strict(),
    foundationDraftState: historicalAuthorDraftStateSchema,
    authorStage: authorStageLinkSchema.optional(),
    gameIrStage: gameIrStageLinkSchema.optional(),
    foundationReviewStage: createFoundationReviewLinkSchema(authorDocumentsResultSchema).optional(),
    // Old project review state is unsupported, not a migration/read compatibility surface.
    foundationAuditState: z.never().optional(),
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
    if (run.phase === 'DOCUMENT_REVIEW' && run.documentStep !== 'CHECKLIST_DRAFTING' &&
        !run.foundationReviewStage && run.authorStage?.status !== 'completed')
      context.addIssue({ code: 'custom', path: ['foundationReviewStage'],
        message: 'Legacy Reviewer projects are unsupported; review requires a public stage invocation or completed public Author handoff' })
    const requiresCompletedFoundation =
      run.phase === 'DOCUMENT_REVIEW' ||
      run.phase === 'RESOURCE_PREPARATION' ||
      run.phase === 'IMPLEMENTATION' ||
      run.phase === 'ACCEPTANCE' ||
      run.phase === 'DELIVERY'
    if (
      requiresCompletedFoundation &&
      !(
        run.phase === 'DOCUMENT_REVIEW' &&
        run.documentStep === 'FOUNDATION_REVIEW' &&
        run.authorStage?.status === 'completed'
      ) && !run.foundationReviewStage &&
      run.foundationDraftState.completedPaths.length !==
        CANONICAL_FOUNDATION_DOCUMENTS.length
    )
      context.addIssue({
        code: 'custom',
        path: ['foundationDraftState', 'completedPaths'],
        message:
          'foundation review and downstream phases require all durable authoring checkpoints',
      })

    if (run.authorStage) {
      if (run.activeDispatch?.workerType === 'document-author' && run.documentStep !== 'CHECKLIST_DRAFTING')
        context.addIssue({
          code: 'custom',
          path: ['activeDispatch'],
          message: 'author stage link cannot coexist with legacy author dispatch',
        })
      if (run.foundationDraftState.completedPaths.length > 0)
        context.addIssue({
          code: 'custom',
          path: ['foundationDraftState', 'completedPaths'],
          message: 'author stage link cannot coexist with legacy author checkpoints',
        })
      if ((run.foundationDraftState.documents?.length ?? 0) > 0)
        context.addIssue({
          code: 'custom',
          path: ['foundationDraftState', 'documents'],
          message: 'author stage link cannot coexist with legacy author documents',
        })

      const result = run.authorStage.result
      if (result) {
        if (result.ownerId !== run.ownerId)
          context.addIssue({
            code: 'custom',
            path: ['authorStage', 'result', 'ownerId'],
            message: 'author result owner does not match delivery run owner',
          })
        if (result.projectId !== run.projectId)
          context.addIssue({
            code: 'custom',
            path: ['authorStage', 'result', 'projectId'],
            message: 'author result project does not match delivery run project',
          })
        if (result.confirmedBriefDigest !== run.confirmedBriefDigest)
          context.addIssue({
            code: 'custom',
            path: ['authorStage', 'result', 'confirmedBriefDigest'],
            message: 'author result brief does not match delivery run brief',
          })
      }
    }

    if (run.foundationReviewStage) {
      const link = run.foundationReviewStage
      const imported = link.importedAuthorResult
      try { assertImportedFoundationAuthorBoundary(run) }
      catch (error) { context.addIssue({ code: 'custom', path: ['foundationReviewStage'], message: String(error) }) }
      if ((!imported && (run.authorStage?.status !== 'completed' || link.authorResultId !== run.authorStage.result?.resultId)) ||
          link.invocation.request.ownerId !== run.ownerId || link.invocation.request.projectId !== run.projectId ||
          (!link.acceptedReview && Boolean(run.activeDispatch)) || run.foundationAuditState ||
          (!link.acceptedReview && run.phase !== 'DOCUMENT_REVIEW'))
        context.addIssue({ code: 'custom', path: ['foundationReviewStage'],
          message: 'Public foundation review must bind its author and cannot coexist with retired execution or downstream phases' })
      if (!link.acceptedReview && run.documentStep !== 'FOUNDATION_REVIEW')
        context.addIssue({ code: 'custom', path: ['documentStep'], message: 'Public foundation phase must use the document review step' })
    }

    if (run.gameIrStage) {
      const link = run.gameIrStage
      const review = run.foundationReviewStage?.acceptedReview
      if (run.phase === 'BRIEF_CONFIRMED' || run.phase === 'DOCUMENT_DRAFTING' ||
          run.phase === 'DOCUMENT_REVIEW' && !['GAME_IR_COMPILATION', 'CHECKLIST_DRAFTING'].includes(run.documentStep ?? ''))
        context.addIssue({ code: 'custom', path: ['gameIrStage'],
          message: 'IR provenance cannot coexist with an earlier Foundation execution stage' })
      if (!review || link.foundationResultId !== review.resultId ||
          link.foundationRevision !== review.documentSetDigest ||
          link.control.appliedSequence > link.control.sequence ||
          (link.outcome && (!link.handle || link.outcome.handle.id !== link.handle.id)))
        context.addIssue({ code: 'custom', path: ['gameIrStage'],
          message: 'IR link must bind its accepted Foundation result, handle and control sequence' })
      if (link.outcome?.status === 'completed' &&
          link.outcome.result.foundationRevision !== link.foundationRevision)
        context.addIssue({ code: 'custom', path: ['gameIrStage', 'outcome'],
          message: 'IR completion must bind the accepted Foundation revision' })
    }
    const entersDownstream = run.documentStep === 'CHECKLIST_DRAFTING' ||
      ['RESOURCE_PREPARATION', 'IMPLEMENTATION', 'ACCEPTANCE', 'DELIVERY'].includes(run.phase)
    if (run.foundationReviewStage?.acceptedReview && entersDownstream &&
        (run.gameIrStage?.outcome?.status !== 'completed' ||
          run.gameIrStage.outcome.billingStatus !== 'settled' || run.gameIrStage.control.action !== 'run'))
      context.addIssue({ code: 'custom', path: ['gameIrStage'],
        message: 'Accepted Foundation documents require settled IR completion before downstream work' })
  })

export const parseDeliveryRun = (value: unknown): DeliveryRun => deliveryRunSchema.parse(value)
export const parseImplementationTask = (value: unknown): ImplementationTask =>
  implementationTaskSchema.parse(value)
export const parseDispatchRecord = (value: unknown): DispatchRecord =>
  dispatchRecordSchema.parse(value)
export const parseEvidenceRef = (value: unknown): EvidenceRef =>
  evidenceRefSchema.parse(value)
