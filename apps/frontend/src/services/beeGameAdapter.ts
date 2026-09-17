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
import type { AssistantContentBlock, ProjectEventMessage } from '../types/message'
import { authenticatedFetch } from './apiClient'
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

type BeeGameEvent = {
  id: number
  sessionId: string
  turnId?: string
  type:
    | 'session.started'
    | 'turn.started'
    | 'user.message'
    | 'assistant.message'
    | 'assistant.partial'
    | 'assistant.thinking'
    | 'tool.started'
    | 'tool.completed'
    | 'tool.failed'
    | 'tool.progress'
    | 'permission.requested'
    | 'permission.resolved'
    | 'system.status'
    | 'result'
    | 'turn.completed'
    | 'turn.empty'
    | 'turn.failed'
    | 'session.stopped'
    | 'session.failed'
  text: string
  payload?: { type: string; [key: string]: unknown }
  createdAt: string
}

type BeeGamePendingPermissionPayload = {
  id?: string
  session_id?: string
  event_id?: number
  tool_name?: string
  message?: string
  created_at?: string
  input?: unknown
}

type ProjectRuntimeStateWithPermissions = ProjectBaselineStatusPayload & {
  pending_permissions?: BeeGamePendingPermissionPayload[]
}

const projectRuntimeStateRequests = new Map<
  string,
  Promise<ProjectRuntimeStateWithPermissions>
>()

