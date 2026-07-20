import type {
  BeeGameAssetManifestPayload,
  BeeGameAssetUploadPayload,
  BeeGameResourcePackImpactPayload,
  BeeGameDeploymentPayload,
  BeeGamePreviewPayload,
  ContinueTaskResponse,
  PendingUserReviewItem,
  ProjectBaselineStatusPayload,
  ProjectRuntimeStatePayload,
  SendMessageResponse,
  StopTaskResponse,
  ChatAttachmentPayload,
} from './api';
import type { Project } from '../types/project';
import type { WebSocketMessage } from '../types/message';
import { authenticatedFetch } from './apiClient';
import { getSupabaseSessionUser } from './supabaseAuthApi';
import { normalizeAttachmentBuildAnalysis, type AttachmentBuildAnalysis } from './attachmentBuild';

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

type BeeGameDiscoveredArtifact = {
  path: string;
  name?: string;
  artifact_type?: string;
  created_at?: string;
};

type BeeGameSessionMetadata = {
  id: string;
  projectId: string;
  workspacePath: string;
  status: string;
  transcriptPath?: string;
  modelConfigId?: string;
  createdAt: string;
  updatedAt: string;
};

type BeeGameSessionHandle = {
  session: BeeGameSession;
  recoveredEvents: BeeGameEvent[];
  binding?: ProjectSessionBinding;
  previousSessionId?: string;
};

type BeeGameEventsResult = {
  events: BeeGameEvent[];
  recoveredFromTranscript: boolean;
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

type BeeGameLanguage = 'en' | 'zh' | 'zh-TW' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'it' | 'pt';

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
  resourceLibraryUsage?: 'optional' | 'preferred' | 'required';
};

export type BeeGameBuildBrief = {
  idea: string;
  option: BeeGameIntakeOption;
  settings: BeeGameIntakeSettings;
  language?: BeeGameLanguage | string;
  documentLanguage?: BeeGameLanguage | string;
  gameUserVisibleLanguage?: BeeGameLanguage | string;
  agentResponseLanguage?: BeeGameLanguage | string;
  root_path?: string;
  title?: string;
  confirmedGdd?: string;
  buildSource?: 'gdd' | 'image' | 'mixed';
  analysisId?: string;
};

const PROJECTS_KEY = 'beegame-adapter-projects';
const BINDINGS_KEY = 'beegame-adapter-bindings';
const WORKSPACE_ROOT_KEY = 'beegame-adapter-workspace-root';
const SENT_DISPLAY_KEY = 'beegame-adapter-sent-display-text';
const ARTIFACT_ID_PREFIX = 'beegame-artifact:';
const PROJECT_PACKAGE_ARTIFACT_PREFIX = 'beegame-project-package:';
const ALLOW_CLIENT_WORKSPACE_ROOT = String(import.meta.env.VITE_BEEGAME_ALLOW_CLIENT_WORKSPACE_ROOT ?? '').trim() === '1' ||
  import.meta.env.MODE === 'test';
const DISPLAY_MESSAGE_ID_KEY = '__displayMessageId';
const missingRuntimeSessionIds = new Set<string>();

