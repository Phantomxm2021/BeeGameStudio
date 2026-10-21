import {
  getPayloadString,
  getPayloadRecord,
  getBeeGameAssistantMessageId,
  getThinkingDisplayId,
  getAssistantPayloadMessageId,
  getAssistantContentBlocks,
  type BeeGameEvent,
} from './beeGameEvent'
import { decodeArtifactId, toWorkspaceRelativePath, getArtifactPath, encodeArtifactId } from './beeGameArtifactPaths'
import { projectEventMessages, projectHistoryMessages, getUsageFromEventPayload } from './beeGameChatProjection'
import type {
  BeeGameAssetManifestPayload,
  BeeGameAssetUploadPayload,
  BeeGameResourcePackImpactPayload,
  BeeGameDeploymentPayload,
  BeeGamePreviewPayload,
  ContinueTaskResponse,
  PendingToolPermissionItem,
  ProjectBaselineStatusPayload,
  ProjectRuntimeStatePayload,
  SendMessageResponse,
  StopTaskResponse,
  ChatAttachmentPayload,
} from './api'
import type { Project } from '../types/project'
import type { BeeGameUiContentNode } from '../../../../packages/scene-editor/src/ui-preview/types'
export type { BeeGameUiContentNode } from '../../../../packages/scene-editor/src/ui-preview/types'
import type { AssistantContentBlock, ProjectEventMessage } from '../types/message'
import { authenticatedFetch } from './apiClient'
import { readSubagentActivity, mergeSubagentActivity, type SubagentActivitySnapshot } from '@bee-game-studio/agent-workflow/subagent-activity'
import { normalizeChatAttachments } from './chatAttachments'
import { projectQuotaErrorMessage } from './projectQuotaError'
import {
  normalizeAttachmentBuildAnalysis,
  type AttachmentBuildAnalysis,
} from './attachmentBuild'
import { getSupabaseSessionUser } from './supabaseAuthApi'

type BeeGameSession = {
  id: string
  cwd: string
  modelConfigId?: string
  status: 'running' | 'stopped' | 'failed'
  turnStatus: 'idle' | 'running'
  createdAt: string
  updatedAt: string
}

export type BeeGameQueuedMessage = {
  id: string
  text: string
  createdAt: string
  state: 'pending' | 'dispatching'
  attachmentCount: number
}

type V3Run = {
  id: string
  version: number
  planRevision: number
  chatSessionId: string
  requirements: { revision: string }
  paused?: { at: string }
  writer?: { attemptId: string; fence: number }
  writerLiveness?: 'none' | 'local-active' | 'unknown'
  recoveryEvidence?: string
  recoveryDiagnostic?: string
  agentTurns?: Array<{
    attemptId: string
    turnId?: string
    status: 'running' | 'ended' | 'failed' | 'interrupted'
    notStarted?: boolean
  }>
}

async function readV3Run(projectId: string): Promise<V3Run | null> {
  const { run, writerLiveness, recoveryEvidence, recoveryDiagnostic } = await getJson<{
    run: V3Run | null; writerLiveness?: V3Run['writerLiveness']; recoveryEvidence?: string; recoveryDiagnostic?: string
  }>(
    `/api/projects/${encodeURIComponent(projectId)}/workflow-v3`,
  )
  if (!run?.agentTurns) return null
  return { ...run, writerLiveness, recoveryEvidence, recoveryDiagnostic }
}

async function currentV3Run(projectId: string): Promise<V3Run> {
  const run = await readV3Run(projectId)
  if (!run) throw new Error('此项目没有 V3 Agent 任务；旧交付不能从聊天入口继续。')
  return run
}

function assertWriterReleased(run: V3Run): void {
  if (!run.writer) return
  if (run.writerLiveness === 'local-active')
    throw new Error('原任务仍在执行或清理中，尚未确认停止；不能继续或发送新任务。')
  if (['persisted', 'original-host', 'host-receipt', 'host-reboot'].includes(run.recoveryEvidence ?? ''))
    throw new Error('旧执行仍在结算，请稍后再试。')
  const reason = ({
    'exit-receipts-not-configured': '宿主未配置退出回执',
    'exit-receipt-invalid': '退出证据无法校验',
    'exit-evidence-read-failed': '退出证据读取失败',
    'host-identity-unavailable': '无法核实主机启动身份',
    'foreign-host': '执行属于另一台主机',
    'same-boot': '同次开机中的旧执行退出状态未确认',
    'ownership-missing': '缺少可信宿主执行记录',
  } as Record<string, string>)[run.recoveryDiagnostic ?? ''] ?? '旧执行退出状态未确认'
  throw new Error(`${reason}。暂停已记录不等于执行已停止；需在原主机核实并清理，不能直接解锁或重新执行。`)
}

async function sendV3Message(projectId: string, sessionId: string, input: {
  text: string
  intent?: 'continue'
  requestKey: string
  continuationOf?: string
  allowResume?: boolean
  attachments?: ChatAttachmentPayload[]
}): Promise<{ turn: { attemptId: string }; runId: string }> {
  let run = await currentV3Run(projectId)
  if (run.chatSessionId !== sessionId)
    throw new Error('项目会话与 V3 任务不一致，请重新打开项目。')
  if (input.allowResume !== false && run.writer && run.writerLiveness !== 'local-active' &&
      ['persisted', 'original-host', 'host-receipt', 'host-reboot'].includes(run.recoveryEvidence ?? '')) {
    await beeGameAdapter.recoverTask({ project_id: projectId })
    run = await currentV3Run(projectId)
  }
  if (!run.paused || run.writer && run.writerLiveness !== 'local-active') assertWriterReleased(run)
  if (run.paused) {
    if (input.allowResume === false) throw new Error('任务已被暂停，已取消自动重试。')
    const resumed = await postJson<{ run: V3Run }>(
      `/api/projects/${encodeURIComponent(projectId)}/workflow-v3/resume`,
      { planRevision: run.planRevision },
    )
    run = resumed.run
  }
  assertWriterReleased(run)
  return postJson(`/api/projects/${encodeURIComponent(projectId)}/workflow-v3/agent/messages`, {
    requestKey: input.requestKey,
    runId: run.id,
    chatSessionId: run.chatSessionId,
    expectedVersion: run.version,
    requirementsRevision: run.requirements.revision,
    ...(input.intent ? { intent: input.intent } : {}),
    text: input.text,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    ...(input.continuationOf ? { continuationOf: input.continuationOf } : {}),
  })
}

type BeeGamePendingPermissionPayload = {
  id?: string
  session_id?: string
  event_id?: number
  tool_name?: string
  message?: string
  created_at?: string
  input?: unknown
  design_change_allowed?: boolean
}

type ProjectRuntimeStateWithPermissions = ProjectBaselineStatusPayload & {
  pending_permissions?: BeeGamePendingPermissionPayload[]
}

const projectRuntimeStateRequests = new Map<
  string,
  Promise<ProjectRuntimeStateWithPermissions>
>()
const projectRuntimeStateGenerations = new Map<string, number>()

const invalidateProjectRuntimeState = (projectId: string): void => {
  const normalizedProjectId = String(projectId || '').trim()
  if (!normalizedProjectId) return
  projectRuntimeStateGenerations.set(
    normalizedProjectId,
    (projectRuntimeStateGenerations.get(normalizedProjectId) ?? 0) + 1,
  )
  projectRuntimeStateRequests.delete(normalizedProjectId)
}

function fetchProjectRuntimeState(
  projectId: string,
): Promise<ProjectRuntimeStateWithPermissions> {
  const normalizedProjectId = String(projectId || '').trim()
  const existing = projectRuntimeStateRequests.get(normalizedProjectId)
  if (existing) return existing
  const generation = projectRuntimeStateGenerations.get(normalizedProjectId) ?? 0
  const request = getJson<ProjectRuntimeStateWithPermissions>(
    `/api/projects/${encodeURIComponent(normalizedProjectId)}/runtime-state`,
  ).then(snapshot => {
    // A preview mutation can complete while an earlier poll is still in
    // flight. Do not let that old response overwrite the post-mutation state;
    // join the replacement request instead.
    if ((projectRuntimeStateGenerations.get(normalizedProjectId) ?? 0) !== generation) {
      return fetchProjectRuntimeState(normalizedProjectId)
    }
    return snapshot
  }).finally(() => {
    if (projectRuntimeStateRequests.get(normalizedProjectId) === request) {
      projectRuntimeStateRequests.delete(normalizedProjectId)
    }
  })
  projectRuntimeStateRequests.set(normalizedProjectId, request)
  return request
}

type ProjectSessionBinding = {
  projectId: string
  sessionId: string
  workspacePath: string
  language?: BeeGameLanguage
}

type BeeGameTranscriptPage = {
  events: BeeGameEvent[]
  page: {
    hasMore: boolean
    nextBeforeId: number | null
  }
}

type BeeGameProjectEvents = {
  sessionId: string
  workspacePath: string
  events: BeeGameEvent[]
  recoveredFromTranscript: boolean
}

type BeeGameEventStreamCallbacks = {
  onOpen?: () => void
  onMessage: (message: ProjectEventMessage) => void
  onCursor?: (eventId: number) => void
}

type BeeGameProjectTranscriptPage = BeeGameTranscriptPage & {
  sessionId: string
  workspacePath: string
  todoEvents?: BeeGameEvent[]
}

type BeeGameProjectArtifactIndex = {
  sessionId?: string
  workspacePath: string
  artifacts: BeeGameDiscoveredArtifact[]
}

// A refresh should restore the active end of the conversation, not replay a
// whole long-running project. Older history remains explicitly paged in when
// the user scrolls to the top.
const CHAT_INITIAL_HISTORY_PAGE_SIZE = 50
const CHAT_HISTORY_PAGE_SIZE = 300
type ChatHistoryCursorState = BeeGameTranscriptPage['page'] & {
  latestEventId: number
}
const chatHistoryCursorByProject = new Map<string, ChatHistoryCursorState>()
const stoppedTurnsByProject = new Map<string, Set<string>>()
type SubagentToolOwner = { event: BeeGameEvent; activity: SubagentActivitySnapshot }
const subagentToolsByProject = new Map<string, Map<string, SubagentToolOwner>>()

type BeeGameDiscoveredArtifact = {
  path: string
  name?: string
  artifact_type?: string
  created_at?: string
}

type BeeGameSessionHandle = {
  session: BeeGameSession
  recoveredEvents: BeeGameEvent[]
  binding?: ProjectSessionBinding
  previousSessionId?: string
}

type BeeGameArtifact = {
  artifact_id: string
  id: string
  name: string
  artifact_type: string
  path?: string
  status: 'active'
  created_by: 'beegame'
  created_at: string
  package_download?: boolean
}

type BeeGameLanguage =
  | 'en'
  | 'zh'
  | 'zh-TW'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'it'
  | 'pt'

type BeeGameIdeaIntakeRequest = {
  idea: string
  language?: BeeGameLanguage | string
  clientRequestId?: string
  attachments?: ChatAttachmentPayload[]
}

export type BeeGameIntakeOption = {
  id: string
  title: string
  projectFolderName?: string
  pitch: string
  gameplay: string
  coreGameplayHypothesis: string
  experienceSnapshot: string
  playerFirstMinute: string
  whyFitsIdea: string
  playablePrototype: string
  validationTarget: string
  coreMechanic: string
  firstBuild: string
  validationGoal: string
  risk: string
  fit: string
  firstPlayableValidation: string
  riskComplexity: string
  recommendedPlatform: string
  recommendedEngine?: string
  recommendedDimension: string
  recommendedGenre: string
  recommendedStyle: string
  recommendedInputs: string[]
  scope: string
}

