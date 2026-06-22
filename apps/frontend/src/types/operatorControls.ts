export type ResetGddApprovalSourceMode = 'latest_review_or_baseline' | 'awaiting_approval_only';

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

export interface ResetGddApprovalAnchor {
  timestamp: string;
  source: string;
  promoted_from_gate_id: string;
}

export interface ResetGddApprovalResponse {
  ok: boolean;
  diagnostic_only: boolean;
  project_id: string;
  pipeline_id: string;
  gate_id: string;
  artifact_id: string;
  artifact_version: number | null;
  document_run_id: string;
  source_run_status: string;
  restored_stage: 'WAITING_FOR_USER_GDD_APPROVAL';
  anchor: ResetGddApprovalAnchor;
  removed_counts: Record<string, number>;
  cleanup_summary: string[];
  memory_cleanup_summary?: MemoryCleanupSummaryPayload | null;
  preserved_gdd_run_id: string;
  preserved_gdd_artifact_id: string;
}

export type StageControlAnchor =
  | 'WAITING_FOR_USER_GDD_APPROVAL'
  | 'ARCHITECTURE_BLUEPRINT_IN_PROGRESS'
  | 'ARCHITECTURE_SELF_CHECK_READY'
  | 'ARCHITECTURE_INTERNAL_REVIEW_READY'
  | 'ART_DIRECTION_IN_PROGRESS'
  | 'ART_DIRECTION_SELF_CHECK_READY'
  | 'ART_DIRECTION_INTERNAL_REVIEW_READY'
  | 'UI_BLUEPRINT_IN_PROGRESS'
  | 'UI_SELF_CHECK_READY'
  | 'UI_ISSUE_LEDGER_READY'
  | 'UI_INTERNAL_REVIEW_READY'
  | 'UI_CLOSURE_REVIEW_READY'
  | 'ASSET_REQUIREMENT_PREPARING'
  | 'WAITING_FOR_USER_ASSETS'
  | 'IMPLEMENTATION_IN_PROGRESS'
  | 'SANKTA_IMPLEMENTATION_IN_PROGRESS'
  | 'HEPHAESTUS_IMPLEMENTATION_IN_PROGRESS'
  | 'IMPLEMENTATION_SELF_CHECK_READY'
  | 'IMPLEMENTATION_INTERNAL_REVIEW_READY'
  | 'QA_IN_PROGRESS'
  | 'POLISH_IN_PROGRESS'
  | 'BUILD_IN_PROGRESS';

export interface PreservedBaselineRefPayload extends ReviewBindingRef {
  alias: string;
  artifact_type?: string;
}

export interface ArtifactSummaryRefPayload {
  label: string;
  artifact_id?: string;
  artifact_type?: string;
  version?: number | null;
  name?: string;
  author?: string;
}

export interface StageCleanupPreviewPayload {
  removed_counts: Record<string, number>;
  cleanup_summary: string[];
}

export interface MemoryCleanupPayload {
  anchor: StageControlAnchor;
  affected_stages: string[];
  removable_counts: Record<string, number>;
  file_counts?: Record<string, number>;
  clear_conversation_summary: boolean;
  preserved_memory_scopes: string[];
  summary: string[];
}

export interface MemoryCleanupSummaryPayload extends MemoryCleanupPayload {
  rollback_generation: number;
  removed_counts: Record<string, number>;
  conversation_summary_cleared: boolean;
  removed_memory_ids: string[];
}

export interface StageLatestRunPayload {
  run_id: string;
  artifact_id: string;
  artifact_type: string;
  status: string;
  updated_at: string;
  title: string;
}

export interface StageFailurePayload {
  stage: string;
  task_id: string;
  error_message: string;
  failed_at: string;
  source: string;
}

export interface ActiveGatePayload {
  gate_id: string;
  gate_type: string;
  gate_name: string;
  status: string;
  artifact_id: string;
  updated_at: string;
  gate_context_mode?: 'real_gate' | 'synthetic_gate' | 'missing' | '';
}

