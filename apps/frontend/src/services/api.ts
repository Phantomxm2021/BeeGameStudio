import apiClient, {
  API_BASE_URL,
  buildUnauthorizedMessage,
  resolveAuthToken,
  setToastErrorCallback,
} from './apiClient'
import { beeGameAdapter } from './beeGameAdapter'
import {
  getCurrentUser as getBeeGameCurrentUser,
  type BeeGameCurrentUser,
} from './currentUserApi'
import type { ChatAttachmentPayload } from './chatAttachments'

export type {
  ChatAttachmentPayload,
  ChatFileAttachmentPayload,
  ChatImageAttachmentPayload,
} from './chatAttachments'

export interface SendMessageResponse {
  command_id: string
  task_id: string
  state: 'queued' | 'running' | 'resuming'
  resume_mode?: 'recover' | 'resume'
  trace_id: string
}

export interface ContinueTaskResponse {
  command_id: string
  resume_task_id: string
  resume_mode: 'recover' | 'resume'
  state: 'resuming'
  trace_id: string
}

export interface StopTaskResponse {
  command_id: string
  task_id: string
  state: 'stopped'
  trace_id: string
}

export interface ProjectBaselineStatusPayload {
  project_id: string
  phase: string
  blocked: boolean
  blocked_reason?: string | null
  active_agents?: string[]
  updated_at?: string
  next_action?: string
  acceptance?: {
    status: 'not_run' | 'passed' | 'failed' | 'blocked' | 'stale'
    summary?: string
    validated_at?: string
  }
  context?: ContextVisibilityPayload | null
  build_report?: BuildReportPayload | null
  project_target?: BeeGameAssetManifestPayload['project_target'] | null
  /** Untrusted backend workflow payload; normalize before it reaches display models. */
  workflow?: unknown
  model_config_id?: string | null
}

export interface ContextVisibilityPayload {
  bundle_id?: string
  phase?: string
  status?: string
  summary?: string
  failure_reason?: string
  blackboard_record_count?: number
  memory_hits?: number
  rag_sources?: string[]
  selected_skills?: string[]
  runtime_features?: Array<{
    id?: string
    label?: string
    stage?: string
    status?: string
  }>
  token_budget?: {
    status?: string
    input_tokens?: number
    cached_input_tokens?: number
    output_tokens?: number
    prompt_tokens?: number
    completion_tokens?: number
    cache_read_tokens?: number
    cache_creation_tokens?: number
    total_tokens?: number
    role_tokens?: {
      mainAgent?: number
      otherSubagents?: number
    }
  }
  counters?: Record<string, number>
}

export interface BuildReportCheckPayload {
  name?: string
  status?: string
  detail?: string
  path?: string
}

export interface BuildReportPayload {
  status?: string
  entrypoint?: string
  report_path?: string
  build_url?: string
  agents?: string[]
  generated_paths?: string[]
  checks?: BuildReportCheckPayload[]
  summary?: string
  failure_reason?: string
  created_at?: string
}

export interface BeeGamePreviewPayload {
  sessionId: string
  workspacePath: string
  status: 'idle' | 'starting' | 'running' | 'stopped' | 'failed' | 'unsupported'
  url: string
  port?: number
  command?: string
  script?: string
  entrypoint?: string
  message?: string
  updatedAt: string
}

export interface BeeGameDeploymentPayload {
  id: string
  sessionId: string
  projectId?: string
  workspacePath: string
  status: 'queued' | 'building' | 'publishing' | 'succeeded' | 'failed'
  url: string
  buildCommand?: string
  buildLog?: string
  entrypoint?: string
  outputDir?: string
  artifactPath?: string
  artifactHash?: string
  message?: string
  createdAt: string
  updatedAt: string
  deployedAt?: string
}

export interface BeeGameAssetRequirementPayload {
  id: string
  name?: string
  purpose?: string
  required?: boolean
}

export interface BeeGameProjectResourcePayload {
  id: string
  source:
    | {
        type: 'resource-library'
        pack_id: string
        pack_version: string
        element_id: string
        element_path: string
      }
    | {
        type: 'agent-authored'
        created_at: string
        reason: string
      }
    | {
        type: 'user-provided'
        created_at: string
        filename: string
      }
  status: 'available' | 'verified' | 'failed'
  root_path: string
  file_paths: string[]
  local_file_hashes?: Record<string, string>
  provisional: boolean
  selected_at: string
  selection_reason: string[]
  asset_kind?: string
  capabilities?: string[]
  content_profile?: Record<string, unknown>
  technical_facts?: Record<string, string | number | boolean>
  dependencies?: Array<{
    key: string
    parent_key: string
    element_id: string
    element_path: string
    reference_path: string
    local_path: string
    kind?: string
  }>
  error?: string
}

