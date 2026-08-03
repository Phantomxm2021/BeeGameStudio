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
} from './api';
import type { Project } from '../types/project';
import type { ProjectEventMessage } from '../types/message';
import { authenticatedFetch } from './apiClient';
import { normalizeAttachmentBuildAnalysis, type AttachmentBuildAnalysis } from './attachmentBuild';
import { getSupabaseSessionUser } from './supabaseAuthApi';

type BeeGameSession = {
  id: string;
  cwd: string;
  modelConfigId?: string;
  status: 'running' | 'stopped' | 'failed';
  turnStatus: 'idle' | 'running';
  createdAt: string;
  updatedAt: string;
};

type BeeGameEvent = {
  id: number;
  sessionId: string;
  turnId?: string;
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
    | 'session.failed';
  text: string;
  payload?: { type: string; [key: string]: unknown };
  createdAt: string;
};

type BeeGamePendingPermissionPayload = {
  id?: string;
  session_id?: string;
  event_id?: number;
  tool_name?: string;
  message?: string;
  created_at?: string;
  input?: unknown;
};

type ProjectRuntimeStateWithPermissions = ProjectBaselineStatusPayload & {
  pending_permissions?: BeeGamePendingPermissionPayload[];
};

const projectRuntimeStateRequests = new Map<string, Promise<ProjectRuntimeStateWithPermissions>>();

function fetchProjectRuntimeState(projectId: string): Promise<ProjectRuntimeStateWithPermissions> {
  const normalizedProjectId = String(projectId || '').trim();
  const existing = projectRuntimeStateRequests.get(normalizedProjectId);
  if (existing) return existing;
  const request = getJson<ProjectRuntimeStateWithPermissions>(
    `/api/projects/${encodeURIComponent(normalizedProjectId)}/runtime-state`,
  ).finally(() => {
    if (projectRuntimeStateRequests.get(normalizedProjectId) === request) {
      projectRuntimeStateRequests.delete(normalizedProjectId);
    }
  });
  projectRuntimeStateRequests.set(normalizedProjectId, request);
  return request;
}

type ProjectSessionBinding = {
  projectId: string;
  sessionId: string;
  workspacePath: string;
  language?: BeeGameLanguage;
};

type BeeGameTranscriptPage = {
  events: BeeGameEvent[];
  page: {
    hasMore: boolean;
    nextBeforeId: number | null;
  };
};

type BeeGameProjectEvents = {
  sessionId: string;
  workspacePath: string;
  events: BeeGameEvent[];
  recoveredFromTranscript: boolean;
};

type BeeGameProjectTranscriptPage = BeeGameTranscriptPage & {
  sessionId: string;
  workspacePath: string;
};

type BeeGameProjectArtifactIndex = {
  sessionId: string;
  workspacePath: string;
  artifacts: BeeGameDiscoveredArtifact[];
};

const CHAT_HISTORY_PAGE_SIZE = 300;
type ChatHistoryCursorState = BeeGameTranscriptPage['page'] & { latestEventId: number };
const chatHistoryCursorByProject = new Map<string, ChatHistoryCursorState>();

type BeeGameDiscoveredArtifact = {
  path: string;
  name?: string;
  artifact_type?: string;
  created_at?: string;
};

type BeeGameSessionHandle = {
  session: BeeGameSession;
  recoveredEvents: BeeGameEvent[];
  binding?: ProjectSessionBinding;
  previousSessionId?: string;
};

type BeeGameArtifact = {
  artifact_id: string;
  id: string;
  name: string;
  artifact_type: string;
  path?: string;
  status: 'active';
  created_by: 'beegame';
  created_at: string;
  package_download?: boolean;
};

type BeeGameLanguage =
  | 'en' | 'zh' | 'zh-TW' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'it' | 'pt';

type BeeGameIdeaIntakeRequest = {
  idea: string;
  language?: BeeGameLanguage | string;
  clientRequestId?: string;
};

export type BeeGameIntakeOption = {
  id: string;
  title: string;
  projectFolderName?: string;
  pitch: string;
  gameplay: string;
  coreGameplayHypothesis: string;
  experienceSnapshot: string;
  playerFirstMinute: string;
  whyFitsIdea: string;
  playablePrototype: string;
  validationTarget: string;
  coreMechanic: string;
  firstBuild: string;
  validationGoal: string;
  risk: string;
  fit: string;
  firstPlayableValidation: string;
  riskComplexity: string;
  recommendedPlatform: string;
  recommendedEngine?: string;
  recommendedDimension: string;
  recommendedGenre: string;
  recommendedStyle: string;
  recommendedInputs: string[];
  scope: string;
};

export type BeeGameClarificationOption = {
  id: string;
  label: string;
  description?: string;
  value?: string;
};

export type BeeGameClarification = {
  prompt: string;
  options: BeeGameClarificationOption[];
  freeformLabel?: string;
};

export type BeeGameIdeaIntakeResult = {
  maturity: 'vague' | 'directional' | 'concrete';
  needsClarification: boolean;
  clarification?: BeeGameClarification;
  clarificationQuestions: string[];
  detectedConstraints: string[];
  recommendedNextStep: string;
  options: BeeGameIntakeOption[];
};

export type BeeGameIntakeSettings = {
  platform: string;
  engine?: string;
  visualStyle: string;
  dimension: string;
  genre: string;
  inputs: string[];
  scope: string;
  notes?: string;
  resourceLibraryUsage: 'optional' | 'preferred' | 'required';
};

export type BeeGameBuildBrief = {
  idea: string;
  option: BeeGameIntakeOption;
  settings: BeeGameIntakeSettings;
  language: BeeGameLanguage | string;
  documentLanguage: BeeGameLanguage | string;
  gameUserVisibleLanguage: BeeGameLanguage | string;
  agentResponseLanguage: BeeGameLanguage | string;
  root_path?: string;
  title?: string;
  confirmedGdd?: string;
  buildSource?: 'gdd' | 'image' | 'mixed';
  analysisId?: string;
};

const WORKSPACE_ROOT_KEY = 'beegame-adapter-workspace-root';
const SENT_DISPLAY_KEY = 'beegame-adapter-sent-display-text';
const ARTIFACT_ID_PREFIX = 'beegame-artifact:';
const PROJECT_PACKAGE_ARTIFACT_PREFIX = 'beegame-project-package:';
const ALLOW_CLIENT_WORKSPACE_ROOT = String(import.meta.env.VITE_BEEGAME_ALLOW_CLIENT_WORKSPACE_ROOT ?? '').trim() === '1' ||
  import.meta.env.MODE === 'test';
const DISPLAY_MESSAGE_ID_KEY = '__displayMessageId';

export type BeeGameWorkspaceSettings = {
  workspacePath: string;
  isDefault: boolean;
};

export async function getBeeGameWorkspaceSettings(): Promise<BeeGameWorkspaceSettings> {
  const configured = readConfiguredWorkspaceRoot();
  if (configured) {
    return { workspacePath: configured, isDefault: false };
  }
  return { workspacePath: await resolveDefaultWorkspacePath(), isDefault: true };
}

export function setBeeGameWorkspaceRoot(path: string): BeeGameWorkspaceSettings {
  if (!ALLOW_CLIENT_WORKSPACE_ROOT) {
    throw new Error('Workspace root is managed by the server deployment');
  }
  const normalized = path.trim();
  if (!isAbsolutePath(normalized)) {
    throw new Error('工作路径必须是绝对路径');
  }
  localStorage.setItem(WORKSPACE_ROOT_KEY, normalized);
  return { workspacePath: normalized, isDefault: false };
}

export async function resetBeeGameWorkspaceRoot(): Promise<BeeGameWorkspaceSettings> {
  if (!ALLOW_CLIENT_WORKSPACE_ROOT) {
    return { workspacePath: await resolveDefaultWorkspacePath(), isDefault: true };
  }
  localStorage.removeItem(WORKSPACE_ROOT_KEY);
  return { workspacePath: await resolveDefaultWorkspacePath(), isDefault: true };
}

