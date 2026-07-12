import type { AxiosRequestConfig } from 'axios';

import apiClient, {
  API_BASE_URL,
  buildUnauthorizedMessage,
  resolveAuthToken,
  setToastErrorCallback,
} from './apiClient';
import { beeGameAdapter, isBeeGameAdapterEnabled } from './beeGameAdapter';
import type { BeeGameThinkingMode } from './beeGameAdapter';
import {
  getCurrentUser as getBeeGameCurrentUser,
  type BeeGameCurrentUser,
} from './currentUserApi';
import type {
  ChatAttachmentPayload,
} from './chatAttachments';

export type {
  ChatAttachmentPayload,
  ChatFileAttachmentPayload,
  ChatImageAttachmentPayload,
} from './chatAttachments';

export interface SendMessageResponse {
  command_id: string;
  task_id: string;
  state: 'queued' | 'running' | 'resuming';
  resume_mode?: 'recover' | 'resume';
  trace_id: string;
}

export interface ContinueTaskResponse {
  command_id: string;
  resume_task_id: string;
  resume_mode: 'recover' | 'resume';
  state: 'resuming';
  trace_id: string;
}

export interface StopTaskResponse {
  command_id: string;
  task_id: string;
  state: 'stopped';
  trace_id: string;
}

export interface ReviewBindingRef {
  artifact_id?: string;
  artifact_version?: number;
  checkpoint_id?: string;
  commit_sha?: string;
  workspace_path?: string;
  workspace_ref?: string;
  binding_integrity?: string;
  truth_source?: string;
}

export interface ReviewBindingPayload extends ReviewBindingRef {}

export interface ArtifactReviewVerdictPayload {
  reviewer_id?: string;
  verdict?: string;
}

export interface ArtifactReviewResponse {
  artifact_id: string;
  verdicts: ArtifactReviewVerdictPayload[];
  votes?: ArtifactReviewVerdictPayload[];
  assigned_reviewers?: string[];
  outcome?: string;
}

export type ReviewDecisionStatus = 'running' | 'approved' | 'revision_required' | 'escalated' | 'awaiting_user';
export type ReviewScopeCode = 'full_review' | 'restricted_review';

export interface ReviewMessageRefPayload {
  message_key?: string;
  message_params?: Record<string, string | number | boolean>;
}

export interface ReviewStatusPayload {
  workflow_id: string;
  lane_id: string;
  lane_status: string;
  decision_status: ReviewDecisionStatus;
  review_scope?: ReviewScopeCode;
  reason_codes?: string[];
  message?: ReviewMessageRefPayload | null;
  requires_user_action?: boolean;
  user_action_kind?: string;
  current_review_round?: number;
  pending_issue_count?: number;
  blocking_issue_count?: number;
  next_transition?: string;
}

export interface DocumentPipelineSummaryPayload {
  current_run?: Record<string, unknown> | null;
  current_snapshot?: Record<string, unknown> | null;
  latest_validation?: Record<string, unknown> | null;
  latest_review?: Record<string, unknown> | null;
  block_reason?: string;
  next_action?: string;
}

export interface ProjectBaselineStatusPayload {
  project_id: string;
  /** Deprecated for review UI. Use review_status instead. */
  phase: string;
  blocked: boolean;
  /** Deprecated for review UI. Use review_status.message instead. */
  blocked_reason?: string | null;
  active_agents?: string[];
  updated_at?: string;
  baseline?: ReviewBindingRef | null;
  current_run?: Record<string, unknown> | null;
  current_snapshot?: Record<string, unknown> | null;
  latest_validation?: Record<string, unknown> | null;
  latest_review?: Record<string, unknown> | null;
  approval_required?: boolean;
  next_action?: string;
  review_status?: ReviewStatusPayload | null;
  last_resume_task_id?: string;
  last_resume_failure?: Record<string, unknown> | null;
  last_resume_failure_stage?: string | null;
  last_resume_failure_at?: string | null;
  can_retry_continue?: boolean;
  clarification_required?: boolean;
  answered_slots?: Record<string, unknown>;
  pending_slots?: string[];
  clarification_questions?: string[];
  clarification_suggestions?: unknown[];
  intent_analysis?: unknown;
  confidence?: unknown;
  reasoning_summary?: unknown;
  context?: ContextVisibilityPayload | null;
  execution_evidence?: ExecutionEvidencePayload[];
  build_report?: BuildReportPayload | null;
  delivery_review?: DeliveryReviewPayload | null;
  delivery_status?: string;
  document_bundle?: DocumentBundleStatusPayload | null;
  model_config_id?: string | null;
}

export interface DeliveryReviewPayload {
  status?: 'validating' | 'passed' | 'failed' | 'untested' | 'blocked';
  summary?: string;
  findings?: Array<{ requirement?: string; status?: string; detail?: string }>;
  evidence_event_ids?: string[];
  updated_at?: string;
}

export interface OperatorVisibilityPayload {
  operator_visibility: ProjectBaselineStatusPayload | null;
}