export interface BeeGameAssetManifestPayload {
  contract_state?: 'missing' | 'ready'
  version: 7
  project_target?: {
    platform?: string
    runtime?: string
    asset_format_capabilities: string[]
    resource_library_usage?: 'optional' | 'preferred' | 'required'
    runtime_asset_root: string
    content_root: string
    generated_asset_root: string
  }
  requirements: BeeGameAssetRequirementPayload[]
  resources: BeeGameProjectResourcePayload[]
}

export interface BeeGameAssetUploadPayload {
  manifest: BeeGameAssetManifestPayload
  resource: BeeGameProjectResourcePayload
  path: string
  message: string
}

export interface BeeGameResourcePackImpactPayload {
  packId: string
  projectCount: number
  references: Array<{
    projectId: string
    projectName: string
    resourceId: string
    packVersion: string
    elementId: string
    status?: string
  }>
  unreadableProjects: Array<{
    projectId: string
    projectName: string
    reason: string
  }>
}

export interface ClarificationSuggestionPayload {
  id: string
  label: string
  description: string
  clarification_patch: Record<string, string>
  metadata?: {
    visual_styles?: string[]
  }
}

export interface IdeaIntakeAnalysisPayload {
  clarification_required: boolean
  answered_slots: Record<string, string>
  pending_slots: string[]
  clarification_questions: string[]
  clarification_suggestions: ClarificationSuggestionPayload[]
  intent_analysis?: Record<string, unknown>
  confidence?: number
  reasoning_summary?: string
}

export interface PendingToolPermissionItem {
  gate_id: string
  type: 'BEEGAME_PERMISSION'
  task_id?: string | null
  title?: string
  permission_tool_name?: string
  created_at?: string
  artifact?: {
    content?: string
    input?: Record<string, unknown>
  }
  summary?: {
    block_reason?: string
    next_action?: string
  }
}

export interface PendingToolPermissionsResponse {
  items: PendingToolPermissionItem[]
}

export interface ProjectRuntimeStatePayload {
  status: ProjectBaselineStatusPayload
  pendingPermissions: PendingToolPermissionItem[]
}

const normalizeBuildReportPayload = (
  payload?: BuildReportPayload | null,
): BuildReportPayload | undefined => {
  if (!payload) return undefined
  return {
    status: String(payload.status ?? '').trim(),
    entrypoint: String(payload.entrypoint ?? '').trim(),
    report_path: String(payload.report_path ?? '').trim(),
    build_url: String(payload.build_url ?? '').trim(),
    agents: Array.isArray(payload.agents)
      ? payload.agents.map(item => String(item).trim()).filter(Boolean)
      : [],
    generated_paths: Array.isArray(payload.generated_paths)
      ? payload.generated_paths.map(item => String(item).trim()).filter(Boolean)
      : [],
    checks: Array.isArray(payload.checks)
      ? payload.checks.map(item => ({
          name: String(item?.name ?? '').trim(),
          status: String(item?.status ?? '').trim(),
          detail: String(item?.detail ?? '').trim(),
          path: String(item?.path ?? '').trim(),
        }))
      : [],
    summary: String(payload.summary ?? '').trim(),
    failure_reason: String(payload.failure_reason ?? '').trim(),
    created_at: String(payload.created_at ?? '').trim(),
  }
}

const normalizeContextVisibilityPayload = (
  payload?: ContextVisibilityPayload | null,
): ContextVisibilityPayload | undefined => {
  if (!payload) return undefined
  return {
    bundle_id: String(payload.bundle_id ?? '').trim(),
    phase: String(payload.phase ?? '').trim(),
    status: String(payload.status ?? '').trim(),
    summary: String(payload.summary ?? '').trim(),
    failure_reason: String(payload.failure_reason ?? '').trim(),
    blackboard_record_count: Number(payload.blackboard_record_count ?? 0),
    memory_hits: Number(payload.memory_hits ?? 0),
    rag_sources: Array.isArray(payload.rag_sources)
      ? payload.rag_sources.map(item => String(item).trim()).filter(Boolean)
      : [],
    selected_skills: Array.isArray(payload.selected_skills)
      ? payload.selected_skills.map(item => String(item).trim()).filter(Boolean)
      : [],
  }
}

