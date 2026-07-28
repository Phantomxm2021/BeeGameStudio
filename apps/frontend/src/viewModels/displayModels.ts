import type {
  BuildReportPayload,
  ContextVisibilityPayload,
  DocumentBundleStatusPayload,
  OperatorVisibilityPayload,
  PendingUserReviewItem,
  ProjectBaselineStatusPayload,
  ExecutionEvidencePayload,
  ReviewBindingRef,
  ReviewStatusPayload,
  VerificationSummaryPayload,
} from '../services/api';
import type {
  Message,
  WorkflowCardPayload,
  WorkflowCardStatus,
  WorkflowCardTask,
} from '../types/message';

export type ChatDisplayMessage = Pick<
    Message,
    | 'id'
    | 'messageId'
    | 'clientMessageId'
    | 'supersedesMessageId'
    | 'dedupeKey'
    | 'sender'
    | 'content'
    | 'attachments'
    | 'timestamp'
    | 'type'
    | 'isDocument'
    | 'documentTitle'
    | 'thought'
    | 'taskId'
    | 'artifactId'
    | 'artifactPath'
    | 'renderHint'
    | 'artifactType'
    | 'taskKind'
    | 'nextAction'
    | 'requiresUserAction'
    | 'errorDetails'
    | 'toolName'
    | 'toolStatus'
    | 'toolDetail'
    | 'toolOutput'
    | 'isSubagentTool'
>

export interface ReviewStatusDisplayPayload {
  workflow_id: string;
  lane_id: string;
  lane_status: string;
  decision_status: string;
  requires_user_action: boolean;
  user_action_kind?: string;
  message?: {
    message_key?: string;
  } | null;
}

export type ReviewDisplayBindingRef = Pick<
  ReviewBindingRef,
  'artifact_id' | 'artifact_version' | 'checkpoint_id' | 'workspace_ref' | 'workspace_path'
>

export interface ReviewDisplaySummary {
  current_run?: Record<string, unknown> | null;
  current_snapshot?: Record<string, unknown> | null;
  latest_validation?: Record<string, unknown> | null;
  latest_review?: Record<string, unknown> | null;
  block_reason?: string;
  next_action?: string;
}

export interface ReviewDisplayVerification {
  verification_decision?: VerificationSummaryPayload['verification_decision'];
  verification_run_id?: string;
  policy_bundle_version?: string;
  attestation_ref?: string;
  blocking_finding_count?: number;
  blocking_findings?: VerificationSummaryPayload['blocking_findings'];
}

export interface BuildReportCheckDisplay {
  name?: string;
  status?: string;
  detail?: string;
  path?: string;
}

export interface BuildReportDisplayModel {
  status?: string;
  entrypoint?: string;
  report_path?: string;
  build_url?: string;
  agents: string[];
  generated_paths: string[];
  checks: BuildReportCheckDisplay[];
  summary?: string;
  failure_reason?: string;
  created_at?: string;
}

export interface DocumentBundleDisplayModel {
  bundle_id?: string;
  bundle_type?: string;
  gate_kind?: string;
  user_action_kind?: string;
  artifact_id?: string;
  status?: string;
  title?: string;
  ready_for_user_approval?: boolean;
  ready_for_promotion?: boolean;
  open_issue_ids: string[];
  open_blocker_ids: string[];
}

