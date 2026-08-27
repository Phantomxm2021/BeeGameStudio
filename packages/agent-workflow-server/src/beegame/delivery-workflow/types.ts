import type { FoundationAuditState } from './foundation-audit-state'
export type {
  FoundationAuditState,
  FoundationRevisionDocumentTask,
  FoundationRevisionImpactedFactsTask,
  FoundationRevisionRound,
  FoundationRevisionSemanticRecheckTask,
  FoundationRevisionTask,
} from './foundation-audit-state'

export const CANONICAL_FOUNDATION_DOCUMENTS = [
  'docs/GDD.md',
  'docs/LEVEL_SCENE_DESIGN.md',
  'docs/BALANCE_DESIGN.md',
  'docs/TECHNICAL_DESIGN.md',
  'docs/ART_DIRECTION.md',
  'docs/UI_UX_SPEC.md',
  'docs/AUDIO_DESIGN.md',
  'docs/ASSET_PLAN.md',
] as const

export const CANONICAL_PROJECT_DOCUMENTS = [
  ...CANONICAL_FOUNDATION_DOCUMENTS,
  'docs/acceptance/gameplay-checklist.md',
] as const

export const CANONICAL_PROJECT_DOCUMENT_IDS = {
  'docs/GDD.md': 'GDD',
  'docs/LEVEL_SCENE_DESIGN.md': 'LEVEL_SCENE_DESIGN',
  'docs/BALANCE_DESIGN.md': 'BALANCE_DESIGN',
  'docs/TECHNICAL_DESIGN.md': 'TECHNICAL_DESIGN',
  'docs/ART_DIRECTION.md': 'ART_DIRECTION',
  'docs/UI_UX_SPEC.md': 'UI_UX_SPEC',
  'docs/AUDIO_DESIGN.md': 'AUDIO_DESIGN',
  'docs/ASSET_PLAN.md': 'ASSET_PLAN',
  'docs/acceptance/gameplay-checklist.md': 'GAMEPLAY_CHECKLIST',
} as const satisfies Record<
  (typeof CANONICAL_PROJECT_DOCUMENTS)[number],
  string
>

export type FoundationDocumentPath =
  (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]

export type FoundationAuthoringStatus =
  | 'pending'
  | 'drafting'
  | 'committed'
  | 'needs_action'

export type FoundationDocumentCheckpoint = {
  path: FoundationDocumentPath
  status: FoundationAuthoringStatus
  upstreamDigests?: Record<string, string>
  dispatch?: DispatchRecord
  failureReason?: string
}

export type FoundationValidationDiagnostics = {
  targetPath: FoundationDocumentPath
  documentDigest: string
  violationSetDigest: string
  violations: string[]
}

export type FoundationDraftState = {
  /** Completed initial-authoring checkpoints in canonical dependency order. */
  completedPaths: FoundationDocumentPath[]
  /** Per-document state exists only for the parallel downstream authoring batch. */
  documents?: FoundationDocumentCheckpoint[]
}

export const CANONICAL_DOCUMENT_ARTIFACTS = [
  ...CANONICAL_PROJECT_DOCUMENTS,
] as const

export const CANONICAL_ASSET_MANIFEST = 'assets/asset-manifest.json' as const
export const WORKFLOW_EVIDENCE_DIRECTORY =
  '.beegame/workflow/evidence/' as const

export const CANONICAL_PROJECT_ARTIFACTS = [
  ...CANONICAL_DOCUMENT_ARTIFACTS,
  CANONICAL_ASSET_MANIFEST,
] as const

export type DeliveryPhase =
  | 'BRIEF_CONFIRMED'
  | 'DOCUMENT_DRAFTING'
  | 'DOCUMENT_REVIEW'
  | 'RESOURCE_PREPARATION'
  | 'ATOMIC_TASK_PLANNING'
  | 'IMPLEMENTATION'
  | 'IMPLEMENTATION_AUDIT'
  | 'ACCEPTANCE'
  | 'DELIVERY'

export type DocumentWorkflowStep =
  | 'FOUNDATION_DRAFTING'
  | 'FOUNDATION_REVIEW'
  | 'CHECKLIST_DRAFTING'