const normalizePendingToolPermissionItem = (
  payload: PendingToolPermissionItem,
): PendingToolPermissionItem => ({
  gate_id: String(payload.gate_id ?? '').trim(),
  type: 'BEEGAME_PERMISSION',
  task_id: String(payload.task_id ?? '').trim() || undefined,
  title: String(payload.title ?? '').trim() || undefined,
  permission_tool_name:
    String(payload.permission_tool_name ?? '').trim() || undefined,
  created_at: String(payload.created_at ?? '').trim() || undefined,
  artifact: payload.artifact,
  summary: payload.summary,
})

export const normalizePendingToolPermissionsResponse = <
  T extends { items?: PendingToolPermissionItem[] },
>(
  payload: T,
): T => {
  return {
    ...payload,
    items: Array.isArray(payload.items)
      ? payload.items.map(item => normalizePendingToolPermissionItem(item))
      : [],
  }
}

const unwrapProjectBaselineStatusPayload = (
  payload?: ProjectBaselineStatusPayload | null,
): ProjectBaselineStatusPayload | undefined => {
  return payload ?? undefined
}

export const normalizeProjectBaselineStatusPayload = (
  payload?: ProjectBaselineStatusPayload | null,
): ProjectBaselineStatusPayload => {
  const normalizedPayload = unwrapProjectBaselineStatusPayload(payload)
  if (!normalizedPayload) {
    return {
      project_id: '',
      phase: '',
      blocked: false,
      blocked_reason: null,
      active_agents: [],
      updated_at: '',
      next_action: '',
      context: undefined,
      build_report: null,
      project_target: null,
    }
  }
  const workflow =
    normalizedPayload.workflow && typeof normalizedPayload.workflow === 'object'
      ? normalizedPayload.workflow
      : undefined
  return {
    project_id: String(normalizedPayload.project_id ?? '').trim(),
    phase: String(normalizedPayload.phase ?? '').trim(),
    blocked: Boolean(normalizedPayload.blocked),
    blocked_reason: normalizedPayload.blocked_reason ?? null,
    active_agents: Array.isArray(normalizedPayload.active_agents)
      ? normalizedPayload.active_agents
          .map(item => String(item).trim())
          .filter(Boolean)
      : [],
    updated_at: String(normalizedPayload.updated_at ?? '').trim(),
    next_action: String(normalizedPayload.next_action ?? '').trim(),
    model_config_id: normalizedPayload.model_config_id,
    acceptance: normalizedPayload.acceptance,
    context: normalizeContextVisibilityPayload(normalizedPayload.context),
    build_report:
      normalizeBuildReportPayload(normalizedPayload.build_report) ?? null,
    project_target:
      normalizedPayload.project_target &&
      typeof normalizedPayload.project_target === 'object'
        ? (normalizedPayload.project_target as ProjectBaselineStatusPayload['project_target'])
        : null,
    workflow,
  }
}