export const beeGameAdapter = {
  async getProjects(): Promise<Project[]> {
    return getJson<Project[]>('/api/projects');
  },

  async runIdeaIntake(data: BeeGameIdeaIntakeRequest): Promise<BeeGameIdeaIntakeResult> {
    const requestBody = buildIdeaIntakeRequestBody(data);
    const response = await runIdeaIntakeJob(requestBody);
    const intake = normalizeIdeaIntakeResult(response);
    if (intake.options.length !== 3) {
      throw new Error(`BeeGame intake must return exactly 3 game mode options; received ${intake.options.length}`);
    }
    return intake;
  },

  async analyzeAttachmentBuild(data: {
    idea?: string;
    attachments: ChatAttachmentPayload[];
    language: string;
    clientRequestId: string;
  }): Promise<AttachmentBuildAnalysis> {
    const response = await postJson<unknown>('/api/beegame-intake/analyze-attachments', {
      idea: data.idea,
      attachments: data.attachments,
      language: data.language,
      clientRequestId: data.clientRequestId,
    });
    return normalizeAttachmentBuildAnalysis(response);
  },

  async generateIntakeOptions(data: BeeGameIdeaIntakeRequest): Promise<BeeGameIntakeOption[]> {
    return (await this.runIdeaIntake(data)).options;
  },

  async bootstrapProjectFromBrief(data: BeeGameBuildBrief): Promise<{
    project: Project;
    task_id: string;
    status: string;
  }> {
    const title = getBriefDisplayTitle(data);
    const folderName = getBriefFolderName(data, title);
    const project = createLocalProject(title);
    const language = normalizeBeeGameLanguage(data.language ?? getCurrentUiLanguage());
    const bootstrap = await postJson<{
      project: Project;
      session: BeeGameSession;
      binding: ProjectSessionBinding;
      task_id: string;
      status: string;
    }>('/api/projects/bootstrap', {
      project,
      projectName: folderName,
      brief: data,
      language,
    });
    const syncedProject = bootstrap.project;
    return {
      project: syncedProject,
      task_id: bootstrap.task_id,
      status: bootstrap.status,
    };
  },

  async openProject(_projectId: string): Promise<{ opened: boolean }> {
    return { opened: true };
  },

  async updateProject(projectId: string, data: { name?: string }): Promise<Project> {
    return patchJson<Project>(`/api/projects/${encodeURIComponent(projectId)}`, data);
  },

  async deleteProject(projectId: string): Promise<{ ok: boolean }> {
    await deleteProjectMetadata(projectId);
    chatHistoryCursorByProject.delete(projectId);
    return { ok: true };
  },

  async sendMessage(data: {
    content: string;
    project_id: string;
    client_message_id?: string;
    supersedes_message_id?: string;
    attachments?: ChatAttachmentPayload[];
  }): Promise<SendMessageResponse> {
    const handle = await ensureProjectSession(data.project_id);
    const { session } = handle;
    const language = getCurrentUiLanguage();
    await sendBeeGameInput(session.id, data.content, {
      clientMessageId: data.client_message_id,
      supersedesMessageId: data.supersedes_message_id,
      language,
      attachments: data.attachments,
    });
    return {
      command_id: session.id,
      task_id: session.id,
      state: 'running',
      trace_id: data.client_message_id || session.id,
    };
  },

  async continueTask(data: { project_id: string; task_id?: string }): Promise<ContinueTaskResponse> {
    const handle = await ensureProjectSession(data.project_id);
    const { session } = handle;
    const language = getCurrentUiLanguage();
    await postJson(`/api/beegame-sessions/${encodeURIComponent(session.id)}/continue`, {
      language,
    });
    return {
      command_id: session.id,
      resume_task_id: session.id,
      resume_mode: 'resume',
      state: 'resuming',
      trace_id: session.id,
    };
  },

  async resumeWorkflow(projectId: string): Promise<Record<string, unknown>> {
    return postJson<Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(projectId)}/workflow/resume`,
      {},
    );
  },

  async retryWorkflow(projectId: string): Promise<Record<string, unknown>> {
    return postJson<Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(projectId)}/workflow/retry`,
      {},
    );
  },

  async restartWorkflow(projectId: string): Promise<Record<string, unknown>> {
    return postJson<Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(projectId)}/workflow/restart`,
      {},
    );
  },

  async requestProjectAction(data: {
    project_id: string;
    kind: 'build_error_repair' | 'deployment_failure_repair';
  }): Promise<SendMessageResponse> {
    const handle = await ensureProjectSession(data.project_id);
    const language = getCurrentUiLanguage();
    await postJson(`/api/beegame-sessions/${encodeURIComponent(handle.session.id)}/action`, {
      kind: data.kind,
      language,
    });
    return {
      command_id: handle.session.id,
      task_id: handle.session.id,
      state: 'running',
      trace_id: handle.session.id,
    };
  },

  async stopTask(data: { task_id: string; project_id?: string }): Promise<StopTaskResponse> {
    const projectId = String(data.project_id || '').trim();
    const sessionId = resolveStopSessionId(data);
    const stopped = projectId
      ? await postJson<BeeGameSession>(`/api/projects/${encodeURIComponent(projectId)}/stop`, {})
      : await postJson<BeeGameSession>(`/api/beegame-sessions/${encodeURIComponent(sessionId)}/stop`, {});
    return {
      command_id: stopped.id || sessionId,
      task_id: stopped.id || sessionId,
      state: 'stopped',
      trace_id: stopped.id || sessionId,
    };
  },

  async getChatHistory(projectId: string): Promise<unknown[]> {
    const transcriptPage = await fetchProjectTranscriptPageIfAvailable(projectId);
    if (!transcriptPage) return [];
    chatHistoryCursorByProject.set(projectId, {
      ...transcriptPage.page,
      latestEventId: getLatestBeeGameEventId(transcriptPage.events),
    });
    return eventsToHistory(projectId, transcriptPage.events, transcriptPage.workspacePath);
  },

  async getOlderChatHistory(projectId: string): Promise<{
    messages: unknown[];
    hasMore: boolean;
  }> {
    const cursor = chatHistoryCursorByProject.get(projectId);
    if (!cursor?.hasMore || cursor.nextBeforeId === null) {
      return { messages: [], hasMore: false };
    }
    const transcriptPage = await fetchProjectTranscriptPage(projectId, cursor.nextBeforeId);
    chatHistoryCursorByProject.set(projectId, {
      ...transcriptPage.page,
      latestEventId: cursor.latestEventId,
    });
    return {
      messages: eventsToHistory(projectId, transcriptPage.events, transcriptPage.workspacePath),
      hasMore: transcriptPage.page.hasMore,
    };
  },

  getChatHistoryPaginationState(projectId: string): {
    initialized: boolean;
    hasMore: boolean;
  } {
    const cursor = chatHistoryCursorByProject.get(projectId);
    return {
      initialized: Boolean(cursor),
      hasMore: cursor?.hasMore === true,
    };
  },

  async pollMessages(projectId: string, afterEventId: number): Promise<{
    lastEventId: number;
    messages: ProjectEventMessage[];
  }> {
    const historyCursor = chatHistoryCursorByProject.get(projectId);
    const effectiveAfterEventId = afterEventId === 0
      ? (historyCursor?.latestEventId ?? 0) : afterEventId;
    let eventResult: BeeGameProjectEvents;
    try {
      eventResult = await fetchProjectEvents(projectId, effectiveAfterEventId);
    } catch (error) {
      if (isSessionNotFoundError(error)) {
        return { lastEventId: effectiveAfterEventId, messages: [] };
      }
      throw error;
    }
    const events = eventResult.events;
    const lastEventId = events.length > 0 ? events[events.length - 1].id : effectiveAfterEventId;
    const normalizedEvents = normalizeLiveEvents(projectId, events);
    const isInitialHistorySync = effectiveAfterEventId === 0;
    return {
      lastEventId,
      messages: normalizedEvents
        .flatMap(event => eventToProjectEventMessages(projectId, event, eventResult.workspacePath))
        // Chat history already renders persisted terminal failures. Replaying
        // them through the live channel would invoke onError again on every
        // dashboard mount and make a historical failure look current.
        .filter(message => !(isInitialHistorySync && message.type === 'error')),
    };
  },

  async getProjectStatus(projectId: string): Promise<ProjectBaselineStatusPayload> {
    return fetchProjectRuntimeState(projectId);
  },

  async getProjectRuntimeState(projectId: string): Promise<ProjectRuntimeStatePayload> {
    const runtimeState = await fetchProjectRuntimeState(projectId);
    const pendingPermissions = Array.isArray(runtimeState.pending_permissions)
      ? runtimeState.pending_permissions
      : [];
    return {
      status: runtimeState,
      pendingPermissions: pendingPermissions.map(permission => pendingPermissionToReview(projectId, permission)),
    };
  },

  async getPendingToolPermissions(projectId: string): Promise<{ items: PendingToolPermissionItem[] }> {
    const runtimeState = await fetchProjectRuntimeState(projectId);
    const pendingPermissions = Array.isArray(runtimeState.pending_permissions)
      ? runtimeState.pending_permissions
      : [];
    return {
      items: pendingPermissions.map(permission => pendingPermissionToReview(projectId, permission)),
    };
  },

  async resolveToolPermission(data: {
    project_id: string;
    gate_id: string;
    decision: 'allow' | 'deny';
    message?: string;
    scope?: 'once' | 'session';
  }): Promise<{ ok: boolean }> {
    await postJson(`/api/projects/${encodeURIComponent(data.project_id)}/permissions/${encodeURIComponent(data.gate_id)}`, {
      decision: data.decision,
      remember: false,
      scope: data.scope ?? 'once',
      ...(data.message ? { message: data.message } : {}),
    });
    return { ok: true };
  },

  async getArtifacts(projectId: string): Promise<BeeGameArtifact[]> {
    let eventResult: BeeGameProjectEvents;
    let artifactIndex: BeeGameProjectArtifactIndex;
    try {
      eventResult = await fetchProjectEvents(projectId);
      artifactIndex = await fetchProjectArtifactIndex(projectId).catch(() => ({
        sessionId: eventResult.sessionId,
        workspacePath: eventResult.workspacePath,
        artifacts: [],
      }));
    } catch (error) {
      if (isSessionNotFoundError(error)) return [];
      throw error;
    }
    const binding: ProjectSessionBinding = {
      projectId,
      sessionId: eventResult.sessionId,
      workspacePath: eventResult.workspacePath,
    };
    return [
      ...mergeArtifactsByPath([
        ...artifactIndex.artifacts
          .filter(artifact => !isInternalRuntimeArtifact(artifact))
          .map(artifact => discoveredArtifactToPanelArtifact(binding, artifact)),
        ...extractArtifacts(projectId, eventResult.events, eventResult.workspacePath),
      ]),
      {
        artifact_id: encodeProjectPackageArtifactId(projectId),
        id: encodeProjectPackageArtifactId(projectId),
        name: `${binding.workspacePath.split('/').filter(Boolean).at(-1) || 'project'}.zip`,
        artifact_type: 'Project Package',
        status: 'active',
        created_by: 'beegame',
        created_at: new Date().toISOString(),
        package_download: true,
      },
    ];
  },

  async getArtifactContent(artifactId: string): Promise<string> {
    const artifactRef = decodeArtifactId(artifactId);
    if (!artifactRef) throw new Error('Invalid BeeGame artifact id');
    const result = await fetchProjectArtifactContent(artifactRef.projectId, artifactRef.path);
    return result.content;
  },

  async downloadProjectPackage(projectId: string): Promise<{ blob: Blob; filename: string }> {
    const response = await fetchProjectPackage(projectId);
    if (!response.ok) {
      throw new Error(await getResponseErrorMessage(response));
    }
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || 'project.zip';
    return { blob: await response.blob(), filename };
  },

  async getProjectPreview(projectId: string): Promise<BeeGamePreviewPayload> {
    return getJson(`/api/projects/${encodeURIComponent(projectId)}/preview`);
  },

  async startProjectPreview(projectId: string): Promise<BeeGamePreviewPayload> {
    return postJson(`/api/projects/${encodeURIComponent(projectId)}/preview`, {});
  },

  async restartProjectPreview(projectId: string): Promise<BeeGamePreviewPayload> {
    return postJson(`/api/projects/${encodeURIComponent(projectId)}/preview/restart`, {});
  },

  async stopProjectPreview(projectId: string): Promise<BeeGamePreviewPayload> {
    return deleteJson<BeeGamePreviewPayload>(`/api/projects/${encodeURIComponent(projectId)}/preview`);
  },

  async deployProject(projectId: string): Promise<BeeGameDeploymentPayload> {
    return postJson(`/api/projects/${encodeURIComponent(projectId)}/deployments`, {});
  },

  async listProjectDeployments(projectId: string): Promise<BeeGameDeploymentPayload[]> {
    return getJson<BeeGameDeploymentPayload[]>(
      `/api/projects/${encodeURIComponent(projectId)}/deployments`,
    );
  },

  async rollbackProjectDeployment(projectId: string, deploymentId: string): Promise<BeeGameDeploymentPayload> {
    return postJson<BeeGameDeploymentPayload>(
      `/api/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}/rollback`,
      {},
    );
  },

  async getProjectAssets(projectId: string): Promise<BeeGameAssetManifestPayload> {
    return getJson<BeeGameAssetManifestPayload>(
      `/api/projects/${encodeURIComponent(projectId)}/assets`,
    );
  },

  async uploadProjectAsset(
    projectId: string,
    resourceId: string,
    file: File,
  ): Promise<BeeGameAssetUploadPayload> {
    const form = new FormData();
    form.set('file', file);
    return postForm<BeeGameAssetUploadPayload>(
      `/api/projects/${encodeURIComponent(projectId)}/assets/resources/${encodeURIComponent(resourceId)}/upload`,
      form,
    );
  },

  async getResourcePackImpact(packId: string): Promise<BeeGameResourcePackImpactPayload> {
    return getJson<BeeGameResourcePackImpactPayload>(`/api/resource-packs/${encodeURIComponent(packId)}/impact`)
  },

};

function createLocalProject(name: string, rootPath?: string, id = newProjectId()): Project {
  return {
    id,
    name: name.trim() || 'BeeGame Project',
    ...(rootPath ? { root_path: rootPath } : {}),
    created_at: Date.now(),
  };
}

function getLatestBeeGameEventId(events: BeeGameEvent[]): number {
  return events.reduce((latest, event) => Math.max(latest, event.id), 0);
}

function getBriefDisplayTitle(brief: BeeGameBuildBrief): string {
  return (
    (brief.title || brief.option.title || summarizeTitle(brief.idea)).trim() || 'BeeGame Project'
  )
}

function getBriefFolderName(brief: BeeGameBuildBrief, displayTitle: string): string {
  const candidates = [
    brief.option.projectFolderName,
    brief.option.title,
    displayTitle,
    brief.option.id,
  ];
  for (const candidate of candidates) {
    const folderName = slugifyPathSegment(candidate || '', '');
    if (folderName) return folderName;
  }
  return stableProjectFolderName(displayTitle || brief.idea);
}

function summarizeTitle(idea: string): string {
  const normalized = idea.replace(/\s+/g, ' ').trim();
  return normalized.length > 42 ? `${normalized.slice(0, 42)}...` : normalized || 'BeeGame Project';
}

function newProjectId(): string {
  return `project_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function deleteProjectMetadata(projectId: string): Promise<void> {
  try {
    await deleteJson(`/api/projects/${encodeURIComponent(projectId)}`);
  } catch (error) {
    if (isDeleteAlreadyGoneError(error)) return;
    throw error;
  }
}