export interface StageRerunScopePayload {
  replay_stages: string[];
  preserved_stages: string[];
  preserved_approvals: string[];
  summary: string;
}

export interface StageSnapshotPayload {
  anchor: StageControlAnchor;
  stage_id?: string;
  agents?: string[];
  requested_agents?: string[];
  execution_scope?: string;
  target_agent?: string;
  agent_role_contract?: string;
  baseline_artifacts: ArtifactSummaryRefPayload[];
  derived_artifacts: ArtifactSummaryRefPayload[];
  latest_run: StageLatestRunPayload;
  latest_failure: StageFailurePayload;
  active_gate: ActiveGatePayload;
  token_cost_hint: string;
  rerun_scope: StageRerunScopePayload;
}

export interface StageOperationLogEntryPayload {
  event_id: string;
  event_type: 'stage_control_rollback' | 'stage_control_manual_start';
  anchor: StageControlAnchor;
  stage_id?: string;
  agents?: string[];
  requested_agents?: string[];
  execution_scope?: string;
  target_agent?: string;
  agent_role_contract?: string;
  phase: string;
  substage: string;
  affected_phases?: string[];
  status: 'succeeded' | 'queued';
  summary: string[];
  created_at: string;
}

export interface StageControlAnchorPayload {
  anchor: StageControlAnchor;
  phase?: string;
  stage_id?: string;
  agents?: string[];
  requested_agents?: string[];
  execution_scope?: string;
  target_agent?: string;
  agent_role_contract?: string;
  parent_anchor?: StageControlAnchor;
  substage?: string;
  phase_group?: string;
  title: string;
  description: string;
  available: boolean;
  unavailable_reason?: string;
  preserved_runtime_state?: Record<string, unknown>;
  preserved_baselines: PreservedBaselineRefPayload[];
  preserved_artifacts: ArtifactSummaryRefPayload[];
  removal_preview: StageCleanupPreviewPayload;
  fine_cleanup_preview?: StageCleanupPreviewPayload | null;
  memory_cleanup_preview?: MemoryCleanupPayload | null;
  allowed_actions: string[];
  stage_snapshot?: StageSnapshotPayload | null;
}

export interface StageControlInspectPayload {
  diagnostic_only?: boolean;
  project_id: string;
  current_stage: string;
  current_anchor?: StageControlAnchor;
  baseline_summary: PreservedBaselineRefPayload[];
  preserved_artifacts: ArtifactSummaryRefPayload[];
  removal_preview: StageCleanupPreviewPayload;
  last_resume_failure: Record<string, unknown>;
  latest_failure: StageFailurePayload;
  latest_run: StageLatestRunPayload;
  active_gate: ActiveGatePayload;
  token_cost_hint: string;
  rerun_scope: StageRerunScopePayload;
  memory_risk?: string;
  memory_cleanup_preview?: MemoryCleanupPayload | null;
  allowed_actions: string[];
  available_anchors: StageControlAnchorPayload[];
  operation_log?: StageOperationLogEntryPayload[];
}

export interface StageControlResetPayload {
  ok: boolean;
  diagnostic_only?: boolean;
  project_id: string;
  anchor: StageControlAnchor;
  stage_id?: string;
  agents?: string[];
  requested_agents?: string[];
  execution_scope?: string;
  target_agent?: string;
  agent_role_contract?: string;
  restored_stage: string;
  preserved_baselines: PreservedBaselineRefPayload[];
  removed_counts: Record<string, number>;
  cleanup_summary: string[];
  memory_cleanup_summary?: MemoryCleanupSummaryPayload | null;
  next_allowed_actions: string[];
}

export interface StageControlStartPayload {
  ok: boolean;
  diagnostic_only?: boolean;
  project_id: string;
  anchor: StageControlAnchor;
  stage_id?: string;
  agents?: string[];
  requested_agents?: string[];
  execution_scope?: string;
  target_agent?: string;
  agent_role_contract?: string;
  restored_stage: string;
  started_task_id: string;
  queued_phase?: string;
  next_allowed_actions: string[];
}