export interface ContextVisibilityPayload {
  bundle_id?: string;
  phase?: string;
  status?: string;
  summary?: string;
  failure_reason?: string;
  blackboard_record_count?: number;
  memory_hits?: number;
  rag_sources?: string[];
  selected_skills?: string[];
  runtime_features?: Array<{
    id?: string;
    label?: string;
    stage?: string;
    status?: string;
  }>;
  token_budget?: {
    status?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  counters?: Record<string, number>;
}

export interface BuildReportCheckPayload {
  name?: string;
  status?: string;
  detail?: string;
  path?: string;
}

export interface BuildReportPayload {
  status?: string;
  entrypoint?: string;
  report_path?: string;
  build_url?: string;
  agents?: string[];
  generated_paths?: string[];
  checks?: BuildReportCheckPayload[];
  summary?: string;
  failure_reason?: string;
  created_at?: string;
}

export interface BeeGamePreviewPayload {
  sessionId: string;
  workspacePath: string;
  status: 'idle' | 'starting' | 'running' | 'stopped' | 'failed' | 'unsupported';
  url: string;
  port?: number;
  command?: string;
  script?: string;
  entrypoint?: string;
  message?: string;
  updatedAt: string;
}

export interface BeeGameDeploymentPayload {
  id: string;
  sessionId: string;
  projectId?: string;
  workspacePath: string;
  status: 'queued' | 'building' | 'publishing' | 'succeeded' | 'failed';
  url: string;
  buildCommand?: string;
  buildLog?: string;
  entrypoint?: string;
  outputDir?: string;
  artifactPath?: string;
  artifactHash?: string;
  message?: string;
  createdAt: string;
  updatedAt: string;
  deployedAt?: string;
}

export type BeeGameAssetIntegrationMode = 'filesystem' | 'mcp' | 'manual';

export interface BeeGameAssetSlotPayload {
  id: string;
  name?: string;
  type?: string;
  purpose?: string;
  required?: boolean;
  placeholder?: boolean;
  accepted_formats?: string[];
  recommended_specs?: Record<string, unknown>;
  target?: {
    path?: string;
    integration_notes?: string;
  };
  integration_provider?: {
    type?: BeeGameAssetIntegrationMode;
    server?: string;
    capabilities?: string[];
  };
  status?: 'placeholder' | 'uploaded' | 'integrated' | 'missing' | 'failed';
  integration_error?: string;
  uploaded_files?: string[];
  resource_requirement?: {
    category?: string;
    dimension?: '2D' | '3D' | 'agnostic';
    accepted_formats?: string[];
    styles?: string[];
    game_types?: string[];
    tags?: string[];
    purpose?: string;
  };
  resource_binding?: {
    pack_id: string;
    pack_version: string;
    element_id: string;
    element_path?: string;
    source_url: string;
    selected_at: string;
    selection_reason: string[];
  };
  updated_at?: string;
}

export interface BeeGameAssetManifestPayload {
  version: number;
  project_target?: {
    kind?: string;
    engine?: string;
    integration_mode?: BeeGameAssetIntegrationMode;
    mcp_server?: string;
    asset_format_capabilities?: string[];
  };
  slots: BeeGameAssetSlotPayload[];
}

export interface BeeGameAssetUploadPayload {
  manifest: BeeGameAssetManifestPayload;
  slot: BeeGameAssetSlotPayload;
  path: string;
  message: string;
}

export interface BeeGameResourceBindingPayload {
  manifest: BeeGameAssetManifestPayload;
  slot: BeeGameAssetSlotPayload;
  selection: { slotId: string; packId: string; packVersion: string; elementId: string; elementPath: string; score: number; reasons: string[] };
  path?: string;
}

export interface BeeGameResourceCandidatePayload {
  slotId: string;
  packId: string;
  packVersion: string;
  elementId: string;
  elementPath: string;
  sourceUrl: string;
  score: number;
  reasons: string[];
}

export interface BeeGameResourcePackImpactPayload {
  packId: string;
  projectCount: number;
  references: Array<{ projectId: string; projectName: string; slotId: string; packVersion: string; elementId: string; status?: string }>;
}

export interface BeeGameResourceIntegrationPayload {
  manifest: BeeGameAssetManifestPayload;
  slot: BeeGameAssetSlotPayload;
  path?: string;
}

export interface BeeGameResourceIntegrationRemovalPayload {
  manifest: BeeGameAssetManifestPayload;
  slot: BeeGameAssetSlotPayload;
  removed_paths: string[];
}

export interface BeeGameAutoResourceBindingPayload {
  manifest: BeeGameAssetManifestPayload;
  results: Array<{
    slotId: string;
    status: 'copied' | 'bound' | 'failed';
    packId: string;
    elementId: string;
    path?: string;
    error?: string;
  }>;
  unmatched_slot_ids: string[];
  repaired_slot_ids?: string[];
}

export interface BeeGameResourceUnbindingPayload {
  manifest: BeeGameAssetManifestPayload;
  slot: BeeGameAssetSlotPayload;
  retained_files: string[];
}

export interface ExecutionEvidencePayload {
  execution_id?: string;
  project_id?: string;
  pipeline_id?: string;
  agent: string;
  status: string;
  generated_paths?: string[];
  summary?: string;
  failure_reason?: string;
  created_at?: string;
  details?: Record<string, unknown>;
}

export interface DocumentBundleStatusPayload {
  bundle_id?: string;
  bundle_type?: string;
  gate_kind?: string;
  user_action_kind?: string;
  artifact_id?: string;
  status?: string;
  title?: string;
  ready_for_user_approval?: boolean;
  ready_for_promotion?: boolean;
  open_issue_ids?: string[];
  open_blocker_ids?: string[];
}

export interface ClarificationSuggestionPayload {
  id: string;
  label: string;
  description: string;
  clarification_patch: Record<string, string>;
  metadata?: {
    visual_styles?: string[];
  };
}

export interface IdeaIntakeAnalysisPayload {
  clarification_required: boolean;
  answered_slots: Record<string, string>;
  pending_slots: string[];
  clarification_questions: string[];
  clarification_suggestions: ClarificationSuggestionPayload[];
  intent_analysis?: Record<string, unknown>;
  confidence?: number;
  reasoning_summary?: string;
}

export type VerificationDecision = 'pass' | 'warning' | 'blocked';

export interface VerificationEvidencePayload {
  kind?: string;
  visibility?: string;
  ref?: string;
  excerpt?: string;
}

export interface VerificationFindingPayload {
  verification_finding_id?: string;
  rule_id?: string;
  claim?: string;
  repair_hint?: string;
  field_path?: string;
  artifact_ref?: string;
  evidence?: VerificationEvidencePayload[];
}

export interface VerificationSummaryPayload {
  bundle_id?: string;
  verification_run_id?: string;
  verification_decision?: VerificationDecision | '';
  policy_bundle_version?: string;
  gate_id?: string;
  attestation_ref?: string;
  decision_logs?: string[];
  finding_count?: number;
  blocking_finding_count?: number;
  blocking_findings?: VerificationFindingPayload[];
  budget_usage?: Record<string, unknown>;
  subject_type?: string;
  subject_id?: string;
  legacy_decision_source?: boolean;
}

export interface PendingUserReviewItem extends ReviewBindingRef {
  artifact?: Record<string, unknown>;
  gate_id: string;
  status?: string;
  run_id?: string;
  task_id?: string | null;
  type?: string;
  gate_kind?: string;
  user_action_kind?: string;
  title?: string;
  artifact_id?: string;
  artifact_version?: number;
  artifact_type?: string;
  created_at?: string;
  review_iteration?: number;
  source_artifact_id?: string;
  revised_from_artifact_id?: string;
  current_review_artifact_id?: string;
  current_review_iteration?: number;
  rollback_manifest?: Record<string, unknown>;
  execution_manifest?: Record<string, unknown>;
  change_request?: Record<string, unknown>;
  ready_for_user_approval?: boolean;
  ready_for_promotion?: boolean;
  gate_reason?: string;
  promotion_status?: string;
  open_defect_count?: number;
  board_execution_completed?: boolean;
  reviewer_board?: string[];
  bundle_id?: string;
  bundle_type?: string | null;
  bundle_revision?: number;
  review_run_id?: string;
  policy_decision_id?: string;
  open_issue_ids?: string[];
  open_blocker_ids?: string[];
  resolved_issue_ids?: string[];
  policy_bundle_version?: string;
  verification_run_id?: string;
  verification_decision?: VerificationDecision | '';
  attestation_ref?: string;
  binding?: ReviewBindingRef;
  summary?: DocumentPipelineSummaryPayload;
  verification?: VerificationSummaryPayload;
  quorum?: Record<string, unknown>;
  history_only?: boolean;
  /** Primary review UI contract. */
  review_status?: ReviewStatusPayload | null;
}

export interface PendingUserReviewsResponse {
  items: PendingUserReviewItem[];
}

const normalizeVerificationSummaryPayload = (
  payload?: VerificationSummaryPayload | null,
): VerificationSummaryPayload => ({
  bundle_id: String(payload?.bundle_id ?? '').trim(),
  verification_run_id: String(payload?.verification_run_id ?? '').trim(),
  verification_decision: (payload?.verification_decision ?? '') as VerificationDecision | '',
  policy_bundle_version: String(payload?.policy_bundle_version ?? '').trim(),
  gate_id: String(payload?.gate_id ?? '').trim(),
  attestation_ref: String(payload?.attestation_ref ?? '').trim(),
  decision_logs: Array.isArray(payload?.decision_logs) ? payload!.decision_logs!.map((item) => String(item)) : [],
  finding_count: typeof payload?.finding_count === 'number' ? payload.finding_count : 0,
  blocking_finding_count: typeof payload?.blocking_finding_count === 'number' ? payload.blocking_finding_count : 0,
  blocking_findings: Array.isArray(payload?.blocking_findings) ? payload!.blocking_findings! : [],
  budget_usage: payload?.budget_usage ?? {},
  subject_type: String(payload?.subject_type ?? '').trim(),
  subject_id: String(payload?.subject_id ?? '').trim(),
  legacy_decision_source: Boolean(payload?.legacy_decision_source),
});

const normalizeDocumentPipelineSummaryPayload = (
  payload?: DocumentPipelineSummaryPayload | null,
): DocumentPipelineSummaryPayload => ({
  current_run: payload?.current_run ?? null,
  current_snapshot: payload?.current_snapshot ?? null,
  latest_validation: payload?.latest_validation ?? null,
  latest_review: payload?.latest_review ?? null,
  block_reason: String(payload?.block_reason ?? '').trim(),
  next_action: String(payload?.next_action ?? '').trim(),
});

const normalizeBuildReportPayload = (
  payload?: BuildReportPayload | null,
): BuildReportPayload | undefined => {
  if (!payload) return undefined;
  return {
    status: String(payload.status ?? '').trim(),
    entrypoint: String(payload.entrypoint ?? '').trim(),
    report_path: String(payload.report_path ?? '').trim(),
    build_url: String(payload.build_url ?? '').trim(),
    agents: Array.isArray(payload.agents)
      ? payload.agents.map((item) => String(item).trim()).filter(Boolean)
      : [],
    generated_paths: Array.isArray(payload.generated_paths)
      ? payload.generated_paths.map((item) => String(item).trim()).filter(Boolean)
      : [],
    checks: Array.isArray(payload.checks)
      ? payload.checks.map((item) => ({
          name: String(item?.name ?? '').trim(),
          status: String(item?.status ?? '').trim(),
          detail: String(item?.detail ?? '').trim(),
          path: String(item?.path ?? '').trim(),
        }))
      : [],
    summary: String(payload.summary ?? '').trim(),
    failure_reason: String(payload.failure_reason ?? '').trim(),
    created_at: String(payload.created_at ?? '').trim(),
  };
};

const normalizeDocumentBundleStatusPayload = (
  payload?: DocumentBundleStatusPayload | null,
): DocumentBundleStatusPayload | undefined => {
  if (!payload) return undefined;
  const gateKind = String(payload.gate_kind ?? '').trim();
  const userActionKind = String(payload.user_action_kind ?? '').trim();
  const approvalReady = Boolean(payload.ready_for_user_approval);
  return {
    bundle_id: String(payload.bundle_id ?? '').trim(),
    bundle_type: String(payload.bundle_type ?? '').trim(),
    gate_kind: gateKind,
    user_action_kind: userActionKind,
    artifact_id: String(payload.artifact_id ?? '').trim(),
    status: String(payload.status ?? '').trim(),
    title: String(payload.title ?? '').trim(),
    ready_for_user_approval: approvalReady,
    ready_for_promotion: approvalReady && Boolean(payload.ready_for_promotion),
    open_issue_ids: Array.isArray(payload.open_issue_ids)
      ? payload.open_issue_ids.map((item) => String(item).trim()).filter(Boolean)
      : [],
    open_blocker_ids: Array.isArray(payload.open_blocker_ids)
      ? payload.open_blocker_ids.map((item) => String(item).trim()).filter(Boolean)
      : [],
  };
};

const normalizeContextVisibilityPayload = (
  payload?: ContextVisibilityPayload | null,
): ContextVisibilityPayload | undefined => {
  if (!payload) return undefined;
  return {
    bundle_id: String(payload.bundle_id ?? '').trim(),
    phase: String(payload.phase ?? '').trim(),
    status: String(payload.status ?? '').trim(),
    summary: String(payload.summary ?? '').trim(),
    failure_reason: String(payload.failure_reason ?? '').trim(),
    blackboard_record_count: Number(payload.blackboard_record_count ?? 0),
    memory_hits: Number(payload.memory_hits ?? 0),
    rag_sources: Array.isArray(payload.rag_sources)
      ? payload.rag_sources.map((item) => String(item).trim()).filter(Boolean)
      : [],
    selected_skills: Array.isArray(payload.selected_skills)
      ? payload.selected_skills.map((item) => String(item).trim()).filter(Boolean)
      : [],
  };
};

const normalizeDocumentPipelineQuorumPayload = (
  payload?: Record<string, unknown> | null,
): Record<string, unknown> => ({
  ...(payload ?? {}),
});

const normalizeReviewStatusPayload = (
  payload?: ReviewStatusPayload | null,
): ReviewStatusPayload | null => {
  if (!payload) return null;
  return {
    workflow_id: String(payload.workflow_id ?? '').trim(),
    lane_id: String(payload.lane_id ?? '').trim(),
    lane_status: String(payload.lane_status ?? '').trim(),
    decision_status: (payload.decision_status ?? 'running') as ReviewDecisionStatus,
    review_scope: (payload.review_scope ?? 'full_review') as ReviewScopeCode,
    reason_codes: Array.isArray(payload.reason_codes) ? payload.reason_codes.map((item) => String(item)) : [],
    message: {
      message_key: String(payload.message?.message_key ?? '').trim(),
      message_params: (payload.message?.message_params ?? {}) as Record<string, string | number | boolean>,
    },
    requires_user_action: Boolean(payload.requires_user_action),
    user_action_kind: String(payload.user_action_kind ?? '').trim(),
    current_review_round: Number(payload.current_review_round ?? 0) || 0,
    pending_issue_count: Number(payload.pending_issue_count ?? 0) || 0,
    blocking_issue_count: Number(payload.blocking_issue_count ?? 0) || 0,
    next_transition: String(payload.next_transition ?? '').trim(),
  };
};

const normalizePendingUserReviewItem = (payload: PendingUserReviewItem): PendingUserReviewItem => {
  const verification = normalizeVerificationSummaryPayload(payload.verification);
  const summary = normalizeDocumentPipelineSummaryPayload(payload.summary as DocumentPipelineSummaryPayload | null);
  const quorum = normalizeDocumentPipelineQuorumPayload(payload.quorum ?? null);
  const reviewStatus = normalizeReviewStatusPayload(payload.review_status);
  const gateKind = String(payload.gate_kind ?? '').trim();
  const userActionKind = String(payload.user_action_kind ?? reviewStatus?.user_action_kind ?? '').trim();
  const approvalReady = Boolean(payload.ready_for_user_approval);
  return {
    ...payload,
    binding: {
      artifact_id: String(payload.binding?.artifact_id ?? payload.artifact_id ?? '').trim() || undefined,
      artifact_version: payload.binding?.artifact_version ?? payload.artifact_version,
      checkpoint_id: String(payload.binding?.checkpoint_id ?? '').trim() || undefined,
      commit_sha: String(payload.binding?.commit_sha ?? '').trim() || undefined,
      workspace_path: String(payload.binding?.workspace_path ?? payload.binding?.workspace_ref ?? '').trim() || undefined,
      workspace_ref: String(payload.binding?.workspace_ref ?? payload.binding?.workspace_path ?? '').trim() || undefined,
      binding_integrity: String(payload.binding?.binding_integrity ?? '').trim() || undefined,
      truth_source: String(payload.binding?.truth_source ?? '').trim() || undefined,
    },
    summary,
    verification,
    quorum,
    status: String(payload.status ?? '').trim(),
    gate_kind: gateKind,
    user_action_kind: userActionKind,
    gate_reason: String(payload.gate_reason ?? '').trim(),
    promotion_status: String(payload.promotion_status ?? '').trim(),
    open_defect_count: Number(payload.open_defect_count ?? 0) || 0,
    ready_for_user_approval: approvalReady,
    ready_for_promotion: approvalReady && Boolean(payload.ready_for_promotion),
    board_execution_completed: Boolean(payload.board_execution_completed),
    reviewer_board: Array.isArray(payload.reviewer_board) ? payload.reviewer_board.map((item) => String(item)) : [],
    verification_run_id: String(payload.verification_run_id ?? verification.verification_run_id ?? '').trim(),
    verification_decision: (payload.verification_decision ?? verification.verification_decision ?? '') as VerificationDecision | '',
    attestation_ref: String(payload.attestation_ref ?? verification.attestation_ref ?? '').trim(),
    bundle_id: String(payload.bundle_id ?? verification.bundle_id ?? '').trim(),
    policy_bundle_version: String(payload.policy_bundle_version ?? verification.policy_bundle_version ?? '').trim(),
    open_issue_ids: Array.isArray(payload.open_issue_ids) ? payload.open_issue_ids : [],
    open_blocker_ids: Array.isArray(payload.open_blocker_ids) ? payload.open_blocker_ids : [],
    resolved_issue_ids: Array.isArray(payload.resolved_issue_ids) ? payload.resolved_issue_ids : [],
    review_status: reviewStatus,
  };
};

const normalizeReviewBindingMetadata = <T extends ReviewBindingPayload>(payload: T): T => {
  const workspaceRef = String(payload.workspace_ref ?? payload.workspace_path ?? '').trim();
  const checkpointId = String(payload.checkpoint_id ?? '').trim();
  return {
    ...payload,
    checkpoint_id: checkpointId,
    workspace_ref: workspaceRef,
    workspace_path: workspaceRef,
  };
};

export const normalizeArtifactReviewResponse = (
  payload?: ArtifactReviewResponse | null,
): ArtifactReviewResponse => {
  const verdicts = Array.isArray(payload?.verdicts)
    ? payload!.verdicts.map((item) => ({
        reviewer_id: String(item?.reviewer_id ?? '').trim(),
        verdict: String(item?.verdict ?? '').trim(),
      }))
    : [];
  return {
    artifact_id: String(payload?.artifact_id ?? '').trim(),
    verdicts,
    votes: verdicts,
    assigned_reviewers: verdicts.map((item) => item.reviewer_id).filter(Boolean),
    outcome: String(payload?.outcome ?? '').trim(),
  };
};

export const normalizeReviewBindingPayload = <T extends ReviewBindingPayload>(payload: T): T => {
  return normalizeReviewBindingMetadata(payload);
};

export const normalizeApprovePlanPayload = (payload: ApprovePlanPayload): ApprovePlanPayload => {
  const normalized = normalizeReviewBindingMetadata(payload);
  return {
    project_id: normalized.project_id,
    gate_id: normalized.gate_id,
    action: normalized.action,
    artifact_id: normalized.artifact_id,
    artifact_version: normalized.artifact_version,
    checkpoint_id: normalized.checkpoint_id,
    commit_sha: normalized.commit_sha,
    workspace_path: normalized.workspace_path,
    workspace_ref: normalized.workspace_ref,
    feedback: normalized.feedback,
  };
};

export const normalizeInboundReviewBindingPayload = <T extends ReviewBindingPayload>(payload: T): T => {
  return normalizeReviewBindingMetadata(payload);
};

export const normalizePendingUserReviewsResponse = <T extends { items?: PendingUserReviewItem[] }>(payload: T): T => {
  return {
    ...payload,
    items: Array.isArray(payload.items)
      ? payload.items.map((item) => normalizePendingUserReviewItem(item))
      : [],
  };
};

const unwrapProjectBaselineStatusPayload = (
  payload?: ProjectBaselineStatusPayload | OperatorVisibilityPayload | null,
): ProjectBaselineStatusPayload | undefined => {
  if (!payload) {
    return undefined;
  }
  if ('operator_visibility' in payload) {
    return payload.operator_visibility ?? undefined;
  }
  return payload as ProjectBaselineStatusPayload;
};

export const normalizeProjectBaselineStatusPayload = (
  payload?: ProjectBaselineStatusPayload | OperatorVisibilityPayload | null,
): ProjectBaselineStatusPayload => {
  const normalizedPayload = unwrapProjectBaselineStatusPayload(payload);
  if (!normalizedPayload) {
    return {
      project_id: '',
      phase: '',
      blocked: false,
      blocked_reason: null,
      active_agents: [],
      updated_at: '',
      approval_required: false,
      next_action: '',
      review_status: null,
      baseline: null,
      current_run: null,
      current_snapshot: null,
      latest_validation: null,
      latest_review: null,
      last_resume_failure: null,
      last_resume_failure_stage: null,
      last_resume_failure_at: null,
      can_retry_continue: false,
      context: undefined,
      execution_evidence: undefined,
      build_report: null,
      delivery_review: null,
      delivery_status: 'implementation',
      document_bundle: null,
    };
  }
  const baseline: ReviewBindingRef | null = normalizedPayload.baseline
    ? normalizeInboundReviewBindingPayload(normalizedPayload.baseline)
    : null;
  return {
    project_id: String(normalizedPayload.project_id ?? '').trim(),
    phase: String(normalizedPayload.phase ?? '').trim(),
    blocked: Boolean(normalizedPayload.blocked),
    blocked_reason: normalizedPayload.blocked_reason ?? null,
    active_agents: Array.isArray(normalizedPayload.active_agents)
      ? normalizedPayload.active_agents.map((item) => String(item).trim()).filter(Boolean)
      : [],
    updated_at: String(normalizedPayload.updated_at ?? '').trim(),
    approval_required: Boolean(normalizedPayload.approval_required),
    next_action: String(normalizedPayload.next_action ?? '').trim(),
    baseline,
    current_run: normalizedPayload.current_run ?? null,
    current_snapshot: normalizedPayload.current_snapshot ?? null,
    latest_validation: normalizedPayload.latest_validation ?? null,
    latest_review: normalizedPayload.latest_review ?? null,
    last_resume_task_id: String(normalizedPayload.last_resume_task_id ?? '').trim() || undefined,
    last_resume_failure: normalizedPayload.last_resume_failure ?? null,
    last_resume_failure_stage: normalizedPayload.last_resume_failure_stage ?? null,
    last_resume_failure_at: normalizedPayload.last_resume_failure_at ?? null,
    can_retry_continue: Boolean(normalizedPayload.can_retry_continue),
    clarification_required: Boolean(normalizedPayload.clarification_required),
    answered_slots: normalizedPayload.answered_slots ?? {},
    pending_slots: Array.isArray(normalizedPayload.pending_slots)
      ? normalizedPayload.pending_slots.map((item) => String(item).trim()).filter(Boolean)
      : [],
    clarification_questions: Array.isArray(normalizedPayload.clarification_questions)
      ? normalizedPayload.clarification_questions.map((item) => String(item).trim()).filter(Boolean)
      : [],
    clarification_suggestions: Array.isArray(normalizedPayload.clarification_suggestions)
      ? normalizedPayload.clarification_suggestions
      : [],
    intent_analysis: normalizedPayload.intent_analysis,
    confidence: normalizedPayload.confidence,
    reasoning_summary: normalizedPayload.reasoning_summary,
    execution_evidence: normalizedPayload.execution_evidence,
    model_config_id: normalizedPayload.model_config_id,
    review_status: normalizeReviewStatusPayload(normalizedPayload.review_status),
    context: normalizeContextVisibilityPayload(normalizedPayload.context),
    build_report: normalizeBuildReportPayload(normalizedPayload.build_report) ?? null,
    delivery_review: normalizedPayload.delivery_review ?? null,
    delivery_status: String(normalizedPayload.delivery_status ?? 'implementation'),
    document_bundle: normalizeDocumentBundleStatusPayload(normalizedPayload.document_bundle) ?? null,
  };
};

export interface ApprovePlanPayload extends ReviewBindingPayload {
  project_id: string;
  gate_id: string;
  action: 'approve' | 'revise' | 'reject';
  feedback?: string;
}

export interface ApproveManifestPayload extends ReviewBindingPayload {
  project_id: string;
  gate_id: string;
  feedback?: string;
}


// API 方法定义
export const api = {
  // ==================== 聊天相关 API ====================

  /**
   * 发送消息到后端
   * @param data - 包含消息内容和项目 ID
   * @returns 返回任务 ID 和状态
   */
  sendMessage: (data: {
    content: string;
    project_id: string;
    termination_node?: string;
    client_message_id?: string;
    supersedes_message_id?: string;
    taskType?: import('./creditsApi').BeeGameCreditTaskType;
    attachments?: ChatAttachmentPayload[];
    thinkingMode?: BeeGameThinkingMode;
  }) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.sendMessage(data)
      : apiClient.post('/api/chat/message', data) as Promise<SendMessageResponse>,

  /**
   * 继续执行暂停的任务
   * @param data - 包含项目 ID 和可选的任务 ID
   * @returns 返回任务 ID 和状态
   */
  continueTask: (data: { project_id: string; task_id?: string }) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.continueTask(data)
      : apiClient.post('/api/chat/continue', data) as Promise<ContinueTaskResponse>,

  /**
   * 停止当前执行的任务
   * @param data - 包含任务 ID
   * @returns 返回操作状态
   */
  stopTask: (data: { task_id: string; project_id?: string }) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.stopTask(data)
      : apiClient.post('/api/chat/stop', data) as Promise<StopTaskResponse>,

  /**
   * 获取项目的聊天历史记录
   * @param projectId - 项目 ID
   * @returns 返回消息列表
   */
  getChatHistory: (projectId: string) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.getChatHistory(projectId)
      : apiClient.get(`/api/chat/history?project_id=${encodeURIComponent(projectId)}`),

  // ==================== 项目管理 API ====================

  /**
   * 获取所有项目列表
   * @returns 返回项目列表
   */
  getProjects: () =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.getProjects()
      : apiClient.get('/api/projects'),

  /**
   * 创建新项目
   * @param data - 包含项目名称和可选的根路径
   * @returns 返回创建的项目对象
   */
  createProject: (data: { name: string; root_path?: string }) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.createProject(data)
      : apiClient.post('/api/projects', data),

  /**
   * 基于 idea 原子创建项目并触发首条执行
   * @param data - idea 与可选字段
   * @returns { project, task_id, status }
   */
  bootstrapProjectFromIdea: (data: { idea: string; root_path?: string; title?: string; termination_node?: string; clarification?: Record<string, string>; language?: string }) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.bootstrapProjectFromIdea(data)
      : apiClient.post('/api/projects/bootstrap-from-idea', data, {
        headers: {
          'Hide-Error-Toast': 'true',
        },
      }),

  bootstrapProjectFromBrief: (data: Parameters<typeof beeGameAdapter.bootstrapProjectFromBrief>[0]) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.bootstrapProjectFromBrief(data)
      : apiClient.post('/api/projects/bootstrap-from-brief', data, {
        headers: {
          'Hide-Error-Toast': 'true',
        },
      }),

  /**
   * Run BeeGame idea intake without creating a project.
   * Used by the landing page thinking/clarification flow.
   */
  analyzeIdeaIntake: (data: { idea: string; clarification?: Record<string, string>; language?: string }) =>
    apiClient.post('/api/idea-intake/analyze', data) as Promise<IdeaIntakeAnalysisPayload>,

  /**
   * 打开项目并通知后端初始化环境
   * @param projectId - 项目 ID
   * @returns 返回操作结果
   */
  openProject: (projectId: string) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.openProject(projectId)
      : apiClient.post(`/api/projects/${encodeURIComponent(projectId)}/open`),

  /**
   * 更新项目信息
   * @param projectId - 项目 ID
   * @param data - 包含要更新的字段（名称和/或根路径）
   * @returns 返回更新后的项目对象
   */
  updateProject: (projectId: string, data: { name?: string; root_path?: string; runtime_snapshot?: import('../types/project').ProjectRuntimeSnapshot }) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.updateProject(projectId, data)
      : apiClient.patch(`/api/projects/${encodeURIComponent(projectId)}`, data),

  /**
   * 获取项目当前状态与项目级 baseline 元数据
   * @param projectId - 项目 ID
   */
  getProjectStatus: async (projectId: string) =>
    isBeeGameAdapterEnabled()
      ? normalizeProjectBaselineStatusPayload(await beeGameAdapter.getProjectStatus(projectId))
      : normalizeProjectBaselineStatusPayload(
        (await apiClient.get(`/api/projects/${encodeURIComponent(projectId)}/status`)) as ProjectBaselineStatusPayload | OperatorVisibilityPayload
      ),

  getProjectReviewStatus: async (projectId: string) =>
    normalizeReviewStatusPayload(
      ((await apiClient.get(`/api/projects/${encodeURIComponent(projectId)}/review-status`)) as { review_status?: ReviewStatusPayload })
        ?.review_status ?? null
    ),

  /**
   * 删除项目
   * @param projectId - 项目 ID
   * @returns 返回操作状态
   */
  deleteProject: (projectId: string) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.deleteProject(projectId)
      : apiClient.delete(`/api/projects/${encodeURIComponent(projectId)}`),

  // ==================== 系统状态 API ====================

  getCurrentUser: (): Promise<BeeGameCurrentUser> => getBeeGameCurrentUser(),

  /**
   * 获取系统状态信息
   * @returns 返回系统状态对象（运行时间、Unity 连接状态、活跃 Agent 数量、项目进度）
   */
  getStatus: () =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.getStatus()
      : apiClient.get('/api/status'),

  getSystemReadiness: () =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.getSystemReadiness()
      : apiClient.get('/api/system/readiness'),

  /**
   * 获取所有 Agent 的状态信息
   * @returns 返回 Agent 列表（包含 ID、状态、当前任务）
   */
  getAgents: (config?: AxiosRequestConfig) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.getAgents()
      : apiClient.get('/api/agents', config),

  /**
   * 获取活动记录列表
   * @returns 返回活动记录列表（工件类型、名称、作者、时间戳）
   */
  getActivity: () =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.getActivity()
      : apiClient.get('/api/activity'),

  /**
   * 获取所有项目列表 (简明版)
   * @returns 返回精简版项目列表
   */
  getProjectsList: () =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.getProjects()
      : apiClient.get('/api/projects/list'),

  // ==================== Team OS / Telemetry API ====================

  /**
   * 获取项目的团队流图 Mermaid
   * @param projectId - 项目 ID
   */
  getWorkflowGraph: (projectId: string) =>
    isBeeGameAdapterEnabled()
      ? Promise.resolve('')
      : apiClient.get(`/api/telemetry/graph/${encodeURIComponent(projectId)}`),

  /**
   * 获取项目的阶段历史与当前阶段
   * @param projectId - 项目 ID
   */
  getWorkflowPhases: (projectId: string, config?: AxiosRequestConfig) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.getWorkflowPhases(projectId)
      : apiClient.get(`/api/telemetry/phases/${encodeURIComponent(projectId)}`, config),

  /**
   * 获取项目累计 token 使用量
   * @param projectId - 项目 ID
   */
  getProjectTokenUsage: (projectId: string, config?: AxiosRequestConfig) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.getTokenUsage(projectId)
      : apiClient.get(`/api/telemetry/token-usage/${encodeURIComponent(projectId)}`, config),

  // ==================== Artifacts API ====================

  /**
   * 获取项目的交付物列表
   * @param projectId - 项目 ID
   */
  getArtifacts: (projectId: string) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.getArtifacts(projectId)
      : apiClient.get(`/api/artifacts?project_id=${encodeURIComponent(projectId)}`),

  /**
   * 获取 Team OS 可认领任务及自治生命周期字段
   * @param projectId - 项目 ID
   * @param agentId - Agent ID
   */
  getAgentTasks: (projectId: string, agentId: string, config?: AxiosRequestConfig) =>
    apiClient.get(`/api/team-os/tasks?project_id=${encodeURIComponent(projectId)}&agent_id=${encodeURIComponent(agentId)}`, config),

  /**
   * 获取交付物下载 URL
   * @param artifactId - 交付物 ID
   */
  getArtifactDownloadUrl: (artifactId: string) =>
    `${API_BASE_URL}/api/artifacts/${encodeURIComponent(artifactId)}/download`,

  /**
   * 获取交付物详情
   * @param artifactId - 交付物 ID
   */
  getArtifact: (artifactId: string, includeInternal: boolean = false) =>
    apiClient.get(`/api/artifacts/${encodeURIComponent(artifactId)}?include_internal=${includeInternal}`),

  /**
   * 获取交付物原始文本内容
   * @param artifactId - 交付物 ID
   */
  getArtifactContent: async (artifactId: string) => {
    if (isBeeGameAdapterEnabled()) {
      return beeGameAdapter.getArtifactContent(artifactId);
    }
    const res = await apiClient.get(`/api/artifacts/${encodeURIComponent(artifactId)}/download`, {
      responseType: 'text',
      headers: { 'Accept': 'text/plain, text/markdown, */*' }
    });
    return res as unknown as string;
  },

  downloadProjectPackage: (projectId: string) => {
    if (isBeeGameAdapterEnabled()) {
      return beeGameAdapter.downloadProjectPackage(projectId);
    }
    throw new Error('Project package download is only available for BeeGame projects');
  },

  getProjectPreview: (projectId: string) => {
    if (isBeeGameAdapterEnabled()) {
      return beeGameAdapter.getProjectPreview(projectId);
    }
    throw new Error('Project preview is only available for BeeGame projects');
  },

  startProjectPreview: (projectId: string) => {
    if (isBeeGameAdapterEnabled()) {
      return beeGameAdapter.startProjectPreview(projectId);
    }
    throw new Error('Project preview is only available for BeeGame projects');
  },

  restartProjectPreview: (projectId: string) => {
    if (isBeeGameAdapterEnabled()) {
      return beeGameAdapter.restartProjectPreview(projectId);
    }
    throw new Error('Project preview is only available for BeeGame projects');
  },

  stopProjectPreview: (projectId: string) => {
    if (isBeeGameAdapterEnabled()) {
      return beeGameAdapter.stopProjectPreview(projectId);
    }
    throw new Error('Project preview is only available for BeeGame projects');
  },

  deployProject: (projectId: string) => {
    if (isBeeGameAdapterEnabled()) {
      return beeGameAdapter.deployProject(projectId);
    }
    throw new Error('Project deployment is only available for BeeGame projects');
  },

  listProjectDeployments: (projectId: string) => {
    if (isBeeGameAdapterEnabled()) {
      return beeGameAdapter.listProjectDeployments(projectId);
    }
    throw new Error('Project deployment is only available for BeeGame projects');
  },

  rollbackProjectDeployment: (projectId: string, deploymentId: string) => {
    if (isBeeGameAdapterEnabled()) {
      return beeGameAdapter.rollbackProjectDeployment(projectId, deploymentId);
    }
    throw new Error('Project deployment rollback is only available for BeeGame projects');
  },

  getProjectAssets: (projectId: string) => {
    if (isBeeGameAdapterEnabled()) {
      return beeGameAdapter.getProjectAssets(projectId);
    }
    throw new Error('Project assets are only available for BeeGame projects');
  },

  uploadProjectAsset: (projectId: string, slotId: string, file: File) => {
    if (isBeeGameAdapterEnabled()) {
      return beeGameAdapter.uploadProjectAsset(projectId, slotId, file);
    }
    throw new Error('Project asset upload is only available for BeeGame projects');
  },

  bindProjectResource: (projectId: string, slotId: string, requirement: Record<string, unknown>, selection?: { packId: string; elementId: string }) => {
    if (isBeeGameAdapterEnabled()) return beeGameAdapter.bindProjectResource(projectId, slotId, requirement, selection);
    throw new Error('Project resource binding is only available for BeeGame projects');
  },

  getProjectResourceCandidates: (projectId: string, slotId: string) => {
    if (isBeeGameAdapterEnabled()) return beeGameAdapter.getProjectResourceCandidates(projectId, slotId);
    throw new Error('Project resource candidates are only available for BeeGame projects');
  },

  getResourcePackImpact: (packId: string) => {
    if (isBeeGameAdapterEnabled()) return beeGameAdapter.getResourcePackImpact(packId);
    throw new Error('Resource Pack impact analysis is only available for BeeGame projects');
  },

  integrateProjectResource: (projectId: string, slotId: string) => {
    if (isBeeGameAdapterEnabled()) return beeGameAdapter.integrateProjectResource(projectId, slotId);
    throw new Error('Project resource integration is only available for BeeGame projects');
  },

  autoBindProjectResources: (projectId: string) => {
    if (isBeeGameAdapterEnabled()) return beeGameAdapter.autoBindProjectResources(projectId);
    throw new Error('Automatic project resource binding is only available for BeeGame projects');
  },

  unbindProjectResource: (projectId: string, slotId: string) => {
    if (isBeeGameAdapterEnabled()) return beeGameAdapter.unbindProjectResource(projectId, slotId);
    throw new Error('Project resource unbinding is only available for BeeGame projects');
  },

  removeProjectResourceIntegration: (projectId: string, slotId: string) => {
    if (isBeeGameAdapterEnabled()) return beeGameAdapter.removeProjectResourceIntegration(projectId, slotId);
    throw new Error('Project resource integration removal is only available for BeeGame projects');
  },

  // ==================== Tasks & Review API ====================

  /**
   * 获取项目的所有任务列表
   * @param projectId - 项目 ID
   */
  getTasks: (projectId: string, config?: AxiosRequestConfig) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.getTasks()
      : apiClient.get(`/api/tasks?project_id=${encodeURIComponent(projectId)}`, config),

  /**
   * 审批通过计划
   * @param data - 包含项目 ID 和用户反馈
   */
  approvePlan: (data: ApprovePlanPayload) =>
    isBeeGameAdapterEnabled()
      ? beeGameAdapter.approvePlan(normalizeApprovePlanPayload(data))
      : apiClient.post('/api/approve-plan', normalizeApprovePlanPayload(data)),

  /**
   * 获取交付物的评审状态
   * @param artifactId - 交付物 ID
   */
  getArtifactReviewStatus: async (artifactId: string, config?: AxiosRequestConfig) =>
    isBeeGameAdapterEnabled()
      ? normalizeArtifactReviewResponse(await beeGameAdapter.getArtifactReviewStatus(artifactId))
      : normalizeArtifactReviewResponse(
        (await apiClient.get(`/api/artifacts/${encodeURIComponent(artifactId)}/review`, config)) as ArtifactReviewResponse
      ),

  // ==================== Manifest (Resource List) API ====================

  /**
   * 上传资源清单 CSV
   * @param data - 包含项目 ID, 任务 ID, CSV 内容和可选的自动审批标志
   */
  uploadManifestCsv: (data: { project_id: string; gate_id: string; csv_content: string; auto_approve?: boolean }) =>
    apiClient.post('/api/upload-manifest-csv', data),

  /**
   * 审批通过资源清单
   * @param data - 包含项目 ID, 任务 ID 和可选的反馈
   */
  approveManifest: (data: ApproveManifestPayload) =>
    apiClient.post('/api/approve-manifest', data),

  /**
   * 驳回资源清单并要求修订
   * @param data - 包含项目 ID, 任务 ID 和用户反馈
   */
  reviseManifest: (data: { project_id: string; gate_id: string; feedback: string }) =>
    apiClient.post('/api/revise-manifest', data),

  /**
   * 获取待处理的用户评审任务
   * @param projectId - 项目 ID
   */
  getPendingUserReviews: async (projectId: string) =>
    isBeeGameAdapterEnabled()
      ? normalizePendingUserReviewsResponse(await beeGameAdapter.getPendingUserReviews(projectId)) as PendingUserReviewsResponse
      : normalizePendingUserReviewsResponse(
        (await apiClient.get(`/api/pending-user-reviews?project_id=${encodeURIComponent(projectId)}`)) as PendingUserReviewsResponse
      ) as PendingUserReviewsResponse,

  getVerificationStatus: async (projectId: string, gateId?: string, bundleId?: string) =>
    normalizeVerificationSummaryPayload(
      (await apiClient.get(
        `/api/verification-status?project_id=${encodeURIComponent(projectId)}&gate_id=${encodeURIComponent(gateId || '')}&bundle_id=${encodeURIComponent(bundleId || '')}`
      )) as VerificationSummaryPayload
    ),
};

export default apiClient;
export {
  API_BASE_URL,
  buildUnauthorizedMessage,
  resolveAuthToken,
  setToastErrorCallback,
};