export interface ReviewDisplayModel {
  gate_id: string;
  type?: string;
  title?: string;
  permission_tool_name?: string;
  task_id?: string | null;
  gate_kind?: string;
  user_action_kind?: string;
  artifact?: Record<string, unknown>;
  artifact_type?: string;
  artifact_id?: string;
  artifact_version?: number;
  checkpoint_id?: string;
  workspace_ref?: string;
  workspace_path?: string;
  current_review_artifact_id?: string;
  current_review_iteration?: number;
  review_iteration?: number;
  revised_from_artifact_id?: string;
  open_issue_ids: string[];
  open_blocker_ids: string[];
  ready_for_user_approval: boolean;
  ready_for_promotion: boolean;
  history_only: boolean;
  verification_decision?: VerificationSummaryPayload['verification_decision'];
  binding?: ReviewDisplayBindingRef;
  review_status?: ReviewStatusDisplayPayload | null;
  summary?: ReviewDisplaySummary;
  verification?: ReviewDisplayVerification;
  quorum?: Record<string, unknown>;
  rollback_manifest?: Record<string, unknown>;
  execution_manifest?: Record<string, unknown>;
  change_request?: Record<string, unknown>;
  raw?: PendingUserReviewItem;
}

export interface ProjectRuntimeDisplayModel {
  project_id: string;
  phase?: string;
  blocked?: boolean;
  blocked_reason?: string | null;
  approval_required?: boolean;
  baseline?: ReviewDisplayBindingRef | null;
  next_action?: string;
  review_status?: ReviewStatusDisplayPayload | null;
  acceptance?: ProjectBaselineStatusPayload['acceptance'];
  context?: ContextVisibilityPayload;
  execution_evidence?: ExecutionEvidencePayload[];
  build_report?: BuildReportDisplayModel;
  document_bundle?: DocumentBundleDisplayModel;
  workflow?: WorkflowCardPayload;
}

const WORKFLOW_STATUS: Record<string, WorkflowCardStatus> = {
  draft: 'draft',
  starting: 'running',
  running: 'running',
  needs_action: 'blocked',
  blocked: 'blocked',
  verifying: 'verifying',
  delivered: 'completed',
  completed: 'completed',
  failed: 'failed',
  interrupted: 'cancelled',
  stopped: 'cancelled',
  cancelled: 'cancelled',
  stale: 'stale',
};

const normalizeWorkflowMessage = (value: unknown): string | undefined => {
  const message = trimString(value);
  if (!message) return undefined;
  try {
    const payload: unknown = JSON.parse(message);
    if (payload !== null && typeof payload === 'object') return undefined;
  } catch {
    // Workflow progress is ordinary display copy unless it is a complete JSON payload.
  }
  return message;
};

