import { z } from 'zod/v4'
import { documentReviewCheckSchema } from './document-review-check-schema'
import type {
  AtomicTask,
  ChecklistRemediation,
  DocumentReviewApproval,
  DocumentReviewCheck,
  DocumentReviewCycle,
  DocumentReviewFinding,
  DocumentReviewState,
  DeliveryPhase,
  DeliveryRun,
  DispatchRecord,
  EvidenceRef,
  FoundationDraftState,
  Revision,
  TaskVerification,
  WorkflowEvent,
  WorkerDispatchRequest,
} from './types'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  DELIVERY_RUN_SCHEMA_VERSION,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
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
    startingUsageTotalTokens: z.number().int().nonnegative().optional(),
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
      successfulResourceCount: z.number().int().nonnegative(),
      failedResourceCount: z.number().int().nonnegative(),
      observedAt: z.string().datetime(),
    })
    .strict(),
])

const documentReviewCheckIdSchema = z.enum(
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
)

export const persistedDocumentReviewCheckSchema: z.ZodType<DocumentReviewCheck> =
  documentReviewCheckSchema

export const persistedDocumentReviewFindingSchema: z.ZodType<DocumentReviewFinding> =
  z
    .object({
      findingId: z.string().min(1),
      checkId: documentReviewCheckIdSchema,
      severity: z.literal('blocking'),
      owner: z.enum(['foundation', 'checklist', 'resource']),
      regressionPaths: z.array(z.string().min(1)).optional(),
      evidence: z
        .array(
          z
            .object({
              path: z.string().min(1),
              anchor: z.string().min(1),
            })
            .strict(),
        )
        .min(1),
      subjects: z
        .array(
          z
            .object({
              path: z.string().min(1),
              anchor: z.string().min(1),
              requirementId: z.string().min(1).optional(),
              resourceId: z.string().min(1).optional(),
              contentId: z.string().min(1).optional(),
            })
            .strict(),
        )
        .min(1),
      observation: z.string().min(1),
      blockingReason: z.string().min(1),
      requiredAction: z.string().min(1),
      closureCondition: z.string().min(1),
    })
    .strict()

const checkEvidenceDigestsSchema = z.record(
  z.string(),
  z.record(z.string(), z.string().min(1)),
)