export function isBeeGameAdapterEnabled(): boolean {
  return String(import.meta.env.VITE_BEEGAME_ADAPTER ?? '1') !== '0';
}

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
    try {
      const projects = await getJson<Project[]>('/api/projects');
      const localProjects = readProjects();
      if (!hasCloudSession() && projects.length === 0 && localProjects.length > 0) {
        await Promise.all(localProjects.map(project => syncProjectMetadata(project)));
        return localProjects;
      }
      saveProjects(projects);
      reconcileProjectBindings(projects);
      return projects;
    } catch (error) {
      if (hasCloudSession()) throw error;
      return readProjects();
    }
  },

  async createProject(data: { name: string; root_path?: string }): Promise<Project> {
    const project = createLocalProject(data.name, data.root_path);
    saveProjects(upsertProject(readProjects(), project));
    await syncProjectMetadata(project);
    return project;
  },

  async runIdeaIntake(data: BeeGameIdeaIntakeRequest): Promise<BeeGameIdeaIntakeResult> {
    const requestBody = buildIdeaIntakeRequestBody(data);
    const response = await runIdeaIntakeJob(requestBody) ?? await postJson<Partial<BeeGameIdeaIntakeResult> & { options?: BeeGameIntakeOption[] }>(
      '/api/beegame-intake/options',
      requestBody,
    );
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
    pipeline: { pipeline_id: string; status: string };
  }> {
    const title = getBriefDisplayTitle(data);
    const folderName = getBriefFolderName(data, title);
    const project = createLocalProject(title);
    const language = normalizeBeeGameLanguage(data.language, [
      data.idea,
      data.option.title,
      data.option.pitch,
      data.option.gameplay,
      data.settings.notes ?? '',
    ].join('\n'));
    const bootstrap = await postJson<{
      project: Project;
      session: BeeGameSession;
      binding: ProjectSessionBinding;
      task_id: string;
      status: string;
      pipeline: { pipeline_id: string; status: string };
    }>('/api/projects/bootstrap', {
      project,
      projectName: folderName,
      brief: data,
      language,
    });
    const syncedProject = bootstrap.project;
    saveProjects(upsertProject(readProjects(), syncedProject));
    saveBinding({ ...bootstrap.binding, language });
    return {
      project: syncedProject,
      task_id: bootstrap.task_id,
      status: bootstrap.status,
      pipeline: bootstrap.pipeline,
    };
  },

  async openProject(_projectId: string): Promise<{ opened: boolean }> {
    return { opened: true };
  },

  async updateProject(projectId: string, data: { name?: string }): Promise<Project> {
    const projects = readProjects();
    const existing = projects.find(project => project.id === projectId);
    if (!existing) throw new Error('Project not found');
    const updated: Project = {
      ...existing,
      ...(data.name !== undefined ? { name: data.name.trim() || existing.name } : {}),
    };
    saveProjects(upsertProject(projects, updated));
    const persisted = await patchJson<Project>(`/api/projects/${encodeURIComponent(projectId)}`, data);
    saveProjects(upsertProject(readProjects(), persisted));
    return persisted;
  },

  async deleteProject(projectId: string): Promise<{ ok: boolean }> {
    const binding = getBinding(projectId) ?? await restoreProjectBindingFromCloud(projectId);
    if (binding) {
      await deleteBeeGameSession(binding.sessionId, true, binding.workspacePath);
    }
    await deleteProjectMetadata(projectId);
    // Keep the local record until the remote operation has completed (or was
    // already absent). A failed delete must remain retryable after refresh.
    saveProjects(readProjects().filter(project => project.id !== projectId));
    deleteBinding(projectId);
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
    const language = resolveProjectSessionLanguage(data.project_id, data.content);
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
    const language = resolveProjectSessionLanguage(data.project_id, '');
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

  async requestProjectAction(data: {
    project_id: string;
    kind: 'build_error_repair' | 'deployment_failure_repair';
  }): Promise<SendMessageResponse> {
    const handle = await ensureProjectSession(data.project_id);
    const language = resolveProjectSessionLanguage(data.project_id, '');
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
    const sessionId = resolveStopSessionId(data);
    await postJson(`/api/beegame-sessions/${encodeURIComponent(sessionId)}/stop`, {});
    return {
      command_id: sessionId,
      task_id: sessionId,
      state: 'stopped',
      trace_id: sessionId,
    };
  },

  async getChatHistory(projectId: string): Promise<unknown[]> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) return [];
    const transcript = await fetchBeeGameTranscriptIfAvailable(binding);
    if (transcript.length > 0) {
      return eventsToHistory(projectId, transcript, binding.workspacePath);
    }
    const events = await fetchBeeGameEvents(binding.sessionId, 0, binding.workspacePath);
    return eventsToHistory(projectId, events, binding.workspacePath);
  },

  async pollMessages(projectId: string, afterEventId: number): Promise<{
    lastEventId: number;
    messages: WebSocketMessage[];
  }> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) return { lastEventId: afterEventId, messages: [] };
    const eventResult = await fetchBeeGameEventsResultForBinding(binding, afterEventId);
    const events = eventResult.events;
    const lastEventId = events.length > 0 ? events[events.length - 1].id : afterEventId;
    const normalizedEvents = normalizeLiveEvents(projectId, events);
    const isInitialHistorySync = afterEventId === 0;
    return {
      lastEventId,
      messages: normalizedEvents
        .flatMap(event => eventToWebSocketMessages(projectId, event, binding.workspacePath))
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
      pendingReviews: pendingPermissions.map(permission => pendingPermissionToReview(projectId, permission)),
    };
  },

  async getPendingUserReviews(projectId: string): Promise<{ items: PendingUserReviewItem[] }> {
    const runtimeState = await fetchProjectRuntimeState(projectId);
    const pendingPermissions = Array.isArray(runtimeState.pending_permissions)
      ? runtimeState.pending_permissions
      : [];
    return {
      items: pendingPermissions.map(permission => pendingPermissionToReview(projectId, permission)),
    };
  },

  async approvePlan(data: {
    project_id: string;
    gate_id: string;
    action: 'approve' | 'revise' | 'reject';
    feedback?: string;
    permission_scope?: 'once' | 'session';
  }): Promise<{ ok: boolean }> {
    const decision = data.action === 'approve' ? 'allow' : 'deny';
    await postJson(`/api/projects/${encodeURIComponent(data.project_id)}/permissions/${encodeURIComponent(data.gate_id)}`, {
      decision,
      remember: false,
      scope: data.permission_scope ?? 'once',
      ...(data.feedback ? { message: data.feedback } : {}),
    });
    return { ok: true };
  },

  async getStatus(): Promise<Record<string, unknown>> {
    return { status: 'running', backend: 'beegame' };
  },

  async getSystemReadiness(): Promise<Record<string, unknown>> {
    return { status: 'ready', modules: {} };
  },

  async getAgents(): Promise<Array<Record<string, unknown>>> {
    // Agent activity is project-scoped and comes from /projects/:id/runtime-state.
    // Probing the most recent local binding here made the account homepage call
    // stale in-memory session IDs after a refresh or backend restart.
    return [{ id: 'beegame', name: 'BeeGame', status: 'idle' }];
  },

  async getActivity(): Promise<unknown[]> {
    return [];
  },

  async getWorkflowPhases(projectId: string): Promise<unknown> {
    const status = await this.getProjectStatus(projectId);
    const phaseName = String(status.context?.phase || status.phase || '').trim();
    return {
      current_phase: phaseName && phaseName !== 'idle' ? 1 : 0,
      phase_name: phaseName === 'idle' ? '' : phaseName,
      history: [],
    };
  },

  async getTokenUsage(projectId: string): Promise<Record<string, unknown>> {
    const status = await this.getProjectStatus(projectId);
    return status.context?.token_budget ?? {};
  },

  async getTasks(): Promise<unknown[]> {
    return [];
  },

  async getArtifacts(projectId: string): Promise<BeeGameArtifact[]> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) return [];
    const events = await fetchBeeGameEventsForBinding(binding);
    const discoveredArtifacts = await fetchBeeGameDiscoveredArtifactsIfAvailable(binding);
    return [
      ...mergeArtifactsByPath([
        ...discoveredArtifacts
          .filter(artifact => !isInternalRuntimeArtifact(artifact))
          .map(artifact => discoveredArtifactToPanelArtifact(binding, artifact)),
        ...extractArtifacts(projectId, events, binding.workspacePath),
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
    const binding = await ensureProjectBinding(artifactRef.projectId);
    const result = await fetchBeeGameArtifactContent(artifactRef, binding);
    return result.content;
  },

  async downloadProjectPackage(projectId: string): Promise<{ blob: Blob; filename: string }> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) throw new Error('BeeGame session not found for project');
    const response = await fetchProjectPackage(binding);
    if (!response.ok) {
      throw new Error(await getResponseErrorMessage(response));
    }
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `${binding.workspacePath.split('/').filter(Boolean).at(-1) || 'project'}.zip`;
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
    requirementId: string,
    file: File,
  ): Promise<BeeGameAssetUploadPayload> {
    const form = new FormData();
    form.set('file', file);
    return postForm<BeeGameAssetUploadPayload>(
      `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(requirementId)}/upload`,
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

function getBriefDisplayTitle(brief: BeeGameBuildBrief): string {
  return (brief.title || brief.option.title || summarizeTitle(brief.idea)).trim() || 'BeeGame Project';
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

function readProjects(): Project[] {
  return readJson<Project[]>(scopedAdapterCacheKey(PROJECTS_KEY), []);
}

function saveProjects(projects: Project[]): void {
  writeJson(scopedAdapterCacheKey(PROJECTS_KEY), projects);
}

async function syncProjectMetadata(project: Project): Promise<void> {
  try {
    await postJson<Project>('/api/projects', project);
  } catch (error) {
    if (hasCloudSession()) throw error;
    // Local storage remains the dev/offline fallback when the dashboard API is down.
  }
}

async function deleteProjectMetadata(projectId: string): Promise<void> {
  try {
    await deleteJson(`/api/projects/${encodeURIComponent(projectId)}`);
  } catch (error) {
    if (isDeleteAlreadyGoneError(error)) return;
    if (hasCloudSession()) throw error;
    // Local storage remains the dev/offline fallback when the dashboard API is down.
  }
}

function hasCloudSession(): boolean {
  // HttpOnly sessions intentionally expose no access token to browser code.
  // The hydrated session user is the authentication authority for both
  // cookie-backed and legacy browser-token sessions.
  return Boolean(getSupabaseSessionUser()?.id?.trim());
}

function scopedAdapterCacheKey(baseKey: string): string {
  const userId = getSupabaseSessionUser()?.id?.trim();
  if (!userId) return baseKey;
  return `${baseKey}:${encodeURIComponent(userId)}`;
}

function upsertProject(projects: Project[], project: Project): Project[] {
  return [project, ...projects.filter(item => item.id !== project.id)];
}

function readBindings(): ProjectSessionBinding[] {
  return readJson<ProjectSessionBinding[]>(scopedAdapterCacheKey(BINDINGS_KEY), []);
}

function saveBinding(binding: ProjectSessionBinding): void {
  const existingBindings = readBindings();
  const existing = existingBindings.find(item => item.projectId === binding.projectId);
  const normalized = {
    ...binding,
    ...(binding.language || !existing?.language ? {} : { language: existing.language }),
  };
  const bindings = [normalized, ...existingBindings.filter(item => item.projectId !== binding.projectId)];
  writeJson(scopedAdapterCacheKey(BINDINGS_KEY), bindings);
}

function deleteBinding(projectId: string): void {
  writeJson(scopedAdapterCacheKey(BINDINGS_KEY), readBindings().filter(item => item.projectId !== projectId));
}

function getBinding(projectId: string): ProjectSessionBinding | undefined {
  return readBindings().find(binding => binding.projectId === projectId);
}

function reconcileProjectBindings(projects: Project[]): void {
  const current = readBindings();
  // An empty list can be observed briefly while secure authentication and the
  // account project list settle. Explicit project deletion already removes its
  // binding, so preserving the cache here is safer than making durable chat
  // history unreachable after a transient empty response.
  if (projects.length === 0 && current.length > 0) return;
  const projectIds = new Set(projects.map(project => project.id));
  const retained = current.filter(binding => projectIds.has(binding.projectId));
  if (retained.length === current.length) return;
  for (const binding of current) {
    if (!projectIds.has(binding.projectId)) missingRuntimeSessionIds.delete(binding.sessionId);
  }
  writeJson(scopedAdapterCacheKey(BINDINGS_KEY), retained);
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
  saveBinding(binding);
  return {
    session: response.session,
    binding,
    recoveredEvents: [],
    ...(response.previousSessionId ? { previousSessionId: response.previousSessionId } : {}),
  };
}

async function ensureProjectBinding(projectId: string): Promise<ProjectSessionBinding | undefined> {
  const binding = getBinding(projectId);
  if (binding) return binding;
  return await restoreProjectBindingFromCloud(projectId) ?? inferProjectBindingFromMetadata(projectId);
}

async function restoreProjectBindingFromCloud(
  projectId: string,
): Promise<ProjectSessionBinding | undefined> {
  if (!hasCloudSession()) return undefined;
  try {
    const session = await getJson<BeeGameSessionMetadata>(
      `/api/projects/${encodeURIComponent(projectId)}/sessions/latest`,
    );
    const project = readProjects().find(item => item.id === projectId);
    const binding = {
      projectId,
      sessionId: session.id,
      workspacePath: project?.root_path || session.workspacePath,
    };
    saveBinding(binding);
    return binding;
  } catch (error) {
    if (isSessionNotFoundError(error)) return undefined;
    throw error;
  }
}

function resolveStopSessionId(data: { task_id: string; project_id?: string }): string {
  const projectId = String(data.project_id || '').trim();
  if (projectId) {
    const binding = getBinding(projectId);
    if (binding?.sessionId) return binding.sessionId;
    if (projectId.startsWith('project_')) return projectId.slice('project_'.length);
  }
  return String(data.task_id || '').trim();
}

function inferProjectBindingFromMetadata(projectId: string): ProjectSessionBinding | undefined {
  const sessionId = inferSessionIdFromProjectId(projectId);
  if (!sessionId) return undefined;
  const project = readProjects().find(item => item.id === projectId);
  const workspacePath = String(project?.root_path || '').trim();
  if (!workspacePath) return undefined;
  const binding = { projectId, sessionId, workspacePath };
  saveBinding(binding);
  return binding;
}

function inferSessionIdFromProjectId(projectId: string): string {
  const normalized = String(projectId || '').trim();
  if (!normalized.startsWith('project_beegame_')) return '';
  return normalized.slice('project_'.length);
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

function isDeleteStaleWorkspacePathError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.startsWith(
    'Workspace path must stay inside the default Projects directory:',
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

function fetchProjectPackage(binding: ProjectSessionBinding): Promise<Response> {
  const params = new URLSearchParams({ workspacePath: binding.workspacePath });
  return authenticatedFetch(`/api/beegame-sessions/${encodeURIComponent(binding.sessionId)}/package?${params.toString()}`);
}

async function fetchBeeGameDiscoveredArtifactsIfAvailable(
  binding: ProjectSessionBinding,
): Promise<BeeGameDiscoveredArtifact[]> {
  try {
    return await getJson(
      `/api/beegame-sessions/${encodeURIComponent(binding.sessionId)}/artifact-index?workspacePath=${encodeURIComponent(binding.workspacePath)}`,
    );
  } catch {
    return [];
  }
}

async function fetchBeeGameArtifactContent(
  artifactRef: { projectId: string; sessionId: string; path: string },
  binding?: ProjectSessionBinding,
): Promise<{ path: string; content: string }> {
  const params = new URLSearchParams({ path: artifactRef.path });
  if (binding?.workspacePath) params.set('workspacePath', binding.workspacePath);
  return getJson(`/api/beegame-sessions/${encodeURIComponent(artifactRef.sessionId)}/artifacts?${params.toString()}`);
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

async function deleteBeeGameSession(
  sessionId: string,
  deleteArtifacts: boolean,
  workspacePath?: string,
): Promise<void> {
  const params = new URLSearchParams();
  if (deleteArtifacts) params.set('deleteArtifacts', '1');
  if (workspacePath) params.set('workspacePath', workspacePath);
  const query = params.toString() ? `?${params.toString()}` : '';
  try {
    await deleteJson(`/api/beegame-sessions/${encodeURIComponent(sessionId)}${query}`);
  } catch (error) {
    if (isDeleteAlreadyGoneError(error) || isDeleteStaleWorkspacePathError(error)) return;
    throw error;
  }
}

async function fetchBeeGameEvents(
  sessionId: string,
  after = 0,
  workspacePath?: string,
): Promise<BeeGameEvent[]> {
  const response = await authenticatedFetch(
    `/api/beegame-sessions/${encodeURIComponent(sessionId)}/events?after=${encodeURIComponent(String(after))}`,
    workspacePath
      ? { headers: { 'x-beegame-workspace-path': workspacePath } }
      : undefined,
  );
  return readResponse<BeeGameEvent[]>(response);
}

async function fetchBeeGameTranscript(sessionId: string, workspacePath: string): Promise<BeeGameEvent[]> {
  return getJson(`/api/beegame-sessions/${encodeURIComponent(sessionId)}/transcript?workspacePath=${encodeURIComponent(workspacePath)}`);
}

async function fetchBeeGameEventsForBinding(
  binding: ProjectSessionBinding,
  after = 0,
): Promise<BeeGameEvent[]> {
  return (await fetchBeeGameEventsResultForBinding(binding, after)).events;
}

async function fetchBeeGameEventsResultForBinding(
  binding: ProjectSessionBinding,
  after = 0,
): Promise<BeeGameEventsResult> {
  if (missingRuntimeSessionIds.has(binding.sessionId)) {
    const transcript = await fetchBeeGameTranscriptIfAvailable(binding);
    return {
      events: transcript.filter(event => event.id > after),
      recoveredFromTranscript: true,
    };
  }
  try {
    const events = await fetchBeeGameEvents(binding.sessionId, after, binding.workspacePath);
    missingRuntimeSessionIds.delete(binding.sessionId);
    return {
      events,
      recoveredFromTranscript: false,
    };
  } catch (error) {
    if (!isSessionNotFoundError(error)) throw error;
    missingRuntimeSessionIds.add(binding.sessionId);
    const transcript = await fetchBeeGameTranscriptIfAvailable(binding);
    return {
      events: transcript.filter(event => event.id > after),
      recoveredFromTranscript: true,
    };
  }
}

async function fetchBeeGameTranscriptIfAvailable(
  binding: ProjectSessionBinding,
): Promise<BeeGameEvent[]> {
  try {
    return await fetchBeeGameTranscript(binding.sessionId, binding.workspacePath);
  } catch {
    return [];
  }
}

function eventsToHistory(projectId: string, events: BeeGameEvent[], workspacePath = ''): unknown[] {
  const normalizedEvents = normalizeDisplayEvents(events);
  const messages = normalizedEvents
    .flatMap(event => eventToWebSocketMessages(projectId, event, workspacePath))
    .filter(message => message.type !== 'think_start' && message.type !== 'think_end');
  return messages.map(message => ({
    id: message.message_id || `${message.type}-${message.task_id}-${Date.now()}`,
    message_id: message.message_id,
    sender: message.sender || 'system',
    content: message.content || '',
    task_id: message.task_id,
    timestamp: message.timestamp || Date.now(),
    type: message.type === 'agent_message' ? 'text' : message.type === 'tool_start' || message.type === 'tool_end' ? 'tool' : 'normal',
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

function eventToWebSocketMessages(projectId: string, event: BeeGameEvent, workspacePath = ''): WebSocketMessage[] {
  const taskId = event.sessionId;
  switch (event.type) {
    case 'user.message':
      return [baseMessage('agent_message', { ...event, text: resolveUserMessageDisplayText(event) }, projectId, 'user')];
    case 'turn.started':
      return [
        { type: 'status', task_id: taskId, project_id: projectId, status: 'running' } as WebSocketMessage,
      ];
    case 'system.status':
      if (
        event.payload?.type === 'credit.settled' ||
        event.payload?.type === 'credit.refunded'
      ) {
        return [{
          type: 'credit_update',
          task_id: taskId,
          project_id: projectId,
          credit_event: event.payload.type,
          balance_credits: typeof event.payload.balanceCredits === 'number'
            ? event.payload.balanceCredits
            : undefined,
          credits: typeof event.payload.credits === 'number'
            ? event.payload.credits
            : undefined,
          timestamp: Date.parse(event.createdAt) || Date.now(),
        } as WebSocketMessage];
      }
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
          } as WebSocketMessage];
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
        } as WebSocketMessage];
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
        } as WebSocketMessage] : []),
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
      } as WebSocketMessage] : [];
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
      } as WebSocketMessage];
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
      } as WebSocketMessage];
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
      } as WebSocketMessage];
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
      } as WebSocketMessage];
    case 'permission.resolved': {
      const decision = getPayloadString(event, 'decision');
      if (decision !== 'deny') return [];
      return [baseMessage('agent_message', {
        ...event,
        text: describePermissionResolution(event),
      }, projectId, 'system')];
    }
    case 'turn.completed': {
      return [{ type: 'status', task_id: taskId, project_id: projectId, status: 'idle' } as WebSocketMessage];
    }
    case 'turn.empty':
      return [
        baseMessage('agent_message', event, projectId, 'system'),
        { type: 'status', task_id: taskId, project_id: projectId, status: 'idle' } as WebSocketMessage,
      ];
    case 'session.stopped':
      return [{ type: 'status', task_id: taskId, project_id: projectId, status: 'stopped' } as WebSocketMessage];
    case 'turn.failed':
    case 'session.failed':
      return [{ type: 'error', task_id: taskId, project_id: projectId, content: event.text, error: event.text } as WebSocketMessage];
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
  return event.type === 'turn.completed' ||
    event.type === 'turn.empty' ||
    event.type === 'turn.failed' ||
    event.type === 'session.stopped' ||
    event.type === 'session.failed';
}