/** Convert backend workflow data into the only shape the UI may render. */
const normalizeWorkflowDisplay = (payload: unknown): WorkflowCardPayload | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const source = payload as Record<string, unknown>;
  const runId = trimString(source.runId ?? source.run_id);
  const status = WORKFLOW_STATUS[trimString(source.status).toLowerCase()];
  if (!runId || !status) return undefined;

  const thinkingValue = source.thinking;
  const thinking = typeof thinkingValue === 'string' && thinkingValue.trim()
    ? thinkingValue.trim()
    : undefined;
  const block = source.block && typeof source.block === 'object'
    ? source.block as Record<string, unknown>
    : undefined;
  const blockMessage = typeof block?.message === 'string' && block.message.trim()
    ? block.message.trim()
    : undefined;
  const activeDispatch = source.activeDispatch && typeof source.activeDispatch === 'object'
    ? source.activeDispatch as Record<string, unknown>
    : undefined;
  const rawThinking = trimString(source.thinking);
  const message = normalizeWorkflowMessage(source.message);
  const tasks = Array.isArray(source.tasks)
    ? source.tasks.flatMap((task): WorkflowCardTask[] => {
        if (!task || typeof task !== 'object') return [];
        const item = task as Record<string, unknown>;
        const id = trimString(item.id);
        const title = trimString(item.title);
        const taskStatus = trimString(item.status).toLowerCase();
        if (!id || !title || !['pending', 'running', 'completed', 'failed', 'blocked'].includes(taskStatus)) return [];
        return [{
          id,
          title,
          status: taskStatus as NonNullable<WorkflowCardPayload['tasks']>[number]['status'],
          attempt: Number.isFinite(Number(item.attempt)) ? Number(item.attempt) : undefined,
          failureReason: trimString(item.failureReason ?? item.failure_reason) || undefined,
        }];
      })
    : undefined;
  const failureReason = trimString(source.failureReason ?? source.failure_reason ?? source.blockedReason ?? source.blocked_reason);
  const nextActionValue = trimString(source.nextAction ?? source.next_action);

  return {
    runId,
    status,
    currentPhase: trimString(source.currentPhase ?? source.current_phase ?? source.phase) || undefined,
    documentStep: trimString(source.documentStep ?? source.document_step) || undefined,
    worker: trimString(source.worker ?? activeDispatch?.workerType ?? activeDispatch?.worker_type) || undefined,
    thinking: message || (thinking && !['working', 'waiting', 'idle'].includes(thinking) ? thinking : undefined),
    executionStatus: ['working', 'waiting', 'idle'].includes(rawThinking)
      ? rawThinking
      : trimString(activeDispatch?.status) || undefined,
    currentItemId: trimString(
      source.currentItemId ?? source.current_item_id ?? source.activeTaskId ?? source.active_task_id,
    ) || undefined,
    tasks,
    completedTaskCount: Number.isFinite(Number(source.completedTaskCount)) ? Number(source.completedTaskCount) : undefined,
    totalTaskCount: Number.isFinite(Number(source.totalTaskCount)) ? Number(source.totalTaskCount) : undefined,
    createdAt: trimString(source.createdAt ?? source.created_at) || undefined,
    completedAt: trimString(source.completedAt ?? source.completed_at) || undefined,
    updatedAt: trimString(source.updatedAt ?? source.updated_at) || undefined,
    stageStartedAt: trimString(activeDispatch?.startedAt ?? activeDispatch?.started_at) || undefined,
    nextAction: nextActionValue === 'resume' || nextActionValue === 'retry' ? nextActionValue : undefined,
    block: blockMessage || failureReason
      ? {
          message: blockMessage || failureReason,
          nextAction: trimString(block?.nextAction ?? block?.next_action) || undefined,
        }
      : undefined,
    usage: source.usage && typeof source.usage === 'object'
      ? source.usage as WorkflowCardPayload['usage']
      : undefined,
  };
};

const normalizeLegacyWorkflowDisplay = (payload: ProjectBaselineStatusPayload): WorkflowCardPayload => {
  const phase = trimString(payload.phase).toLowerCase();
  const status: WorkflowCardStatus = trimString(payload.blocked_reason).toLowerCase() === 'pipeline_failed'
    ? 'failed'
    : payload.blocked && phase === 'paused' && !payload.approval_required
      ? 'failed'
    : payload.blocked
      ? 'blocked'
    : phase === 'starting' || phase === 'running' || phase === 'waiting_approval' || phase === 'awaiting_user'
      ? 'running'
      : phase === 'finished'
        ? 'completed'
        : phase === 'failed'
          ? 'failed'
          : 'draft';
  return {
    runId: trimString(payload.project_id),
    status,
    currentPhase: trimString(payload.phase) || 'idle',
    block: payload.blocked_reason
      ? { message: trimString(payload.blocked_reason) }
      : undefined,
  };
};

export const getWorkflowControlState = (payload?: ProjectRuntimeDisplayModel | null): WorkflowCardPayload | undefined => {
  if (!payload) return undefined;
  return payload.workflow ?? normalizeLegacyWorkflowDisplay(payload as ProjectBaselineStatusPayload);
};

const trimString = (value: unknown): string => String(value ?? '').trim();