export interface ResolveToolPermissionPayload {
  project_id: string
  gate_id: string
  decision: 'allow' | 'deny'
  message?: string
  scope?: 'once' | 'session'
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
    content: string
    project_id: string
    termination_node?: string
    client_message_id?: string
    supersedes_message_id?: string
    attachments?: ChatAttachmentPayload[]
  }) => beeGameAdapter.sendMessage(data),

  /**
   * 继续执行暂停的任务
   * @param data - 包含项目 ID 和可选的任务 ID
   * @returns 返回任务 ID 和状态
   */
  continueTask: (data: { project_id: string; task_id?: string }) =>
    beeGameAdapter.continueTask(data),

  resumeWorkflow: (projectId: string) =>
    beeGameAdapter.resumeWorkflow(projectId),

  retryWorkflow: (projectId: string) => beeGameAdapter.retryWorkflow(projectId),

  restartWorkflow: (projectId: string) => beeGameAdapter.restartWorkflow(projectId),

  requestProjectAction: (data: {
    project_id: string
    kind: 'build_error_repair' | 'deployment_failure_repair'
  }) => beeGameAdapter.requestProjectAction(data),

  /**
   * 停止当前执行的任务
   * @param data - 包含任务 ID
   * @returns 返回操作状态
   */
  stopTask: (data: { task_id: string; project_id?: string }) =>
    beeGameAdapter.stopTask(data),

  /**
   * 获取项目的聊天历史记录
   * @param projectId - 项目 ID
   * @returns 返回消息列表
   */
  getChatHistory: (projectId: string) =>
    beeGameAdapter.getChatHistory(projectId),

  getOlderChatHistory: (projectId: string) =>
    beeGameAdapter.getOlderChatHistory(projectId),

  getChatHistoryPaginationState: (projectId: string) =>
    beeGameAdapter.getChatHistoryPaginationState(projectId),

  // ==================== 项目管理 API ====================

  /**
   * 获取所有项目列表
   * @returns 返回项目列表
   */
  getProjects: () => beeGameAdapter.getProjects(),

  bootstrapProjectFromBrief: (
    data: Parameters<typeof beeGameAdapter.bootstrapProjectFromBrief>[0],
  ) => beeGameAdapter.bootstrapProjectFromBrief(data),

  /**
   * 打开项目并通知后端初始化环境
   * @param projectId - 项目 ID
   * @returns 返回操作结果
   */
  openProject: (projectId: string) => beeGameAdapter.openProject(projectId),

  /**
   * 更新项目信息
   * @param projectId - 项目 ID
   * @param data - 包含要更新的字段（名称和/或根路径）
   * @returns 返回更新后的项目对象
   */
  updateProject: (projectId: string, data: { name?: string }) =>
    beeGameAdapter.updateProject(projectId, data),

  /**
   * 获取项目当前状态与项目级 baseline 元数据
   * @param projectId - 项目 ID
   */
  getProjectStatus: async (projectId: string) =>
    normalizeProjectBaselineStatusPayload(
      await beeGameAdapter.getProjectStatus(projectId),
    ),

  /** Read the project runtime snapshot once and derive all dashboard views. */
  getProjectRuntimeState: (
    projectId: string,
  ): Promise<ProjectRuntimeStatePayload> =>
    beeGameAdapter.getProjectRuntimeState(projectId),

  getWorkflowPhases: async (projectId: string) =>
    (await beeGameAdapter.getProjectRuntimeState(projectId)).status,

  getProjectTokenUsage: async (projectId: string) =>
    (await beeGameAdapter.getProjectRuntimeState(projectId)).status.context
      ?.token_budget ?? {},

  /**
   * 删除项目
   * @param projectId - 项目 ID
   * @returns 返回操作状态
   */
  deleteProject: (projectId: string) => beeGameAdapter.deleteProject(projectId),

  getCurrentUser: (): Promise<BeeGameCurrentUser> => getBeeGameCurrentUser(),

  /**
   * 获取所有项目列表 (简明版)
   * @returns 返回精简版项目列表
   */
  getProjectsList: () => beeGameAdapter.getProjects(),

  // ==================== Artifacts API ====================

  /**
   * 获取项目的交付物列表
   * @param projectId - 项目 ID
   */
  getArtifacts: (projectId: string) => beeGameAdapter.getArtifacts(projectId),

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
    apiClient.get(
      `/api/artifacts/${encodeURIComponent(artifactId)}?include_internal=${includeInternal}`,
    ),

  /**
   * 获取交付物原始文本内容
   * @param artifactId - 交付物 ID
   */
  getArtifactContent: (artifactId: string) =>
    beeGameAdapter.getArtifactContent(artifactId),

  downloadProjectPackage: (projectId: string) =>
    beeGameAdapter.downloadProjectPackage(projectId),

  getProjectPreview: (projectId: string) =>
    beeGameAdapter.getProjectPreview(projectId),

  startProjectPreview: (projectId: string) =>
    beeGameAdapter.startProjectPreview(projectId),

  restartProjectPreview: (projectId: string) =>
    beeGameAdapter.restartProjectPreview(projectId),

  stopProjectPreview: (projectId: string) =>
    beeGameAdapter.stopProjectPreview(projectId),

  deployProject: (projectId: string) => beeGameAdapter.deployProject(projectId),

  listProjectDeployments: (projectId: string) =>
    beeGameAdapter.listProjectDeployments(projectId),

  rollbackProjectDeployment: (projectId: string, deploymentId: string) =>
    beeGameAdapter.rollbackProjectDeployment(projectId, deploymentId),

  getProjectAssets: (projectId: string) =>
    beeGameAdapter.getProjectAssets(projectId),

  uploadProjectAsset: (projectId: string, resourceId: string, file: File) =>
    beeGameAdapter.uploadProjectAsset(projectId, resourceId, file),

  getResourcePackImpact: (packId: string) =>
    beeGameAdapter.getResourcePackImpact(packId),

  resolveToolPermission: (data: ResolveToolPermissionPayload) =>
    beeGameAdapter.resolveToolPermission(data),

  /**
   * 获取待处理的用户评审任务
   * @param projectId - 项目 ID
   */
  getPendingToolPermissions: async (projectId: string) =>
    normalizePendingToolPermissionsResponse(
      await beeGameAdapter.getPendingToolPermissions(projectId),
    ) as PendingToolPermissionsResponse,

}

export default apiClient
export {
  API_BASE_URL,
  buildUnauthorizedMessage,
  resolveAuthToken,
  setToastErrorCallback,
}
