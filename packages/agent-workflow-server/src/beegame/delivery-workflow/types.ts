export const CANONICAL_PROJECT_DOCUMENTS = [
  'docs/GDD.md',
  'docs/TECHNICAL_DESIGN.md',
  'docs/ART_DIRECTION.md',
  'docs/UI_UX_SPEC.md',
  'docs/AUDIO_DESIGN.md',
  'docs/ASSET_PLAN.md',
  'docs/acceptance/gameplay-checklist.md',
] as const

export const CANONICAL_FOUNDATION_DOCUMENTS = [
  'docs/GDD.md',
  'docs/TECHNICAL_DESIGN.md',
  'docs/ART_DIRECTION.md',
  'docs/UI_UX_SPEC.md',
  'docs/AUDIO_DESIGN.md',
  'docs/ASSET_PLAN.md',
] as const

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
  | 'CHECKLIST_REVIEW'

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
  | 'document-reviewer'
  | 'resource-preparer'
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

export type DocumentReviewFinding = {
  id: string
  severity: 'blocking' | 'non_blocking'
  category: 'cross_document_conflict' | 'missing_spec' | 'calculation' | 'other'
  documents: string[]
  description: string
  requiredAction: string
}

export type DocumentRemediation = {
  sourceRevision: string
  evidencePath: string
  attempt: number
  findings: DocumentReviewFinding[]
  resolvedFindingIds?: string[]
}

export type ChecklistRemediation = {
  sourceRevision: string
  attempt: number
  issues: string[]
}

export type ResourceRemediation = {
  sourceRevision: string
  attempt: number
  issues: string[]
  preserveImportIds: string[]
  preserveCompositionIds: string[]
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
  sourceRequirementIds: string[]
  checklistIds: string[]
  dependsOn: string[]
  allowedPaths: string[]
  expectedArtifacts: string[]
  resourceImportIds?: string[]
  resourceCompositionIds?: string[]
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
  /** Raw worker output retained when parsing/contract validation fails. */
  terminalOutput?: string
  request?: WorkerDispatchRequest
  terminalResult?: Record<string, unknown>
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

export type ResourceEvidenceSnapshot =
  | { state: 'missing' }
  | {
      state: 'stale' | 'current'
      actions: string[]
      failedActions: string[]
      successfulImportCount: number
      failedImportCount: number
      observedAt: string
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

export type DeliveryRun = {
  schemaVersion: 1
  runId: string
  projectId: string
  ownerId: string
  parentRunId?: string
  confirmedBriefDigest: string
  confirmedBriefContext?: string
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
  /** Canonical project document currently being written by a workflow worker. */
  currentItemId?: string
  tasks: AtomicTask[]
  activeDispatch?: DispatchRecord
  evidence: {
    documentReview?: EvidenceRef
    resourcePreparation?: EvidenceRef
    implementationAudit?: EvidenceRef
    acceptance?: EvidenceRef
  }
  /** Exact reviewer corrections carried across author/reviewer retries. */
  documentRemediation?: DocumentRemediation
  /** Deterministic checklist-structure issues carried across bounded author retries. */
  checklistRemediation?: ChecklistRemediation
  /** Exact deterministic resource-contract failures carried into a repair pass. */
  resourceRemediation?: ResourceRemediation
  usage?: WorkflowUsage
  /** Latest deterministic native Resource Library provenance observed for this run. */
  resourceEvidence?: ResourceEvidenceSnapshot
  /** Latest durable progress text for the workflow card. */
  currentMessage?: string
  currentMessageKey?: string
  thinking?: 'working' | 'waiting' | 'idle'
  /** Last worker activity observed by the durable progress channel. */
  lastProgressAt?: string
  /** Internal write-ahead marker; removed once the matching journal entry exists. */
  pendingEvent?: WorkflowEvent
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
  contract: Record<string, unknown>
}

export type DeliveryWorkerPort = {
  start(
    request: WorkerDispatchRequest,
  ): Promise<{ sessionId: string; dispatchId: string }>
  submit(dispatchId: string, prompt: string): Promise<void>
  stop(dispatchId: string, reason: string): Promise<void>
  close?(dispatchId: string): Promise<void>
  status(dispatchId: string): Promise<DispatchRecord>
  waitForTerminal?(dispatchId: string): Promise<unknown>
}