function scopedAdapterCacheKey(baseKey: string): string {
  const userId = getSupabaseSessionUser()?.id?.trim();
  if (!userId) return baseKey;
  return `${baseKey}:${encodeURIComponent(userId)}`;
}

async function ensureProjectSession(projectId: string): Promise<BeeGameSessionHandle> {
  const response = await postJson<{
    session: BeeGameSession;
    binding?: ProjectSessionBinding;
    previousSessionId?: string;
  }>(`/api/projects/${encodeURIComponent(projectId)}/session/ensure`, {
    language: getCurrentUiLanguage(),
  });
  const binding = response.binding ?? {
    projectId,
    sessionId: response.session.id,
    workspacePath: response.session.cwd,
    language: getCurrentUiLanguage(),
  };
  return {
    session: response.session,
    binding,
    recoveredEvents: [],
    ...(response.previousSessionId ? { previousSessionId: response.previousSessionId } : {}),
  };
}

function resolveStopSessionId(data: { task_id: string; project_id?: string }): string {
  return String(data.task_id || '').trim();
}

function isSessionNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message === 'session not found' || message === 'not found';
}

function isDeleteAlreadyGoneError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message === 'session not found' ||
    message === 'not found' ||
    message.includes('enoent: no such file or directory')
  );
}

function readConfiguredWorkspaceRoot(): string {
  if (!ALLOW_CLIENT_WORKSPACE_ROOT) return '';
  const value = String(localStorage.getItem(WORKSPACE_ROOT_KEY) || '').trim();
  return isAbsolutePath(value) ? value : '';
}