function fetchProjectRuntimeState(
  projectId: string,
): Promise<ProjectRuntimeStateWithPermissions> {
  const normalizedProjectId = String(projectId || '').trim()
  const existing = projectRuntimeStateRequests.get(normalizedProjectId)
  if (existing) return existing
  const request = getJson<ProjectRuntimeStateWithPermissions>(
    `/api/projects/${encodeURIComponent(normalizedProjectId)}/runtime-state`,
  ).finally(() => {
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
  latestTodoEvent?: BeeGameEvent
}

type BeeGameProjectArtifactIndex = {
  sessionId?: string
  workspacePath: string
  artifacts: BeeGameDiscoveredArtifact[]
}

const CHAT_HISTORY_PAGE_SIZE = 300
type ChatHistoryCursorState = BeeGameTranscriptPage['page'] & {
  latestEventId: number
}
const chatHistoryCursorByProject = new Map<string, ChatHistoryCursorState>()

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
  genre: string
  inputs: string[]
  scope: string
  notes?: string
  resourceLibraryUsage: 'optional' | 'preferred' | 'required'
}

export type BeeGameBuildBrief = {
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
const ARTIFACT_ID_PREFIX = 'beegame-artifact:'
const PROJECT_PACKAGE_ARTIFACT_PREFIX = 'beegame-project-package:'
const DISPLAY_MESSAGE_ID_KEY = '__displayMessageId'

export type BeeGameWorkspaceSettings = {
  workspacePath: string
  isDefault: boolean
}

export type BeeGameContentNode = {
  id: string
  parentId?: string
  name?: string
  kind: string
  enabled?: boolean
  transform?: {
    position: [number, number]
    rotation?: number
    scale?: [number, number]
  }
  layer?: string
  zIndex?: number
  assetRef?: string
  frameRef?: string
  components?: Array<{
    type: string
    assetRef?: string
    data?: Record<string, unknown>
  }>
  data?: Record<string, unknown>
}

export type BeeGameSceneContentDocument = {
  schema: 'beegame-content.v1'
  id: string
  kind: 'scene-2d'
  assetRefs: string[]
  data: { nodes: BeeGameContentNode[]; cameraNodeId?: string }
}

export type BeeGameUiContentNode = {
  id: string
  parentId?: string
  role: string
  name?: string
  text?: string
  assetRef?: string
  layout?: {
    anchor?: string
    position?: [number, number]
    size?: [number, number]
    rotation?: number
    scale?: [number, number]
  }
  bindings?: Record<string, string>
  actions?: Record<string, string>
  style?: Record<string, unknown>
  data?: Record<string, unknown>
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
  index?: {
    schema: 'beegame-content-package.v1'
    id: string
    dimension: '2d'
    documentRevision: string
    assetManifestRevision: string
    entryScene: string
    files: string[]
  }
  documents?: Array<{
    path: string
    revision: string
    document: BeeGameEditableContentDocument | Record<string, unknown>
  }>
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
    return { ok: true }
  },

  async createReviewCopy(projectId: string): Promise<{
    project: Project
    runId: string
    phase: string
  }> {
    return postJson(
      `/api/projects/${encodeURIComponent(projectId)}/review-copy`,
      {},
    )
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
    const language = getCurrentUiLanguage()
    await sendBeeGameInput(session.id, data.content, {
      clientMessageId: data.client_message_id,
      supersedesMessageId: data.supersedes_message_id,
      language,
      attachments: data.attachments,
    })
    return {
      command_id: session.id,
      task_id: session.id,
      state: 'running',
      trace_id: data.client_message_id || session.id,
    }
  },

  async continueTask(data: {
    project_id: string
    task_id?: string
  }): Promise<ContinueTaskResponse> {
    const handle = await ensureProjectSession(data.project_id)
    const { session } = handle
    const language = getCurrentUiLanguage()
    await postJson(
      `/api/beegame-sessions/${encodeURIComponent(session.id)}/continue`,
      {
        language,
      },
    )
    return {
      command_id: session.id,
      resume_task_id: session.id,
      resume_mode: 'resume',
      state: 'resuming',
      trace_id: session.id,
    }
  },

  async resumeWorkflow(projectId: string): Promise<Record<string, unknown>> {
    return postJson<Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(projectId)}/workflow/resume`,
      { language: getCurrentUiLanguage() },
    )
  },

  async retryWorkflow(projectId: string): Promise<Record<string, unknown>> {
    return postJson<Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(projectId)}/workflow/retry`,
      { language: getCurrentUiLanguage() },
    )
  },

  async stopWorkflow(projectId: string): Promise<Record<string, unknown>> {
    return postJson<Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(projectId)}/workflow/stop`,
      { reason: 'user stopped workflow' },
    )
  },

  async requestProjectAction(data: {
    project_id: string
    kind: 'build_error_repair' | 'deployment_failure_repair'
  }): Promise<SendMessageResponse> {
    const handle = await ensureProjectSession(data.project_id)
    const language = getCurrentUiLanguage()
    await postJson(
      `/api/beegame-sessions/${encodeURIComponent(handle.session.id)}/action`,
      {
        kind: data.kind,
        language,
      },
    )
    return {
      command_id: handle.session.id,
      task_id: handle.session.id,
      state: 'running',
      trace_id: handle.session.id,
    }
  },

  async stopTask(data: {
    task_id: string
    project_id?: string
  }): Promise<StopTaskResponse> {
    const projectId = String(data.project_id || '').trim()
    const sessionId = resolveStopSessionId(data)
    const stopped = projectId
      ? await postJson<BeeGameSession>(
          `/api/projects/${encodeURIComponent(projectId)}/stop`,
          {},
        )
      : await postJson<BeeGameSession>(
          `/api/beegame-sessions/${encodeURIComponent(sessionId)}/stop`,
          {},
        )
    return {
      command_id: stopped.id || sessionId,
      task_id: stopped.id || sessionId,
      state: stopped.status === 'stopped' ? 'stopped' : 'stop_requested',
      trace_id: stopped.id || sessionId,
    }
  },

  async getChatHistory(projectId: string): Promise<unknown[]> {
    const transcriptPage =
      await fetchProjectTranscriptPageIfAvailable(projectId)
    if (!transcriptPage) return []
    chatHistoryCursorByProject.set(projectId, {
      ...transcriptPage.page,
      latestEventId: getLatestBeeGameEventId(transcriptPage.events),
    })
    const historyEvents = transcriptPage.latestTodoEvent &&
      !transcriptPage.events.some(event => event.id === transcriptPage.latestTodoEvent?.id)
      ? [...transcriptPage.events, transcriptPage.latestTodoEvent]
      : transcriptPage.events
    return eventsToHistory(
      projectId,
      historyEvents,
      transcriptPage.workspacePath,
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
      const error = new Error(await getResponseErrorMessage(response)) as Error & { status?: number }
      error.status = response.status
      throw error
    }
    if (!response.body) throw new Error('BeeGame event stream has no response body')
    callbacks.onOpen?.()

    let lastEventId = effectiveAfterEventId
    const isInitialHistorySync = effectiveAfterEventId === 0
    await readProjectEventStream(response.body, frame => {
      if (!frame.data) return
      const payload = JSON.parse(frame.data) as Partial<BeeGameProjectEvents> & { lastEventId?: number }
      const events = Array.isArray(payload.events)
        ? payload.events as BeeGameEvent[]
        : []
      if (events.length === 0) return
      const eventId = typeof payload.lastEventId === 'number'
        ? payload.lastEventId
        : frame.id ?? events[events.length - 1]?.id ?? lastEventId
      lastEventId = Math.max(lastEventId, eventId)
      callbacks.onCursor?.(lastEventId)
      normalizeLiveEvents(projectId, events)
        .flatMap(event => eventToProjectEventMessages(projectId, event, payload.workspacePath || ''))
        .filter(message => !(isInitialHistorySync && message.type === 'error'))
        .forEach(message => callbacks.onMessage(message))
    })
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
  }): Promise<{ ok: boolean }> {
    await postJson(
      `/api/projects/${encodeURIComponent(data.project_id)}/permissions/${encodeURIComponent(data.gate_id)}`,
      {
        decision: data.decision,
        remember: false,
        scope: data.scope ?? 'once',
        ...(data.message ? { message: data.message } : {}),
      },
    )
    return { ok: true }
  },

  async getArtifacts(projectId: string): Promise<BeeGameArtifact[]> {
    let artifactIndex: BeeGameProjectArtifactIndex | undefined
    try {
      artifactIndex = await fetchProjectArtifactIndex(projectId)
    } catch (error) {
      // Older servers may not expose the project-scoped index yet. Keep the
      // event-derived fallback for those servers, but never hide auth or
      // transport failures behind an empty artifact list.
      if (!isNotFoundError(error)) throw error
    }

    let eventResult: BeeGameProjectEvents | undefined
    if (artifactIndex?.sessionId) {
      try {
        eventResult = await fetchProjectEvents(projectId)
      } catch (error) {
        if (!isSessionNotFoundError(error)) throw error
      }
    } else if (!artifactIndex) {
      try {
        eventResult = await fetchProjectEvents(projectId)
      } catch (error) {
        if (isSessionNotFoundError(error)) return []
        throw error
      }
    }

    const workspacePath = artifactIndex?.workspacePath || eventResult?.workspacePath
    if (!workspacePath) return []
    const binding = {
      projectId,
      workspacePath,
      ...(artifactIndex?.sessionId || eventResult?.sessionId
        ? { sessionId: artifactIndex?.sessionId || eventResult?.sessionId }
        : {}),
    }
    return [
      ...mergeArtifactsByPath([
        ...(artifactIndex?.artifacts || [])
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
    return postJson(
      `/api/projects/${encodeURIComponent(projectId)}/preview`,
      {},
    )
  },

  async restartProjectPreview(
    projectId: string,
  ): Promise<BeeGamePreviewPayload> {
    return postJson(
      `/api/projects/${encodeURIComponent(projectId)}/preview/restart`,
      {},
    )
  },

  async stopProjectPreview(projectId: string): Promise<BeeGamePreviewPayload> {
    return deleteJson<BeeGamePreviewPayload>(
      `/api/projects/${encodeURIComponent(projectId)}/preview`,
    )
  },

  async deployProject(projectId: string): Promise<BeeGameDeploymentPayload> {
    return postJson(
      `/api/projects/${encodeURIComponent(projectId)}/deployments`,
      {},
    )
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
  ): Promise<BeeGameAssetManifestPayload> {
    return getJson<BeeGameAssetManifestPayload>(
      `/api/projects/${encodeURIComponent(projectId)}/assets`,
    )
  },

  async getProjectGameContent(
    projectId: string,
  ): Promise<BeeGameGameContentSnapshot> {
    return getJson<BeeGameGameContentSnapshot>(
      `/api/projects/${encodeURIComponent(projectId)}/game-content`,
    )
  },

  async loadProjectAssetFile(
    projectId: string,
    resourceId: string,
    path: string,
  ): Promise<Blob> {
    const query = new URLSearchParams({ path })
    const response = await authenticatedFetch(
      `/api/projects/${encodeURIComponent(projectId)}/assets/resources/${encodeURIComponent(resourceId)}/file?${query.toString()}`,
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
    file: File,
  ): Promise<BeeGameAssetUploadPayload> {
    const form = new FormData()
    form.set('file', file)
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

function resolveStopSessionId(data: {
  task_id: string
  project_id?: string
}): string {
  return String(data.task_id || '').trim()
}

function isSessionNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message === 'session not found' || message === 'not found'
}

function isNotFoundError(error: unknown): boolean {
  if (isSessionNotFoundError(error)) return true
  if (!(error instanceof Error)) return false
  return (error as Error & { status?: number }).status === 404
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

async function sendBeeGameInput(
  sessionId: string,
  text: string,
  display?: {
    clientMessageId?: string
    supersedesMessageId?: string
    language?: BeeGameLanguage
    attachments?: ChatAttachmentPayload[]
  },
): Promise<BeeGameSession> {
  return postJson(
    `/api/beegame-sessions/${encodeURIComponent(sessionId)}/input`,
    {
      text,
      ...(display?.clientMessageId
        ? { clientMessageId: display.clientMessageId }
        : {}),
      ...(display?.supersedesMessageId
        ? { supersedesMessageId: display.supersedesMessageId }
        : {}),
      ...(display?.language ? { language: display.language } : {}),
      ...(display?.attachments?.length
        ? { attachments: display.attachments }
        : {}),
    },
  )
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
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

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
      const result = await reader.read()
      if (result.done) break
      buffer += decoder.decode(result.value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() || ''
      frames.forEach(flush)
    }
    buffer += decoder.decode()
    if (buffer.trim()) flush(buffer)
  } finally {
    reader.releaseLock()
  }
}

async function fetchProjectTranscriptPage(
  projectId: string,
  beforeId?: number,
): Promise<BeeGameProjectTranscriptPage> {
  const params = new URLSearchParams({
    limit: String(CHAT_HISTORY_PAGE_SIZE),
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
    return await fetchProjectTranscriptPage(projectId)
  } catch {
    return undefined
  }
}

function eventsToHistory(
  projectId: string,
  events: BeeGameEvent[],
  workspacePath = '',
): unknown[] {
  const normalizedEvents = normalizeDisplayEvents(events)
  const projectedMessages = normalizedEvents.flatMap(event =>
    eventToProjectEventMessages(projectId, event, workspacePath),
  )
  const thoughtMessages = new Map<string, ProjectEventMessage>()
  const messages = projectedMessages.flatMap(message => {
    if (message.type === 'think_start') return []
    if (message.type === 'think_end') {
      const thought = message.message_id
        ? thoughtMessages.get(message.message_id)
        : undefined
      // The end event owns the authoritative wall-clock duration. Keep the
      // visible Thought card, but transfer that value before suppressing the
      // lifecycle marker from the history UI.
      if (thought && typeof message.thinking_duration_ms === 'number') {
        thought.thinking_duration_ms = message.thinking_duration_ms
        thought.timestamp = message.timestamp
      }
      return []
    }
    if (message.type !== 'thought' || !message.message_id) return [message]
    const existing = thoughtMessages.get(message.message_id)
    if (existing) {
      existing.content = `${existing.content || ''}${message.content || ''}`
      existing.timestamp = message.timestamp
      existing.thinking_duration_ms = message.thinking_duration_ms
      return []
    }
    thoughtMessages.set(message.message_id, message)
    return [message]
  })
  return messages.map(message => ({
    id:
      message.message_id || `${message.type}-${message.task_id}-${Date.now()}`,
    message_id: message.message_id,
    sender: message.sender || 'system',
    content: message.content || '',
    contentBlocks: message.content_blocks,
    task_id: message.task_id,
    turnId: message.turnId || message.turn_id,
    turn_id: message.turn_id || message.turnId,
    timestamp: message.timestamp || Date.now(),
    thinkingDurationMs: message.thinking_duration_ms,
    type:
      message.type === 'agent_message'
        ? 'text'
        : message.type === 'thought'
          ? 'thought'
        : message.type === 'tool_start' || message.type === 'tool_end'
          ? 'tool'
          : 'normal',
    renderHint: message.render_hint,
    artifactType: message.artifact_type,
    taskKind: message.task_kind,
    nextAction: message.next_action,
    requiresUserAction: message.requires_user_action,
    toolName: message.tool,
    toolUseId: message.tool_use_id,
    toolStatus: message.tool_status,
    toolDetail: message.tool_detail,
    toolOutput: message.tool_output,
    toolInput: message.tool_input,
    toolDiff: message.tool_diff,
    toolPatch: message.tool_patch,
    toolBefore: message.tool_before,
    toolAfter: message.tool_after,
    toolStructuredPatch: message.structured_patch,
    subagentPrompt: message.subagent_prompt,
    subagentOutput: message.subagent_output,
    subagentTrace: message.subagent_trace,
    sources: message.sources,
    citations: message.citations,
    artifactId: message.artifact_id,
    isSubagentTool: message.is_subagent_tool,
  }))
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
  const messages = eventToProjectEventMessagesBase(
    projectId,
    event,
    workspacePath,
  )
  const workflowStage = getWorkflowStage(event)
  if (!workflowStage) return messages
  return messages.map(message => ({
    ...message,
    // A stage is a workflow concern, independent of whether its implementation
    // happens to be a native module or a delivery worker. It must therefore
    // take precedence over generic transport kinds such as `agent_message`.
    task_kind: `workflow_stage:${workflowStage}`,
  }))
}

function getWorkflowStage(event: BeeGameEvent): string | undefined {
  const directStage = getPayloadString(event, 'workflowStage')
  if (directStage) return directStage

  const workerType = getPayloadString(event, 'workflowWorkerType')
  const workerStage: Record<string, string> = {
    'document-author': 'author',
    'content-author': 'content',
    'foundation-reviewer': 'reviewer',
    'foundation-document-reviser': 'revision',
    'resource-planner': 'resources',
    'implementation-worker': 'implementation',
    'acceptance-validator': 'acceptance',
  }
  return workerType ? workerStage[workerType] : undefined
}

function eventToProjectEventMessagesBase(
  projectId: string,
  event: BeeGameEvent,
  workspacePath = '',
): ProjectEventMessage[] {
  const taskId = event.sessionId
  switch (event.type) {
    case 'user.message':
      return [
        baseMessage(
          'agent_message',
          { ...event, text: resolveUserMessageDisplayText(event) },
          projectId,
          'user',
        ),
      ]
    case 'turn.started':
      return [
        {
          type: 'status',
          task_id: taskId,
          project_id: projectId,
          turnId: event.turnId,
          turn_id: event.turnId,
          status: 'running',
        } as ProjectEventMessage,
      ]
    case 'system.status':
      return []
    case 'assistant.partial': {
      // Only the unified workflow trace has a durable stream identity. Legacy
      // partials have no way to reconcile with their final answer, so retain
      // the established final-only behavior for them.
      if (!getPayloadString(event, 'workflowStageStreamId')) return []
      return [
        {
          type: 'token',
          task_id: taskId,
          project_id: projectId,
          sender: 'beegame',
          content: event.text,
          task_kind: 'assistant_stream',
          message_id: getBeeGameAssistantMessageId(event),
          turnId: event.turnId,
          turn_id: event.turnId,
          timestamp: Date.parse(event.createdAt) || Date.now(),
        } as ProjectEventMessage,
      ]
    }
    case 'assistant.thinking': {
      const status = getPayloadString(event, 'status')
      const thinkingBlockId = getPayloadString(event, 'thinkingBlockId') || 'default'
      const thinkingMessageId = thinkingBlockId === 'default'
        ? `beegame-thinking-${event.turnId || event.sessionId}`
        : `beegame-thinking-${event.turnId || event.sessionId}-${thinkingBlockId}`
      const thinkingStartedAt = Date.parse(getPayloadString(event, 'thinkingStartedAt'))
      const thinkingDurationMs = Number.isFinite(thinkingStartedAt)
        ? Math.max(0, Date.parse(event.createdAt) - thinkingStartedAt)
        : undefined
      if (status === 'ended') {
        return [
          {
            type: 'think_end',
            task_id: taskId,
            project_id: projectId,
            sender: 'beegame',
            message_id: thinkingMessageId,
            turnId: event.turnId,
            turn_id: event.turnId,
            timestamp: Date.parse(event.createdAt) || Date.now(),
            ...(thinkingDurationMs !== undefined ? { thinking_duration_ms: thinkingDurationMs } : {}),
          } as ProjectEventMessage,
        ]
      }
      if (event.text && event.text !== 'Thinking') {
        return [
          {
            type: 'thought',
            task_id: taskId,
            project_id: projectId,
            sender: 'beegame',
            content: event.text,
            task_kind: 'assistant_thinking',
            message_id: thinkingMessageId,
            turnId: event.turnId,
            turn_id: event.turnId,
            timestamp: Date.parse(event.createdAt) || Date.now(),
            ...(thinkingDurationMs !== undefined ? { thinking_duration_ms: thinkingDurationMs } : {}),
          } as ProjectEventMessage,
        ]
      }
      return [
        {
          type: 'think_start',
          task_id: taskId,
          project_id: projectId,
          sender: 'beegame',
          content: event.text || 'Thinking',
          task_kind: 'assistant_thinking',
          message_id: thinkingMessageId,
          turnId: event.turnId,
          turn_id: event.turnId,
          timestamp: Date.parse(event.createdAt) || Date.now(),
        } as ProjectEventMessage,
      ]
    }
    case 'assistant.message': {
      const usage = getUsageFromEventPayload(event.payload)
      return [
        baseMessage('agent_message', event, projectId, 'beegame'),
        ...(usage
          ? [
              {
                type: 'usage',
                task_id: taskId,
                project_id: projectId,
                turnId: event.turnId,
                turn_id: event.turnId,
                usage,
                timestamp: Date.parse(event.createdAt) || Date.now(),
              } as ProjectEventMessage,
            ]
          : []),
      ]
    }
    case 'result': {
      const usage = getUsageFromEventPayload(event.payload)
      return usage
        ? [
            {
              type: 'usage',
              task_id: taskId,
              project_id: projectId,
              turnId: event.turnId,
              turn_id: event.turnId,
              usage,
              timestamp: Date.parse(event.createdAt) || Date.now(),
            } as ProjectEventMessage,
          ]
        : []
    }
    case 'tool.started': {
      if (Object.keys(getPayloadRecord(event, 'input')).length === 0) return []
      const startedInput = getPayloadRecord(event, 'input')
      const startedTool = getPayloadString(event, 'toolName') || event.text
      const startedInfo = getToolDisplayInfo(
        startedTool,
        'running',
        startedInput,
        workspacePath,
      )
      const startedArtifactPath = getArtifactPath(startedTool, startedInput)
      return [
        {
          type: 'tool_start',
          task_id: taskId,
          project_id: projectId,
          turnId: event.turnId,
          turn_id: event.turnId,
          message_id: getToolMessageId(event),
          tool_use_id: getPayloadString(event, 'toolUseID'),
          tool: startedTool,
          content: formatToolContent(startedInfo),
          tool_status: startedInfo.status,
          tool_detail: startedInfo.detail,
          tool_input: startedInput,
          ...getToolDiffFields(event, startedInput),
          artifact_id: startedArtifactPath
            ? encodeArtifactId(projectId, event.sessionId, startedArtifactPath)
            : undefined,
          artifact_path: startedArtifactPath
            ? toWorkspaceRelativePath(startedArtifactPath, workspacePath)
            : undefined,
          is_subagent_tool: startedInfo.isSubagent,
          subagent_prompt: startedInfo.subagentPrompt,
          subagent_output: startedInfo.subagentOutput,
          subagent_trace: startedInfo.subagentTrace,
          timestamp: Date.parse(event.createdAt) || Date.now(),
        } as ProjectEventMessage,
      ]
    }
    case 'tool.progress': {
      const progressInput = getPayloadRecord(event, 'input')
      const progressTool = getPayloadString(event, 'toolName') || event.text
      const output =
        typeof event.payload?.output === 'string'
          ? event.payload.output
          : event.text
      const progressInfo = getToolDisplayInfo(
        progressTool,
        'running',
        progressInput,
        workspacePath,
        output,
      )
      const progressArtifactPath = getArtifactPath(progressTool, progressInput)
      return [
        {
          type: 'tool_start',
          task_id: taskId,
          project_id: projectId,
          turnId: event.turnId,
          turn_id: event.turnId,
          message_id: getToolMessageId(event),
          tool_use_id: getPayloadString(event, 'toolUseID'),
          tool: progressTool,
          content: formatToolContent(progressInfo),
          tool_status: progressInfo.status,
          tool_detail: progressInfo.detail,
          tool_output: progressInfo.output,
          tool_input: progressInput,
          ...getToolDiffFields(event, progressInput),
          artifact_id: progressArtifactPath
            ? encodeArtifactId(projectId, event.sessionId, progressArtifactPath)
            : undefined,
          artifact_path: progressArtifactPath
            ? toWorkspaceRelativePath(progressArtifactPath, workspacePath)
            : undefined,
          is_subagent_tool: progressInfo.isSubagent,
          subagent_prompt: progressInfo.subagentPrompt,
          subagent_output: progressInfo.subagentOutput,
          subagent_trace: progressInfo.subagentTrace,
          timestamp: Date.parse(event.createdAt) || Date.now(),
        } as ProjectEventMessage,
      ]
    }
    case 'tool.completed':
    case 'tool.failed': {
      const finishedInput = getPayloadRecord(event, 'input')
      const finishedTool = getPayloadString(event, 'toolName') || event.text
      const output =
        typeof event.payload?.output === 'string'
          ? event.payload.output
          : event.text
      const finishedInfo = getToolDisplayInfo(
        finishedTool,
        event.type === 'tool.failed' ? 'failed' : 'completed',
        finishedInput,
        workspacePath,
        output,
      )
      const finishedArtifactPath = getArtifactPath(finishedTool, finishedInput)
      return [
        {
          type: 'tool_end',
          task_id: taskId,
          project_id: projectId,
          turnId: event.turnId,
          turn_id: event.turnId,
          message_id: getToolMessageId(event),
          tool_use_id: getPayloadString(event, 'toolUseID'),
          tool: finishedTool,
          output,
          content: formatToolContent(finishedInfo),
          tool_status: finishedInfo.status,
          tool_detail: finishedInfo.detail,
          tool_output: finishedInfo.output,
          tool_input: finishedInput,
          ...getToolDiffFields(event, finishedInput),
          artifact_id: finishedArtifactPath
            ? encodeArtifactId(projectId, event.sessionId, finishedArtifactPath)
            : undefined,
          artifact_path: finishedArtifactPath
            ? toWorkspaceRelativePath(finishedArtifactPath, workspacePath)
            : undefined,
          is_subagent_tool: finishedInfo.isSubagent,
          subagent_prompt: finishedInfo.subagentPrompt,
          subagent_output: finishedInfo.subagentOutput,
          subagent_trace: finishedInfo.subagentTrace,
          timestamp: Date.parse(event.createdAt) || Date.now(),
        } as ProjectEventMessage,
      ]
    }
    case 'permission.requested':
      return [
        {
          type: 'human_gate',
          task_id: taskId,
          project_id: projectId,
          message_id: getPermissionRequestMessageId(event),
          content: event.text,
          sender: 'beegame',
          task_kind: 'permission_request',
          turnId: event.turnId,
          turn_id: event.turnId,
          requires_user_action: true,
          timestamp: Date.parse(event.createdAt) || Date.now(),
        } as ProjectEventMessage,
      ]
    case 'permission.resolved': {
      const decision = getPayloadString(event, 'decision')
      if (decision !== 'deny') return []
      return [
        baseMessage(
          'agent_message',
          {
            ...event,
            text: describePermissionResolution(event),
          },
          projectId,
          'system',
        ),
      ]
    }
    case 'turn.completed': {
      return [
        {
          type: 'status',
          task_id: taskId,
          project_id: projectId,
          turnId: event.turnId,
          turn_id: event.turnId,
          status: 'idle',
        } as ProjectEventMessage,
      ]
    }
    case 'turn.empty':
      return [
        baseMessage('agent_message', event, projectId, 'system'),
        {
          type: 'status',
          task_id: taskId,
          project_id: projectId,
          turnId: event.turnId,
          turn_id: event.turnId,
          status: 'idle',
        } as ProjectEventMessage,
      ]
    case 'session.stopped':
      return [
        {
          type: 'status',
          task_id: taskId,
          project_id: projectId,
          turnId: event.turnId,
          turn_id: event.turnId,
          status: 'stopped',
        } as ProjectEventMessage,
      ]
    case 'turn.failed':
    case 'session.failed':
      return [
        {
          type: 'error',
          task_id: taskId,
          project_id: projectId,
          turnId: event.turnId,
          turn_id: event.turnId,
          content: event.text,
          error: event.text,
        } as ProjectEventMessage,
      ]
    default:
      return []
  }
}

function normalizeDisplayEvents(events: BeeGameEvent[]): BeeGameEvent[] {
  return normalizeBeeGameEvents(events, {
    includeUserMessages: true,
    includePartialsWhenFinalExists: false,
  })
}

function normalizeBeeGameEvents(
  events: BeeGameEvent[],
  options: {
    includeUserMessages: boolean
    includePartialsWhenFinalExists: boolean
  },
): BeeGameEvent[] {
  events = coalesceLogicalAssistantMessages(events)
  const visible: BeeGameEvent[] = []
  const terminalEventByTurn = new Map<string, number>()
  for (const event of events) {
    if (!event.turnId || !isTurnTerminalEvent(event)) continue
    const existing = terminalEventByTurn.get(event.turnId)
    if (existing === undefined || event.id < existing)
      terminalEventByTurn.set(event.turnId, event.id)
  }
  const seenUserTexts = new Set<string>()
  const turnsWithFinal = new Set(
    events
      .filter(event => event.type === 'assistant.message')
      .map(getTurnDisplayId),
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
    if (isLateRuntimeEvent(event, terminalEventByTurn)) continue
    if (event.type !== 'assistant.partial') {
      flushPartial()
    }
    if (event.type !== 'assistant.thinking') {
      flushThinking()
    }
    if (event.type === 'user.message') {
      if (!options.includeUserMessages) continue
      const displayText = resolveUserMessageDisplayText(event)
      if (seenUserTexts.has(displayText)) continue
      seenUserTexts.add(displayText)
      visible.push(event)
      continue
    }
    if (
      event.type === 'system.status' &&
      event.text.trim().toLowerCase() === 'system'
    ) {
      continue
    }
    if (event.type === 'result' && !getUsageFromEventPayload(event.payload)) {
      continue
    }
    if (
      event.type === 'tool.started' &&
      Object.keys(getPayloadRecord(event, 'input')).length === 0
    ) {
      continue
    }
    if (event.type === 'assistant.partial') {
      if (
        !options.includePartialsWhenFinalExists &&
        turnsWithFinal.has(getTurnDisplayId(event))
      ) {
        continue
      }
      if (
        bufferedPartial &&
        getTurnDisplayId(bufferedPartial) === getTurnDisplayId(event)
      ) {
        bufferedPartial = Object.assign({}, bufferedPartial, {
          id: event.id,
          text: `${bufferedPartial.text}${event.text}`,
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
          text: previous + next || 'Thinking',
          payload: {
            ...(event.payload ?? { type: 'assistant.thinking' }),
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
  return visible
}

function getThinkingDisplayId(event: BeeGameEvent): string {
  return `${getTurnDisplayId(event)}:${getPayloadString(event, 'thinkingBlockId') || 'default'}`
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
    const identity = `${event.sessionId}:${event.turnId ?? ''}:${messageId}`
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

function getAssistantPayloadMessageId(event: BeeGameEvent): string {
  if (!event.payload) return ''
  const message = event.payload.message
  if (!message || typeof message !== 'object' || Array.isArray(message))
    return ''
  const id = (message as Record<string, unknown>).id
  return typeof id === 'string' ? id.trim() : ''
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

function getAssistantContentBlocks(event: BeeGameEvent): AssistantContentBlock[] | undefined {
  if (!event.payload) return undefined
  const payloadBlocks = event.payload.contentBlocks
  if (Array.isArray(payloadBlocks)) {
    return payloadBlocks.filter(isAssistantContentBlock)
  }
  const message = event.payload.message
  if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content)) return undefined
  const blocks = content.flatMap((block): AssistantContentBlock[] => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return []
    const record = block as Record<string, unknown>
    const type = record.type
    if (type !== 'thinking' && type !== 'text' && type !== 'tool_use' && type !== 'tool_result') return []
    return [{
      type,
      ...(typeof record.thinking === 'string' ? { text: record.thinking } : {}),
      ...(typeof record.text === 'string' ? { text: record.text } : {}),
      ...(typeof record.id === 'string' ? { toolUseId: record.id } : {}),
      ...(typeof record.tool_use_id === 'string' ? { toolUseId: record.tool_use_id } : {}),
      ...(typeof record.name === 'string' ? { toolName: record.name } : {}),
      ...(record.input !== undefined ? { toolInput: record.input } : {}),
      ...(typeof record.is_error === 'boolean' ? { isError: record.is_error } : {}),
    }]
  })
  return blocks.length ? blocks : undefined
}

function isAssistantContentBlock(value: unknown): value is AssistantContentBlock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const block = value as Partial<AssistantContentBlock>
  return (
    block.type === 'thinking' ||
    block.type === 'text' ||
    block.type === 'tool_use' ||
    block.type === 'tool_result'
  )
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
  _projectId: string,
  events: BeeGameEvent[],
): BeeGameEvent[] {
  return normalizeBeeGameEvents(events, {
    includeUserMessages: false,
    includePartialsWhenFinalExists: true,
  })
}

function baseMessage(
  type: 'token' | 'agent_message',
  event: BeeGameEvent,
  projectId: string,
  sender: string,
): ProjectEventMessage {
  const clientMessageId =
    sender === 'user'
      ? getPayloadString(event, 'clientMessageId') ||
        getPayloadString(event, 'client_message_id')
      : ''
  const supersedesMessageId =
    sender === 'user'
      ? getPayloadString(event, 'supersedesMessageId') ||
        getPayloadString(event, 'supersedes_message_id')
      : ''
  const messageId =
    sender === 'beegame'
      ? getBeeGameAssistantMessageId(event)
      : clientMessageId || `beegame-event-${event.id}`
  return {
    type,
    task_id: event.sessionId,
    project_id: projectId,
    sender,
    content: event.text,
    content_blocks: getAssistantContentBlocks(event),
    message_id: messageId,
    ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
    ...(supersedesMessageId
      ? { supersedes_message_id: supersedesMessageId }
      : {}),
    ...(getEventSources(event, 'sources') ? { sources: getEventSources(event, 'sources') } : {}),
    ...(getEventSources(event, 'citations') ? { citations: getEventSources(event, 'citations') } : {}),
    ...(event.turnId ? { turnId: event.turnId, turn_id: event.turnId } : {}),
    timestamp: Date.parse(event.createdAt) || Date.now(),
  } as ProjectEventMessage
}

type EventSource = { id?: string; title?: string; domain?: string; url?: string }

function getEventSources(event: BeeGameEvent, key: 'sources' | 'citations'): EventSource[] | undefined {
  const payload = event.payload
  const nested = payload?.message && typeof payload.message === 'object' && !Array.isArray(payload.message)
    ? payload.message as Record<string, unknown>
    : undefined
  const value = payload?.[key] ?? nested?.[key]
  if (!Array.isArray(value)) return undefined
  const sources = value.flatMap((entry): EventSource[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    if (!title) return []
    return [{
      ...(typeof record.id === 'string' ? { id: record.id } : {}),
      title,
      ...(typeof record.domain === 'string' ? { domain: record.domain } : {}),
      ...(typeof record.url === 'string' ? { url: record.url } : {}),
    }]
  })
  return sources.length > 0 ? sources : undefined
}

function describePermissionResolution(event: BeeGameEvent): string {
  const toolName = getPayloadString(event, 'toolName') || 'tool'
  const reason = getPayloadString(event, 'reason')
  if (getPayloadBoolean(event, 'autoDenied')) {
    return reason
      ? `BeeGame blocked ${toolName}: ${reason}`
      : `BeeGame blocked ${toolName}.`
  }
  return reason ? `${toolName} denied: ${reason}` : `${toolName} denied.`
}

function getBeeGameAssistantMessageId(event: BeeGameEvent): string {
  const displayMessageId = getPayloadString(event, DISPLAY_MESSAGE_ID_KEY)
  if (displayMessageId) return displayMessageId
  const stageStreamId = getPayloadString(event, 'workflowStageStreamId')
  if (stageStreamId) return `beegame-stream-${stageStreamId}`
  if (event.type === 'assistant.message')
    return getFinalAssistantMessageId(event)
  if (event.type === 'assistant.partial')
    return `beegame-partial-${getTurnDisplayId(event)}-${event.id}`
  return `beegame-event-${event.id}`
}

function getPermissionRequestMessageId(event: BeeGameEvent): string {
  const toolUseID = getPayloadString(event, 'toolUseID')
  if (toolUseID) return `beegame-permission-${event.sessionId}-${toolUseID}`
  return `beegame-permission-${event.sessionId}-${event.id}`
}

function getToolMessageId(event: BeeGameEvent): string {
  const toolUseId = getPayloadString(event, 'toolUseID')
  if (toolUseId) return `beegame-tool-${event.sessionId}-${toolUseId}`
  return `beegame-event-${event.id}`
}

type ToolDisplayInfo = {
  name: string
  status: 'running' | 'completed' | 'failed'
  detail: string
  output: string
  isSubagent: boolean
  subagentPrompt?: string
  subagentOutput?: string
  subagentTrace?: string
}

function getToolDiffFields(
  event: BeeGameEvent,
  input: Record<string, unknown>,
): Pick<ProjectEventMessage, 'tool_diff' | 'tool_patch' | 'tool_before' | 'tool_after' | 'structured_patch'> {
  const payload: Record<string, unknown> = event.payload || {}
  const output = payload.output && typeof payload.output === 'object' && !Array.isArray(payload.output)
    ? payload.output as Record<string, unknown>
    : undefined
  const result = payload.result && typeof payload.result === 'object' && !Array.isArray(payload.result)
    ? payload.result as Record<string, unknown>
    : undefined
  const readString = (key: string): string | undefined => {
    for (const source of [payload, input, output, result]) {
      const value = source?.[key]
      if (typeof value === 'string' && value.length > 0) return value
    }
    return undefined
  }
  const diff = readString('diff') || readString('gitDiff') || readString('git_diff')
  const patch = readString('patch')
  const before = readString('before') || readString('oldContent') || readString('old_content') || readString('originalFile') || readString('original_file')
  const after = readString('after') || readString('newContent') || readString('new_content')
  const readUnknown = (key: string): unknown => {
    for (const source of [payload, input, output, result]) {
      const value = source?.[key]
      if (value !== undefined) return value
    }
    return undefined
  }
  const structuredPatch = readUnknown('structuredPatch') ?? readUnknown('structured_patch')
  return {
    ...(diff ? { tool_diff: diff } : {}),
    ...(patch ? { tool_patch: patch } : {}),
    ...(before !== undefined ? { tool_before: before } : {}),
    ...(after !== undefined ? { tool_after: after } : {}),
    ...(structuredPatch !== undefined ? { structured_patch: structuredPatch } : {}),
  }
}

function getToolDisplayInfo(
  toolName: string,
  status: 'running' | 'completed' | 'failed',
  input: Record<string, unknown>,
  workspacePath: string,
  output = '',
): ToolDisplayInfo {
  const normalizedTool = toolName.toLowerCase()
  const isSubagent = normalizedTool === 'agent' || normalizedTool === 'task'
  const description = String(input.description || '').trim()
  const subagentType = String(
    input.subagent_type || input.agent_type || '',
  ).trim()
  const prompt = String(input.prompt || '').trim()
  const trace = String(input.trace || input.trace_output || '').trim()
  const name = isSubagent ? description || toolName : toolName
  const details: string[] = []
  if (isSubagent && subagentType) {
    details.push(`Type: ${subagentType}`)
  }
  if (isSubagent && prompt) {
    details.push(
      `Prompt: ${prompt.length > 220 ? `${prompt.slice(0, 220)}...` : prompt}`,
    )
  }
  const command = String(input.command || '').trim()
  const targetPath = String(
    input.file_path || input.path || input.notebook_path || '',
  ).trim()
  if (!isSubagent && command) {
    details.push(`Command: ${command}`)
  } else if (!isSubagent && targetPath) {
    details.push(
      `Target: ${formatWorkspaceRelativePath(targetPath, workspacePath)}`,
    )
  }
  const outputSummary =
    output.length > 160 ? `${output.slice(0, 160)}...` : output
  return {
    name,
    status,
    detail: details.join(' · '),
    output: outputSummary,
    isSubagent,
    ...(isSubagent && prompt ? { subagentPrompt: prompt } : {}),
    ...(isSubagent && output ? { subagentOutput: output } : {}),
    ...(isSubagent && trace ? { subagentTrace: trace } : {}),
  }
}

function formatToolContent(info: ToolDisplayInfo): string {
  const lines = info.isSubagent
    ? [`Subagent: ${info.name}`, `Status: ${info.status}`]
    : [`Tool: ${info.name}`, `Status: ${info.status}`]
  if (info.detail) {
    lines.push(info.detail)
  }
  if (info.output) {
    lines.push(`Output: ${info.output}`)
  }
  return lines.join('\n')
}

function formatWorkspaceRelativePath(
  path: string,
  workspacePath: string,
): string {
  const normalizedPath = path.replaceAll('\\', '/')
  const normalizedWorkspace = workspacePath
    .replaceAll('\\', '/')
    .replace(/\/+$/, '')
  if (
    normalizedWorkspace &&
    normalizedPath.startsWith(`${normalizedWorkspace}/`)
  ) {
    return normalizedPath.slice(normalizedWorkspace.length + 1)
  }
  return normalizedPath.split('/').filter(Boolean).slice(-2).join('/') || path
}

function getUsageFromEventPayload(payload?: Record<string, unknown>): {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
} | null {
  const usage = getUsageRecord(payload)
  if (!usage) return null
  const promptTokens = normalizePositiveNumber(
    usage.input_tokens ?? usage.prompt_tokens,
  )
  const completionTokens = normalizePositiveNumber(
    usage.output_tokens ?? usage.completion_tokens,
  )
  const totalTokens = normalizePositiveNumber(
    usage.total_tokens,
    promptTokens + completionTokens,
  )
  if (!promptTokens && !completionTokens && !totalTokens) return null
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  }
}

function getUsageRecord(
  payload?: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!payload) return null
  const directUsage = payload.usage
  if (
    directUsage &&
    typeof directUsage === 'object' &&
    !Array.isArray(directUsage)
  ) {
    return directUsage as Record<string, unknown>
  }
  const message = payload.message
  if (!message || typeof message !== 'object' || Array.isArray(message))
    return null
  const messageUsage = (message as Record<string, unknown>).usage
  if (
    messageUsage &&
    typeof messageUsage === 'object' &&
    !Array.isArray(messageUsage)
  ) {
    return messageUsage as Record<string, unknown>
  }
  return null
}

function normalizePositiveNumber(value: unknown, fallback = 0): number {
  const number = Number(value)
  if (Number.isFinite(number) && number > 0) return number
  return Math.max(0, fallback)
}

function getFinalAssistantMessageId(event: BeeGameEvent): string {
  const upstreamMessageId = getAssistantPayloadMessageId(event)
  return upstreamMessageId
    ? `beegame-assistant-${event.sessionId}-${upstreamMessageId}`
    : `beegame-event-${event.id}`
}

function getTurnDisplayId(event: BeeGameEvent): string {
  return event.turnId || `beegame-turn-${event.sessionId}-${event.id}`
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
  return displayText || resolveSentDisplayText(event.sessionId, event.text)
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

function toWorkspaceRelativePath(path: string, workspacePath: string): string {
  const normalized = path
    .split('\\')
    .join('/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '')
  const normalizedWorkspace = workspacePath
    .split('\\')
    .join('/')
    .replace(/\/+$/, '')
  if (normalizedWorkspace && normalized.startsWith(`${normalizedWorkspace}/`)) {
    return normalized.slice(normalizedWorkspace.length + 1)
  }
  return normalized
}

function isDeliverableDocPath(path: string): boolean {
  const normalized = path
    .split('\\')
    .join('/')
    .replace(/^\.\/+/, '')
  return normalized.startsWith('docs/') && /\.md$/i.test(normalized)
}

function getArtifactPath(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const normalizedTool = toolName.toLowerCase()
  if (!['write', 'edit', 'multiedit', 'notebookedit'].includes(normalizedTool))
    return ''
  return String(
    input.file_path || input.path || input.notebook_path || '',
  ).trim()
}

function encodeProjectPackageArtifactId(projectId: string): string {
  return `${PROJECT_PACKAGE_ARTIFACT_PREFIX}${encodeURIComponent(projectId)}`
}

export function isBeeGameProjectPackageArtifactId(artifactId: string): boolean {
  return artifactId.startsWith(PROJECT_PACKAGE_ARTIFACT_PREFIX)
}

function encodeArtifactId(
  projectId: string,
  sessionId: string | undefined,
  path: string,
): string {
  const encodedProjectId = encodeURIComponent(projectId)
  const encodedPath = encodeURIComponent(path)
  return sessionId
    ? `${ARTIFACT_ID_PREFIX}${encodedProjectId}:${encodeURIComponent(sessionId)}:${encodedPath}`
    : `${ARTIFACT_ID_PREFIX}${encodedProjectId}:${encodedPath}`
}

function decodeArtifactId(
  artifactId: string,
): { projectId: string; sessionId?: string; path: string } | null {
  if (!artifactId.startsWith(ARTIFACT_ID_PREFIX)) return null
  const parts = artifactId.slice(ARTIFACT_ID_PREFIX.length).split(':')
  if (parts.length === 3) {
    return {
      projectId: decodeURIComponent(parts[0]),
      sessionId: decodeURIComponent(parts[1]),
      path: decodeURIComponent(parts[2]),
    }
  }
  if (parts.length === 2) {
    return {
      projectId: decodeURIComponent(parts[0]),
      path: decodeURIComponent(parts[1]),
    }
  }
  return null
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
  if (
    message.includes('was blocked') &&
    message.includes('allowed working directories')
  ) {
    return {
      title: 'Workspace boundary',
      description: message,
      blockReason:
        'BeeGame attempted to access a path outside the active workspace.',
      nextAction:
        'Deny this request, or restart the backend with AGENT_WORKFLOW_WORKSPACE_PATH set to the directory BeeGame should operate in.',
    }
  }
  return {
    title: `${toolName} permission`,
    description: target ? `${toolName}: ${target}` : message,
    blockReason: message,
    nextAction:
      'Allow to continue this BeeGame turn, or deny to ask BeeGame to choose another approach.',
  }
}

function getPayloadString(event: BeeGameEvent, field: string): string {
  const value = event.payload?.[field]
  return typeof value === 'string' ? value : ''
}

function getPayloadBoolean(event: BeeGameEvent, field: string): boolean {
  return event.payload?.[field] === true
}

function getPayloadRecord(
  event: BeeGameEvent,
  field: string,
): Record<string, unknown> {
  const value = event.payload?.[field]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
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

async function getJson<T>(path: string): Promise<T> {
  const response = await authenticatedFetch(path)
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
  const payload = body as { message?: unknown; error?: unknown }
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
