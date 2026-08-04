export const CANONICAL_PROJECT_DOCUMENTS = [
  'docs/GDD.md',
  'docs/LEVEL_SCENE_DESIGN.md',
  'docs/BALANCE_DESIGN.md',
  'docs/TECHNICAL_DESIGN.md',
  'docs/ART_DIRECTION.md',
  'docs/UI_UX_SPEC.md',
  'docs/AUDIO_DESIGN.md',
  'docs/ASSET_PLAN.md',
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

export type FoundationDocumentPath =
  (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]

export type FoundationDraftState = {
  /** Completed initial-authoring checkpoints in canonical dependency order. */
  completedPaths: FoundationDocumentPath[]
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

export const FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS = [
  'brief_alignment',
  'cross_document_consistency',
  'gameplay_completeness',
  'gameplay_strategy_viability',
  'economy_progression_integrity',
  'numeric_balance_feasibility',
  'pacing_difficulty_coherence',
  'level_scene_design_integrity',
  'technical_feasibility',
  'art_direction_coherence',
  'ui_audio_consistency',
  'acceptance_observability',
] as const

export const FOUNDATION_DOCUMENT_REVIEW_CHECK_PACKETS = [
  ['brief_alignment', 'cross_document_consistency', 'gameplay_completeness'],
  ['gameplay_strategy_viability', 'economy_progression_integrity'],
  ['numeric_balance_feasibility', 'pacing_difficulty_coherence'],
  [
    'level_scene_design_integrity',
    'technical_feasibility',
    'art_direction_coherence',
    'ui_audio_consistency',
  ],
  ['acceptance_observability'],
] as const satisfies readonly (readonly FoundationDocumentReviewCheckId[])[]

export const COMPREHENSIVE_DOCUMENT_REVIEW_ADDITIONAL_CHECK_IDS = [
  'checklist_traceability',
  'resource_semantic_fitness',
  'content_structure_fitness',
  'resource_content_consistency',
  'implementation_readiness',
] as const

export const DOCUMENT_REVIEW_CHECK_PACKETS: readonly (readonly DocumentReviewCheckId[])[] =
  [
    ...FOUNDATION_DOCUMENT_REVIEW_CHECK_PACKETS,
    ...COMPREHENSIVE_DOCUMENT_REVIEW_ADDITIONAL_CHECK_IDS.map(id => [id]),
  ]

export const COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS = [
  ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  ...COMPREHENSIVE_DOCUMENT_REVIEW_ADDITIONAL_CHECK_IDS,
] as const

export type DocumentReviewScope = 'foundation' | 'complete'
export type DocumentReviewMode = 'initial' | 'closure'
export type FoundationDocumentReviewCheckId =
  (typeof FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS)[number]
export type ComprehensiveDocumentReviewCheckId =
  (typeof COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS)[number]
export type DocumentReviewCheckId = ComprehensiveDocumentReviewCheckId

export const DOCUMENT_REVIEW_OWNER_BY_CHECK_ID = Object.fromEntries([
  ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS.map(
    id => [id, 'foundation'] as const,
  ),
  ['checklist_traceability', 'checklist'] as const,
  ['resource_semantic_fitness', 'resource'] as const,
  ['content_structure_fitness', 'resource'] as const,
  ['resource_content_consistency', 'resource'] as const,
  ['implementation_readiness', 'resource'] as const,
]) as Record<DocumentReviewCheckId, 'foundation' | 'checklist' | 'resource'>

export const GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA = {
  gameplay_strategy_viability: [
    'meaningful_choices',
    'dominant_strategy_risk',
    'counterplay_and_recovery',
  ],
  economy_progression_integrity: [
    'sources_and_sinks',
    'affordability_and_growth',
    'exploit_and_deadlock',
  ],
  numeric_balance_feasibility: [
    'outcome_bounds',
    'relative_value',
    'formula_consistency',
  ],
  pacing_difficulty_coherence: [
    'pressure_curve',
    'capability_curve',
    'spike_and_recovery',
  ],
  level_scene_design_integrity: [
    'spatial_gameplay_support',
    'level_progression_coherence',
    'scene_state_completeness',
  ],
} as const satisfies Partial<Record<DocumentReviewCheckId, readonly string[]>>

export type GameDesignDocumentReviewCheckId =
  keyof typeof GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA
export const GAME_DESIGN_DOCUMENT_REVIEW_CHECK_IDS = Object.keys(
  GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
) as GameDesignDocumentReviewCheckId[]
export type DocumentReviewCriterionId =
  (typeof GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA)[GameDesignDocumentReviewCheckId][number]

export type DocumentReviewAssessment = {
  criterion: DocumentReviewCriterionId
  status: 'pass' | 'block'
  evidence: Array<{ path: string; anchor: string }>
  derivation: string
  conclusion: string
}

export type DocumentReviewCheck = {
  id: DocumentReviewCheckId
  status: 'pass' | 'block'
  conclusion: string
  evidence: Array<{ path: string; anchor: string }>
  findingIds: string[]
  assessments: DocumentReviewAssessment[]
}

export type DocumentReviewFindingSubject = {
  path: string
  anchor: string
  requirementId?: string
  resourceId?: string
  contentId?: string
}

export type DocumentReviewEvidence = { path: string; anchor: string }

export type DocumentReviewFinding = {
  findingId: string
  checkId: DocumentReviewCheckId
  severity: 'blocking'
  owner: 'foundation' | 'checklist' | 'resource'
  regressionPaths?: string[]
  evidence: DocumentReviewEvidence[]
  subjects: DocumentReviewFindingSubject[]
  observation: string
  blockingImpact: string
  requiredOutcome: string
}

export type DocumentReviewApproval = {
  scope: DocumentReviewScope
  revision: string
  checks: DocumentReviewCheck[]
  checkEvidenceDigests: Record<string, Record<string, string>>
  evidencePath: string
  approvedAt: string
}

export type DocumentRepairGroup = {
  groupId: string
  findingIds: string[]
  decision: string
  affectedPaths: FoundationDocumentPath[]
  dependsOn: string[]
}

export type DocumentRepairPlan = {
  groups: DocumentRepairGroup[]
  /** Durable owner-task cursor; paths occur in canonical owner order. */
  completedPaths: FoundationDocumentPath[]
}

export type DocumentReviewCycle = {
  cycleId: string
  parentCycleId?: string
  /** Scope of the Initial Review that created this finding ledger. */
  originScope: DocumentReviewScope
  scope: DocumentReviewScope
  mode: DocumentReviewMode
  sourceRevision: string
  requiredCheckIds: DocumentReviewCheckId[]
  /** Ordered cursor, including any digest-verified inherited approval prefix. */
  completedCheckIds: DocumentReviewCheckId[]
  checks: DocumentReviewCheck[]
  checkEvidenceDigests: Record<string, Record<string, string>>
  findings: DocumentReviewFinding[]
  activeTarget?: 'foundation' | 'checklist' | 'resource'
  acceptedSemanticResult: boolean
  changedPaths: string[]
  sourceArtifactDigests: Record<string, string>
  /** Sole execution plan for the accepted foundation finding ledger. */
  repairPlan?: DocumentRepairPlan
  evidencePath?: string
}

export type DocumentReviewState = {
  foundationApproval?: DocumentReviewApproval
  comprehensiveApproval?: DocumentReviewApproval
  activeCycle?: DocumentReviewCycle
  repairPasses: {
    foundation: number
    checklist: number
    resource: number
  }
}

export const DELIVERY_RUN_SCHEMA_VERSION = 8 as const

export type ChecklistRemediation = {
  sourceRevision: string
  attempt: number
  issues: string[]
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
      successfulResourceCount: number
      failedResourceCount: number
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
  schemaVersion: typeof DELIVERY_RUN_SCHEMA_VERSION
  runId: string
  projectId: string
  ownerId: string
  parentRunId?: string
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
  /** Canonical artifacts successfully read by the active document-reviewer dispatch. */
  reviewedDocumentPaths?: string[]
  tasks: AtomicTask[]
  activeDispatch?: DispatchRecord
  evidence: {
    resourcePreparation?: EvidenceRef
    implementationAudit?: EvidenceRef
    acceptance?: EvidenceRef
  }
  /** Sole owner of document review approvals, findings, retries and closure. */
  documentReviewState: DocumentReviewState
  /** Sole durable cursor for the initial eight-document authoring pass. */
  foundationDraftState: FoundationDraftState
  /** Deterministic checklist-structure issues carried across bounded author retries. */
  checklistRemediation?: ChecklistRemediation
  /** Durable execution count for the current Resource Production phase. */
  resourcePreparationAttempt?: number
  usage?: WorkflowUsage
  /** Latest deterministic native Resource Library provenance observed for this run. */
  resourceEvidence?: ResourceEvidenceSnapshot
  /** Latest durable progress text for the workflow card. */
  currentMessage?: string
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
  /** True while a write or Resource Library import is still in flight. */
  hasInFlightMutation?(dispatchId: string): Promise<boolean>
  /** True while the worker's sole structured terminal tool is streaming. */
  hasInFlightTerminalSubmission?(dispatchId: string): Promise<boolean>
  waitForTerminal?(dispatchId: string): Promise<unknown>
}