const unwrapProjectRuntimePayload = (
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

const normalizeReviewStatusDisplay = (
  payload?: ReviewStatusPayload | null,
): ReviewStatusDisplayPayload | null => {
  if (!payload) {
    return null;
  }
  return {
    workflow_id: trimString(payload.workflow_id),
    lane_id: trimString(payload.lane_id),
    lane_status: trimString(payload.lane_status),
    decision_status: trimString(payload.decision_status),
    requires_user_action: Boolean(payload.requires_user_action),
    user_action_kind: trimString(payload.user_action_kind) || undefined,
    message: trimString(payload.message?.message_key)
      ? { message_key: trimString(payload.message?.message_key) }
      : null,
  };
};

const normalizeBindingDisplay = (
  payload?: ReviewBindingRef | null,
): ReviewDisplayBindingRef | undefined => {
  if (!payload) {
    return undefined;
  }
  const normalized: ReviewDisplayBindingRef = {
    artifact_id: trimString(payload.artifact_id) || undefined,
    artifact_version:
      typeof payload.artifact_version === 'number' ? payload.artifact_version : undefined,
    checkpoint_id: trimString(payload.checkpoint_id) || undefined,
    workspace_ref: trimString(payload.workspace_ref ?? payload.workspace_path) || undefined,
    workspace_path: trimString(payload.workspace_path ?? payload.workspace_ref) || undefined,
  };
  return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined;
};

const normalizeBuildReportDisplay = (
  payload?: BuildReportPayload | null,
): BuildReportDisplayModel | undefined => {
  if (!payload) {
    return undefined;
  }
  const buildReport: BuildReportDisplayModel = {
    status: trimString(payload.status) || undefined,
    entrypoint: trimString(payload.entrypoint) || undefined,
    report_path: trimString(payload.report_path) || undefined,
    build_url: trimString(payload.build_url) || undefined,
    agents: Array.isArray(payload.agents)
      ? payload.agents.map((item) => trimString(item)).filter(Boolean)
      : [],
    generated_paths: Array.isArray(payload.generated_paths)
      ? payload.generated_paths.map((item) => trimString(item)).filter(Boolean)
      : [],
    checks: Array.isArray(payload.checks)
      ? payload.checks
          .map((item) => ({
            name: trimString(item?.name) || undefined,
            status: trimString(item?.status) || undefined,
            detail: trimString(item?.detail) || undefined,
            path: trimString(item?.path) || undefined,
          }))
          .filter((item) => Object.values(item).some((value) => value !== undefined))
      : [],
    summary: trimString(payload.summary) || undefined,
    failure_reason: trimString(payload.failure_reason) || undefined,
    created_at: trimString(payload.created_at) || undefined,
  };
  return Object.values(buildReport).some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return value !== undefined;
  })
    ? buildReport
    : undefined;
};

const normalizeDocumentBundleDisplay = (
  payload?: DocumentBundleStatusPayload | null,
): DocumentBundleDisplayModel | undefined => {
  if (!payload) {
    return undefined;
  }
  const bundle: DocumentBundleDisplayModel = {
    bundle_id: trimString(payload.bundle_id) || undefined,
    bundle_type: trimString(payload.bundle_type) || undefined,
    gate_kind: trimString(payload.gate_kind) || undefined,
    user_action_kind: trimString(payload.user_action_kind) || undefined,
    artifact_id: trimString(payload.artifact_id) || undefined,
    status: trimString(payload.status) || undefined,
    title: trimString(payload.title) || undefined,
    ready_for_user_approval: Boolean(payload.ready_for_user_approval),
    ready_for_promotion: Boolean(payload.ready_for_promotion),
    open_issue_ids: Array.isArray(payload.open_issue_ids)
      ? payload.open_issue_ids.map((item) => trimString(item)).filter(Boolean)
      : [],
    open_blocker_ids: Array.isArray(payload.open_blocker_ids)
      ? payload.open_blocker_ids.map((item) => trimString(item)).filter(Boolean)
      : [],
  };
  return Object.values(bundle).some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return value !== undefined;
  })
    ? bundle
    : undefined;
};