export type BeeGameClarificationOption = {
  id: string
  label: string
  description?: string
  value?: string
}

export type BeeGameClarification = {
  prompt: string
  options: BeeGameClarificationOption[]
  freeformLabel?: string
}

export type BeeGameIdeaIntakeResult = {
  maturity: 'vague' | 'directional' | 'concrete'
  needsClarification: boolean
  clarification?: BeeGameClarification
  clarificationQuestions: string[]
  detectedConstraints: string[]
  recommendedNextStep: string
  options: BeeGameIntakeOption[]
}

export type BeeGameIntakeSettings = {
  platform: string
  engine?: string
  visualStyle: string
  dimension: string
  orientation?: 'Landscape' | 'Portrait' | ''
  genre: string
  inputs: string[]
  scope: string
  notes?: string
  resourceLibraryUsage: 'optional' | 'preferred' | 'required'
}

export type BeeGameBuildBrief = {
  creationMode?: 'creative' | 'blueprint'
  attachments?: ChatAttachmentPayload[]
  idea: string
  option: BeeGameIntakeOption
  settings: BeeGameIntakeSettings
  language: BeeGameLanguage | string
  documentLanguage: BeeGameLanguage | string
  gameUserVisibleLanguage: BeeGameLanguage | string
  agentResponseLanguage: BeeGameLanguage | string
  root_path?: string
  title?: string
  confirmedGdd?: string
  buildSource?: 'gdd' | 'image' | 'mixed'
  analysisId?: string
}

const SENT_DISPLAY_KEY = 'beegame-adapter-sent-display-text'
const PROJECT_PACKAGE_ARTIFACT_PREFIX = 'beegame-project-package:'

export type BeeGameWorkspaceSettings = {
  workspacePath: string
  isDefault: boolean
}

export type BeeGameContentNode = {
  id: string
  parentId?: string
  name?: string
  semantic?: string[]
  enabled?: boolean
  transform?: {
    position: [number, number, number]
    rotation?: [number, number, number]
    scale?: [number, number, number]
  }
  layer?: string
  zIndex?: number
  components?: Array<{
    id: string
    type: 'sprite-renderer' | 'mesh-filter' | 'mesh-renderer' | 'skinned-mesh-renderer' | 'grid' | 'tilemap' | 'tilemap-renderer' | 'animator' | 'box-collider-2d' | 'circle-collider-2d' | 'capsule-collider-2d' | 'polygon-collider-2d' | 'rigidbody-2d' | 'box-collider' | 'sphere-collider' | 'capsule-collider' | 'mesh-collider' | 'rigidbody' | 'audio-source' | 'audio-listener' | 'particle-system' | 'particle-system-renderer' | 'light-2d' | 'light' | 'camera' | 'canvas' | 'canvas-renderer' | 'rect-transform' | 'image' | 'text'
    assetRef?: string
    data?: Record<string, unknown>
  }>
  data?: Record<string, unknown>
}

export type BeeGameSceneContentDocument = {
  schema: 'beegame-content.v1'
  id: string
  kind: 'scene-2d' | 'scene-3d'
  assetRefs: string[]
  data: {
    nodes: BeeGameContentNode[]
    cameraNodeId?: string
    settings?: Record<string, unknown>
  }
}


export type BeeGameUiContentDocument = {
  schema: 'beegame-content.v1'
  id: string
  kind: 'ui-screen' | 'ui-hud' | 'ui-flow'
  assetRefs: string[]
  data: { rootId: string; nodes: BeeGameUiContentNode[] }
}

export type BeeGameEditableContentDocument =
  | BeeGameSceneContentDocument
  | BeeGameUiContentDocument

export type BeeGameGameContentSnapshot = {
  state: 'awaiting_documents' | 'awaiting_assets' | 'awaiting_content' | 'ready' | 'draft'
  acceptedContentRevision?: string
  contentRevision?: string
  indexIssues?: string[]
  index?: {
    schema: 'beegame-content-package.v2'
    id: string
    dimension: '2d' | '3d'
    documentRevision?: string
    assetManifestRevision?: string
    entryScene: string
    sceneModel: 'game-object-v2'
    files: string[]
  }
  documents?: Array<{
    path: string
    revision: string
    document: BeeGameEditableContentDocument | Record<string, unknown>
  }>
}

export type BeeGameContentFileListSnapshot = Omit<BeeGameGameContentSnapshot, 'documents'> & {
  documents?: Array<{
    path: string
    revision?: string
    id: string
    kind: BeeGameEditableContentDocument['kind'] | 'scene' | 'ui'
    error?: string
  }>
}

function normalizeBeeGameContentFileList(
  snapshot: BeeGameContentFileListSnapshot | BeeGameGameContentSnapshot,
): BeeGameContentFileListSnapshot {
  if (!snapshot.documents) {
    // Both snapshot shapes omit documents while content is not available yet.
    // Strip the discriminating union field before returning the lightweight
    // file-list shape so callers never receive a full-document union here.
    const { documents: _documents, ...metadata } = snapshot
    return metadata
  }
  return {
    ...snapshot,
    documents: snapshot.documents.flatMap(item => {
      if (!('document' in item)) return [item]
      const document = item.document
      if (!document || typeof document !== 'object' || Array.isArray(document)) return []
      const record = document as Record<string, unknown>
      if (typeof record.id !== 'string' || typeof record.kind !== 'string') return []
      return [{
        path: item.path,
        revision: item.revision,
        id: record.id,
        kind: record.kind as BeeGameEditableContentDocument['kind'],
      }]
    }),
  }
}

export type BeeGameContentDocumentSaveResult<
  Document extends BeeGameEditableContentDocument = BeeGameEditableContentDocument,
> = {
  path: string
  revision: string
  contentRevision: string
  document: Document
}

export async function getBeeGameWorkspaceSettings(): Promise<BeeGameWorkspaceSettings> {
  return { workspacePath: await resolveDefaultWorkspacePath(), isDefault: true }
}