/**
 * `blocked` is reserved for a durable validation gate result.  Operational
 * failures and malformed worker output are `failed`; a gate that needs a
 * person to fix an artifact is `needs_action`.  Keeping these states distinct
 * is what makes restart/retry behaviour deterministic.
 */
export type DeliveryRunStatus =
  | 'running'
  | 'needs_action'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'stopped'

export type AtomicTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'

export type DispatchWorkerType =
  | 'document-author'
  | 'foundation-fact-extractor'
  | 'foundation-semantic-reviewer'
  | 'foundation-document-reviser'
  | 'resource-planner'
  | 'resource-curator'
  | 'resource-content-author'
  | 'atomic-task-planner'
  | 'implementation-worker'
  | 'implementation-auditor'
  | 'acceptance-validator'
  | 'change-impact-analyzer'
  | 'question-answerer'

export type DispatchStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'interrupted'
  | 'invalid'

export type EvidenceKind =
  | 'document_review'
  | 'resource_preparation'
  | 'implementation_audit'
  | 'acceptance'
export type EvidenceStatus = 'ready' | 'passed' | 'failed' | 'blocked'

export const DELIVERY_RUN_SCHEMA_VERSION = 45 as const

export const RESOURCE_PRODUCTION_TASKS = [
  'RESOURCE_PLAN',
  'RESOURCE_INVENTORY',
  'RESOURCE_CONTENT',
  'RESOURCE_GATE',
] as const

export type ResourceProductionTask = (typeof RESOURCE_PRODUCTION_TASKS)[number]

export type ResourceInventoryBinding = {
  requirementId: string
  resourceIds: string[]
}

export type ResourceInventoryReceipt = {
  revision: string
  bindings: ResourceInventoryBinding[]
  catalogObserved: boolean
  acceptedAt: string
}

export type ResourceContentReceipt = {
  contentDigest: string
  acceptedAt: string
}

export type ResourceProductionState = {
  currentTask: ResourceProductionTask
  inventoryReceipt?: ResourceInventoryReceipt
  contentReceipt?: ResourceContentReceipt
}

export type Revision = {
  document: string
  resource?: string
  implementation?: string
  workspace: string
}

export type TaskVerification = {
  kind: 'test' | 'build' | 'runtime' | 'file' | 'asset'
  commandOrAction: string
  expectedResult: string
}

export type AtomicTask = {
  id: string
  title: string
  checklistIds: string[]
  resourceIds: string[]
  contentIds: string[]
  dependsOn: string[]
  allowedPaths: string[]
  expectedArtifacts: string[]
  verification: TaskVerification[]
  status: AtomicTaskStatus
  attempt: number
  startedRevision?: string
  completedRevision?: string
  evidenceRefs: string[]
}

export type DispatchRecord = {
  dispatchId: string
  workerType: DispatchWorkerType
  phase: DeliveryPhase
  taskId?: string
  revision: string
  status: DispatchStatus
  terminalEvidencePath?: string
  failureReason?: string
  request?: WorkerDispatchRequest
  terminalResult?: Record<string, unknown>
  /** Cumulative run usage captured before this worker starts. */
  startingUsage?: WorkflowUsage
  /** Usage attributed only to this dispatch, including concurrent lanes. */
  usage?: WorkflowUsage
  startedAt: string
  finishedAt?: string
}

export type EvidenceRef = {
  path: string
  kind: EvidenceKind
  revision: string
  status: EvidenceStatus
  observedAt: string
}

export type WorkflowUsage = {
  input_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  completion_tokens: number
  total_tokens: number
}

export type AcceptedWorkflowUnit = {
  eventSchemaVersion: 1
  unitId: string
  kind:
    | 'document'
    | 'resource-inventory'
    | 'resource-content'
    | 'resource-gate'
    | 'atomic-plan'
    | 'implementation-task'
    | 'implementation-audit'
    | 'acceptance'
  phase: DeliveryPhase
  predecessorUnitIds: string[]
  inputRevision: string
  dependencyDigests: Record<string, string>
  /** Exact worker dispatch that produced a receipt-backed accepted unit. */
  dispatchId?: string
  receiptRef?: string
  acceptedAt: string
  payload: unknown
}

/**
 * A journal record that is also safe to keep temporarily in the run snapshot.
 * The snapshot marker makes a commit recoverable if the process exits after
 * writing the state but before the append-only journal has been flushed.
 */