function isLateRuntimeEvent(event: BeeGameEvent, terminalEventByTurn: Map<string, number>): boolean {
  if (!event.turnId) return false;
  const terminalId = terminalEventByTurn.get(event.turnId);
  if (terminalId === undefined || event.id <= terminalId) return false;
  return event.type === 'assistant.partial' ||
    event.type === 'assistant.thinking' ||
    event.type === 'assistant.message' ||
    event.type === 'tool.started' ||
    event.type === 'tool.progress' ||
    event.type === 'tool.completed' ||
    event.type === 'tool.failed' ||
    event.type === 'permission.requested' ||
    event.type === 'permission.resolved' ||
    event.type === 'result';
}

function normalizeLiveEvents(_projectId: string, events: BeeGameEvent[]): BeeGameEvent[] {
  return normalizeBeeGameEvents(events, {
    includeUserMessages: false,
    includePartialsWhenFinalExists: true,
  });
}

function baseMessage(type: 'token' | 'agent_message', event: BeeGameEvent, projectId: string, sender: string): WebSocketMessage {
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
  } as WebSocketMessage;
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
  const name = isSubagent ? (description || toolName) : toolName;
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

function normalizeBeeGameLanguage(language: string | undefined, fallbackText: string): BeeGameLanguage {
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
  return containsCjk(fallbackText) ? 'zh' : 'en';
}