export const toChatDisplayMessage = (message: Message): ChatDisplayMessage => ({
  id: message.id,
  messageId: message.messageId,
  clientMessageId: message.clientMessageId,
  dedupeKey: message.dedupeKey,
  sender: message.sender,
  content: message.content,
  timestamp: message.timestamp,
  type: message.type,
  isDocument: message.isDocument,
  documentTitle: message.documentTitle,
  thought: message.thought,
  taskId: message.taskId,
  artifactId: message.artifactId,
  artifactPath: message.artifactPath,
  renderHint: message.renderHint,
  artifactType: message.artifactType,
  taskKind: message.taskKind,
  nextAction: message.nextAction,
  requiresUserAction: message.requiresUserAction,
  errorDetails: message.errorDetails,
  toolName: message.toolName,
  toolStatus: message.toolStatus,
  toolDetail: message.toolDetail,
  toolOutput: message.toolOutput,
  isSubagentTool: message.isSubagentTool,
});

export const toChatDisplayMessages = (messages: Message[]): ChatDisplayMessage[] =>
  messages.map(toChatDisplayMessage);

export const toReviewDisplayModel = (review: PendingUserReviewItem): ReviewDisplayModel => ({
  gate_id: trimString(review.gate_id),
  type: trimString(review.type) || undefined,
  title: trimString(review.title) || undefined,
  permission_tool_name: trimString(review.permission_tool_name) || undefined,
  task_id: trimString(review.task_id) || undefined,
  gate_kind: trimString(review.gate_kind) || undefined,
  user_action_kind: trimString(review.user_action_kind) || undefined,
  artifact:
    review.artifact && typeof review.artifact === 'object'
      ? review.artifact
      : undefined,
  artifact_type:
    trimString(
      review.artifact_type ?? ((review.artifact as Record<string, unknown> | undefined)?.artifact_type),
    ) || undefined,
  artifact_id: trimString(review.artifact_id) || undefined,
  artifact_version: typeof review.artifact_version === 'number' ? review.artifact_version : undefined,
  checkpoint_id: trimString(review.checkpoint_id) || undefined,
  workspace_ref: trimString(review.workspace_ref ?? review.workspace_path) || undefined,
  workspace_path: trimString(review.workspace_path ?? review.workspace_ref) || undefined,
  current_review_artifact_id: trimString(review.current_review_artifact_id || review.artifact_id) || undefined,
  current_review_iteration:
    typeof review.current_review_iteration === 'number' ? review.current_review_iteration : undefined,
  review_iteration: typeof review.review_iteration === 'number' ? review.review_iteration : undefined,
  revised_from_artifact_id: trimString(review.revised_from_artifact_id) || undefined,
  open_issue_ids: Array.isArray(review.open_issue_ids) ? review.open_issue_ids.map((item) => trimString(item)).filter(Boolean) : [],
  open_blocker_ids: Array.isArray(review.open_blocker_ids)
    ? review.open_blocker_ids.map((item) => trimString(item)).filter(Boolean)
    : [],
  ready_for_user_approval: Boolean(review.ready_for_user_approval),
  ready_for_promotion: Boolean(review.ready_for_promotion),
  history_only: Boolean(review.history_only),
  verification_decision: review.verification_decision,
  binding: normalizeBindingDisplay(review.binding ?? review),
  review_status: normalizeReviewStatusDisplay(review.review_status),
  summary: review.summary
    ? {
        current_run: review.summary.current_run ?? null,
        current_snapshot: review.summary.current_snapshot ?? null,
        latest_validation: review.summary.latest_validation ?? null,
        latest_review: review.summary.latest_review ?? null,
        block_reason: trimString(review.summary.block_reason) || undefined,
        next_action: trimString(review.summary.next_action) || undefined,
      }
    : undefined,
  verification: review.verification
    ? {
        verification_decision: review.verification.verification_decision,
        verification_run_id: trimString(review.verification.verification_run_id) || undefined,
        policy_bundle_version: trimString(review.verification.policy_bundle_version) || undefined,
        attestation_ref: trimString(review.verification.attestation_ref) || undefined,
        blocking_finding_count:
          typeof review.verification.blocking_finding_count === 'number'
            ? review.verification.blocking_finding_count
            : undefined,
        blocking_findings: Array.isArray(review.verification.blocking_findings)
          ? review.verification.blocking_findings
          : undefined,
      }
    : undefined,
  quorum: review.quorum ?? undefined,
  rollback_manifest:
    review.rollback_manifest && typeof review.rollback_manifest === 'object'
      ? review.rollback_manifest
      : undefined,
  execution_manifest:
    review.execution_manifest && typeof review.execution_manifest === 'object'
      ? review.execution_manifest
      : undefined,
  change_request:
    review.change_request && typeof review.change_request === 'object'
      ? review.change_request
      : undefined,
  raw: review,
});