export type WorkflowEvent = {
  eventId: string
  runId: string
  type: string
  phase: DeliveryPhase
  documentStep?: DocumentWorkflowStep
  status: DeliveryRunStatus
  revision: Revision
  createdAt: string
  [key: string]: unknown
}

export type WorkflowUnitAcceptedEvent = WorkflowEvent & {
  type: 'workflow.unit.accepted'
  projectId: string
  ownerId: string
  unit: AcceptedWorkflowUnit
}

export type TasksPlannedEvent = WorkflowEvent & {
  type: 'tasks.planned'
  phase: 'IMPLEMENTATION'
  status: 'running'
  activeTaskId?: string
  taskGraph: AtomicTask[]
}

export type DeliveryRun = {
  schemaVersion: typeof DELIVERY_RUN_SCHEMA_VERSION
  runId: string
  projectId: string
  ownerId: string
  confirmedBriefDigest: string
  confirmedBriefContext: string
  changeRequest?: string
  changeRoute?: 'question' | 'implementation_only' | 'documents_required'
  changeAffectedRequirementIds?: string[]
  changeAffectedChecklistIds?: string[]
  changeRationale?: string
  phase: DeliveryPhase
  documentStep?: DocumentWorkflowStep
  status: DeliveryRunStatus
  revision: Revision
  activeTaskId?: string
  /** Canonical project artifact currently being processed by a document worker. */
  currentItemId?: string
  tasks: AtomicTask[]
  activeDispatch?: DispatchRecord
  evidence: {
    resourcePreparation?: EvidenceRef
    implementationAudit?: EvidenceRef
    acceptance?: EvidenceRef
  }
  /** Sole durable cursor for the initial eight-document authoring pass. */
  foundationDraftState: FoundationDraftState
  /** Deterministic post-authoring Section Index + Fact Store binding. */
  foundationAuditState?: FoundationAuditState
  /** Sole task/checkpoint state for Resource Production. */
  resourceProductionState: ResourceProductionState
  usage?: WorkflowUsage
  /** Latest durable progress text for the workflow card. */
  currentMessage?: string
  thinking?: 'working' | 'waiting' | 'idle'
  /** Last worker activity observed by the durable progress channel. */
  lastProgressAt?: string
  /** Internal write-ahead marker; removed once every matching journal entry exists. */
  pendingEvents?: WorkflowEvent[]
  lastAnswer?: string
  blockedReason?: string
  createdAt: string
  /** Immutable wall-clock endpoint captured when delivery completes. */
  completedAt?: string
  updatedAt: string
}

export type WorkerDispatchRequest = {
  /** Assigned before persistence so a crash cannot orphan an untracked worker. */
  dispatchId?: string
  runId: string
  ownerId: string
  projectId: string
  workspacePath: string
  workerType: DispatchWorkerType
  phase: DeliveryPhase
  taskId?: string
  revision: string
  allowedPaths?: string[]
  protectedPaths?: string[]
  /** Explicit project-read scope; fact workers use the empty scope. */
  projectReadScope?: 'empty' | 'allowed'
  workflowJsonSchema?: Record<string, unknown>
  contract: Record<string, unknown>
}

export type DeliveryWorkerPort = {
  /** Front-door validation for the fact worker's persisted fast model route. */
  assertFoundationFactFastReady?(request: WorkerDispatchRequest): Promise<void>
  /** Front-door validation for persisted semantic model tier routing. */
  assertFoundationSemanticModelReady?(request: WorkerDispatchRequest): Promise<void>
  start(
    request: WorkerDispatchRequest,
  ): Promise<{ sessionId: string; dispatchId: string }>
  submit(dispatchId: string, prompt: string): Promise<void>
  stop(dispatchId: string, reason: string): Promise<void>
  close?(
    dispatchId: string,
    options?: { preserveSession?: boolean },
  ): Promise<void>
  status(dispatchId: string): Promise<DispatchRecord>
  /** True while a write or Resource Library import is still in flight. */
  hasInFlightMutation?(dispatchId: string): Promise<boolean>
  /** True while the worker's sole structured terminal tool is streaming. */
  hasInFlightTerminalSubmission?(dispatchId: string): Promise<boolean>
  waitForTerminal?(dispatchId: string): Promise<unknown>
}