const documentReviewApprovalSchema: z.ZodType<DocumentReviewApproval> = z
  .object({
    scope: z.enum(['foundation', 'complete']),
    revision: z.string().min(1),
    checks: z.array(persistedDocumentReviewCheckSchema).min(1),
    checkEvidenceDigests: checkEvidenceDigestsSchema,
    evidencePath: z.string().min(1),
    approvedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((approval, context) => {
    const expected =
      approval.scope === 'foundation'
        ? FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS
        : COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS
    const ids = approval.checks.map(check => check.id)
    if (
      ids.length !== expected.length ||
      new Set(ids).size !== expected.length ||
      expected.some(id => !ids.includes(id)) ||
      approval.checks.some(check => check.status !== 'pass')
    )
      context.addIssue({
        code: 'custom',
        path: ['checks'],
        message:
          'document review approval requires the exact passing check set',
      })
  })

const documentReviewCycleSchema: z.ZodType<DocumentReviewCycle> = z
  .object({
    cycleId: z.string().min(1),
    parentCycleId: z.string().min(1).optional(),
    originScope: z.enum(['foundation', 'complete']),
    scope: z.enum(['foundation', 'complete']),
    mode: z.enum(['initial', 'closure']),
    sourceRevision: z.string().min(1),
    requiredCheckIds: z.array(documentReviewCheckIdSchema).min(1),
    completedCheckIds: z.array(documentReviewCheckIdSchema),
    checks: z.array(persistedDocumentReviewCheckSchema),
    checkEvidenceDigests: checkEvidenceDigestsSchema,
    findings: z.array(persistedDocumentReviewFindingSchema),
    activeTarget: z.enum(['foundation', 'checklist', 'resource']).optional(),
    acceptedSemanticResult: z.boolean(),
    changedPaths: z.array(z.string().min(1)),
    sourceArtifactDigests: z.record(z.string(), z.string().min(1)),
    repairPlan: z
      .object({
        groups: z
          .array(
            z
              .object({
                groupId: z.string().trim().min(1),
                findingIds: z.array(z.string().trim().min(1)).min(1),
                decision: z.string().trim().min(1),
                affectedPaths: z
                  .array(z.enum(CANONICAL_FOUNDATION_DOCUMENTS))
                  .min(1),
                dependsOn: z.array(z.string().trim().min(1)),
              })
              .strict(),
          )
          .min(1),
        completedPaths: z.array(z.enum(CANONICAL_FOUNDATION_DOCUMENTS)),
      })
      .strict()
      .optional(),
    evidencePath: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((cycle, context) => {
    const completedPrefix = cycle.requiredCheckIds.slice(
      0,
      cycle.completedCheckIds.length,
    )
    if (
      completedPrefix.length !== cycle.completedCheckIds.length ||
      completedPrefix.some(
        (id, index) => id !== cycle.completedCheckIds[index],
      ) ||
      cycle.acceptedSemanticResult !==
        (cycle.completedCheckIds.length === cycle.requiredCheckIds.length) ||
      cycle.completedCheckIds.some(
        id => !cycle.checks.some(check => check.id === id),
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['completedCheckIds'],
        message:
          'document review completed checks must be the required-order prefix',
      })
    if (
      cycle.mode === 'initial' &&
      (cycle.originScope !== cycle.scope ||
        cycle.parentCycleId ||
        (!cycle.acceptedSemanticResult && cycle.activeTarget) ||
        cycle.changedPaths.length > 0)
    )
      context.addIssue({
        code: 'custom',
        message: 'initial document review cycle has closure-only state',
      })
    if (
      cycle.mode === 'closure' &&
      (!cycle.parentCycleId || !cycle.activeTarget)
    )
      context.addIssue({
        code: 'custom',
        message: 'closure document review cycle requires parent and target',
      })
    if (cycle.repairPlan) {
      if (!cycle.acceptedSemanticResult || cycle.activeTarget !== 'foundation')
        context.addIssue({
          code: 'custom',
          path: ['repairPlan'],
          message:
            'foundation repair plan requires one accepted active foundation finding ledger',
        })
      const expectedFindingIds = cycle.findings
        .filter(finding => finding.owner === 'foundation')
        .map(finding => finding.findingId)
      const assignedFindingIds = cycle.repairPlan.groups.flatMap(
        group => group.findingIds,
      )
      if (
        assignedFindingIds.length > expectedFindingIds.length ||
        new Set(assignedFindingIds).size !== assignedFindingIds.length ||
        assignedFindingIds.some((id, index) => id !== expectedFindingIds[index])
      )
        context.addIssue({
          code: 'custom',
          path: ['repairPlan', 'groups'],
          message:
            'repair plan must be the stable accepted-finding prefix without duplicates',
        })
      const groupIds = cycle.repairPlan.groups.map(group => group.groupId)
      const knownGroups = new Set(groupIds)
      if (
        knownGroups.size !== groupIds.length ||
        cycle.repairPlan.groups.some(
          group =>
            new Set(group.findingIds).size !== group.findingIds.length ||
            new Set(group.affectedPaths).size !== group.affectedPaths.length ||
            new Set(group.dependsOn).size !== group.dependsOn.length ||
            group.dependsOn.some(
              dependency =>
                dependency === group.groupId || !knownGroups.has(dependency),
            ),
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['repairPlan', 'groups'],
          message: 'repair plan group identities and dependencies are invalid',
        })
      const dependencyMap = new Map(
        cycle.repairPlan.groups.map(group => [group.groupId, group.dependsOn]),
      )
      const visiting = new Set<string>()
      const visited = new Set<string>()
      let cyclic = false
      const visit = (groupId: string): void => {
        if (visited.has(groupId) || cyclic) return
        if (visiting.has(groupId)) {
          cyclic = true
          return
        }
        visiting.add(groupId)
        for (const dependency of dependencyMap.get(groupId) ?? [])
          visit(dependency)
        visiting.delete(groupId)
        visited.add(groupId)
      }
      for (const groupId of groupIds) visit(groupId)
      if (cyclic)
        context.addIssue({
          code: 'custom',
          path: ['repairPlan', 'groups'],
          message: 'repair plan dependencies must be acyclic',
        })
      const plannedFindingSet = new Set(assignedFindingIds)
      const expectedPaths = [
        ...new Set(
          cycle.findings
            .filter(finding => plannedFindingSet.has(finding.findingId))
            .flatMap(finding =>
              finding.subjects
                .map(subject => subject.path)
                .filter(path =>
                  CANONICAL_FOUNDATION_DOCUMENTS.includes(path as never),
                ),
            ),
        ),
      ]
      const plannedPaths = [
        ...new Set(
          cycle.repairPlan.groups.flatMap(group => group.affectedPaths),
        ),
      ]
      if (
        plannedPaths.length !== expectedPaths.length ||
        expectedPaths.some(path => !plannedPaths.includes(path as never))
      )
        context.addIssue({
          code: 'custom',
          path: ['repairPlan', 'groups'],
          message: 'repair plan paths must cover the finding subjects exactly',
        })
      if (
        assignedFindingIds.length < expectedFindingIds.length &&
        cycle.repairPlan.completedPaths.length > 0
      )
        context.addIssue({
          code: 'custom',
          path: ['repairPlan', 'completedPaths'],
          message:
            'document repair cannot start before every finding has a decision',
        })
      const repairPaths = CANONICAL_FOUNDATION_DOCUMENTS.filter(path =>
        cycle.repairPlan!.groups.some(group =>
          group.affectedPaths.includes(path),
        ),
      )
      const completedPrefix = repairPaths.slice(
        0,
        cycle.repairPlan.completedPaths.length,
      )
      if (
        completedPrefix.length !== cycle.repairPlan.completedPaths.length ||
        completedPrefix.some(
          (path, index) => path !== cycle.repairPlan!.completedPaths[index],
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['repairPlan', 'completedPaths'],
          message:
            'repair plan completed paths must be the canonical owner-order prefix',
        })
    }
  })

const documentReviewStateSchema: z.ZodType<DocumentReviewState> = z
  .object({
    foundationApproval: documentReviewApprovalSchema.optional(),
    comprehensiveApproval: documentReviewApprovalSchema.optional(),
    activeCycle: documentReviewCycleSchema.optional(),
    repairPasses: z
      .object({
        foundation: z.number().int().min(0),
        checklist: z.number().int().min(0),
        resource: z.number().int().min(0),
      })
      .strict(),
  })
  .strict()

const checklistRemediationSchema: z.ZodType<ChecklistRemediation> = z
  .object({
    sourceRevision: z.string().min(1),
    attempt: z.number().int().positive(),
    issues: z.array(z.string().min(1)).min(1),
  })
  .strict()

const foundationDraftStateSchema: z.ZodType<FoundationDraftState> = z
  .object({
    completedPaths: z.array(z.enum(CANONICAL_FOUNDATION_DOCUMENTS)),
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
      ])
      .optional(),
    status: z.enum(DELIVERY_RUN_STATUSES),
    revision: revisionSchema,
    createdAt: z.string().datetime(),
  })
  .catchall(z.unknown()) as z.ZodType<WorkflowEvent>

export const deliveryRunSchema: z.ZodType<DeliveryRun> = z
  .object({
    schemaVersion: z.literal(DELIVERY_RUN_SCHEMA_VERSION),
    runId: z.string().min(1),
    projectId: z.string().min(1),
    ownerId: z.string().min(1),
    parentRunId: z.string().min(1).optional(),
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
      ])
      .optional(),
    status: z.enum(DELIVERY_RUN_STATUSES),
    revision: revisionSchema,
    activeTaskId: z.string().min(1).optional(),
    currentItemId: z.string().min(1).optional(),
    reviewedDocumentPaths: z.array(z.string().min(1)).optional(),
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
    checklistRemediation: checklistRemediationSchema.optional(),
    resourcePreparationAttempt: z.number().int().nonnegative().optional(),
    usage: workflowUsageSchema.optional(),
    resourceEvidence: resourceEvidenceSchema.optional(),
    currentMessage: z.string().min(1).optional(),
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
        run.documentReviewState.activeCycle?.acceptedSemanticResult === true)
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
