import type { HistoricalAuthorDraftState } from './historical-author-checkpoint'
import type { FoundationReviewLinkState } from './foundation-review-link'
import type { GameIrStageLink } from './game-ir-link'
import type {
  AuthorDocumentsResult,
  AuthorHandle,
} from '../stage-modules/foundation-authoring/public'

import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath } from '../foundation-documents'
export { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath } from '../foundation-documents'

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

export type AuthorStageLink = {
  timing?: { currentCallElapsedMs: number; historicalElapsedMs: number }
  protocolVersion: 1
  requestId: string
  inputDigest: string
  handle?: AuthorHandle
  status:
    | 'starting'
    | 'running'
    | 'stopped'
    | 'needs_action'
    | 'failed'
    | 'completed'
  result?: AuthorDocumentsResult
  control: {
    sequence: number
    action: 'run' | 'stop'
    requestId: string
    reason?: string
  }
}

export const CANONICAL_DOCUMENT_ARTIFACTS = [
  ...CANONICAL_PROJECT_DOCUMENTS,
] as const

export const CANONICAL_ASSET_MANIFEST = 'assets/asset-manifest.json' as const
export const CANONICAL_GAME_CONTENT_INDEX = 'content/index.json' as const
export const WORKFLOW_EVIDENCE_DIRECTORY =
  '.beegame/workflow/evidence/' as const

export const CANONICAL_PROJECT_ARTIFACTS = [
  ...CANONICAL_DOCUMENT_ARTIFACTS,
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_GAME_CONTENT_INDEX,
] as const

export type DeliveryPhase =
  | 'BRIEF_CONFIRMED'
  | 'DOCUMENT_DRAFTING'
  | 'DOCUMENT_REVIEW'
  | 'RESOURCE_PREPARATION'
  | 'GAME_CONTENT'
  | 'IMPLEMENTATION'
  | 'ACCEPTANCE'
  | 'DELIVERY'

export type DocumentWorkflowStep =
  | 'FOUNDATION_DRAFTING'
  | 'FOUNDATION_REVIEW'
  | 'GAME_IR_COMPILATION'
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

export type ImplementationTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'

export type DispatchWorkerType =
  | 'document-author'
  | 'resource-planner'
  | 'content-author'
  | 'implementation-worker'
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
  | 'game_content'
  | 'acceptance'
export type EvidenceStatus = 'ready' | 'passed' | 'failed' | 'blocked'

export const DELIVERY_RUN_SCHEMA_VERSION = 61 as const

export const RESOURCE_PRODUCTION_TASKS = [
  'RESOURCE_DELIVERY',
  'RESOURCE_DELIVERED',
] as const

export type ResourceProductionTask = (typeof RESOURCE_PRODUCTION_TASKS)[number]

export type ResourceInventoryBinding = {
  requirementId: string
  resourceIds: string[]
}

export type ResourceDeliveryReceipt = {
  bindings: ResourceInventoryBinding[]
  catalogObserved: boolean
  resourceDigest: string
  acceptedAt: string
}

export type ResourceProductionState = {
  currentTask: ResourceProductionTask
  /** Published IR accepted by the resource planner; retained by its descendants. */
  irResultId?: string
  deliveryReceipt?: ResourceDeliveryReceipt
}

export type Revision = {
  document: string
  resource?: string
  content?: string
  implementation?: string
  workspace: string
}

export type ImplementationTask = {
  id: string
  title: string
  checklistIds: string[]
  resourceIds: string[]
  contentIds: string[]
  allowedPaths: string[]
  status: ImplementationTaskStatus
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
    | 'resource-delivery'
    | 'game-content'
    | 'implementation-task'
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
  tasks: ImplementationTask[]
  activeDispatch?: DispatchRecord
  evidence: {
    resourcePreparation?: EvidenceRef
    gameContent?: EvidenceRef
    acceptance?: EvidenceRef
  }
  /** Sole durable cursor for the initial eight-document authoring pass. */
  /** Historical evidence; never a resumable Author execution checkpoint. */
  foundationDraftState: HistoricalAuthorDraftState
  /** Public author lifecycle handoff; never contains private checkpoints or worker state. */
  authorStage?: AuthorStageLink
  gameIrStage?: GameIrStageLink
  foundationReviewStage?: FoundationReviewLinkState
  /** Reserved solely to reject obsolete snapshots; no old project state is accepted. */
  foundationAuditState?: never
  /** Sole task/checkpoint state for Resource Production. */
  resourceProductionState: ResourceProductionState
  /** Accepted engine-neutral Scene/UI package for downstream implementation. */
  gameContentReceipt?: import('../game-content-package').BeeGameContentReadyReceipt
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
  contract: Record<string, unknown>
}

export type DeliveryWorkerPort = {
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
  /** True while a native workspace mutation is still in flight. */
  hasInFlightMutation?(dispatchId: string): Promise<boolean>
  waitForTerminal?(dispatchId: string): Promise<unknown>
}