async function resolveDefaultWorkspacePath(): Promise<string> {
  let fallback: { path: string };
  try {
    fallback = await getJson<{ path: string }>('/api/filesystem/default-workspace');
  } catch (error) {
    throw new Error(
      `无法获取默认 Workspace path，请重启 agent-workflow-server 后端服务。${error instanceof Error ? ` (${error.message})` : ''}`,
    );
  }
  if (!isAbsolutePath(fallback.path || '')) {
    throw new Error('后端没有返回可用的默认 Workspace path');
  }
  return fallback.path;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

function slugifyPathSegment(value: string, fallback = 'game-project'): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || fallback;
}

function stableProjectFolderName(value: string): string {
  return `game-project-${stableTextHash(value || 'BeeGame Project')}`;
}

function fetchProjectPackage(projectId: string): Promise<Response> {
  return authenticatedFetch(`/api/projects/${encodeURIComponent(projectId)}/package`);
}

function fetchProjectArtifactIndex(projectId: string): Promise<BeeGameProjectArtifactIndex> {
  return getJson(`/api/projects/${encodeURIComponent(projectId)}/artifact-index`);
}

function fetchProjectArtifactContent(
  projectId: string,
  path: string,
): Promise<{ path: string; content: string }> {
  return getJson(
    `/api/projects/${encodeURIComponent(projectId)}/artifacts?path=${encodeURIComponent(path)}`,
  );
}

async function getResponseErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await response.json().catch(() => ({}));
    const message = getJsonErrorMessage(body);
    if (message) return message;
  } else {
    const text = (await response.text().catch(() => '')).trim();
    if (text) return `Request failed with status ${response.status}: ${text.slice(0, 180)}`;
  }
  return `Request failed with status ${response.status}`;
}

async function sendBeeGameInput(
  sessionId: string,
  text: string,
  display?: {
    clientMessageId?: string;
    supersedesMessageId?: string;
    language?: BeeGameLanguage;
    attachments?: ChatAttachmentPayload[];
  },
): Promise<BeeGameSession> {
  return postJson(`/api/beegame-sessions/${encodeURIComponent(sessionId)}/input`, {
    text,
    ...(display?.clientMessageId ? { clientMessageId: display.clientMessageId } : {}),
    ...(display?.supersedesMessageId ? { supersedesMessageId: display.supersedesMessageId } : {}),
    ...(display?.language ? { language: display.language } : {}),
    ...(display?.attachments?.length ? { attachments: display.attachments } : {}),
  });
}

function fetchProjectEvents(projectId: string, after = 0): Promise<BeeGameProjectEvents> {
  return getJson(
    `/api/projects/${encodeURIComponent(projectId)}/events?after=${encodeURIComponent(String(after))}`,
  );
}

async function fetchProjectTranscriptPage(
  projectId: string,
  beforeId?: number,
): Promise<BeeGameProjectTranscriptPage> {
  const params = new URLSearchParams({
    limit: String(CHAT_HISTORY_PAGE_SIZE),
  });
  if (beforeId !== undefined) params.set('before', String(beforeId));
  return getJson(
    `/api/projects/${encodeURIComponent(projectId)}/transcript?${params.toString()}`,
  );
}

async function fetchProjectTranscriptPageIfAvailable(
  projectId: string,
): Promise<BeeGameProjectTranscriptPage | undefined> {
  try {
    return await fetchProjectTranscriptPage(projectId);
  } catch {
    return undefined;
  }
}

function eventsToHistory(projectId: string, events: BeeGameEvent[], workspacePath = ''): unknown[] {
  const normalizedEvents = normalizeDisplayEvents(events);
  const messages = normalizedEvents
    .flatMap(event => eventToProjectEventMessages(projectId, event, workspacePath))
    .filter(message => message.type !== 'think_start' && message.type !== 'think_end');
  return messages.map(message => ({
    id: message.message_id || `${message.type}-${message.task_id}-${Date.now()}`,
    message_id: message.message_id,
    sender: message.sender || 'system',
    content: message.content || '',
    task_id: message.task_id,
    timestamp: message.timestamp || Date.now(),
    type: message.type === 'agent_message' ? 'text' : message.type === 'tool_start' || message.type === 'tool_end' ? 'tool' : 'normal',
    renderHint: message.render_hint,
    artifactType: message.artifact_type,
    taskKind: message.task_kind,
    nextAction: message.next_action,
    requiresUserAction: message.requires_user_action,
    toolName: message.tool,
    toolStatus: message.tool_status,
    toolDetail: message.tool_detail,
    toolOutput: message.tool_output,
    artifactId: message.artifact_id,
    isSubagentTool: message.is_subagent_tool,
  }));
}