export const beeGameAdapter = {
  async getProjects(): Promise<Project[]> {
    return getJson<Project[]>('/api/projects')
  },

  async getProjectPage(offset: number, search = ''): Promise<{ items: Project[]; hasMore: boolean; total: number | null }> {
    const query = new URLSearchParams({ offset: String(offset), limit: '20' })
    if (search.trim()) query.set('search', search.trim())
    return getJson<{ items: Project[]; hasMore: boolean; total: number | null }>(`/api/projects/page?${query}`)
  },

  async getProjectMetadata(projectId: string): Promise<Project> {
    return getJson<Project>(`/api/projects/${encodeURIComponent(projectId)}/metadata`)
  },

  async runIdeaIntake(
    data: BeeGameIdeaIntakeRequest,
  ): Promise<BeeGameIdeaIntakeResult> {
    const requestBody = buildIdeaIntakeRequestBody(data)
    const response = await runIdeaIntakeJob(requestBody)
    const intake = normalizeIdeaIntakeResult(response)
    if (intake.options.length !== 3) {
      throw new Error(
        `BeeGame intake must return exactly 3 game mode options; received ${intake.options.length}`,
      )
    }
    return intake
  },

  async analyzeAttachmentBuild(data: {
    idea?: string
    attachments: ChatAttachmentPayload[]
    language: string
    clientRequestId: string
  }): Promise<AttachmentBuildAnalysis> {
    const response = await postJson<unknown>(
      '/api/beegame-intake/analyze-attachments',
      {
        idea: data.idea,
        attachments: data.attachments,
        language: data.language,
        clientRequestId: data.clientRequestId,
      },
    )
    return normalizeAttachmentBuildAnalysis(response)
  },

  async generateIntakeOptions(
    data: BeeGameIdeaIntakeRequest,
  ): Promise<BeeGameIntakeOption[]> {
    return (await this.runIdeaIntake(data)).options
  },

  async bootstrapProjectFromBrief(data: BeeGameBuildBrief): Promise<{
    project: Project
    task_id: string
    status: string
  }> {
    const title = getBriefDisplayTitle(data)
    const folderName = getBriefFolderName(data, title)
    const project = createLocalProject(title)
    const language = normalizeBeeGameLanguage(
      data.language ?? getCurrentUiLanguage(),
    )
    const bootstrap = await postJson<{
      project: Project
      session: BeeGameSession
      binding: ProjectSessionBinding
      task_id: string
      status: string
    }>('/api/projects/bootstrap', {
      project,
      projectName: folderName,
      brief: data,
      language,
    })
    const syncedProject = bootstrap.project
    return {
      project: syncedProject,
      task_id: bootstrap.task_id,
      status: bootstrap.status,
    }
  },

  async openProject(projectId: string): Promise<{ opened: boolean }> {
    // Opening a project must establish the server-owned session/workspace
    // binding before the dashboard starts polling history and runtime state.
    // Sending a message also calls this endpoint, but project navigation must
    // recover a live session even when the user only inspects the project.
    await ensureProjectSession(projectId)
    return { opened: true }
  },

  async updateProject(
    projectId: string,
    data: { name?: string },
  ): Promise<Project> {
    return patchJson<Project>(
      `/api/projects/${encodeURIComponent(projectId)}`,
      data,
    )
  },

  async deleteProject(projectId: string): Promise<{ ok: boolean }> {
    await deleteProjectMetadata(projectId)
    chatHistoryCursorByProject.delete(projectId)
    stoppedTurnsByProject.delete(projectId)
    subagentToolsByProject.delete(projectId)
    return { ok: true }
  },

  async sendMessage(data: {
    content: string
    project_id: string
    client_message_id?: string
    supersedes_message_id?: string
    attachments?: ChatAttachmentPayload[]
  }): Promise<SendMessageResponse> {
    const handle = await ensureProjectSession(data.project_id)
    const { session } = handle
    if (data.supersedes_message_id)
      throw new Error('V3 对话不能改写已发送消息；请发送一条新的更正。')
    const result = await sendV3Message(data.project_id, session.id, {
      text: data.content,
      attachments: data.attachments,
      requestKey: data.client_message_id ?? crypto.randomUUID(),
    })
    return {
      command_id: session.id,
      task_id: result.turn.attemptId,
      state: 'running',
      trace_id: data.client_message_id || result.turn.attemptId,
    }
  },

  async listQueuedMessages(projectId: string): Promise<BeeGameQueuedMessage[]> {
    await currentV3Run(projectId)
    return []
  },

  async deleteQueuedMessage(projectId: string, messageId: string): Promise<void> {
    void projectId; void messageId
    throw new Error('V3 不使用旧消息队列。')
  },

  async steerQueuedMessage(projectId: string, messageId: string): Promise<void> {
    void projectId; void messageId
    throw new Error('V3 不使用旧消息队列。')
  },

  async continueTask(data: {
    project_id: string
    failed_turn_id?: string
    automatic_retry?: boolean
    task_id?: string
  }): Promise<ContinueTaskResponse> {
    if (data.automatic_retry && !data.failed_turn_id) throw new Error('自动重试必须绑定失败回合。')
    const handle = await ensureProjectSession(data.project_id)
    const { session } = handle
    let run = await currentV3Run(data.project_id)
    if (data.automatic_retry && run.paused)
      throw new Error('任务已被暂停，已取消自动重试；请明确继续任务。')
    if (!data.automatic_retry && run.writer && run.writerLiveness !== 'local-active' &&
        ['persisted', 'original-host', 'host-receipt', 'host-reboot'].includes(run.recoveryEvidence ?? '')) {
      await this.recoverTask({ project_id: data.project_id })
      run = await currentV3Run(data.project_id)
    }
    if (!run.paused || run.writer && run.writerLiveness !== 'local-active') assertWriterReleased(run)
    if (data.failed_turn_id && run.agentTurns?.at(-1)?.turnId !== data.failed_turn_id)
      throw new Error('任务回合已改变，已取消旧错误的重试。')
    if (run.paused) {
      await postJson(`/api/projects/${encodeURIComponent(data.project_id)}/workflow-v3/resume`, {
        planRevision: run.planRevision,
      })
      run = await currentV3Run(data.project_id)
    }
    assertWriterReleased(run)
    const last = run.agentTurns?.at(-1)
    if (data.failed_turn_id && last?.turnId !== data.failed_turn_id)
      throw new Error('任务回合已改变，已取消旧错误的重试。')
    if (!last || !['failed', 'interrupted'].includes(last.status) || last.notStarted)
      throw new Error('没有可续作的已中断 V3 回合；请明确发送新的执行请求。')
    const result = await sendV3Message(data.project_id, session.id, {
      text: '继续上一次已中断的任务。',
      intent: 'continue',
      requestKey: crypto.randomUUID(),
      continuationOf: last.attemptId,
      allowResume: !data.automatic_retry,
    })
    return {
      command_id: session.id,
      resume_task_id: result.turn.attemptId,
      resume_mode: 'resume',
      state: 'resuming',
      trace_id: result.turn.attemptId,
    }
  },

  async requestProjectAction(data: {
    project_id: string
    kind: 'deployment_failure_repair'
  }): Promise<SendMessageResponse> {
    if (data.kind !== 'deployment_failure_repair') throw new Error('不支持的 V3 项目操作。')
    return this.sendMessage({
      project_id: data.project_id,
      content: '检查最近一次部署失败的实际错误，并仅在必要时修复当前工程，再重新验证。',
    })
  },

  async stopTask(data: {
    task_id: string
    project_id?: string
  }): Promise<StopTaskResponse> {
    const projectId = String(data.project_id || '').trim()
    if (!projectId) throw new Error('停止 V3 任务需要项目 ID。')
    const stopped = await postJson<{ run: V3Run; stopping: boolean }>(
      `/api/projects/${encodeURIComponent(projectId)}/workflow-v3/stop`, {},
    )
    return {
      command_id: stopped.run.id,
      task_id: stopped.run.id,
      state: stopped.stopping ? 'stop_requested' : 'stopped',
      trace_id: stopped.run.id,
    }
  },

  async recoverTask(data: { project_id: string }): Promise<{ recovered: boolean; paused: boolean }> {
    const run = await currentV3Run(data.project_id)
    if (!run.writer) return { recovered: false, paused: Boolean(run.paused) }
    if (run.writerLiveness === 'local-active' ||
        !['persisted', 'original-host', 'host-receipt', 'host-reboot'].includes(run.recoveryEvidence ?? ''))
      assertWriterReleased(run)
    const result = await postJson<{ run: V3Run }>(
      `/api/projects/${encodeURIComponent(data.project_id)}/workflow-v3/recover-writer`,
      { expectedVersion: run.version, attemptId: run.writer.attemptId, fence: run.writer.fence },
    )
    if (result.run.writer) throw new Error('旧执行占用尚未释放；没有恢复任务。')
    return { recovered: true, paused: Boolean(result.run.paused) }
  },

  async getChatHistory(projectId: string): Promise<unknown[]> {
    const transcriptPage =
      await fetchProjectTranscriptPageIfAvailable(projectId)
    if (!transcriptPage) return []
    chatHistoryCursorByProject.set(projectId, {
      ...transcriptPage.page,
      latestEventId: getLatestBeeGameEventId(transcriptPage.events),
    })
    const pageIds = new Set(transcriptPage.events.map(event => event.id))
    const historyEvents = [...transcriptPage.events,
      ...(transcriptPage.todoEvents ?? []).filter(event => !pageIds.has(event.id))]
    const subagentTools = new Map<string, SubagentToolOwner>()
    subagentToolsByProject.set(projectId, subagentTools)
    return eventsToHistory(
      projectId,
      historyEvents,
      transcriptPage.workspacePath,
      subagentTools,
    )
  },

  async getOlderChatHistory(projectId: string): Promise<{
    messages: unknown[]
    hasMore: boolean
  }> {
    const cursor = chatHistoryCursorByProject.get(projectId)
    if (!cursor?.hasMore || cursor.nextBeforeId === null) {
      return { messages: [], hasMore: false }
    }
    const transcriptPage = await fetchProjectTranscriptPage(
      projectId,
      cursor.nextBeforeId,
    )
    chatHistoryCursorByProject.set(projectId, {
      ...transcriptPage.page,
      latestEventId: cursor.latestEventId,
    })
    return {
      messages: eventsToHistory(
        projectId,
        transcriptPage.events,
        transcriptPage.workspacePath,
      ),
      hasMore: transcriptPage.page.hasMore,
    }
  },

  getChatHistoryPaginationState(projectId: string): {
    initialized: boolean
    hasMore: boolean
  } {
    const cursor = chatHistoryCursorByProject.get(projectId)
    return {
      initialized: Boolean(cursor),
      hasMore: cursor?.hasMore === true,
    }
  },

  async pollMessages(
    projectId: string,
    afterEventId: number,
  ): Promise<{
    lastEventId: number
    messages: ProjectEventMessage[]
  }> {
    const historyCursor = chatHistoryCursorByProject.get(projectId)
    const effectiveAfterEventId =
      afterEventId === 0 ? (historyCursor?.latestEventId ?? 0) : afterEventId
    let eventResult: BeeGameProjectEvents
    try {
      eventResult = await fetchProjectEvents(projectId, effectiveAfterEventId)
    } catch (error) {
      if (isSessionNotFoundError(error)) {
        return { lastEventId: effectiveAfterEventId, messages: [] }
      }
      throw error
    }
    const events = eventResult.events
    const lastEventId =
      events.length > 0 ? events[events.length - 1].id : effectiveAfterEventId
    const normalizedEvents = normalizeLiveEvents(projectId, events)
    const isInitialHistorySync = effectiveAfterEventId === 0
    return {
      lastEventId,
      messages: normalizedEvents
        .flatMap(event =>
          eventToProjectEventMessages(
            projectId,
            event,
            eventResult.workspacePath,
          ),
        )
        // Chat history already renders persisted terminal failures. Replaying
        // them through the live channel would invoke onError again on every
        // dashboard mount and make a historical failure look current.
        .filter(message => !(isInitialHistorySync && message.type === 'error')),
    }
  },

  async streamMessages(
    projectId: string,
    afterEventId: number,
    callbacks: BeeGameEventStreamCallbacks,
    signal: AbortSignal,
  ): Promise<number> {
    const historyCursor = chatHistoryCursorByProject.get(projectId)
    const effectiveAfterEventId =
      afterEventId === 0 ? (historyCursor?.latestEventId ?? 0) : afterEventId
    const response = await authenticatedFetch(
      `/api/projects/${encodeURIComponent(projectId)}/events/stream?after=${encodeURIComponent(String(effectiveAfterEventId))}`,
      {
        headers: {
          accept: 'text/event-stream',
          'last-event-id': String(effectiveAfterEventId),
        },
        signal,
      },
    )
    if (!response.ok) {
      // Use the same error envelope as polling: keep auth outage and retry
      // metadata instead of reducing every SSE failure to a generic error.
      await readResponse(response)
    }
    if (!response.body) throw new Error('BeeGame event stream has no response body')
    callbacks.onOpen?.()

    let lastEventId = effectiveAfterEventId
    const isInitialHistorySync = effectiveAfterEventId === 0
    await readProjectEventStream(response.body, frame => {
      if (!frame.data) return
      const payload = JSON.parse(frame.data) as Partial<BeeGameProjectEvents> & { lastEventId?: number }
      const events = Array.isArray(payload.events)
        ? (payload.events as BeeGameEvent[]).filter(event => event.id > lastEventId)
        : []
      if (events.length === 0) return
      const eventId = typeof payload.lastEventId === 'number'
        ? payload.lastEventId
        : frame.id ?? events[events.length - 1]?.id ?? lastEventId
      normalizeLiveEvents(projectId, events)
        .flatMap(event => eventToProjectEventMessages(projectId, event, payload.workspacePath || ''))
        .filter(message => !(isInitialHistorySync && message.type === 'error'))
        .forEach(message => callbacks.onMessage(message))
      lastEventId = Math.max(lastEventId, eventId)
      callbacks.onCursor?.(lastEventId)
    }, signal)
    return lastEventId
  },

  async getProjectStatus(
    projectId: string,
  ): Promise<ProjectBaselineStatusPayload> {
    return fetchProjectRuntimeState(projectId)
  },

  async getProjectRuntimeState(
    projectId: string,
  ): Promise<ProjectRuntimeStatePayload> {
    const runtimeState = await fetchProjectRuntimeState(projectId)
    const pendingPermissions = Array.isArray(runtimeState.pending_permissions)
      ? runtimeState.pending_permissions
      : []
    return {
      status: runtimeState,
      pendingPermissions: pendingPermissions.map(permission =>
        pendingPermissionToReview(projectId, permission),
      ),
    }
  },

  async getPendingToolPermissions(
    projectId: string,
  ): Promise<{ items: PendingToolPermissionItem[] }> {
    const runtimeState = await fetchProjectRuntimeState(projectId)
    const pendingPermissions = Array.isArray(runtimeState.pending_permissions)
      ? runtimeState.pending_permissions
      : []
    return {
      items: pendingPermissions.map(permission =>
        pendingPermissionToReview(projectId, permission),
      ),
    }
  },

  async resolveToolPermission(data: {
    project_id: string
    gate_id: string
    decision: 'allow' | 'deny'
    message?: string
    scope?: 'once' | 'session'
    answers?: Record<string, string>
    intent?: 'change'
  }): Promise<{ ok: boolean }> {
    const result = await postJson<{ resolved?: boolean }>(
      `/api/projects/${encodeURIComponent(data.project_id)}/permissions/${encodeURIComponent(data.gate_id)}`,
      {
        decision: data.decision,
        remember: false,
        scope: data.scope ?? 'once',
        ...(data.answers ? { answers: data.answers } : {}),
        ...(data.intent ? { intent: data.intent } : {}),
        ...(data.message ? { message: data.message } : {}),
      },
    )
    if (result.resolved === false) throw Object.assign(
      new Error('This request is no longer pending. Refresh the conversation.'),
      { code: 'permission_not_pending' },
    )
    return { ok: true }
  },

  async getArtifacts(projectId: string): Promise<BeeGameArtifact[]> {
    const artifactIndex = await fetchProjectArtifactIndex(projectId)

    let eventResult: BeeGameProjectEvents | undefined
    if (artifactIndex.sessionId) {
      try {
        eventResult = await fetchProjectEvents(projectId)
      } catch (error) {
        if (!isSessionNotFoundError(error)) throw error
      }
    }

    const workspacePath = artifactIndex.workspacePath || eventResult?.workspacePath
    if (!workspacePath) return []
    const binding = {
      projectId,
      workspacePath,
      ...(artifactIndex.sessionId || eventResult?.sessionId
        ? { sessionId: artifactIndex.sessionId || eventResult?.sessionId }
        : {}),
    }
    return [
      ...mergeArtifactsByPath([
        ...artifactIndex.artifacts
          .filter(artifact => !isInternalRuntimeArtifact(artifact))
          .map(artifact =>
            discoveredArtifactToPanelArtifact(binding, artifact),
          ),
        ...(eventResult
          ? extractArtifacts(projectId, eventResult.events, eventResult.workspacePath)
          : []),
      ]),
      {
        artifact_id: encodeProjectPackageArtifactId(projectId),
        id: encodeProjectPackageArtifactId(projectId),
        name: `${workspacePath.split('/').filter(Boolean).at(-1) || 'project'}.zip`,
        artifact_type: 'Project Package',
        status: 'active',
        created_by: 'beegame',
        created_at: new Date().toISOString(),
        package_download: true,
      },
    ]
  },

  async getArtifactContent(artifactId: string): Promise<string> {
    const artifactRef = decodeArtifactId(artifactId)
    if (!artifactRef) throw new Error('Invalid BeeGame artifact id')
    const result = await fetchProjectArtifactContent(
      artifactRef.projectId,
      artifactRef.path,
    )
    return result.content
  },

  async downloadProjectPackage(
    projectId: string,
  ): Promise<{ blob: Blob; filename: string }> {
    const response = await fetchProjectPackage(projectId)
    if (!response.ok) {
      throw new Error(await getResponseErrorMessage(response))
    }
    const disposition = response.headers.get('content-disposition') || ''
    const filename =
      disposition.match(/filename="([^"]+)"/)?.[1] || 'project.zip'
    return { blob: await response.blob(), filename }
  },

  async getProjectPreview(projectId: string): Promise<BeeGamePreviewPayload> {
    return getJson(`/api/projects/${encodeURIComponent(projectId)}/preview`)
  },

  async startProjectPreview(projectId: string): Promise<BeeGamePreviewPayload> {
    try {
      return await postJson(
        `/api/projects/${encodeURIComponent(projectId)}/preview`,
        {},
      )
    } finally {
      invalidateProjectRuntimeState(projectId)
    }
  },

  async restartProjectPreview(
    projectId: string,
  ): Promise<BeeGamePreviewPayload> {
    try {
      return await postJson(
        `/api/projects/${encodeURIComponent(projectId)}/preview/restart`,
        {},
      )
    } finally {
      invalidateProjectRuntimeState(projectId)
    }
  },

  async stopProjectPreview(projectId: string): Promise<BeeGamePreviewPayload> {
    try {
      return await deleteJson<BeeGamePreviewPayload>(
        `/api/projects/${encodeURIComponent(projectId)}/preview`,
      )
    } finally {
      invalidateProjectRuntimeState(projectId)
    }
  },

  async deployProject(projectId: string, confirmation?: import('./api').BeeGameDeploymentDiscussionConfirmation): Promise<BeeGameDeploymentPayload> {
    return postJson(
      `/api/projects/${encodeURIComponent(projectId)}/deployments`,
      confirmation ?? {},
    )
  },

  async getDeploymentReadiness(projectId: string): Promise<import('./api').BeeGameDeploymentReadiness> {
    return getJson(`/api/projects/${encodeURIComponent(projectId)}/deployment-readiness`)
  },

  async listProjectDeployments(
    projectId: string,
  ): Promise<BeeGameDeploymentPayload[]> {
    return getJson<BeeGameDeploymentPayload[]>(
      `/api/projects/${encodeURIComponent(projectId)}/deployments`,
    )
  },

  async rollbackProjectDeployment(
    projectId: string,
    deploymentId: string,
  ): Promise<BeeGameDeploymentPayload> {
    return postJson<BeeGameDeploymentPayload>(
      `/api/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}/rollback`,
      {},
    )
  },

  async getProjectAssets(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<BeeGameAssetManifestPayload> {
    return getJson<BeeGameAssetManifestPayload>(
      `/api/projects/${encodeURIComponent(projectId)}/assets`,
      { signal },
    )
  },

  async getProjectGameContent(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<BeeGameGameContentSnapshot> {
    return getJson<BeeGameGameContentSnapshot>(
      `/api/projects/${encodeURIComponent(projectId)}/game-content`,
      { signal },
    )
  },

  async getProjectGameContentFileList(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<BeeGameContentFileListSnapshot> {
    const snapshot = await getJson<BeeGameContentFileListSnapshot | BeeGameGameContentSnapshot>(
      `/api/projects/${encodeURIComponent(projectId)}/game-content?metadata=1`,
      { signal },
    )
    return normalizeBeeGameContentFileList(snapshot)
  },

  async loadProjectAssetFile(
    projectId: string,
    resourceId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<Blob> {
    const query = new URLSearchParams({ path })
    const response = await authenticatedFetch(
      `/api/projects/${encodeURIComponent(projectId)}/assets/resources/${encodeURIComponent(resourceId)}/file?${query.toString()}`,
      { signal },
    )
    if (!response.ok) await readResponse<never>(response)
    return response.blob()
  },

  async saveProjectGameContentDocument<Document extends BeeGameEditableContentDocument>(
    projectId: string,
    input: {
      path: string
      expectedRevision: string
      document: Document
    },
  ): Promise<BeeGameContentDocumentSaveResult<Document>> {
    return putJson<BeeGameContentDocumentSaveResult<Document>>(
      `/api/projects/${encodeURIComponent(projectId)}/game-content/document`,
      input,
    )
  },

  async uploadProjectAsset(
    projectId: string,
    resourceId: string,
    file: File | readonly File[],
  ): Promise<BeeGameAssetUploadPayload> {
    const form = new FormData()
    for (const item of Array.isArray(file) ? file : [file as File]) form.append('file', item)
    return postForm<BeeGameAssetUploadPayload>(
      `/api/projects/${encodeURIComponent(projectId)}/assets/resources/${encodeURIComponent(resourceId)}/upload`,
      form,
    )
  },

  async getResourcePackImpact(
    packId: string,
  ): Promise<BeeGameResourcePackImpactPayload> {
    return getJson<BeeGameResourcePackImpactPayload>(
      `/api/resource-packs/${encodeURIComponent(packId)}/impact`,
    )
  },
}

function createLocalProject(
  name: string,
  rootPath?: string,
  id = newProjectId(),
): Project {
  return {
    id,
    name: name.trim() || 'BeeGame Project',
    ...(rootPath ? { root_path: rootPath } : {}),
    created_at: Date.now(),
  }
}

function getLatestBeeGameEventId(events: BeeGameEvent[]): number {
  return events.reduce((latest, event) => Math.max(latest, event.id), 0)
}

function getBriefDisplayTitle(brief: BeeGameBuildBrief): string {
  return (
    (brief.title || brief.option.title || summarizeTitle(brief.idea)).trim() ||
    'BeeGame Project'
  )
}

function getBriefFolderName(
  brief: BeeGameBuildBrief,
  displayTitle: string,
): string {
  const candidates = [
    brief.option.projectFolderName,
    brief.option.title,
    displayTitle,
    brief.option.id,
  ]
  for (const candidate of candidates) {
    const folderName = slugifyPathSegment(candidate || '', '')
    if (folderName) return folderName
  }
  return stableProjectFolderName(displayTitle || brief.idea)
}

function summarizeTitle(idea: string): string {
  const normalized = idea.replace(/\s+/g, ' ').trim()
  return normalized.length > 42
    ? `${normalized.slice(0, 42)}...`
    : normalized || 'BeeGame Project'
}

function newProjectId(): string {
  return `project_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function deleteProjectMetadata(projectId: string): Promise<void> {
  try {
    await deleteJson(`/api/projects/${encodeURIComponent(projectId)}`)
  } catch (error) {
    if (isDeleteAlreadyGoneError(error)) return
    throw error
  }
}

function scopedAdapterCacheKey(baseKey: string): string {
  const userId = getSupabaseSessionUser()?.id?.trim()
  if (!userId) return baseKey
  return `${baseKey}:${encodeURIComponent(userId)}`
}

async function ensureProjectSession(
  projectId: string,
): Promise<BeeGameSessionHandle> {
  const response = await postJson<{
    session: BeeGameSession
    binding?: ProjectSessionBinding
    previousSessionId?: string
  }>(`/api/projects/${encodeURIComponent(projectId)}/session/ensure`, {
    language: getCurrentUiLanguage(),
  })
  const binding = response.binding ?? {
    projectId,
    sessionId: response.session.id,
    workspacePath: response.session.cwd,
    language: getCurrentUiLanguage(),
  }
  return {
    session: response.session,
    binding,
    recoveredEvents: [],
    ...(response.previousSessionId
      ? { previousSessionId: response.previousSessionId }
      : {}),
  }
}

function isSessionNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message === 'session not found' || message === 'not found'
}

function isDeleteAlreadyGoneError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message === 'session not found' ||
    message === 'not found' ||
    message.includes('enoent: no such file or directory')
  )
}

async function resolveDefaultWorkspacePath(): Promise<string> {
  let fallback: { path: string }
  try {
    fallback = await getJson<{ path: string }>(
      '/api/filesystem/default-workspace',
    )
  } catch (error) {
    throw new Error(
      `无法获取默认 Workspace path，请重启 agent-workflow-server 后端服务。${error instanceof Error ? ` (${error.message})` : ''}`,
    )
  }
  if (!isAbsolutePath(fallback.path || '')) {
    throw new Error('后端没有返回可用的默认 Workspace path')
  }
  return fallback.path
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

function slugifyPathSegment(value: string, fallback = 'game-project'): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return normalized || fallback
}

function stableProjectFolderName(value: string): string {
  return `game-project-${stableTextHash(value || 'BeeGame Project')}`
}

function fetchProjectPackage(projectId: string): Promise<Response> {
  return authenticatedFetch(
    `/api/projects/${encodeURIComponent(projectId)}/package`,
  )
}

function fetchProjectArtifactIndex(
  projectId: string,
): Promise<BeeGameProjectArtifactIndex> {
  return getJson(
    `/api/projects/${encodeURIComponent(projectId)}/artifact-index`,
  )
}

function fetchProjectArtifactContent(
  projectId: string,
  path: string,
): Promise<{ path: string; content: string }> {
  return getJson(
    `/api/projects/${encodeURIComponent(projectId)}/artifacts?path=${encodeURIComponent(path)}`,
  )
}

async function getResponseErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const body = await response.json().catch(() => ({}))
    const message = getJsonErrorMessage(body)
    if (message) return message
  } else {
    const text = (await response.text().catch(() => '')).trim()
    if (text)
      return `Request failed with status ${response.status}: ${text.slice(0, 180)}`
  }
  return `Request failed with status ${response.status}`
}

function fetchProjectEvents(
  projectId: string,
  after = 0,
): Promise<BeeGameProjectEvents> {
  return getJson(
    `/api/projects/${encodeURIComponent(projectId)}/events?after=${encodeURIComponent(String(after))}`,
  )
}

type ProjectEventStreamFrame = {
  id?: number
  data: string
}

async function readProjectEventStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: ProjectEventStreamFrame) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })

  const flush = (rawFrame: string) => {
    let id: number | undefined
    const data: string[] = []
    for (const rawLine of rawFrame.split(/\r?\n/)) {
      if (rawLine.startsWith(':')) continue
      if (rawLine.startsWith('id:')) {
        const parsed = Number(rawLine.slice(3).trim())
        if (Number.isFinite(parsed) && parsed >= 0) id = parsed
      } else if (rawLine.startsWith('data:')) {
        data.push(rawLine.slice(5).trimStart())
      }
    }
    if (data.length > 0) onFrame({ id, data: data.join('\n') })
  }

  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { reject(new Error('Chat stream heartbeat timed out')); cancel() }, 20_000)
        }),
      ]).finally(() => clearTimeout(timer))
      if (signal?.aborted) break
      if (result.done) break
      buffer += decoder.decode(result.value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() || ''
      frames.forEach(flush)
    }
    buffer += decoder.decode()
    if (buffer.trim()) flush(buffer)
  } finally {
    signal?.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}

async function fetchProjectTranscriptPage(
  projectId: string,
  beforeId?: number,
  limit = CHAT_HISTORY_PAGE_SIZE,
): Promise<BeeGameProjectTranscriptPage> {
  const params = new URLSearchParams({
    limit: String(limit),
  })
  if (beforeId !== undefined) params.set('before', String(beforeId))
  return getJson(
    `/api/projects/${encodeURIComponent(projectId)}/transcript?${params.toString()}`,
  )
}

async function fetchProjectTranscriptPageIfAvailable(
  projectId: string,
): Promise<BeeGameProjectTranscriptPage | undefined> {
  try {
    return await fetchProjectTranscriptPage(
      projectId,
      undefined,
      CHAT_INITIAL_HISTORY_PAGE_SIZE,
    )
  } catch {
    return undefined
  }
}

function eventsToHistory(
  projectId: string,
  events: BeeGameEvent[],
  workspacePath = '',
  subagentTools?: Map<string, SubagentToolOwner>,
): unknown[] {
  const normalizedEvents = normalizeDisplayEvents(events, subagentTools, projectId)
  const turnCompletedAt = new Map<string, number>()
  for (const event of normalizedEvents) {
    if (event.type !== 'turn.completed' || !event.turnId) continue
    const timestamp = Date.parse(event.createdAt)
    if (Number.isFinite(timestamp)) turnCompletedAt.set(event.turnId, timestamp)
  }
  const projectedMessages = normalizedEvents.flatMap(event =>
    eventToProjectEventMessages(projectId, event, workspacePath),
  )
  return projectHistoryMessages(projectedMessages, turnCompletedAt)
}

/** Adapter entry point used by dev/test transcript fixtures. */
export function transcriptEventsToHistory(
  projectId: string,
  events: unknown[],
  workspacePath = '',
): unknown[] {
  return eventsToHistory(projectId, events as BeeGameEvent[], workspacePath)
}

function eventToProjectEventMessages(
  projectId: string,
  event: BeeGameEvent,
  workspacePath = '',
): ProjectEventMessage[] {
  const userDisplayText = event.type === 'user.message' && getPayloadString(event, 'displayKind') !== 'delivery_continue'
    ? resolveUserMessageDisplayText(event) : event.text
  return projectEventMessages(projectId, event, workspacePath, userDisplayText)
}

function normalizeDisplayEvents(events: BeeGameEvent[], subagentTools?: Map<string, SubagentToolOwner>, projectId?: string): BeeGameEvent[] {
  return normalizeBeeGameEvents(events, {
    includeUserMessages: true,
    includePartialsWhenFinalExists: false,
    subagentTools,
    projectId,
  })
}

function normalizeBeeGameEvents(
  events: BeeGameEvent[],
  options: {
    includeUserMessages: boolean
    includePartialsWhenFinalExists: boolean
    subagentTools?: Map<string, SubagentToolOwner>
    projectId?: string
  },
): BeeGameEvent[] {
  // A replacement turn keeps the immutable audit stream, but only the live
  // branch belongs in Chat. Do this before grouping thoughts/tools by turn.
  const liveEvents: BeeGameEvent[] = []
  for (const event of events) {
    if (event.type === 'user.message') {
      const target = getPayloadString(event, 'supersedesMessageId') || getPayloadString(event, 'supersedes_message_id')
      if (target) {
        const index = liveEvents.findIndex(candidate => candidate.type === 'user.message' &&
          (getPayloadString(candidate, 'clientMessageId') === target || `beegame-event-${candidate.id}` === target))
        if (index >= 0) {
          const currentTurnStart = [...liveEvents].reverse().find(candidate => candidate.type === 'turn.started' && candidate.turnId === event.turnId)
          const targetTurnId = liveEvents[index]?.turnId
          const start = targetTurnId
            ? liveEvents.findIndex(candidate => candidate.type === 'turn.started' && candidate.turnId === targetTurnId)
            : index
          liveEvents.splice(start >= 0 ? start : index)
          if (currentTurnStart) liveEvents.push(currentTurnStart)
        }
      }
    }
    liveEvents.push(event)
  }
  events = liveEvents
  // Earlier persisted transcripts have a native TaskOutput result but no
  // terminal task_notification. Reconcile only the SDK's structured task ID;
  // never infer task completion from free-form terminal output.
  const startedTasks = new Map<string, { toolUseID: string; toolName: 'Agent' | 'Task'; input: Record<string, unknown> }>()
  events = events.map(event => {
    if (event.type === 'system.status' && getPayloadString(event, 'subtype') === 'task_started') {
      const taskId = getPayloadString(event, 'task_id')
      const toolUseID = getPayloadString(event, 'toolUseID') || getPayloadString(event, 'tool_use_id')
      if (taskId && toolUseID) startedTasks.set(taskId, {
        toolUseID, toolName: getPayloadString(event, 'task_type') === 'local_bash' ? 'Task' : 'Agent',
        input: getPayloadRecord(event, 'input'),
      })
      return event
    }
    if (event.type === 'system.status' &&
        ['task_progress', 'task_notification'].includes(getPayloadString(event, 'subtype'))) {
      const task = startedTasks.get(getPayloadString(event, 'task_id'))
      if (task && event.payload) return { ...event, payload: { ...event.payload,
        toolUseID: task.toolUseID,
        ...(task.toolName === 'Task' ? { task_type: 'local_bash' } : {}),
      } }
      return event
    }
    if (event.type !== 'tool.completed' || getPayloadString(event, 'toolName') !== 'TaskOutput' ||
        event.payload?.nativeBackgroundTaskResult) return event
    const result = getPayloadRecord(event, 'nativeTaskResult')
    const task = startedTasks.get(typeof result.taskId === 'string' ? result.taskId : '')
    if (!task || !event.payload || !['completed', 'failed', 'stopped', 'killed'].includes(String(result.status))) return event
    return { ...event, payload: { ...event.payload, nativeBackgroundTaskResult: {
      toolUseID: task.toolUseID, toolName: task.toolName, status: result.status,
      ...(typeof result.result === 'string' ? { result: result.result } : {}),
    }, backgroundAgentInput: task.input } }
  })
  events = coalesceLogicalAssistantMessages(events)
  const visible: BeeGameEvent[] = []
  const terminalEventByTurn = new Map<string, number>()
  const stoppedEventByTurn = new Map<string, number>()
  for (const event of events) {
    if (!event.turnId || !isTurnTerminalEvent(event)) continue
    const existing = terminalEventByTurn.get(event.turnId)
    if (existing === undefined || event.id < existing)
      terminalEventByTurn.set(event.turnId, event.id)
    if (event.type === 'session.stopped' || event.type === 'session.failed')
      stoppedEventByTurn.set(event.turnId, event.id)
  }
  const seenUserMessages = new Set<string>()
  const turnsWithFinal = new Set(
    events
      .filter(event => event.type === 'assistant.message')
      .map(getBeeGameAssistantMessageId),
  )
  let bufferedPartial: BeeGameEvent | null = null
  let bufferedThinking: BeeGameEvent | null = null
  // Older transcripts predate server-side thinkingStartedAt. While reading a
  // complete history we can still recover the duration from the first event of
  // the same visible block. Live events receive this timestamp from the server.
  const thinkingStartedAtByBlock = new Map<string, string>()
  const flushPartial = () => {
    if (bufferedPartial) {
      visible.push(bufferedPartial)
      bufferedPartial = null
    }
  }
  const flushThinking = () => {
    if (bufferedThinking) {
      visible.push(bufferedThinking)
      bufferedThinking = null
    }
  }
  for (const event of events) {
    const stoppedAt = event.turnId ? stoppedEventByTurn.get(event.turnId) : undefined
    if (stoppedAt !== undefined && event.id > stoppedAt && event.type === 'system.status' &&
        ['task_started', 'task_progress'].includes(getPayloadString(event, 'subtype'))) continue
    if (isLateRuntimeEvent(event, terminalEventByTurn)) continue
    if (event.type !== 'assistant.partial') {
      flushPartial()
    }
    if (event.type !== 'assistant.thinking') {
      flushThinking()
    }
    if (event.type === 'user.message') {
      if (!options.includeUserMessages) continue
      if (getPayloadString(event, 'displayKind') === 'delivery_continue') continue
      const identity = getPayloadString(event, 'clientMessageId') || getPayloadString(event, 'client_message_id') ||
        `${event.sessionId}:${event.turnId || ''}:${event.id}`
      if (seenUserMessages.has(identity)) continue
      seenUserMessages.add(identity)
      visible.push(event)
      continue
    }
    if (
      event.type === 'system.status' &&
      event.text.trim().toLowerCase() === 'system' &&
      !['task_started', 'task_progress', 'task_notification', 'compact_boundary', 'delivery_phase'].includes(getPayloadString(event, 'subtype')) &&
      !(getPayloadString(event, 'subtype') === 'status' && getPayloadString(event, 'status') === 'compacting')
    ) {
      continue
    }
    if (event.type === 'result' && !getUsageFromEventPayload(event.payload)) {
      continue
    }
    if (event.type === 'assistant.partial') {
      if (
        !options.includePartialsWhenFinalExists &&
        turnsWithFinal.has(getBeeGameAssistantMessageId(event))
      ) {
        continue
      }
      if (
        bufferedPartial &&
        getBeeGameAssistantMessageId(bufferedPartial) === getBeeGameAssistantMessageId(event)
      ) {
        bufferedPartial = Object.assign({}, bufferedPartial, {
          id: event.id,
          payload: { ...event.payload, sourceSequence: bufferedPartial.payload?.sourceSequence ?? bufferedPartial.id,
            contentMode: getPayloadString(bufferedPartial, 'contentMode') === 'snapshot' || getPayloadString(event, 'contentMode') === 'snapshot' ? 'snapshot' : 'delta' },
          text: getPayloadString(event, 'contentMode') === 'snapshot' ? event.text : `${bufferedPartial.text}${event.text}`,
          createdAt: event.createdAt,
        })
      } else {
        flushPartial()
        bufferedPartial = event
      }
      continue
    }
    if (event.type === 'assistant.thinking') {
      // Thinking is durable Chat content, unlike a transient response partial.
      // Keep every delta: eventsToHistory groups them by turn and joins their
      // text, while the live store performs the equivalent incremental join.
      // Dropping these merely because a final answer exists made all persisted
      // thinking disappear on refresh.
      const thinkingBlock = getThinkingDisplayId(event)
      const status = getPayloadString(event, 'status')
      if (status === 'ended') {
        const thinkingStartedAt =
          getPayloadString(event, 'thinkingStartedAt') ||
          thinkingStartedAtByBlock.get(thinkingBlock)
        thinkingStartedAtByBlock.delete(thinkingBlock)
        flushThinking()
        visible.push(thinkingStartedAt
          ? {
              ...event,
              payload: {
                ...(event.payload ?? { type: 'assistant.thinking' }),
                thinkingStartedAt,
              },
            }
          : event)
        continue
      }
      const thinkingStartedAt =
        getPayloadString(event, 'thinkingStartedAt') ||
        thinkingStartedAtByBlock.get(thinkingBlock) ||
        event.createdAt
      thinkingStartedAtByBlock.set(thinkingBlock, thinkingStartedAt)
      if (
        bufferedThinking &&
        getThinkingDisplayId(bufferedThinking) === getThinkingDisplayId(event)
      ) {
        const previous: string = bufferedThinking.text === 'Thinking' ? '' : bufferedThinking.text
        const next: string = event.text === 'Thinking' ? '' : event.text
        bufferedThinking = {
          ...event,
          text: (getPayloadString(event, 'contentMode') === 'snapshot' ? next : previous + next) || 'Thinking',
          payload: {
            ...(event.payload ?? { type: 'assistant.thinking' }),
            sourceSequence: bufferedThinking.payload?.sourceSequence ?? bufferedThinking.id,
            thinkingStartedAt:
              getPayloadString(bufferedThinking, 'thinkingStartedAt') ||
              thinkingStartedAt,
          },
        }
      } else {
        flushThinking()
        bufferedThinking = {
          ...event,
          payload: {
            ...(event.payload ?? { type: 'assistant.thinking' }),
            thinkingStartedAt,
          },
        }
      }
      continue
    }
    visible.push(event)
  }
  flushPartial()
  flushThinking()
  return routeSubagentToolEvents(visible, options.subagentTools, options.projectId)
}

/** Owned child activity updates its owner's detail, never a main-chat row.
 * Use the same projection for old transcripts, polling and separate SSE frames;
 * some foreground workers have no output-file activity snapshot to fall back on. */
function routeSubagentToolEvents(
  events: BeeGameEvent[],
  owners = new Map<string, SubagentToolOwner>(),
  projectId?: string,
): BeeGameEvent[] {
  const mergeActivity = (previous: SubagentActivitySnapshot, next?: SubagentActivitySnapshot) => mergeSubagentActivity(previous, next)!
  return events.flatMap<BeeGameEvent>(event => {
    let parent = getPayloadString(event, 'parentToolUseID') || getPayloadString(event, 'parent_tool_use_id')
    const sourceOwner = parent
    const toolName = getPayloadString(event, 'toolName') || getPayloadString(event, 'tool_name')
    const lifecycle = event.type === 'system.status' &&
      ['task_started', 'task_progress', 'task_notification'].includes(getPayloadString(event, 'subtype'))
    const toolEvent = ['tool.started', 'tool.progress', 'tool.completed', 'tool.failed'].includes(event.type)
    if (!parent) {
      const backgroundResult = getPayloadRecord(event, 'nativeBackgroundTaskResult')
      const completedOwner = toolName === 'TaskOutput' && typeof backgroundResult.toolUseID === 'string'
        ? backgroundResult.toolUseID : ''
      if (!lifecycle && !(toolEvent && (['Agent', 'Task'].includes(toolName) || completedOwner))) return [event]
      const id = completedOwner || getPayloadString(event, 'toolUseID') || getPayloadString(event, 'tool_use_id') || getPayloadString(event, 'task_id')
      if (!id) return [event]
      const key = `${event.sessionId}:${id}`
      const previous = owners.get(key)
      const activity = mergeActivity(previous?.activity ?? { entries: [], truncated: false }, readSubagentActivity(event.payload?.subagentActivity))
      const updated: BeeGameEvent = { ...event, payload: { ...event.payload, type: event.payload?.type ?? event.type,
        input: { ...getPayloadRecord(previous?.event ?? event, 'input'), ...getPayloadRecord(event, 'input') },
        ...(activity.entries.length ? { subagentActivity: activity } : {}),
      } }
      owners.set(key, { event: updated, activity })
      return [updated]
    }
    // Nested workers belong inside the root owner's drawer as well. Retain
    // their real invocation relation instead of creating a main-chat owner.
    if ((toolEvent || lifecycle) && ['Agent', 'Task'].includes(toolName)) {
      const childId = getPayloadString(event, 'toolUseID') || getPayloadString(event, 'tool_use_id')
      if (childId) owners.set(`${event.sessionId}:${childId}`, { event, activity: { entries: [], truncated: false } })
    }
    const ancestors = new Set<string>()
    while (parent && !ancestors.has(parent)) {
      ancestors.add(parent)
      const ancestor = owners.get(`${event.sessionId}:${parent}`)?.event
      const next = ancestor && (getPayloadString(ancestor, 'parentToolUseID') || getPayloadString(ancestor, 'parent_tool_use_id'))
      if (!next) break
      parent = next
    }
    const key = `${event.sessionId}:${parent}`
    const previous = owners.get(key)
    // Provider message IDs are only unique inside their original worker.
    // Scope both live messages and that worker's transcript snapshots equally.
    const scopedMessageId = (id: string, worker = sourceOwner) => worker && worker !== parent ? `${worker}:${id}` : id
    const input = getPayloadRecord(event, 'input')
    const id = getPayloadString(event, 'toolUseID') || getPayloadString(event, 'tool_use_id')
    const priorTool = previous?.activity.entries.find(item => item.id === id && item.kind === 'tool')
    const output = getPayloadString(event, 'output')
    const launchReceipt = event.type === 'tool.completed' && ['Agent', 'Task'].includes(toolName) &&
      (Boolean(event.payload?.nativeBackgroundTask) || (/^agentId:\s*\S+/m.test(output) && /^output_file:\s*\S+/m.test(output)))
    let entry: SubagentActivitySnapshot['entries'][number] | undefined
    if (toolEvent && id) entry = { id, kind: 'tool' as const,
      toolName: toolName || (priorTool?.kind === 'tool' ? priorTool.toolName : 'Tool'),
      ...(typeof input.file_path === 'string' ? { filePath: input.file_path } : {}),
      ...(typeof input.command === 'string' ? { command: input.command } : {}),
      ...(Object.keys(input).length ? { input: JSON.stringify(input, null, 2) } : {}),
      ...(!launchReceipt && typeof event.payload?.output === 'string' ? { output: event.payload.output } : {}),
      ...(getPayloadString(event, 'attachmentError') ? { attachmentError: getPayloadString(event, 'attachmentError') } : {}),
      ...(typeof event.payload?.elapsed_time_seconds === 'number' && Number.isFinite(event.payload.elapsed_time_seconds) && event.payload.elapsed_time_seconds >= 0
        ? { elapsedTimeSeconds: event.payload.elapsed_time_seconds } : {}),
      ...(Array.isArray(event.payload?.attachments) ? { attachments: normalizeChatAttachments(
        event.payload.attachments.map(item => item && typeof item === 'object' ? { ...item, projectId } : item)) } : {}),
      status: launchReceipt ? 'running' : event.type === 'tool.failed' ? 'failed' : event.type === 'tool.completed' ? 'completed' : 'running',
    }
    if (lifecycle && id) {
      const terminal = getPayloadString(event, 'subtype') === 'task_notification'
      const status = getPayloadString(event, 'status')
      entry = { id, kind: 'tool', toolName: toolName || 'Agent',
        status: terminal ? status === 'completed' ? 'completed' : ['stopped', 'killed'].includes(status) ? 'cancelled' : 'failed' : 'running',
        ...(terminal ? { output: getPayloadString(event, 'summary') || event.text } : {}),
      }
    }
    if (event.type === 'assistant.message' || event.type === 'assistant.partial') {
      const messageId = scopedMessageId(`message-${getAssistantPayloadMessageId(event) || getPayloadString(event, 'uuid') || getBeeGameAssistantMessageId(event)}`)
      const existing = previous?.activity.entries.find(item => item.id === messageId)
      const text = event.type === 'assistant.partial' && getPayloadString(event, 'contentMode') !== 'snapshot' && existing?.kind === 'message'
        ? existing.text + event.text : event.text
      entry = { id: messageId, kind: 'message', text }
    }
    if (event.type === 'assistant.thinking' && getPayloadString(event, 'status') !== 'ended' && event.text !== 'Thinking') {
      const thinkingId = `thinking-${getThinkingDisplayId(event)}`
      const existing = previous?.activity.entries.find(item => item.id === thinkingId)
      entry = { id: thinkingId, kind: 'message', text: getPayloadString(event, 'contentMode') !== 'snapshot' && existing?.kind === 'message'
        ? existing.text + event.text : event.text }
    }
    if (event.type === 'permission.requested' || event.type === 'permission.resolved') {
      const permissionId = `permission-${id || event.id}`
      const existing = previous?.activity.entries.find(item => item.id === permissionId)
      const decision = getPayloadString(event, 'decision')
      // Routine automatic allows already have a tool record; they did not ask
      // the user and must not look like a user-approved gate.
      if (!(event.payload?.autoApproved && !existing)) entry = { id: permissionId, kind: 'permission', toolName,
        message: getPayloadString(event, 'message') || (existing?.kind === 'permission' ? existing.message : event.text),
        status: event.type === 'permission.requested' ? 'pending' : decision === 'allow' ? 'allowed' : decision === 'cancelled' ? 'cancelled' : 'denied' }
    }
    if (event.type === 'system.status' && !lifecycle) {
      const subtype = getPayloadString(event, 'subtype')
      const compacting = subtype === 'status' && getPayloadString(event, 'status') === 'compacting'
      if (compacting || subtype === 'compact_boundary') {
        entry = { id: `compaction-${event.turnId || event.sessionId}-${sourceOwner}`, kind: 'message',
          text: compacting ? 'Context compacting' : 'Context compacted' }
      } else if (event.text && !['system', 'control_response'].includes(event.text)) {
        entry = { id: `status-${event.id}`, kind: 'message', text: event.text }
      }
    }
    const snapshot = readSubagentActivity(event.payload?.subagentActivity)
    const snapshotResult = getPayloadRecord(event, 'nativeBackgroundTaskResult')
    const snapshotOwner = (lifecycle || ['Agent', 'Task'].includes(toolName)) && id ? id
      : typeof snapshotResult.toolUseID === 'string' ? snapshotResult.toolUseID : sourceOwner
    const scopedSnapshot = snapshot && { ...snapshot, entries: snapshot.entries.map(item => item.kind === 'message'
      ? { ...item, id: scopedMessageId(item.id, snapshotOwner) } : item) }
    let activity = mergeActivity(previous?.activity ?? { entries: [], truncated: true }, scopedSnapshot)
    if (entry) activity = mergeActivity(activity, { entries: [entry], truncated: false })
    const taskResult = getPayloadRecord(event, 'nativeBackgroundTaskResult')
    if (typeof taskResult.toolUseID === 'string' && ['completed', 'failed', 'stopped', 'killed'].includes(String(taskResult.status))) {
      activity = mergeActivity(activity, { entries: [{ id: taskResult.toolUseID, kind: 'tool', toolName: 'Agent',
        status: taskResult.status === 'completed' ? 'completed' : taskResult.status === 'failed' ? 'failed' : 'cancelled',
        ...(typeof taskResult.result === 'string' ? { output: taskResult.result } : {}),
      }], truncated: false })
    }
    // History can start mid-worker. The known parent invocation ID still owns
    // the record; no separate execution or completion is invented here.
    const owner = previous?.event ?? { ...event, type: 'tool.progress', text: 'Agent',
      payload: { type: 'tool.progress', toolName: 'Agent', toolUseID: parent, input: {} } }
    const updated: BeeGameEvent = { ...owner, id: event.id, createdAt: event.createdAt,
      payload: { ...owner.payload, type: owner.payload?.type ?? owner.type, subagentActivity: activity } }
    owners.set(key, { event: updated, activity })
    // TodoWrite also feeds the task checklist. That non-visible projection
    // keeps its original owner scope; the feed already excludes it as a row.
    return toolName === 'TodoWrite' || event.type === 'permission.requested' ? [updated, event] : [updated]
  })
}

function coalesceLogicalAssistantMessages(
  events: BeeGameEvent[],
): BeeGameEvent[] {
  const representativeByMessage = new Map<
    string,
    {
      event: BeeGameEvent
      payloadText: string
      longestVisibleText: string
      contentBlocks: AssistantContentBlock[]
    }
  >()
  const suppressedEventIds = new Set<number>()

  for (const event of events) {
    if (event.type !== 'assistant.message') continue
    const messageId = getAssistantPayloadMessageId(event)
    if (!messageId) continue
    const identity = `${event.sessionId}:${event.turnId ?? ''}:${getPayloadString(event, 'parentToolUseID') || getPayloadString(event, 'parent_tool_use_id')}:${getPayloadString(event, 'assistantBlockId') || messageId}`
    const payloadText = getAssistantPayloadVisibleText(event)
    const existing = representativeByMessage.get(identity)
    if (!existing) {
      representativeByMessage.set(identity, {
        event,
        payloadText,
        longestVisibleText: event.text,
        contentBlocks: getAssistantContentBlocks(event) ?? [],
      })
      continue
    }
    existing.payloadText += payloadText
    if (event.text.length > existing.longestVisibleText.length) {
      existing.longestVisibleText = event.text
    }
    existing.contentBlocks = mergeAssistantContentBlocks(
      existing.contentBlocks,
      getAssistantContentBlocks(event) ?? [],
    )
    suppressedEventIds.add(event.id)
  }

  const replacementByEventId = new Map<number, BeeGameEvent>()
  for (const {
    event,
    payloadText,
    longestVisibleText,
    contentBlocks,
  } of representativeByMessage.values()) {
    const text =
      payloadText.length >= longestVisibleText.length
        ? payloadText
        : longestVisibleText
    const payload =
      contentBlocks.length > 0
        ? { ...(event.payload ?? { type: 'assistant.message' }), contentBlocks }
        : event.payload
    replacementByEventId.set(
      event.id,
      text === event.text && payload === event.payload
        ? event
        : { ...event, text, payload },
    )
  }

  return events.flatMap(event => {
    if (suppressedEventIds.has(event.id)) return []
    return [replacementByEventId.get(event.id) ?? event]
  })
}

function getAssistantPayloadVisibleText(event: BeeGameEvent): string {
  if (!event.payload) return ''
  const message = event.payload.message
  if (!message || typeof message !== 'object' || Array.isArray(message))
    return ''
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (!block || typeof block !== 'object' || Array.isArray(block)) return ''
      const record = block as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string'
        ? record.text
        : ''
    })
    .join('')
}

function mergeAssistantContentBlocks(
  existing: AssistantContentBlock[],
  incoming: AssistantContentBlock[],
): AssistantContentBlock[] {
  const merged = [...existing]
  for (const block of incoming) {
    const exactIndex = merged.findIndex(candidate =>
      assistantContentBlockKey(candidate) === assistantContentBlockKey(block),
    )
    if (exactIndex >= 0) continue

    const sameBlockIndex = merged.findIndex(candidate =>
      candidate.type === block.type &&
      candidate.toolUseId === block.toolUseId &&
      candidate.toolName === block.toolName &&
      typeof candidate.text === 'string' &&
      typeof block.text === 'string' &&
      (block.text.startsWith(candidate.text) || candidate.text.startsWith(block.text)),
    )
    if (sameBlockIndex >= 0 && (block.text?.length ?? 0) > (merged[sameBlockIndex].text?.length ?? 0)) {
      merged[sameBlockIndex] = block
      continue
    }
    merged.push(block)
  }
  return merged
}

function assistantContentBlockKey(block: AssistantContentBlock): string {
  return [
    block.type,
    block.toolUseId ?? '',
    block.toolName ?? '',
    block.text ?? '',
    JSON.stringify(block.toolInput ?? null),
    block.isError ? 'error' : '',
  ].join('\u0000')
}

function isTurnTerminalEvent(event: BeeGameEvent): boolean {
  return (
    event.type === 'turn.completed' ||
    event.type === 'turn.empty' ||
    event.type === 'turn.failed' ||
    event.type === 'session.stopped' ||
    event.type === 'session.failed'
  )
}

function isLateRuntimeEvent(
  event: BeeGameEvent,
  terminalEventByTurn: Map<string, number>,
): boolean {
  if (!event.turnId) return false
  const terminalId = terminalEventByTurn.get(event.turnId)
  if (terminalId === undefined || event.id <= terminalId) return false
  return (
    event.type === 'assistant.partial' ||
    event.type === 'assistant.thinking' ||
    event.type === 'assistant.message' ||
    event.type === 'tool.started' ||
    event.type === 'tool.progress' ||
    event.type === 'tool.completed' ||
    event.type === 'tool.failed' ||
    event.type === 'permission.requested' ||
    event.type === 'permission.resolved' ||
    event.type === 'result'
  )
}

function normalizeLiveEvents(
  projectId: string,
  events: BeeGameEvent[],
): BeeGameEvent[] {
  const stopped = stoppedTurnsByProject.get(projectId) ?? new Set<string>()
  stoppedTurnsByProject.set(projectId, stopped)
  const subagentTools = subagentToolsByProject.get(projectId) ?? new Map<string, SubagentToolOwner>()
  subagentToolsByProject.set(projectId, subagentTools)
  const visible = events.filter(event => {
    if (event.turnId && (event.type === 'session.stopped' || event.type === 'session.failed'))
      stopped.add(event.turnId)
    return !(event.turnId && stopped.has(event.turnId) && event.type === 'system.status' &&
      ['task_started', 'task_progress'].includes(getPayloadString(event, 'subtype')))
  })
  return normalizeBeeGameEvents(visible, {
    includeUserMessages: true,
    includePartialsWhenFinalExists: true,
    subagentTools,
    projectId,
  })
}

function normalizeIdeaIntakeResult(
  response: Partial<BeeGameIdeaIntakeResult> & {
    options?: BeeGameIntakeOption[]
  },
): BeeGameIdeaIntakeResult {
  const options = (response.options || []).map(option =>
    normalizeIntakeOption(option),
  )
  const maturity =
    response.maturity === 'directional' ||
    response.maturity === 'concrete' ||
    response.maturity === 'vague'
      ? response.maturity
      : 'vague'
  return {
    maturity,
    needsClarification: false,
    clarificationQuestions: [],
    detectedConstraints: Array.isArray(response.detectedConstraints)
      ? response.detectedConstraints.map(String).filter(Boolean)
      : [],
    recommendedNextStep:
      typeof response.recommendedNextStep === 'string' &&
      response.recommendedNextStep
        ? response.recommendedNextStep
        : 'choose_direction',
    options,
  }
}

function normalizeIntakeOption(
  option: BeeGameIntakeOption,
): BeeGameIntakeOption {
  const rawOption = option as BeeGameIntakeOption & {
    project_folder_name?: string
    recommended_platform?: string
    recommended_engine?: string
    recommended_dimension?: string
    recommended_genre?: string
    recommended_style?: string
    recommended_inputs?: unknown
  }
  const recommendedInputs = Array.isArray(option.recommendedInputs)
    ? option.recommendedInputs
    : Array.isArray(rawOption.recommended_inputs)
      ? rawOption.recommended_inputs.map(String).filter(Boolean)
      : []
  return {
    ...option,
    projectFolderName:
      option.projectFolderName || rawOption.project_folder_name || '',
    coreGameplayHypothesis:
      option.coreGameplayHypothesis || option.coreMechanic || option.gameplay,
    experienceSnapshot: option.experienceSnapshot || option.pitch,
    playerFirstMinute: option.playerFirstMinute || option.gameplay,
    whyFitsIdea: option.whyFitsIdea || option.fit || option.pitch,
    playablePrototype:
      option.playablePrototype ||
      option.firstBuild ||
      option.firstPlayableValidation ||
      option.gameplay,
    validationTarget:
      option.validationTarget ||
      option.validationGoal ||
      option.firstPlayableValidation ||
      option.gameplay,
    coreMechanic:
      option.coreMechanic || option.coreGameplayHypothesis || option.gameplay,
    firstBuild:
      option.firstBuild ||
      option.playablePrototype ||
      option.firstPlayableValidation ||
      option.gameplay,
    validationGoal:
      option.validationGoal ||
      option.validationTarget ||
      option.firstPlayableValidation ||
      option.gameplay,
    risk:
      option.risk ||
      option.riskComplexity ||
      '复杂度取决于最终范围，需要先控制第一版目标。',
    fit: option.fit || option.pitch,
    firstPlayableValidation: option.firstPlayableValidation || option.gameplay,
    riskComplexity:
      option.riskComplexity || '复杂度取决于最终范围，需要先控制第一版目标。',
    recommendedPlatform:
      option.recommendedPlatform || rawOption.recommended_platform || '',
    recommendedEngine:
      option.recommendedEngine || rawOption.recommended_engine || '',
    recommendedDimension:
      option.recommendedDimension || rawOption.recommended_dimension || '',
    recommendedGenre:
      option.recommendedGenre || rawOption.recommended_genre || '',
    recommendedStyle:
      option.recommendedStyle || rawOption.recommended_style || '',
    recommendedInputs,
  }
}

function normalizeBeeGameLanguage(
  language: string | undefined,
): BeeGameLanguage {
  const normalized = String(language || '').trim()
  if (normalized === 'zh-TW' || normalized === 'zh-HK') return 'zh-TW'
  if (normalized === 'zh' || normalized === 'zh-CN' || normalized === 'zh-Hans')
    return 'zh'
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja'
  if (normalized === 'ko' || normalized.startsWith('ko-')) return 'ko'
  if (normalized === 'fr' || normalized.startsWith('fr-')) return 'fr'
  if (normalized === 'de' || normalized.startsWith('de-')) return 'de'
  if (normalized === 'es' || normalized.startsWith('es-')) return 'es'
  if (normalized === 'it' || normalized.startsWith('it-')) return 'it'
  if (normalized === 'pt' || normalized.startsWith('pt-')) return 'pt'
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en'
  return 'zh'
}

function getCurrentUiLanguage(): BeeGameLanguage {
  const language = String(localStorage.getItem('i18nextLng') || 'zh').trim()
  return normalizeBeeGameLanguage(language)
}

function resolveSentDisplayText(
  sessionId: string,
  transportText: string,
): string {
  const values = readJson<Record<string, string>>(
    scopedAdapterCacheKey(SENT_DISPLAY_KEY),
    {},
  )
  return (
    values[`${sessionId}:${stableTextHash(transportText)}`] || transportText
  )
}

function resolveUserMessageDisplayText(event: BeeGameEvent): string {
  const displayText =
    typeof event.payload?.displayText === 'string'
      ? event.payload.displayText.trim()
      : ''
  const text = displayText || resolveSentDisplayText(event.sessionId, event.text)
  if (getPayloadString(event, 'displayKind') !== 'workflow_v3_goal') return text
  try {
    // Older initial turns saved the full internal prompt as displayText.
    // Their structured brief remains the authoritative source of the idea.
    const brief: unknown = JSON.parse(getPayloadString(event, 'confirmedBriefContext') || text)
    if (brief && typeof brief === 'object' && !Array.isArray(brief) &&
      'kind' in brief && brief.kind === 'confirmed_build_brief' &&
      'idea' in brief && typeof brief.idea === 'string' && brief.idea.trim()) {
      return brief.idea.trim()
    }
  } catch {
    // Older goal turns may contain prose rather than a serialized brief.
  }
  return text
}

function stableTextHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash >>> 0).toString(36)
}

function extractArtifacts(
  projectId: string,
  events: BeeGameEvent[],
  workspacePath: string,
): BeeGameArtifact[] {
  const artifacts = new Map<string, BeeGameArtifact>()
  for (const event of events) {
    if (event.type !== 'tool.started' && event.type !== 'tool.completed')
      continue
    const toolName = getPayloadString(event, 'toolName') || ''
    const input = getPayloadRecord(event, 'input')
    const path = toWorkspaceRelativePath(
      getArtifactPath(toolName, input),
      workspacePath,
    )
    if (!path) continue
    if (!isDeliverableDocPath(path)) continue
    const artifactId = encodeArtifactId(projectId, event.sessionId, path)
    artifacts.set(path, {
      artifact_id: artifactId,
      id: artifactId,
      name: path.split('/').filter(Boolean).at(-1) || path,
      artifact_type: toolName || 'File',
      path,
      status: 'active',
      created_by: 'beegame',
      created_at: event.createdAt,
    })
  }
  return [...artifacts.values()].sort((a, b) =>
    String(a.path || '').localeCompare(String(b.path || '')),
  )
}

function discoveredArtifactToPanelArtifact(
  binding: Pick<ProjectSessionBinding, 'projectId' | 'workspacePath'> & {
    sessionId?: string
  },
  artifact: BeeGameDiscoveredArtifact,
): BeeGameArtifact {
  const artifactId = encodeArtifactId(
    binding.projectId,
    binding.sessionId,
    artifact.path,
  )
  return {
    artifact_id: artifactId,
    id: artifactId,
    name:
      artifact.name ||
      artifact.path.split('/').filter(Boolean).at(-1) ||
      artifact.path,
    artifact_type: artifact.artifact_type || 'File',
    path: artifact.path,
    status: 'active',
    created_by: 'beegame',
    created_at: artifact.created_at || new Date().toISOString(),
  }
}

function isInternalRuntimeArtifact(
  artifact: BeeGameDiscoveredArtifact,
): boolean {
  const artifactType = String(artifact.artifact_type || '').toLowerCase()
  const normalizedPath = artifact.path
    .split('\\')
    .join('/')
    .replace(/^\.\/+/, '')
  return (
    artifactType === 'transcript' || normalizedPath.startsWith('transcripts/')
  )
}

function mergeArtifactsByPath(artifacts: BeeGameArtifact[]): BeeGameArtifact[] {
  const byPath = new Map<string, BeeGameArtifact>()
  for (const artifact of artifacts) {
    const path = String(artifact.path || artifact.name || artifact.id || '')
    if (!path) continue
    byPath.set(path, {
      ...(byPath.get(path) || {}),
      ...artifact,
    })
  }
  return [...byPath.values()].sort((a, b) =>
    String(a.path || '').localeCompare(String(b.path || '')),
  )
}

function isDeliverableDocPath(path: string): boolean {
  const normalized = path
    .split('\\')
    .join('/')
    .replace(/^\.\/+/, '')
  return normalized.startsWith('docs/') && /\.md$/i.test(normalized)
}

function encodeProjectPackageArtifactId(projectId: string): string {
  return `${PROJECT_PACKAGE_ARTIFACT_PREFIX}${encodeURIComponent(projectId)}`
}

export function isBeeGameProjectPackageArtifactId(artifactId: string): boolean {
  return artifactId.startsWith(PROJECT_PACKAGE_ARTIFACT_PREFIX)
}

function permissionEventToReview(
  event: BeeGameEvent,
  binding: ProjectSessionBinding,
): PendingToolPermissionItem {
  const toolUseID = getPayloadString(event, 'toolUseID')
  const toolName = getPayloadString(event, 'toolName') || 'BeeGame tool'
  const input =
    event.payload?.input && typeof event.payload.input === 'object'
      ? (event.payload.input as Record<string, unknown>)
      : {}
  const summary = summarizePermissionRequest(toolName, event.text, input)
  return {
    gate_id: toolUseID,
    task_id: binding.sessionId,
    type: 'BEEGAME_PERMISSION',
    title: summary.title,
    permission_tool_name: toolName,
    created_at: event.createdAt,
    artifact: {
      content: summary.description,
      input,
      designChangeAllowed: (event.payload?.workflowQuestion as {designChangeAllowed?: boolean} | undefined)?.designChangeAllowed === true,
    },
    summary: {
      block_reason: summary.blockReason,
      next_action: summary.nextAction,
    },
  }
}

function pendingPermissionToReview(
  projectId: string,
  permission: BeeGamePendingPermissionPayload,
): PendingToolPermissionItem {
  const sessionId = String(permission.session_id || projectId)
  const toolUseID = String(permission.id || permission.event_id || '')
  const toolName = String(permission.tool_name || 'BeeGame tool')
  const event: BeeGameEvent = {
    id: typeof permission.event_id === 'number' ? permission.event_id : 0,
    sessionId,
    type: 'permission.requested',
    text: String(permission.message || toolName),
    payload: {
      type: 'permission.requested',
      toolUseID,
      toolName,
      workflowQuestion: {designChangeAllowed:permission.design_change_allowed === true},
      input:
        permission.input &&
        typeof permission.input === 'object' &&
        !Array.isArray(permission.input)
          ? (permission.input as Record<string, unknown>)
          : {},
    },
    createdAt: String(permission.created_at || new Date().toISOString()),
  }
  return permissionEventToReview(event, {
    projectId,
    sessionId,
    workspacePath: '',
  })
}

function summarizePermissionRequest(
  toolName: string,
  message: string,
  input: Record<string, unknown>,
): {
  title: string
  description: string
  blockReason: string
  nextAction: string
} {
  const command = String(input.command || '').trim()
  const path = String(
    input.path || input.file_path || input.notebook_path || '',
  ).trim()
  const target = command || path
  return {
    title: `${toolName} permission`,
    description: target ? `${toolName}: ${target}` : message,
    blockReason: message,
    nextAction:
      'Allow to continue this BeeGame turn, or deny to ask BeeGame to choose another approach.',
  }
}

type BeeGameIntakeJobCreated = {
  jobId: string
  status: 'running'
}

type BeeGameIntakeJobPoll =
  | { status: 'running' }
  | {
      status: 'completed'
      result: Partial<BeeGameIdeaIntakeResult> & {
        options?: BeeGameIntakeOption[]
      }
    }
  | { status: 'failed'; error?: string }

const BEEGAME_INTAKE_JOB_POLL_INTERVAL_MS = 1500
const BEEGAME_INTAKE_JOB_MAX_POLLS = 240
const BEEGAME_INTAKE_JOB_MAX_RETRY_INTERVAL_MS = 10_000
const BEEGAME_INTAKE_JOB_RECOVERABLE_STATUSES = new Set([
  408, 429, 502, 503, 504,
])

function buildIdeaIntakeRequestBody(
  data: BeeGameIdeaIntakeRequest,
): BeeGameIdeaIntakeRequest {
  const language = normalizeBeeGameLanguage(
    data.language ?? getCurrentUiLanguage(),
  )
  return {
    idea: data.idea,
    language,
    clientRequestId: data.clientRequestId ?? createClientRequestId(),
    ...(data.attachments?.length ? { attachments: data.attachments } : {}),
  }
}

function createClientRequestId(): string {
  return typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function runIdeaIntakeJob(
  requestBody: BeeGameIdeaIntakeRequest,
): Promise<
  Partial<BeeGameIdeaIntakeResult> & { options?: BeeGameIntakeOption[] }
> {
  const createResponse = await authenticatedFetch('/api/beegame-intake/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  })
  const created = await readResponse<BeeGameIntakeJobCreated>(createResponse)
  let retryIntervalMs = BEEGAME_INTAKE_JOB_POLL_INTERVAL_MS
  const deadlineAt =
    Date.now() +
    BEEGAME_INTAKE_JOB_POLL_INTERVAL_MS * BEEGAME_INTAKE_JOB_MAX_POLLS
  for (let index = 0; index < BEEGAME_INTAKE_JOB_MAX_POLLS; index += 1) {
    if (Date.now() >= deadlineAt) break
    let response: Response
    try {
      response = await authenticatedFetch(
        `/api/beegame-intake/jobs/${encodeURIComponent(created.jobId)}`,
      )
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
      await sleep(
        Math.min(retryIntervalMs, Math.max(0, deadlineAt - Date.now())),
      )
      retryIntervalMs = Math.min(
        retryIntervalMs * 2,
        BEEGAME_INTAKE_JOB_MAX_RETRY_INTERVAL_MS,
      )
      continue
    }
    if (BEEGAME_INTAKE_JOB_RECOVERABLE_STATUSES.has(response.status)) {
      await sleep(
        Math.min(retryIntervalMs, Math.max(0, deadlineAt - Date.now())),
      )
      retryIntervalMs = Math.min(
        retryIntervalMs * 2,
        BEEGAME_INTAKE_JOB_MAX_RETRY_INTERVAL_MS,
      )
      continue
    }
    const poll = await readResponse<BeeGameIntakeJobPoll>(response)
    retryIntervalMs = BEEGAME_INTAKE_JOB_POLL_INTERVAL_MS
    if (poll.status === 'completed') return poll.result
    if (poll.status === 'failed')
      throw new Error(poll.error || 'BeeGame intake failed')
    await sleep(BEEGAME_INTAKE_JOB_POLL_INTERVAL_MS)
  }
  throw new Error('BeeGame intake timed out')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, init)
  return readResponse<T>(response)
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await authenticatedFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readResponse<T>(response)
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const response = await authenticatedFetch(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readResponse<T>(response)
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await authenticatedFetch(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readResponse<T>(response)
}

async function postForm<T>(path: string, body: FormData): Promise<T> {
  const response = await authenticatedFetch(path, {
    method: 'POST',
    body,
  })
  return readResponse<T>(response)
}

async function deleteJson<T = unknown>(path: string): Promise<T> {
  const response = await authenticatedFetch(path, { method: 'DELETE' })
  return readResponse<T>(response)
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const message = getJsonErrorMessage(body) || response.statusText
    const payload =
      body && typeof body === 'object'
        ? (body as {
            code?: unknown
            recoverable?: unknown
            retry_after_ms?: unknown
          })
        : {}
    const error = new Error(message) as Error & {
      status?: number
      code?: string
      recoverable?: boolean
      retryAfterMs?: number
    }
    error.status = response.status
    if (typeof payload.code === 'string') error.code = payload.code
    if (payload.recoverable === true) error.recoverable = true
    if (typeof payload.retry_after_ms === 'number') {
      error.retryAfterMs = payload.retry_after_ms
    }
    throw error
  }
  return response.json() as Promise<T>
}

function getJsonErrorMessage(body: unknown): string | null {
  const quotaMessage = projectQuotaErrorMessage(body)
  if (quotaMessage) return quotaMessage
  if (typeof body !== 'object' || body === null) return null
  const payload = body as { message?: unknown; error?: unknown; issues?: unknown; code?: unknown }
  if (payload.code === 'writer-unresolved') return '旧执行尚未确认停止或结算，不能直接继续。请先检查执行占用恢复状态。'
  if (payload.code === 'conversation-unavailable') return '缺少可校验的原生会话记录，不能直接继续；需要核实原会话或另行明确授权新的执行上下文，不会自动重跑。'
  if (Array.isArray(payload.issues) && payload.issues.some(issue => typeof issue === 'string')) {
    return [payload.message || payload.error, ...payload.issues].filter(value => typeof value === 'string' && value.trim()).join('\n')
  }
  if (typeof payload.message === 'string' && payload.message.trim())
    return payload.message
  if (typeof payload.error === 'string' && payload.error.trim())
    return payload.error
  return null
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