export const toReviewDisplayModels = (reviews: PendingUserReviewItem[]): ReviewDisplayModel[] =>
  reviews.map(toReviewDisplayModel);

export const toProjectRuntimeDisplayModel = (
  payload?: ProjectBaselineStatusPayload | OperatorVisibilityPayload | null,
): ProjectRuntimeDisplayModel | null => {
  const normalizedPayload = unwrapProjectRuntimePayload(payload);
  if (!normalizedPayload) {
    return null;
  }
  return {
    project_id: trimString(normalizedPayload.project_id),
    phase: trimString(normalizedPayload.phase) || undefined,
    blocked: Boolean(normalizedPayload.blocked),
    blocked_reason: normalizedPayload.blocked_reason ?? null,
    approval_required: Boolean(normalizedPayload.approval_required),
    baseline: normalizeBindingDisplay(normalizedPayload.baseline),
    next_action: trimString(normalizedPayload.next_action) || undefined,
    review_status: normalizeReviewStatusDisplay(normalizedPayload.review_status),
    acceptance: normalizedPayload.acceptance,
    context: normalizedPayload.context
      ? {
          bundle_id: trimString(normalizedPayload.context.bundle_id) || undefined,
          phase: trimString(normalizedPayload.context.phase) || undefined,
          status: trimString(normalizedPayload.context.status) || undefined,
          summary: trimString(normalizedPayload.context.summary) || undefined,
          failure_reason: trimString(normalizedPayload.context.failure_reason) || undefined,
          blackboard_record_count: Number(normalizedPayload.context.blackboard_record_count ?? 0),
          memory_hits: Number(normalizedPayload.context.memory_hits ?? 0),
          rag_sources: Array.isArray(normalizedPayload.context.rag_sources)
            ? normalizedPayload.context.rag_sources.map((item) => trimString(item)).filter(Boolean)
            : [],
          selected_skills: Array.isArray(normalizedPayload.context.selected_skills)
            ? normalizedPayload.context.selected_skills.map((item) => trimString(item)).filter(Boolean)
            : [],
        }
      : undefined,
    build_report: normalizeBuildReportDisplay(normalizedPayload.build_report),
    document_bundle: normalizeDocumentBundleDisplay(normalizedPayload.document_bundle),
    workflow: normalizeWorkflowDisplay(normalizedPayload.workflow) ?? normalizeLegacyWorkflowDisplay(normalizedPayload),
    execution_evidence: Array.isArray(normalizedPayload.execution_evidence)
      ? normalizedPayload.execution_evidence.map((item) => ({
          ...item,
          execution_id: trimString(item.execution_id) || undefined,
          agent: trimString(item.agent),
          status: trimString(item.status),
          generated_paths: Array.isArray(item.generated_paths)
            ? item.generated_paths.map((path) => trimString(path)).filter(Boolean)
            : [],
          summary: trimString(item.summary) || undefined,
          failure_reason: trimString(item.failure_reason) || undefined,
        }))
      : [],
  };
};