function eventToProjectEventMessages(projectId: string, event: BeeGameEvent, workspacePath = ''): ProjectEventMessage[] {
  const taskId = event.sessionId;
  switch (event.type) {
    case 'user.message':
      return [baseMessage('agent_message', { ...event, text: resolveUserMessageDisplayText(event) }, projectId, 'user')];
    case 'turn.started':
      return [
        { type: 'status', task_id: taskId, project_id: projectId, status: 'running' } as ProjectEventMessage,
      ];
    case 'system.status':
      return [];
    case 'assistant.partial':
      return [];
    case 'assistant.thinking':
      {
        const status = getPayloadString(event, 'status');
        const thinkingMessageId = `beegame-thinking-${event.turnId || event.sessionId}`;
        if (status === 'ended') {
          return [{
            type: 'think_end',
            task_id: taskId,
            project_id: projectId,
            sender: 'beegame',
            message_id: thinkingMessageId,
            timestamp: Date.parse(event.createdAt) || Date.now(),
          } as ProjectEventMessage];
        }
        return [{
          type: 'think_start',
          task_id: taskId,
          project_id: projectId,
          sender: 'beegame',
          content: event.text || 'Thinking',
          task_kind: 'assistant_thinking',
          message_id: thinkingMessageId,
          timestamp: Date.parse(event.createdAt) || Date.now(),
        } as ProjectEventMessage];
      }
    case 'assistant.message': {
      const usage = getUsageFromEventPayload(event.payload);
      return [
        baseMessage('agent_message', event, projectId, 'beegame'),
        ...(usage ? [{
          type: 'usage',
          task_id: taskId,
          project_id: projectId,
          usage,
          timestamp: Date.parse(event.createdAt) || Date.now(),
        } as ProjectEventMessage] : []),
      ];
    }
    case 'result': {
      const usage = getUsageFromEventPayload(event.payload);
      return usage ? [{
        type: 'usage',
        task_id: taskId,
        project_id: projectId,
        usage,
        timestamp: Date.parse(event.createdAt) || Date.now(),
      } as ProjectEventMessage] : [];
    }
    case 'tool.started':
      if (Object.keys(getPayloadRecord(event, 'input')).length === 0) return [];
      const startedInput = getPayloadRecord(event, 'input');
      const startedTool = getPayloadString(event, 'toolName') || event.text;
      const startedInfo = getToolDisplayInfo(startedTool, 'running', startedInput, workspacePath);
      const startedArtifactPath = getArtifactPath(startedTool, startedInput);
      return [{
        type: 'tool_start',
        task_id: taskId,
        project_id: projectId,
        message_id: getToolMessageId(event),
        tool_use_id: getPayloadString(event, 'toolUseID'),
        tool: startedTool,
        content: formatToolContent(startedInfo),
        tool_status: startedInfo.status,
        tool_detail: startedInfo.detail,
        artifact_id: startedArtifactPath ? encodeArtifactId(projectId, event.sessionId, startedArtifactPath) : undefined,
        artifact_path: startedArtifactPath ? toWorkspaceRelativePath(startedArtifactPath, workspacePath) : undefined,
        is_subagent_tool: startedInfo.isSubagent,
        timestamp: Date.parse(event.createdAt) || Date.now(),
      } as ProjectEventMessage];
    case 'tool.progress': {
      const progressInput = getPayloadRecord(event, 'input');
      const progressTool = getPayloadString(event, 'toolName') || event.text;
      const output = typeof event.payload?.output === 'string' ? event.payload.output : event.text;
      const progressInfo = getToolDisplayInfo(progressTool, 'running', progressInput, workspacePath, output);
      const progressArtifactPath = getArtifactPath(progressTool, progressInput);
      return [{
        type: 'tool_start',
        task_id: taskId,
        project_id: projectId,
        message_id: getToolMessageId(event),
        tool_use_id: getPayloadString(event, 'toolUseID'),
        tool: progressTool,
        content: formatToolContent(progressInfo),
        tool_status: progressInfo.status,
        tool_detail: progressInfo.detail,
        tool_output: progressInfo.output,
        artifact_id: progressArtifactPath ? encodeArtifactId(projectId, event.sessionId, progressArtifactPath) : undefined,
        artifact_path: progressArtifactPath ? toWorkspaceRelativePath(progressArtifactPath, workspacePath) : undefined,
        is_subagent_tool: progressInfo.isSubagent,
        timestamp: Date.parse(event.createdAt) || Date.now(),
      } as ProjectEventMessage];
    }
    case 'tool.completed':
    case 'tool.failed': {
      const finishedInput = getPayloadRecord(event, 'input');
      const finishedTool = getPayloadString(event, 'toolName') || event.text;
      const output = typeof event.payload?.output === 'string' ? event.payload.output : event.text;
      const finishedInfo = getToolDisplayInfo(finishedTool, event.type === 'tool.failed' ? 'failed' : 'completed', finishedInput, workspacePath, output);
      const finishedArtifactPath = getArtifactPath(finishedTool, finishedInput);
      return [{
        type: 'tool_end',
        task_id: taskId,
        project_id: projectId,
        message_id: getToolMessageId(event),
        tool_use_id: getPayloadString(event, 'toolUseID'),
        tool: finishedTool,
        output,
        content: formatToolContent(finishedInfo),
        tool_status: finishedInfo.status,
        tool_detail: finishedInfo.detail,
        tool_output: finishedInfo.output,
        artifact_id: finishedArtifactPath ? encodeArtifactId(projectId, event.sessionId, finishedArtifactPath) : undefined,
        artifact_path: finishedArtifactPath ? toWorkspaceRelativePath(finishedArtifactPath, workspacePath) : undefined,
        is_subagent_tool: finishedInfo.isSubagent,
        timestamp: Date.parse(event.createdAt) || Date.now(),
      } as ProjectEventMessage];
    }
    case 'permission.requested':
      return [{
        type: 'human_gate',
        task_id: taskId,
        project_id: projectId,
        message_id: getPermissionRequestMessageId(event),
        content: event.text,
        sender: 'beegame',
        task_kind: 'permission_request',
        requires_user_action: true,
        timestamp: Date.parse(event.createdAt) || Date.now(),
      } as ProjectEventMessage];
    case 'permission.resolved': {
      const decision = getPayloadString(event, 'decision');
      if (decision !== 'deny') return [];
      return [baseMessage('agent_message', {
        ...event,
        text: describePermissionResolution(event),
      }, projectId, 'system')];
    }
    case 'turn.completed': {
      return [{ type: 'status', task_id: taskId, project_id: projectId, status: 'idle' } as ProjectEventMessage];
    }
    case 'turn.empty':
      return [
        baseMessage('agent_message', event, projectId, 'system'),
        { type: 'status', task_id: taskId, project_id: projectId, status: 'idle' } as ProjectEventMessage,
      ];
    case 'session.stopped':
      return [{ type: 'status', task_id: taskId, project_id: projectId, status: 'stopped' } as ProjectEventMessage];
    case 'turn.failed':
    case 'session.failed':
      return [{ type: 'error', task_id: taskId, project_id: projectId, content: event.text, error: event.text } as ProjectEventMessage];
    default:
      return [];
  }
}

function normalizeDisplayEvents(events: BeeGameEvent[]): BeeGameEvent[] {
  return normalizeBeeGameEvents(events, {
    includeUserMessages: true,
    includePartialsWhenFinalExists: false,
  });
}

function normalizeBeeGameEvents(
  events: BeeGameEvent[],
  options: { includeUserMessages: boolean; includePartialsWhenFinalExists: boolean },
): BeeGameEvent[] {
  events = coalesceLogicalAssistantMessages(events);
  const visible: BeeGameEvent[] = [];
  const terminalEventByTurn = new Map<string, number>();
  for (const event of events) {
    if (!event.turnId || !isTurnTerminalEvent(event)) continue;
    const existing = terminalEventByTurn.get(event.turnId);
    if (existing === undefined || event.id < existing) terminalEventByTurn.set(event.turnId, event.id);
  }
  const seenUserTexts = new Set<string>();
  const turnsWithFinal = new Set(
    events
      .filter(event => event.type === 'assistant.message')
      .map(getTurnDisplayId),
  );
  let bufferedPartial: BeeGameEvent | null = null;
  let bufferedThinking: BeeGameEvent | null = null;
  const flushPartial = () => {
    if (bufferedPartial) {
      visible.push(bufferedPartial);
      bufferedPartial = null;
    }
  };
  const flushThinking = () => {
    if (bufferedThinking) {
      visible.push(bufferedThinking);
      bufferedThinking = null;
    }
  };
  for (const event of events) {
    if (isLateRuntimeEvent(event, terminalEventByTurn)) continue;
    if (event.type !== 'assistant.partial') {
      flushPartial();
    }
    if (event.type !== 'assistant.thinking') {
      flushThinking();
    }
    if (event.type === 'user.message') {
      if (!options.includeUserMessages) continue;
      const displayText = resolveUserMessageDisplayText(event);
      if (seenUserTexts.has(displayText)) continue;
      seenUserTexts.add(displayText);
      visible.push(event);
      continue;
    }
    if (event.type === 'system.status' && event.text.trim().toLowerCase() === 'system') {
      continue;
    }
    if (event.type === 'result' && !getUsageFromEventPayload(event.payload)) {
      continue;
    }
    if (event.type === 'tool.started' && Object.keys(getPayloadRecord(event, 'input')).length === 0) {
      continue;
    }
    if (event.type === 'assistant.partial') {
      if (!options.includePartialsWhenFinalExists && turnsWithFinal.has(getTurnDisplayId(event))) {
        continue;
      }
      if (bufferedPartial && getTurnDisplayId(bufferedPartial) === getTurnDisplayId(event)) {
        bufferedPartial = Object.assign({}, bufferedPartial, {
          id: event.id,
          text: `${bufferedPartial.text}${event.text}`,
          createdAt: event.createdAt,
        });
      } else {
        flushPartial();
        bufferedPartial = event;
      }
      continue;
    }
    if (event.type === 'assistant.thinking') {
      if (!options.includePartialsWhenFinalExists && turnsWithFinal.has(getTurnDisplayId(event))) {
        continue;
      }
      if (getPayloadString(event, 'status') === 'ended') {
        flushThinking();
        visible.push(event);
        continue;
      }
      if (bufferedThinking && getTurnDisplayId(bufferedThinking) === getTurnDisplayId(event)) {
        bufferedThinking = event;
      } else {
        flushThinking();
        bufferedThinking = event;
      }
      continue;
    }
    visible.push(event);
  }
  flushPartial();
  flushThinking();
  return visible;
}

function coalesceLogicalAssistantMessages(events: BeeGameEvent[]): BeeGameEvent[] {
  const representativeByMessage = new Map<string, {
    event: BeeGameEvent;
    payloadText: string;
    longestVisibleText: string;
  }>();
  const suppressedEventIds = new Set<number>();

  for (const event of events) {
    if (event.type !== 'assistant.message') continue;
    const messageId = getAssistantPayloadMessageId(event);
    if (!messageId) continue;
    const identity = `${event.sessionId}:${event.turnId ?? ''}:${messageId}`;
    const payloadText = getAssistantPayloadVisibleText(event);
    const existing = representativeByMessage.get(identity);
    if (!existing) {
      representativeByMessage.set(identity, {
        event,
        payloadText,
        longestVisibleText: event.text,
      });
      continue;
    }
    existing.payloadText += payloadText;
    if (event.text.length > existing.longestVisibleText.length) {
      existing.longestVisibleText = event.text;
    }
    suppressedEventIds.add(event.id);
  }

  const replacementByEventId = new Map<number, BeeGameEvent>();
  for (const { event, payloadText, longestVisibleText } of representativeByMessage.values()) {
    const text = payloadText.length >= longestVisibleText.length
      ? payloadText
      : longestVisibleText;
    replacementByEventId.set(event.id, text === event.text ? event : { ...event, text });
  }

  return events.flatMap(event => {
    if (suppressedEventIds.has(event.id)) return [];
    return [replacementByEventId.get(event.id) ?? event];
  });
}