function getCurrentUiLanguage(): BeeGameLanguage {
  const language = String(localStorage.getItem('i18nextLng') || 'zh').trim();
  return normalizeBeeGameLanguage(language, '');
}

function resolveProjectSessionLanguage(
  projectId: string,
  fallbackText: string,
): BeeGameLanguage {
  return getBinding(projectId)?.language ??
    (fallbackText
      ? normalizeBeeGameLanguage(undefined, fallbackText)
      : normalizeBeeGameLanguage(getCurrentUiLanguage(), ''));
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text);
}

function resolveSentDisplayText(sessionId: string, transportText: string): string {
  const values = readJson<Record<string, string>>(scopedAdapterCacheKey(SENT_DISPLAY_KEY), {});
  return values[`${sessionId}:${stableTextHash(transportText)}`] || transportText;
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
  return artifactType === 'transcript' || normalizedPath.startsWith('transcripts/');
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

function permissionEventToReview(event: BeeGameEvent, binding: ProjectSessionBinding): PendingUserReviewItem {
  const toolUseID = getPayloadString(event, 'toolUseID');
  const toolName = getPayloadString(event, 'toolName') || 'BeeGame tool';
  const input = event.payload?.input && typeof event.payload.input === 'object'
    ? event.payload.input as Record<string, unknown>
    : {};
  const summary = summarizePermissionRequest(toolName, event.text, input);
  return {
    gate_id: toolUseID,
    task_id: binding.sessionId,
    type: 'BEEGAME_PERMISSION',
    gate_kind: 'beegame_permission',
    user_action_kind: 'approve',
    title: summary.title,
    permission_tool_name: toolName,
    status: 'awaiting_approval',
    artifact_type: 'beegame_permission',
    ready_for_user_approval: true,
    ready_for_promotion: true,
    created_at: event.createdAt,
    artifact: {
      title: summary.title,
      artifact_type: 'beegame_permission',
      content: summary.description,
      input,
    },
    summary: {
      block_reason: summary.blockReason,
      next_action: summary.nextAction,
    },
    binding: {
      workspace_path: binding.workspacePath,
      workspace_ref: binding.workspacePath,
    },
    review_status: {
      workflow_id: 'beegame',
      lane_id: 'permission',
      lane_status: 'awaiting_approval',
      decision_status: 'awaiting_user',
      user_action_kind: 'approve',
      requires_user_action: true,
      pending_issue_count: 1,
      blocking_issue_count: 1,
    },
  };
}

function pendingPermissionToReview(
  projectId: string,
  permission: BeeGamePendingPermissionPayload,
): PendingUserReviewItem {
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
        ? permission.input as Record<string, unknown>
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
    ? value as Record<string, unknown>
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
  const language = data.language
    ? normalizeBeeGameLanguage(data.language, data.idea)
    : undefined;
  return {
    idea: data.idea,
    ...(language ? { language } : {}),
    clientRequestId: data.clientRequestId ?? createClientRequestId(),
  };
}

function createClientRequestId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function runIdeaIntakeJob(requestBody: BeeGameIdeaIntakeRequest): Promise<(Partial<BeeGameIdeaIntakeResult> & { options?: BeeGameIntakeOption[] }) | undefined> {
  const createResponse = await authenticatedFetch('/api/beegame-intake/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  if (createResponse.status === 404) return undefined;
  const created = await readResponse<BeeGameIntakeJobCreated>(createResponse);
  let retryIntervalMs = BEEGAME_INTAKE_JOB_POLL_INTERVAL_MS;
  const deadlineAt = Date.now() + (
    BEEGAME_INTAKE_JOB_POLL_INTERVAL_MS * BEEGAME_INTAKE_JOB_MAX_POLLS
  );
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
      ? body as {
          code?: unknown;
          recoverable?: unknown;
          retry_after_ms?: unknown;
        }
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

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}