function getAssistantPayloadMessageId(event: BeeGameEvent): string {
  if (!event.payload) return '';
  const message = event.payload.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return '';
  const id = (message as Record<string, unknown>).id;
  return typeof id === 'string' ? id.trim() : '';
}

function getAssistantPayloadVisibleText(event: BeeGameEvent): string {
  if (!event.payload) return '';
  const message = event.payload.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return '';
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return '';
  return content.map(block => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return '';
    const record = block as Record<string, unknown>;
    return record.type === 'text' && typeof record.text === 'string' ? record.text : '';
  }).join('');
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

function isLateRuntimeEvent(event: BeeGameEvent, terminalEventByTurn: Map<string, number>): boolean {
  if (!event.turnId) return false;
  const terminalId = terminalEventByTurn.get(event.turnId);
  if (terminalId === undefined || event.id <= terminalId) return false;
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

function normalizeLiveEvents(_projectId: string, events: BeeGameEvent[]): BeeGameEvent[] {
  return normalizeBeeGameEvents(events, {
    includeUserMessages: false,
    includePartialsWhenFinalExists: true,
  });
}

function baseMessage(type: 'token' | 'agent_message', event: BeeGameEvent, projectId: string, sender: string): ProjectEventMessage {
  const clientMessageId = sender === 'user'
    ? getPayloadString(event, 'clientMessageId') || getPayloadString(event, 'client_message_id')
    : '';
  const supersedesMessageId = sender === 'user'
    ? getPayloadString(event, 'supersedesMessageId') || getPayloadString(event, 'supersedes_message_id')
    : '';
  const messageId = sender === 'beegame'
    ? getBeeGameAssistantMessageId(event)
    : clientMessageId || `beegame-event-${event.id}`;
  return {
    type,
    task_id: event.sessionId,
    project_id: projectId,
    sender,
    content: event.text,
    message_id: messageId,
    ...(clientMessageId ? { client_message_id: clientMessageId } : {}),
    ...(supersedesMessageId ? { supersedes_message_id: supersedesMessageId } : {}),
    timestamp: Date.parse(event.createdAt) || Date.now(),
  } as ProjectEventMessage;
}

function describePermissionResolution(event: BeeGameEvent): string {
  const toolName = getPayloadString(event, 'toolName') || 'tool';
  const reason = getPayloadString(event, 'reason');
  if (getPayloadBoolean(event, 'autoDenied')) {
    return reason ? `BeeGame blocked ${toolName}: ${reason}` : `BeeGame blocked ${toolName}.`;
  }
  return reason ? `${toolName} denied: ${reason}` : `${toolName} denied.`;
}

function getBeeGameAssistantMessageId(event: BeeGameEvent): string {
  const displayMessageId = getPayloadString(event, DISPLAY_MESSAGE_ID_KEY);
  if (displayMessageId) return displayMessageId;
  if (event.type === 'assistant.message') return getFinalAssistantMessageId(event);
  if (event.type === 'assistant.partial') return `beegame-partial-${getTurnDisplayId(event)}-${event.id}`;
  return `beegame-event-${event.id}`;
}

function getPermissionRequestMessageId(event: BeeGameEvent): string {
  const toolUseID = getPayloadString(event, 'toolUseID');
  if (toolUseID) return `beegame-permission-${event.sessionId}-${toolUseID}`;
  return `beegame-permission-${event.sessionId}-${event.id}`;
}

function getToolMessageId(event: BeeGameEvent): string {
  const toolUseId = getPayloadString(event, 'toolUseID');
  if (toolUseId) return `beegame-tool-${event.sessionId}-${toolUseId}`;
  return `beegame-event-${event.id}`;
}

type ToolDisplayInfo = {
  name: string;
  status: 'running' | 'completed' | 'failed';
  detail: string;
  output: string;
  isSubagent: boolean;
};

function getToolDisplayInfo(
  toolName: string,
  status: 'running' | 'completed' | 'failed',
  input: Record<string, unknown>,
  workspacePath: string,
  output = '',
): ToolDisplayInfo {
  const normalizedTool = toolName.toLowerCase();
  const isSubagent = normalizedTool === 'agent' || normalizedTool === 'task';
  const description = String(input.description || '').trim();
  const subagentType = String(input.subagent_type || input.agent_type || '').trim();
  const prompt = String(input.prompt || '').trim();
  const name = isSubagent ? description || toolName : toolName;
  const details: string[] = [];
  if (isSubagent && subagentType) {
    details.push(`Type: ${subagentType}`);
  }
  if (isSubagent && prompt) {
    details.push(`Prompt: ${prompt.length > 220 ? `${prompt.slice(0, 220)}...` : prompt}`);
  }
  const command = String(input.command || '').trim();
  const targetPath = String(input.file_path || input.path || input.notebook_path || '').trim();
  if (!isSubagent && command) {
    details.push(`Command: ${command}`);
  } else if (!isSubagent && targetPath) {
    details.push(`Target: ${formatWorkspaceRelativePath(targetPath, workspacePath)}`);
  }
  const outputSummary = output.length > 160 ? `${output.slice(0, 160)}...` : output;
  return {
    name,
    status,
    detail: details.join(' · '),
    output: outputSummary,
    isSubagent,
  };
}

function formatToolContent(info: ToolDisplayInfo): string {
  const lines = info.isSubagent
    ? [`Subagent: ${info.name}`, `Status: ${info.status}`]
    : [`Tool: ${info.name}`, `Status: ${info.status}`];
  if (info.detail) {
    lines.push(info.detail);
  }
  if (info.output) {
    lines.push(`Output: ${info.output}`);
  }
  return lines.join('\n');
}

function formatWorkspaceRelativePath(path: string, workspacePath: string): string {
  const normalizedPath = path.replaceAll('\\', '/');
  const normalizedWorkspace = workspacePath.replaceAll('\\', '/').replace(/\/+$/, '');
  if (normalizedWorkspace && normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedPath.slice(normalizedWorkspace.length + 1);
  }
  return normalizedPath.split('/').filter(Boolean).slice(-2).join('/') || path;
}

function getUsageFromEventPayload(payload?: Record<string, unknown>): { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null {
  const usage = getUsageRecord(payload);
  if (!usage) return null;
  const promptTokens = normalizePositiveNumber(usage.input_tokens ?? usage.prompt_tokens);
  const completionTokens = normalizePositiveNumber(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = normalizePositiveNumber(usage.total_tokens, promptTokens + completionTokens);
  if (!promptTokens && !completionTokens && !totalTokens) return null;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

function getUsageRecord(payload?: Record<string, unknown>): Record<string, unknown> | null {
  if (!payload) return null;
  const directUsage = payload.usage;
  if (directUsage && typeof directUsage === 'object' && !Array.isArray(directUsage)) {
    return directUsage as Record<string, unknown>;
  }
  const message = payload.message;
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const messageUsage = (message as Record<string, unknown>).usage;
  if (messageUsage && typeof messageUsage === 'object' && !Array.isArray(messageUsage)) {
    return messageUsage as Record<string, unknown>;
  }
  return null;
}

function normalizePositiveNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  return Math.max(0, fallback);
}

function getFinalAssistantMessageId(event: BeeGameEvent): string {
  const upstreamMessageId = getAssistantPayloadMessageId(event);
  return upstreamMessageId
    ? `beegame-assistant-${event.sessionId}-${upstreamMessageId}`
    : `beegame-event-${event.id}`;
}

function getTurnDisplayId(event: BeeGameEvent): string {
  return event.turnId || `beegame-turn-${event.sessionId}-${event.id}`;
}

function normalizeIdeaIntakeResult(
  response: Partial<BeeGameIdeaIntakeResult> & { options?: BeeGameIntakeOption[] },
): BeeGameIdeaIntakeResult {
  const options = (response.options || []).map((option) => normalizeIntakeOption(option));
  const maturity = response.maturity === 'directional' || response.maturity === 'concrete' || response.maturity === 'vague'
    ? response.maturity
    : 'vague';
  return {
    maturity,
    needsClarification: false,
    clarificationQuestions: [],
    detectedConstraints: Array.isArray(response.detectedConstraints) ? response.detectedConstraints.map(String).filter(Boolean) : [],
    recommendedNextStep: typeof response.recommendedNextStep === 'string' && response.recommendedNextStep
      ? response.recommendedNextStep
      : 'choose_direction',
    options,
  };
}

function normalizeIntakeOption(option: BeeGameIntakeOption): BeeGameIntakeOption {
  const rawOption = option as BeeGameIntakeOption & {
    project_folder_name?: string;
    recommended_platform?: string;
    recommended_engine?: string;
    recommended_dimension?: string;
    recommended_genre?: string;
    recommended_style?: string;
    recommended_inputs?: unknown;
  };
  const recommendedInputs = Array.isArray(option.recommendedInputs)
    ? option.recommendedInputs
    : Array.isArray(rawOption.recommended_inputs)
      ? rawOption.recommended_inputs.map(String).filter(Boolean)
      : [];
  return {
    ...option,
    projectFolderName: option.projectFolderName || rawOption.project_folder_name || '',
    coreGameplayHypothesis: option.coreGameplayHypothesis || option.coreMechanic || option.gameplay,
    experienceSnapshot: option.experienceSnapshot || option.pitch,
    playerFirstMinute: option.playerFirstMinute || option.gameplay,
    whyFitsIdea: option.whyFitsIdea || option.fit || option.pitch,
    playablePrototype: option.playablePrototype || option.firstBuild || option.firstPlayableValidation || option.gameplay,
    validationTarget: option.validationTarget || option.validationGoal || option.firstPlayableValidation || option.gameplay,
    coreMechanic: option.coreMechanic || option.coreGameplayHypothesis || option.gameplay,
    firstBuild: option.firstBuild || option.playablePrototype || option.firstPlayableValidation || option.gameplay,
    validationGoal: option.validationGoal || option.validationTarget || option.firstPlayableValidation || option.gameplay,
    risk: option.risk || option.riskComplexity || '复杂度取决于最终范围，需要先控制第一版目标。',
    fit: option.fit || option.pitch,
    firstPlayableValidation: option.firstPlayableValidation || option.gameplay,
    riskComplexity: option.riskComplexity || '复杂度取决于最终范围，需要先控制第一版目标。',
    recommendedPlatform: option.recommendedPlatform || rawOption.recommended_platform || '',
    recommendedEngine: option.recommendedEngine || rawOption.recommended_engine || '',
    recommendedDimension: option.recommendedDimension || rawOption.recommended_dimension || '',
    recommendedGenre: option.recommendedGenre || rawOption.recommended_genre || '',
    recommendedStyle: option.recommendedStyle || rawOption.recommended_style || '',
    recommendedInputs,
  };
}

function normalizeBeeGameLanguage(language: string | undefined): BeeGameLanguage {
  const normalized = String(language || '').trim();
  if (normalized === 'zh-TW' || normalized === 'zh-HK') return 'zh-TW';
  if (normalized === 'zh' || normalized === 'zh-CN' || normalized === 'zh-Hans') return 'zh';
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja';
  if (normalized === 'ko' || normalized.startsWith('ko-')) return 'ko';
  if (normalized === 'fr' || normalized.startsWith('fr-')) return 'fr';
  if (normalized === 'de' || normalized.startsWith('de-')) return 'de';
  if (normalized === 'es' || normalized.startsWith('es-')) return 'es';
  if (normalized === 'it' || normalized.startsWith('it-')) return 'it';
  if (normalized === 'pt' || normalized.startsWith('pt-')) return 'pt';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  return 'zh';
}

function getCurrentUiLanguage(): BeeGameLanguage {
  const language = String(localStorage.getItem('i18nextLng') || 'zh').trim();
  return normalizeBeeGameLanguage(language);
}

function resolveSentDisplayText(sessionId: string, transportText: string): string {
  const values = readJson<Record<string, string>>(scopedAdapterCacheKey(SENT_DISPLAY_KEY), {});
  return (
    values[`${sessionId}:${stableTextHash(transportText)}`] || transportText
  )
}

function resolveUserMessageDisplayText(event: BeeGameEvent): string {
  const displayText = typeof event.payload?.displayText === 'string'
    ? event.payload.displayText.trim()
    : '';
  return displayText || resolveSentDisplayText(event.sessionId, event.text);
}

function stableTextHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function extractArtifacts(projectId: string, events: BeeGameEvent[], workspacePath: string): BeeGameArtifact[] {
  const artifacts = new Map<string, BeeGameArtifact>();
  for (const event of events) {
    if (event.type !== 'tool.started' && event.type !== 'tool.completed') continue;
    const toolName = getPayloadString(event, 'toolName') || '';
    const input = getPayloadRecord(event, 'input');
    const path = toWorkspaceRelativePath(getArtifactPath(toolName, input), workspacePath);
    if (!path) continue;
    if (!isDeliverableDocPath(path)) continue;
    const artifactId = encodeArtifactId(projectId, event.sessionId, path);
    artifacts.set(path, {
      artifact_id: artifactId,
      id: artifactId,
      name: path.split('/').filter(Boolean).at(-1) || path,
      artifact_type: toolName || 'File',
      path,
      status: 'active',
      created_by: 'beegame',
      created_at: event.createdAt,
    });
  }
  return [...artifacts.values()].sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')));
}

function discoveredArtifactToPanelArtifact(
  binding: ProjectSessionBinding,
  artifact: BeeGameDiscoveredArtifact,
): BeeGameArtifact {
  const artifactId = encodeArtifactId(binding.projectId, binding.sessionId, artifact.path);
  return {
    artifact_id: artifactId,
    id: artifactId,
    name: artifact.name || artifact.path.split('/').filter(Boolean).at(-1) || artifact.path,
    artifact_type: artifact.artifact_type || 'File',
    path: artifact.path,
    status: 'active',
    created_by: 'beegame',
    created_at: artifact.created_at || new Date().toISOString(),
  };
}

function isInternalRuntimeArtifact(artifact: BeeGameDiscoveredArtifact): boolean {
  const artifactType = String(artifact.artifact_type || '').toLowerCase();
  const normalizedPath = artifact.path.split('\\').join('/').replace(/^\.\/+/, '');
  return (
    artifactType === 'transcript' || normalizedPath.startsWith('transcripts/')
  )
}

function mergeArtifactsByPath(artifacts: BeeGameArtifact[]): BeeGameArtifact[] {
  const byPath = new Map<string, BeeGameArtifact>();
  for (const artifact of artifacts) {
    const path = String(artifact.path || artifact.name || artifact.id || '');
    if (!path) continue;
    byPath.set(path, {
      ...(byPath.get(path) || {}),
      ...artifact,
    });
  }
  return [...byPath.values()].sort((a, b) => String(a.path || '').localeCompare(String(b.path || '')));
}

function toWorkspaceRelativePath(path: string, workspacePath: string): string {
  const normalized = path.split('\\').join('/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  const normalizedWorkspace = workspacePath.split('\\').join('/').replace(/\/+$/, '');
  if (normalizedWorkspace && normalized.startsWith(`${normalizedWorkspace}/`)) {
    return normalized.slice(normalizedWorkspace.length + 1);
  }
  return normalized;
}

function isDeliverableDocPath(path: string): boolean {
  const normalized = path.split('\\').join('/').replace(/^\.\/+/, '');
  return normalized.startsWith('docs/') && /\.md$/i.test(normalized);
}

function getArtifactPath(toolName: string, input: Record<string, unknown>): string {
  const normalizedTool = toolName.toLowerCase();
  if (!['write', 'edit', 'multiedit', 'notebookedit'].includes(normalizedTool)) return '';
  return String(input.file_path || input.path || input.notebook_path || '').trim();
}

function encodeProjectPackageArtifactId(projectId: string): string {
  return `${PROJECT_PACKAGE_ARTIFACT_PREFIX}${encodeURIComponent(projectId)}`;
}

export function isBeeGameProjectPackageArtifactId(artifactId: string): boolean {
  return artifactId.startsWith(PROJECT_PACKAGE_ARTIFACT_PREFIX);
}

function encodeArtifactId(projectId: string, sessionId: string, path: string): string {
  return `${ARTIFACT_ID_PREFIX}${encodeURIComponent(projectId)}:${encodeURIComponent(sessionId)}:${encodeURIComponent(path)}`;
}

function decodeArtifactId(artifactId: string): { projectId: string; sessionId: string; path: string } | null {
  if (!artifactId.startsWith(ARTIFACT_ID_PREFIX)) return null;
  const parts = artifactId.slice(ARTIFACT_ID_PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  return {
    projectId: decodeURIComponent(parts[0]),
    sessionId: decodeURIComponent(parts[1]),
    path: decodeURIComponent(parts[2]),
  };
}

function permissionEventToReview(event: BeeGameEvent, binding: ProjectSessionBinding): PendingToolPermissionItem {
  const toolUseID = getPayloadString(event, 'toolUseID');
  const toolName = getPayloadString(event, 'toolName') || 'BeeGame tool';
  const input = event.payload?.input && typeof event.payload.input === 'object'
    ? (event.payload.input as Record<string, unknown>)
      : {};
  const summary = summarizePermissionRequest(toolName, event.text, input);
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
  };
}

function pendingPermissionToReview(
  projectId: string,
  permission: BeeGamePendingPermissionPayload,
): PendingToolPermissionItem {
  const sessionId = String(permission.session_id || projectId);
  const toolUseID = String(permission.id || permission.event_id || '');
  const toolName = String(permission.tool_name || 'BeeGame tool');
  const event: BeeGameEvent = {
    id: typeof permission.event_id === 'number' ? permission.event_id : 0,
    sessionId,
    type: 'permission.requested',
    text: String(permission.message || toolName),
    payload: {
      type: 'permission.requested',
      toolUseID,
      toolName,
      input: permission.input && typeof permission.input === 'object' && !Array.isArray(permission.input)
        ? (permission.input as Record<string, unknown>)
          : {},
    },
    createdAt: String(permission.created_at || new Date().toISOString()),
  };
  return permissionEventToReview(event, {
    projectId,
    sessionId,
    workspacePath: '',
  });
}

function summarizePermissionRequest(
  toolName: string,
  message: string,
  input: Record<string, unknown>,
): { title: string; description: string; blockReason: string; nextAction: string } {
  const command = String(input.command || '').trim();
  const path = String(input.path || input.file_path || input.notebook_path || '').trim();
  const target = command || path;
  if (message.includes('was blocked') && message.includes('allowed working directories')) {
    return {
      title: 'Workspace boundary',
      description: message,
      blockReason: 'BeeGame attempted to access a path outside the active workspace.',
      nextAction: 'Deny this request, or restart the backend with AGENT_WORKFLOW_WORKSPACE_PATH set to the directory BeeGame should operate in.',
    };
  }
  return {
    title: `${toolName} permission`,
    description: target ? `${toolName}: ${target}` : message,
    blockReason: message,
    nextAction: 'Allow to continue this BeeGame turn, or deny to ask BeeGame to choose another approach.',
  };
}

function getPayloadString(event: BeeGameEvent, field: string): string {
  const value = event.payload?.[field];
  return typeof value === 'string' ? value : '';
}

function getPayloadBoolean(event: BeeGameEvent, field: string): boolean {
  return event.payload?.[field] === true;
}

function getPayloadRecord(event: BeeGameEvent, field: string): Record<string, unknown> {
  const value = event.payload?.[field];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type BeeGameIntakeJobCreated = {
  jobId: string;
  status: 'running';
};

type BeeGameIntakeJobPoll =
  | { status: 'running' }
  | { status: 'completed'; result: Partial<BeeGameIdeaIntakeResult> & { options?: BeeGameIntakeOption[] } }
  | { status: 'failed'; error?: string };

const BEEGAME_INTAKE_JOB_POLL_INTERVAL_MS = 1500;
const BEEGAME_INTAKE_JOB_MAX_POLLS = 240;
const BEEGAME_INTAKE_JOB_MAX_RETRY_INTERVAL_MS = 10_000;
const BEEGAME_INTAKE_JOB_RECOVERABLE_STATUSES = new Set([408, 429, 502, 503, 504]);

function buildIdeaIntakeRequestBody(data: BeeGameIdeaIntakeRequest): BeeGameIdeaIntakeRequest {
  const language = normalizeBeeGameLanguage(data.language ?? getCurrentUiLanguage());
  return {
    idea: data.idea,
    language,
    clientRequestId: data.clientRequestId ?? createClientRequestId(),
  };
}

function createClientRequestId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function runIdeaIntakeJob(requestBody: BeeGameIdeaIntakeRequest): Promise<Partial<BeeGameIdeaIntakeResult> & { options?: BeeGameIntakeOption[] }> {
  const createResponse = await authenticatedFetch('/api/beegame-intake/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  const created = await readResponse<BeeGameIntakeJobCreated>(createResponse);
  let retryIntervalMs = BEEGAME_INTAKE_JOB_POLL_INTERVAL_MS;
  const deadlineAt = Date.now() +
    BEEGAME_INTAKE_JOB_POLL_INTERVAL_MS * BEEGAME_INTAKE_JOB_MAX_POLLS
  for (let index = 0; index < BEEGAME_INTAKE_JOB_MAX_POLLS; index += 1) {
    if (Date.now() >= deadlineAt) break;
    let response: Response;
    try {
      response = await authenticatedFetch(`/api/beegame-intake/jobs/${encodeURIComponent(created.jobId)}`);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      await sleep(Math.min(retryIntervalMs, Math.max(0, deadlineAt - Date.now())));
      retryIntervalMs = Math.min(retryIntervalMs * 2, BEEGAME_INTAKE_JOB_MAX_RETRY_INTERVAL_MS);
      continue;
    }
    if (BEEGAME_INTAKE_JOB_RECOVERABLE_STATUSES.has(response.status)) {
      await sleep(Math.min(retryIntervalMs, Math.max(0, deadlineAt - Date.now())));
      retryIntervalMs = Math.min(retryIntervalMs * 2, BEEGAME_INTAKE_JOB_MAX_RETRY_INTERVAL_MS);
      continue;
    }
    const poll = await readResponse<BeeGameIntakeJobPoll>(response);
    retryIntervalMs = BEEGAME_INTAKE_JOB_POLL_INTERVAL_MS;
    if (poll.status === 'completed') return poll.result;
    if (poll.status === 'failed') throw new Error(poll.error || 'BeeGame intake failed');
    await sleep(BEEGAME_INTAKE_JOB_POLL_INTERVAL_MS);
  }
  throw new Error('BeeGame intake timed out');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getJson<T>(path: string): Promise<T> {
  const response = await authenticatedFetch(path);
  return readResponse<T>(response);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await authenticatedFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse<T>(response);
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await authenticatedFetch(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse<T>(response);
}

async function postForm<T>(path: string, body: FormData): Promise<T> {
  const response = await authenticatedFetch(path, {
    method: 'POST',
    body,
  });
  return readResponse<T>(response);
}

async function deleteJson<T = unknown>(path: string): Promise<T> {
  const response = await authenticatedFetch(path, { method: 'DELETE' });
  return readResponse<T>(response);
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = getJsonErrorMessage(body) || response.statusText;
    const payload = body && typeof body === 'object'
      ? (body as {
          code?: unknown;
          recoverable?: unknown;
          retry_after_ms?: unknown;
        })
        : {};
    const error = new Error(message) as Error & {
      status?: number;
      code?: string;
      recoverable?: boolean;
      retryAfterMs?: number;
    };
    error.status = response.status;
    if (typeof payload.code === 'string') error.code = payload.code;
    if (payload.recoverable === true) error.recoverable = true;
    if (typeof payload.retry_after_ms === 'number') {
      error.retryAfterMs = payload.retry_after_ms;
    }
    throw error;
  }
  return response.json() as Promise<T>;
}

function getJsonErrorMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const payload = body as { message?: unknown; error?: unknown };
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
  return null;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
