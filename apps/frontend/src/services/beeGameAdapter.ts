import type {
  BeeGameAssetManifestPayload,
  BeeGameAssetUploadPayload,
  BeeGameDeploymentPayload,
  BeeGamePreviewPayload,
  BuildReportPayload,
  ContinueTaskResponse,
  PendingUserReviewItem,
  ProjectBaselineStatusPayload,
  SendMessageResponse,
  StopTaskResponse,
} from './api';
import type { Project } from '../types/project';
import type { WebSocketMessage } from '../types/message';
import { authenticatedFetch } from './apiClient';
import type { BeeGameCreditTaskType } from './creditsApi';
import { getSupabaseAccessToken, getSupabaseSessionUser } from './supabaseAuthApi';

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
    | 'tool.started'
    | 'tool.completed'
    | 'tool.failed'
    | 'tool.progress'
    | 'permission.requested'
    | 'permission.resolved'
    | 'runtime.observation'
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

type BeeGameRuntimeSnapshot = {
  sessionId: string;
  workspacePath: string;
  modelConfigId?: string;
  phaseName: string;
  phaseStatus: string;
  updatedAt: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type ModelConfig = {
  id: string;
  isDefault?: boolean;
};

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

type BeeGameLanguage = 'en' | 'zh' | 'zh-TW' | 'ja' | 'ko';

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
  needsOptions: boolean;
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
};

export type BeeGameBuildBrief = {
  idea: string;
  option: BeeGameIntakeOption;
  settings: BeeGameIntakeSettings;
  language?: BeeGameLanguage | string;
  root_path?: string;
  title?: string;
};

const PROJECTS_KEY = 'beegame-adapter-projects';
const BINDINGS_KEY = 'beegame-adapter-bindings';
const WORKSPACE_ROOT_KEY = 'beegame-adapter-workspace-root';
const SUBAGENTS_ENABLED_KEY = 'beegame-adapter-subagents-enabled';
const SENT_DISPLAY_KEY = 'beegame-adapter-sent-display-text';
const ARTIFACT_ID_PREFIX = 'beegame-artifact:';
const PROJECT_PACKAGE_ARTIFACT_PREFIX = 'beegame-project-package:';
const USER_QUESTION_TOOL = 'AskUserQuestion';
const ENV_WORKSPACE_PATH = String(import.meta.env.VITE_BEEGAME_WORKSPACE_PATH ?? '').trim();
const ALLOW_CLIENT_WORKSPACE_ROOT = String(import.meta.env.VITE_BEEGAME_ALLOW_CLIENT_WORKSPACE_ROOT ?? '').trim() === '1' ||
  import.meta.env.MODE === 'test';
const DISPLAY_MESSAGE_ID_KEY = '__displayMessageId';
const CONTINUE_FROM_LAST_FAILED_CHECK_ACTION = 'continue_from_last_failed_check';
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

export function getBeeGameSubagentsEnabled(): boolean {
  return localStorage.getItem(SUBAGENTS_ENABLED_KEY) !== '0';
}

export function setBeeGameSubagentsEnabled(enabled: boolean): boolean {
  localStorage.setItem(SUBAGENTS_ENABLED_KEY, enabled ? '1' : '0');
  return enabled;
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

  async runIdeaIntake(data: { idea: string; language?: BeeGameLanguage | string }): Promise<BeeGameIdeaIntakeResult> {
    const response = await runIdeaIntakeJob(data) ?? await postJson<Partial<BeeGameIdeaIntakeResult> & { options?: BeeGameIntakeOption[] }>(
      '/api/beegame-intake/options',
      { idea: data.idea, ...(data.language ? { language: data.language } : {}) },
    );
    const intake = normalizeIdeaIntakeResult(response);
    if (intake.options.length === 0 && !intake.clarification) {
      throw new Error('BeeGame intake did not return game mode options');
    }
    return intake;
  },

  async generateIntakeOptions(data: { idea: string; language?: BeeGameLanguage | string }): Promise<BeeGameIntakeOption[]> {
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
    const requestedWorkspacePath = await resolveNewProjectClientWorkspacePath(data.root_path, folderName);
    const project = createLocalProject(title, requestedWorkspacePath);
    saveProjects(upsertProject(readProjects(), project));
    await syncProjectMetadata(project);
    const language = normalizeBeeGameLanguage(data.language, [
      data.idea,
      data.option.title,
      data.option.pitch,
      data.option.gameplay,
      data.settings.notes ?? '',
    ].join('\n'));
    const session = await startBeeGameSession({
      workspacePath: requestedWorkspacePath,
      projectName: folderName,
      projectId: project.id,
      language,
    });
    const workspacePath = session.cwd;
    const syncedProject = { ...project, root_path: workspacePath };
    saveProjects(upsertProject(readProjects(), syncedProject));
    await syncProjectMetadata(syncedProject);
    saveBinding({ projectId: project.id, sessionId: session.id, workspacePath, language });
    const prompt = buildConfirmedBriefPrompt(data);
    rememberSentDisplayText(session.id, prompt, data.idea);
    await sendBeeGameInput(session.id, prompt, {
      displayText: data.idea,
      displayKind: 'confirmed_brief',
      taskType: 'full_build',
      language,
    });
    return {
      project: syncedProject,
      task_id: session.id,
      status: 'running',
      pipeline: { pipeline_id: session.id, status: 'running' },
    };
  },

  async bootstrapProjectFromIdea(data: {
    idea: string;
    root_path?: string;
    title?: string;
    language?: string;
  }): Promise<{
    project: Project;
    task_id: string;
    status: string;
    pipeline: { pipeline_id: string; status: string };
  }> {
    const title = data.title || summarizeTitle(data.idea);
    const requestedWorkspacePath = await resolveNewProjectClientWorkspacePath(data.root_path, title);
    const project = createLocalProject(title, requestedWorkspacePath);
    saveProjects(upsertProject(readProjects(), project));
    await syncProjectMetadata(project);
    const language = normalizeBeeGameLanguage(data.language, data.idea);
    const session = await startBeeGameSession({
      workspacePath: requestedWorkspacePath,
      projectName: title,
      projectId: project.id,
      language,
    });
    const workspacePath = session.cwd;
    const syncedProject = { ...project, root_path: workspacePath };
    saveProjects(upsertProject(readProjects(), syncedProject));
    await syncProjectMetadata(syncedProject);
    saveBinding({ projectId: project.id, sessionId: session.id, workspacePath, language });
    const prompt = buildIdeaIntakePrompt(data.idea);
    rememberSentDisplayText(session.id, prompt, data.idea);
    await sendBeeGameInput(session.id, prompt, {
      displayText: data.idea,
      displayKind: 'initial_idea',
      taskType: 'full_build',
      language,
    });
    return {
      project: syncedProject,
      task_id: session.id,
      status: 'running',
      pipeline: { pipeline_id: session.id, status: 'running' },
    };
  },

  async openProject(_projectId: string): Promise<{ opened: boolean }> {
    return { opened: true };
  },

  async updateProject(projectId: string, data: { name?: string; root_path?: string; runtime_snapshot?: Project['runtime_snapshot'] }): Promise<Project> {
    const projects = readProjects();
    const existing = projects.find(project => project.id === projectId);
    if (!existing) throw new Error('Project not found');
    const updated: Project = {
      ...existing,
      ...(data.name !== undefined ? { name: data.name.trim() || existing.name } : {}),
      ...(data.root_path !== undefined ? { root_path: data.root_path } : {}),
      ...(data.runtime_snapshot !== undefined ? { runtime_snapshot: data.runtime_snapshot } : {}),
    };
    saveProjects(upsertProject(projects, updated));
    await syncProjectMetadata(updated);
    if (data.root_path) {
      const binding = getBinding(projectId);
      if (binding) saveBinding({ ...binding, workspacePath: data.root_path });
    }
    return updated;
  },

  async deleteProject(projectId: string): Promise<{ ok: boolean }> {
    const binding = getBinding(projectId) ?? await restoreProjectBindingFromCloud(projectId);
    if (binding) {
      await deleteBeeGameSession(binding.sessionId, true, binding.workspacePath);
    }
    saveProjects(readProjects().filter(project => project.id !== projectId));
    await deleteProjectMetadata(projectId);
    deleteBinding(projectId);
    return { ok: true };
  },

  async sendMessage(data: {
    content: string;
    project_id: string;
    client_message_id?: string;
    taskType?: BeeGameCreditTaskType;
  }): Promise<SendMessageResponse> {
    const handle = await ensureProjectSession(data.project_id);
    const { session } = handle;
    const language = resolveProjectSessionLanguage(data.project_id, data.content);
    const prompt = data.content;
    rememberSentDisplayText(session.id, prompt, data.content);
    await sendBeeGameInput(session.id, prompt, {
      taskType: data.taskType || 'edit_turn',
      clientMessageId: data.client_message_id,
      language,
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
    const prompt = getContinuePrompt(language);
    rememberSentDisplayText(session.id, prompt, prompt);
    await sendBeeGameInput(session.id, prompt, {
      taskType: 'continue_turn',
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

  async stopTask(data: { task_id: string; project_id?: string }): Promise<StopTaskResponse> {
    const sessionId = resolveStopSessionId(data);
    await postJson(`/api/beegame-sessions/${sessionId}/stop`, {});
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
    const eventResult = await fetchBeeGameEventsResultForBinding(binding, afterEventId, {
      restoreMissingSession: true,
    });
    const events = eventResult.events;
    const lastEventId = events.length > 0 ? events[events.length - 1].id : afterEventId;
    const normalizedEvents = normalizeLiveEvents(projectId, events);
    return {
      lastEventId,
      messages: normalizedEvents
        .flatMap(event => eventToWebSocketMessages(projectId, event, binding.workspacePath, normalizedEvents)),
    };
  },

  async getProjectStatus(projectId: string): Promise<ProjectBaselineStatusPayload> {
    const binding = await ensureProjectBinding(projectId);
    const snapshot = binding ? await fetchBeeGameRuntimeSnapshotIfAvailable(binding) : undefined;
    const eventResult = binding
      ? await fetchBeeGameEventsResultForBinding(binding)
      : { events: [], recoveredFromTranscript: false };
    const session = binding && !eventResult.recoveredFromTranscript
      ? await fetchBeeGameSessionIfAvailable(binding.sessionId)
      : undefined;
    const events = eventResult.events;
    const pending = eventResult.recoveredFromTranscript ? [] : getPendingPermissionEvents(events);
    const runtimeStatus = deriveRuntimeStatus(events, pending, eventResult.recoveredFromTranscript);
    const preview = binding ? await fetchBeeGamePreviewIfAvailable(binding) : undefined;
    return {
      project_id: projectId,
      phase: runtimeStatus.phase,
      blocked: pending.length > 0 || runtimeStatus.agentStatus === 'failed',
      blocked_reason: pending[0]?.text ?? (runtimeStatus.agentStatus === 'failed' ? runtimeStatus.nextAction : null),
      active_agents: runtimeStatus.activeAgents,
      updated_at: runtimeStatus.updatedAt,
      approval_required: pending.length > 0,
      next_action: runtimeStatus.nextAction,
      context: deriveContextVisibility(events, snapshot),
      build_report: preview ? previewSnapshotToBuildReport(preview) : null,
      review_status: null,
      model_config_id: session?.modelConfigId ?? snapshot?.modelConfigId ?? null,
    };
  },

  async getPendingUserReviews(projectId: string): Promise<{ items: PendingUserReviewItem[] }> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) return { items: [] };
    const eventResult = await fetchBeeGameEventsResultForBinding(binding);
    if (eventResult.recoveredFromTranscript) return { items: [] };
    return {
      items: getPendingPermissionEvents(eventResult.events).map(event => permissionEventToReview(event, binding)),
    };
  },

  async approvePlan(data: {
    project_id: string;
    gate_id: string;
    action: 'approve' | 'revise' | 'reject';
    feedback?: string;
  }): Promise<{ ok: boolean }> {
    const binding = getBinding(data.project_id);
    if (!binding) throw new Error('BeeGame session not found for project');
    const decision = data.action === 'approve' ? 'allow' : 'deny';
    await postJson(`/api/beegame-sessions/${binding.sessionId}/permissions/${encodeURIComponent(data.gate_id)}`, {
      decision,
      remember: decision === 'allow',
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
    const bindings = readBindings();
    const latest = bindings[0];
    if (!latest) return [{ id: 'beegame', name: 'BeeGame', status: 'idle' }];
    try {
      const events = await fetchBeeGameEvents(latest.sessionId, 0, latest.workspacePath);
      const runtimeStatus = deriveRuntimeStatus(events, getPendingPermissionEvents(events));
      return [{
        id: 'beegame',
        name: 'BeeGame',
        status: runtimeStatus.agentStatus,
      }];
    } catch {
      return [{ id: 'beegame', name: 'BeeGame', status: 'idle' }];
    }
  },

  async getActivity(): Promise<unknown[]> {
    return [];
  },

  async getWorkflowPhases(projectId: string): Promise<unknown> {
    const binding = await ensureProjectBinding(projectId);
    const snapshot = binding ? await fetchBeeGameRuntimeSnapshotIfAvailable(binding) : undefined;
    const events = binding ? await fetchBeeGameEventsForBinding(binding) : [];
    return derivePhaseInfo(events, snapshot);
  },

  async getTokenUsage(projectId: string): Promise<Record<string, unknown>> {
    const binding = await ensureProjectBinding(projectId);
    const snapshot = binding ? await fetchBeeGameRuntimeSnapshotIfAvailable(binding) : undefined;
    const events = binding ? await fetchBeeGameEventsForBinding(binding) : [];
    return getLatestTokenUsage(events) ?? snapshot?.usage ?? {};
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
    let result: { path: string; content: string };
    try {
      result = await fetchBeeGameArtifactContent(artifactRef, binding);
    } catch (error) {
      if (!binding || !isSessionNotFoundError(error)) throw error;
      await restoreBeeGameSessionForBinding(binding);
      result = await fetchBeeGameArtifactContent(artifactRef, binding);
    }
    return result.content;
  },

  async downloadProjectPackage(projectId: string): Promise<{ blob: Blob; filename: string }> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) throw new Error('BeeGame session not found for project');
    let response = await fetchProjectPackage(binding);
    if (response.status === 404) {
      await restoreBeeGameSessionForBinding(binding);
      response = await fetchProjectPackage(binding);
    }
    if (!response.ok) {
      throw new Error(await getResponseErrorMessage(response));
    }
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `${binding.workspacePath.split('/').filter(Boolean).at(-1) || 'project'}.zip`;
    return { blob: await response.blob(), filename };
  },

  async getProjectPreview(projectId: string): Promise<BeeGamePreviewPayload> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) throw new Error('BeeGame session not found for project');
    try {
      return await fetchBeeGamePreview(binding);
    } catch (error) {
      if (!isSessionNotFoundError(error)) throw error;
      await restoreBeeGameSessionForBinding(binding);
      return fetchBeeGamePreview(binding);
    }
  },

  async startProjectPreview(projectId: string): Promise<BeeGamePreviewPayload> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) throw new Error('BeeGame session not found for project');
    try {
      return await postJson(`/api/beegame-sessions/${binding.sessionId}/preview`, {
        workspacePath: binding.workspacePath,
      });
    } catch (error) {
      if (!isSessionNotFoundError(error)) throw error;
      await restoreBeeGameSessionForBinding(binding);
      return postJson(`/api/beegame-sessions/${binding.sessionId}/preview`, {
        workspacePath: binding.workspacePath,
      });
    }
  },

  async restartProjectPreview(projectId: string): Promise<BeeGamePreviewPayload> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) throw new Error('BeeGame session not found for project');
    try {
      return await postJson(`/api/beegame-sessions/${binding.sessionId}/preview/restart`, {
        workspacePath: binding.workspacePath,
      });
    } catch (error) {
      if (!isSessionNotFoundError(error)) throw error;
      await restoreBeeGameSessionForBinding(binding);
      return postJson(`/api/beegame-sessions/${binding.sessionId}/preview/restart`, {
        workspacePath: binding.workspacePath,
      });
    }
  },

  async stopProjectPreview(projectId: string): Promise<BeeGamePreviewPayload> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) throw new Error('BeeGame session not found for project');
    try {
      return await deleteJson<BeeGamePreviewPayload>(`/api/beegame-sessions/${binding.sessionId}/preview?workspacePath=${encodeURIComponent(binding.workspacePath)}`);
    } catch (error) {
      if (!isSessionNotFoundError(error)) throw error;
      await restoreBeeGameSessionForBinding(binding);
      return deleteJson<BeeGamePreviewPayload>(`/api/beegame-sessions/${binding.sessionId}/preview?workspacePath=${encodeURIComponent(binding.workspacePath)}`);
    }
  },

  async deployProject(projectId: string): Promise<BeeGameDeploymentPayload> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) throw new Error('BeeGame session not found for project');
    try {
      return await postJson(`/api/beegame-sessions/${binding.sessionId}/deployments`, {
        workspacePath: binding.workspacePath,
      });
    } catch (error) {
      if (!isSessionNotFoundError(error)) throw error;
      await restoreBeeGameSessionForBinding(binding);
      return postJson(`/api/beegame-sessions/${binding.sessionId}/deployments`, {
        workspacePath: binding.workspacePath,
      });
    }
  },

  async listProjectDeployments(projectId: string): Promise<BeeGameDeploymentPayload[]> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) return [];
    try {
      return await getJson<BeeGameDeploymentPayload[]>(
        `/api/beegame-sessions/${binding.sessionId}/deployments`,
      );
    } catch (error) {
      if (!isSessionNotFoundError(error)) throw error;
      await restoreBeeGameSessionForBinding(binding);
      return getJson<BeeGameDeploymentPayload[]>(
        `/api/beegame-sessions/${binding.sessionId}/deployments`,
      );
    }
  },

  async rollbackProjectDeployment(projectId: string, deploymentId: string): Promise<BeeGameDeploymentPayload> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) throw new Error('BeeGame session not found for project');
    try {
      return await postJson<BeeGameDeploymentPayload>(
        `/api/beegame-sessions/${binding.sessionId}/deployments/${encodeURIComponent(deploymentId)}/rollback`,
        {},
      );
    } catch (error) {
      if (!isSessionNotFoundError(error)) throw error;
      await restoreBeeGameSessionForBinding(binding);
      return postJson<BeeGameDeploymentPayload>(
        `/api/beegame-sessions/${binding.sessionId}/deployments/${encodeURIComponent(deploymentId)}/rollback`,
        {},
      );
    }
  },

  async getProjectAssets(projectId: string): Promise<BeeGameAssetManifestPayload> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) return { version: 1, slots: [] };
    return getJson<BeeGameAssetManifestPayload>(
      `/api/beegame-sessions/${binding.sessionId}/assets?workspacePath=${encodeURIComponent(binding.workspacePath)}`,
    );
  },

  async uploadProjectAsset(
    projectId: string,
    slotId: string,
    file: File,
  ): Promise<BeeGameAssetUploadPayload> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) throw new Error('BeeGame session not found for project');
    const form = new FormData();
    form.set('file', file);
    return postForm<BeeGameAssetUploadPayload>(
      `/api/beegame-sessions/${binding.sessionId}/assets/${encodeURIComponent(slotId)}/upload?workspacePath=${encodeURIComponent(binding.workspacePath)}`,
      form,
    );
  },

  async getArtifactReviewStatus(artifactId: string): Promise<{
    artifact_id: string;
    verdicts: Array<{ reviewer_id: string; verdict: string }>;
    votes: Array<{ reviewer_id: string; verdict: string }>;
    assigned_reviewers: string[];
    outcome: string;
  }> {
    return {
      artifact_id: artifactId,
      verdicts: [{ reviewer_id: 'beegame', verdict: 'approved' }],
      votes: [{ reviewer_id: 'beegame', verdict: 'approved' }],
      assigned_reviewers: ['beegame'],
      outcome: 'Available',
    };
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
    if (hasCloudSession()) throw error;
    // Local storage remains the dev/offline fallback when the dashboard API is down.
  }
}

function hasCloudSession(): boolean {
  return Boolean(getSupabaseAccessToken());
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

async function ensureProjectSession(projectId: string): Promise<BeeGameSessionHandle> {
  const binding = getBinding(projectId) ?? await restoreProjectBindingFromCloud(projectId);
  const project = readProjects().find(item => item.id === projectId);
  if (binding) {
    try {
      const session = await syncBeeGameSessionModel(
        await fetchBeeGameSession(binding.sessionId),
      );
      const workspacePath = await resolveExistingProjectWorkspacePath(project, binding.workspacePath);
      if (
        session.status !== 'running' ||
        normalizePath(session.cwd) !== normalizePath(workspacePath)
      ) {
        const recoveredEvents = await fetchBeeGameTranscriptIfAvailable(binding);
        const restored = await startBeeGameSession({
          workspacePath,
          transcriptSessionId: binding.sessionId,
          projectId,
          language: binding.language,
        });
        saveBinding({ projectId, sessionId: restored.id, workspacePath, language: binding.language });
        return {
          session: restored,
          recoveredEvents,
          previousSessionId: binding.sessionId,
        };
      }
      if (normalizePath(binding.workspacePath) !== normalizePath(workspacePath)) {
        saveBinding({ projectId, sessionId: binding.sessionId, workspacePath, language: binding.language });
      }
      return {
        session,
        recoveredEvents: [],
      };
    } catch (error) {
      if (!isSessionNotFoundError(error)) throw error;
      const recoveredEvents = await fetchBeeGameTranscriptIfAvailable(binding);
      const workspacePath = await resolveExistingProjectWorkspacePath(project, binding.workspacePath);
      const session = await startBeeGameSession({
        workspacePath,
        transcriptSessionId: binding.sessionId,
        projectId,
        language: binding.language,
      });
      saveBinding({ projectId, sessionId: session.id, workspacePath, language: binding.language });
      return {
        session,
        recoveredEvents,
        previousSessionId: binding.sessionId,
      };
    }
  }

  const workspacePath = await resolveExistingProjectWorkspacePath(project);
  const language = getCurrentUiLanguage();
  const session = await startBeeGameSession({ workspacePath, projectId, language });
  saveBinding({ projectId, sessionId: session.id, workspacePath, language });
  return { session, recoveredEvents: [] };
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

async function resolveWorkspacePath(input?: string): Promise<string> {
  const workspacePath = (input || ENV_WORKSPACE_PATH || readConfiguredWorkspaceRoot() || '').trim();
  if (isAbsolutePath(workspacePath)) {
    return workspacePath;
  }

  return resolveDefaultWorkspacePath();
}

async function resolveProjectWorkspacePath(input: string | undefined, folderName: string): Promise<string> {
  if (input?.trim()) {
    return resolveWorkspacePath(input);
  }
  const projectsRoot = await resolveWorkspacePath();
  const projectPath = joinPath(projectsRoot, slugifyPathSegment(folderName || 'game-project', 'game-project'));
  return projectPath;
}

async function resolveNewProjectClientWorkspacePath(
  input: string | undefined,
  folderName: string,
): Promise<string | undefined> {
  if (!ALLOW_CLIENT_WORKSPACE_ROOT) return undefined;
  return resolveProjectWorkspacePath(input, folderName);
}

async function resolveExistingProjectWorkspacePath(
  project: Project | undefined,
  bindingWorkspacePath?: string,
): Promise<string> {
  const candidate = project?.root_path || bindingWorkspacePath;
  if (!candidate) {
    return resolveProjectWorkspacePath(undefined, project?.name || 'BeeGame Project');
  }
  let projectsRoot: string;
  try {
    projectsRoot = await resolveWorkspacePath();
  } catch {
    return candidate;
  }
  if (normalizePath(candidate) !== normalizePath(projectsRoot)) {
    return candidate;
  }
  const migratedPath = joinPath(projectsRoot, slugifyPathSegment(project?.name || 'BeeGame Project'));
  if (project) {
    saveProjects(upsertProject(readProjects(), {
      ...project,
      name: getWorkspaceDisplayName(migratedPath, project.name),
      root_path: migratedPath,
    }));
  }
  return migratedPath;
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '');
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

function joinPath(root: string, segment: string): string {
  return `${root.replace(/\/+$/, '')}/${segment.replace(/^\/+/, '')}`;
}

function getWorkspaceDisplayName(workspacePath: string, fallback: string): string {
  const segments = workspacePath.replaceAll('\\', '/').split('/').filter(Boolean);
  return segments.at(-1) || fallback.trim() || 'BeeGame Project';
}

async function startBeeGameSession(
  options: {
    workspacePath?: string;
    transcriptSessionId?: string;
    projectId?: string;
    projectName?: string;
    language?: BeeGameLanguage;
  },
): Promise<BeeGameSession> {
  const modelConfigId = await getDefaultModelConfigId();
  if (!modelConfigId) {
    throw new Error('平台尚未配置默认模型。请联系管理员在系统设置的平台页配置后再生成。');
  }
  return postJson('/api/beegame-sessions', {
    modelConfigId,
    ...(options.workspacePath ? { workspacePath: options.workspacePath } : {}),
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.projectName ? { projectName: options.projectName } : {}),
    ...(options.transcriptSessionId ? { transcriptSessionId: options.transcriptSessionId } : {}),
    ...(options.language ? { language: options.language } : {}),
  });
}

async function getDefaultModelConfigId(): Promise<string> {
  try {
    const configs = await getJson<ModelConfig[]>('/api/model-configs');
    return configs.find(config => config.isDefault)?.id || configs[0]?.id || '';
  } catch {
    return '';
  }
}

async function fetchBeeGameSession(sessionId: string): Promise<BeeGameSession> {
  return getJson(`/api/beegame-sessions/${sessionId}`);
}

async function fetchBeeGameSessionIfAvailable(sessionId: string): Promise<BeeGameSession | undefined> {
  try {
    return await fetchBeeGameSession(sessionId);
  } catch (error) {
    if (isSessionNotFoundError(error)) return undefined;
    throw error;
  }
}

function fetchProjectPackage(binding: ProjectSessionBinding): Promise<Response> {
  const params = new URLSearchParams({ workspacePath: binding.workspacePath });
  return authenticatedFetch(`/api/beegame-sessions/${binding.sessionId}/package?${params.toString()}`);
}

async function fetchBeeGamePreview(binding: ProjectSessionBinding): Promise<BeeGamePreviewPayload> {
  return getJson(
    `/api/beegame-sessions/${binding.sessionId}/preview?workspacePath=${encodeURIComponent(binding.workspacePath)}`,
  );
}

async function fetchBeeGameDiscoveredArtifactsIfAvailable(
  binding: ProjectSessionBinding,
): Promise<BeeGameDiscoveredArtifact[]> {
  try {
    return await getJson(
      `/api/beegame-sessions/${binding.sessionId}/artifact-index?workspacePath=${encodeURIComponent(binding.workspacePath)}`,
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
  return getJson(`/api/beegame-sessions/${artifactRef.sessionId}/artifacts?${params.toString()}`);
}

async function fetchBeeGamePreviewIfAvailable(
  binding: ProjectSessionBinding,
): Promise<BeeGamePreviewPayload | undefined> {
  try {
    return await fetchBeeGamePreview(binding);
  } catch {
    return undefined;
  }
}

async function restoreBeeGameSessionForBinding(binding: ProjectSessionBinding): Promise<void> {
  await postJson('/api/beegame-sessions', {
    workspacePath: binding.workspacePath,
    transcriptSessionId: binding.sessionId,
    projectId: binding.projectId,
  });
}

async function getResponseErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await response.json().catch(() => ({}));
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
    ) {
      return body.error;
    }
  } else {
    const text = (await response.text().catch(() => '')).trim();
    if (text) return `Request failed with status ${response.status}: ${text.slice(0, 180)}`;
  }
  return `Request failed with status ${response.status}`;
}

async function updateBeeGameSessionModel(
  sessionId: string,
  modelConfigId: string,
): Promise<BeeGameSession> {
  return patchJson(`/api/beegame-sessions/${sessionId}/model`, {
    modelConfigId,
  });
}

async function syncBeeGameSessionModel(session: BeeGameSession): Promise<BeeGameSession> {
  const modelConfigId = await getDefaultModelConfigId();
  if (!modelConfigId || session.modelConfigId === modelConfigId) {
    return session;
  }
  return updateBeeGameSessionModel(session.id, modelConfigId);
}

async function sendBeeGameInput(
  sessionId: string,
  text: string,
  display?: {
    displayText?: string;
    displayKind?: string;
    taskType?: BeeGameCreditTaskType;
    clientMessageId?: string;
    language?: BeeGameLanguage;
  },
): Promise<BeeGameSession> {
  return postJson(`/api/beegame-sessions/${sessionId}/input`, {
    text,
    ...(display?.displayText ? { displayText: display.displayText } : {}),
    ...(display?.displayKind ? { displayKind: display.displayKind } : {}),
    ...(display?.taskType ? { taskType: display.taskType } : {}),
    ...(display?.clientMessageId ? { clientMessageId: display.clientMessageId } : {}),
    ...(display?.language ? { language: display.language } : {}),
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
    await deleteJson(`/api/beegame-sessions/${sessionId}${query}`);
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
    `/api/beegame-sessions/${sessionId}/events?after=${after}`,
    workspacePath
      ? { headers: { 'x-beegame-workspace-path': workspacePath } }
      : undefined,
  );
  return readResponse<BeeGameEvent[]>(response);
}

async function fetchBeeGameTranscript(sessionId: string, workspacePath: string): Promise<BeeGameEvent[]> {
  return getJson(`/api/beegame-sessions/${sessionId}/transcript?workspacePath=${encodeURIComponent(workspacePath)}`);
}

async function fetchBeeGameRuntimeSnapshot(binding: ProjectSessionBinding): Promise<BeeGameRuntimeSnapshot> {
  return getJson(
    `/api/beegame-sessions/${binding.sessionId}/runtime-snapshot?workspacePath=${encodeURIComponent(binding.workspacePath)}`,
  );
}

async function fetchBeeGameRuntimeSnapshotIfAvailable(
  binding: ProjectSessionBinding,
): Promise<BeeGameRuntimeSnapshot | undefined> {
  try {
    return await fetchBeeGameRuntimeSnapshot(binding);
  } catch {
    return undefined;
  }
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
  options: { restoreMissingSession?: boolean } = {},
): Promise<BeeGameEventsResult> {
  if (!options.restoreMissingSession && missingRuntimeSessionIds.has(binding.sessionId)) {
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
    if (!options.restoreMissingSession) {
      const transcript = await fetchBeeGameTranscriptIfAvailable(binding);
      return {
        events: transcript.filter(event => event.id > after),
        recoveredFromTranscript: true,
      };
    }
    try {
      await restoreBeeGameSessionForBinding(binding);
      missingRuntimeSessionIds.delete(binding.sessionId);
      return {
        events: await fetchBeeGameEvents(binding.sessionId, after, binding.workspacePath),
        recoveredFromTranscript: false,
      };
    } catch (restoreError) {
      if (!isSessionNotFoundError(restoreError)) {
        const transcript = await fetchBeeGameTranscriptIfAvailable(binding);
        return {
          events: transcript.filter(event => event.id > after),
          recoveredFromTranscript: true,
        };
      }
    }
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
    .flatMap(event => eventToWebSocketMessages(projectId, event, workspacePath, normalizedEvents));
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

function eventToWebSocketMessages(projectId: string, event: BeeGameEvent, workspacePath = '', events: BeeGameEvent[] = []): WebSocketMessage[] {
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
        is_subagent_tool: finishedInfo.isSubagent,
        timestamp: Date.parse(event.createdAt) || Date.now(),
      } as WebSocketMessage];
    }
    case 'permission.requested':
      if (isUserQuestionPermissionEvent(event)) {
        return [];
      }
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
    case 'runtime.observation':
      return [];
    case 'turn.completed': {
      const failedCheckAlert = buildLastFailedCheckAlert(projectId, event, events);
      const reviewAlert = failedCheckAlert ? null : buildDeliveryReviewAlert(projectId, event, events);
      return [
        ...(failedCheckAlert ? [failedCheckAlert] : []),
        ...(reviewAlert ? [reviewAlert] : []),
        { type: 'status', task_id: taskId, project_id: projectId, status: 'idle' } as WebSocketMessage,
      ];
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

function buildLastFailedCheckAlert(projectId: string, completedEvent: BeeGameEvent, events: BeeGameEvent[]): WebSocketMessage | null {
  const failedCheck = findUnresolvedValidationFailure(completedEvent, events);
  if (!failedCheck) return null;
  const command = getBashCommand(failedCheck);
  const output = getEventOutput(failedCheck);
  const content = [
    'Last check failed.',
    command ? `Command: ${command}` : '',
    output ? `Output: ${truncateForChatAlert(output)}` : '',
  ].filter(Boolean).join('\n');
  return {
    type: 'agent_message',
    task_id: completedEvent.sessionId,
    project_id: projectId,
    sender: 'system',
    content,
    message_id: `beegame-last-check-failed-${completedEvent.sessionId}-${completedEvent.turnId || completedEvent.id}-${failedCheck.id}`,
    timestamp: Date.parse(completedEvent.createdAt) || Date.now(),
    task_kind: 'last_check_failed',
    next_action: CONTINUE_FROM_LAST_FAILED_CHECK_ACTION,
    requires_user_action: true,
  } as WebSocketMessage;
}

function buildDeliveryReviewAlert(projectId: string, completedEvent: BeeGameEvent, events: BeeGameEvent[]): WebSocketMessage | null {
  const turnEvents = events.filter(event => (
    event.sessionId === completedEvent.sessionId &&
    (!completedEvent.turnId || event.turnId === completedEvent.turnId) &&
    event.id <= completedEvent.id
  ));
  const evidence = summarizeTurnEvidence(turnEvents);
  if (evidence.length === 0) return null;
  const content = [
    'Evidence for review.',
    'The agent ended this turn. BeeGame is idle and has not marked the project delivered.',
    'Use the observed evidence below to compare against the agent final summary.',
    '',
    'Observed evidence:',
    ...evidence.map(item => `- ${item}`),
    '',
    'Agent claims without matching evidence should be treated as unverified. Continue with fixes if the game is not ready.',
  ].join('\n');
  return {
    type: 'agent_message',
    task_id: completedEvent.sessionId,
    project_id: projectId,
    sender: 'system',
    content,
    message_id: `beegame-delivery-review-${completedEvent.sessionId}-${completedEvent.turnId || completedEvent.id}`,
    timestamp: Date.parse(completedEvent.createdAt) || Date.now(),
    task_kind: 'delivery_review',
  } as WebSocketMessage;
}

function summarizeTurnEvidence(events: BeeGameEvent[]): string[] {
  const items: string[] = [];
  for (const event of events) {
    if (event.type !== 'tool.completed' && event.type !== 'tool.failed') continue;
    const toolName = getPayloadString(event, 'toolName') || 'Tool';
    const status = event.type === 'tool.failed' ? 'failed' : 'completed';
    const input = getPayloadRecord(event, 'input');
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    const filePath = typeof input.file_path === 'string' ? input.file_path.trim() : '';
    const path = typeof input.path === 'string' ? input.path.trim() : '';
    const detail = command || filePath || path;
    const outputHint = summarizeEvidenceOutput(getEventOutput(event));
    const suffix = [
      detail ? truncateEvidenceDetail(detail) : '',
      outputHint,
    ].filter(Boolean).join(' | ');
    items.push(`${toolName} ${status}${suffix ? `: ${suffix}` : ''}`);
  }
  return items.slice(-8);
}

function summarizeEvidenceOutput(output: string): string {
  const compact = output.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const urlMatch = compact.match(PREVIEW_URL_PATTERN);
  if (urlMatch) return `observed URL ${urlMatch[0]}`;
  if (/\b(error|failed|failure|exception)\b/i.test(compact)) return `output ${truncateEvidenceDetail(compact)}`;
  if (/\b(pass(?:ed)?|success(?:ful)?|built|compiled|ready)\b/i.test(compact)) return `output ${truncateEvidenceDetail(compact)}`;
  return '';
}

const PREVIEW_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|\[[^\]]+\]|[^\s/]+)(?::\d+)?\/?[^\s)]*/i;

function previewSnapshotToBuildReport(preview: BeeGamePreviewPayload): BuildReportPayload | null {
  if (preview.status === 'idle' && !preview.url) return null;
  const isRunning = preview.status === 'running' && Boolean(preview.url);
  const isUnavailable = preview.status === 'failed' || preview.status === 'unsupported';
  return {
    status: isRunning ? 'passed' : isUnavailable ? 'failed' : preview.status,
    entrypoint: preview.entrypoint || '',
    report_path: '',
    build_url: isRunning ? preview.url : '',
    agents: ['dashboard-preview'],
    generated_paths: [],
    checks: [{
      name: preview.script || 'preview',
      status: isRunning ? 'passed' : preview.status,
      detail: preview.message || '',
      path: '',
    }],
    summary: isRunning
      ? `Managed preview available at ${preview.url}`
      : preview.message || 'Preview is not running',
    failure_reason: isUnavailable ? preview.message || 'Preview unavailable' : '',
    created_at: preview.updatedAt,
  };
}

function truncateEvidenceDetail(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= 180) return compact;
  return `${compact.slice(0, 180)}...`;
}

function findUnresolvedValidationFailure(completedEvent: BeeGameEvent, events: BeeGameEvent[]): BeeGameEvent | null {
  const commandState = new Map<string, BeeGameEvent>();
  for (const event of events) {
    if (event.sessionId !== completedEvent.sessionId) continue;
    if (completedEvent.turnId && event.turnId !== completedEvent.turnId) continue;
    if (event.id > completedEvent.id) continue;
    if (event.type !== 'tool.completed' && event.type !== 'tool.failed') continue;
    if (!isBashToolEvent(event)) continue;
    const command = getBashCommand(event);
    if (!command || !isValidationCommand(command)) continue;
    commandState.set(normalizeCommandForState(command), event);
  }
  const unresolvedFailures = [...commandState.values()]
    .filter(event => event.type === 'tool.failed')
    .sort((a, b) => b.id - a.id);
  return unresolvedFailures[0] || null;
}

function isBashToolEvent(event: BeeGameEvent): boolean {
  return (getPayloadString(event, 'toolName') || '').toLowerCase() === 'bash';
}

function getBashCommand(event: BeeGameEvent): string {
  return String(getPayloadRecord(event, 'input').command || '').trim();
}

function getEventOutput(event: BeeGameEvent): string {
  return typeof event.payload?.output === 'string' ? event.payload.output : event.text;
}

function isValidationCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return /\b(build|test|typecheck|lint|check|verify|compile)\b/.test(normalized)
    || /\btsc\b/.test(normalized);
}

function normalizeCommandForState(command: string): string {
  return command
    .replace(/\s+/g, ' ')
    .replace(/\s+2>&1\b/g, '')
    .replace(/\s+\|\s*head\s+-\d+\b/g, '')
    .trim();
}

function truncateForChatAlert(output: string): string {
  const text = output.trim();
  if (text.length <= 1200) return text;
  return `${text.slice(0, 1200)}...`;
}

function derivePhaseInfo(
  events: BeeGameEvent[],
  snapshot?: BeeGameRuntimeSnapshot,
): {
  current_phase: number;
  phase_name: string;
  history: Array<{ phase: number; name: string; timestamp: number }>;
} {
  const status = deriveRuntimeStatus(events, getPendingPermissionEvents(events));
  const currentPhase = status.phase === 'running'
    ? 'running'
    : snapshot?.phaseName && snapshot.phaseName !== 'idle'
      ? snapshot.phaseName
      : '';
  return {
    current_phase: currentPhase ? 1 : 0,
    phase_name: currentPhase,
    history: [],
  };
}

function deriveContextVisibility(events: BeeGameEvent[], snapshot?: BeeGameRuntimeSnapshot) {
  const observation = [...events].reverse().find(event => event.type === 'runtime.observation');
  const usage = getLatestTokenUsage(events) ?? snapshot?.usage ?? null;
  if (!observation && !usage) return null;
  const features = getRuntimeFeatures(observation);
  const labels = features
    .map(feature => String(feature.label || feature.id || '').trim())
    .filter(Boolean);
  const counters = observation ? getPayloadRecord(observation, 'counters') : {};
  const summary = labels.length > 0
    ? `BeeGame is observing ${labels.join(', ')} for this session.`
    : 'BeeGame runtime observability is active for this session.';
  return {
    bundle_id: observation ? `beegame-runtime-${observation.sessionId}` : 'beegame-runtime',
    phase: observation ? getPayloadString(observation, 'phase') || deriveRuntimeStatus(events, getPendingPermissionEvents(events)).phase : deriveRuntimeStatus(events, getPendingPermissionEvents(events)).phase,
    status: observation ? getPayloadString(observation, 'status') || 'active' : 'active',
    summary,
    blackboard_record_count: Number(counters.eventCount ?? events.length),
    memory_hits: Number(counters.toolUseCount ?? events.filter(event => event.type.startsWith('tool.')).length),
    rag_sources: observation ? ['transcripts/<project-folder>__<session-hash>.jsonl'] : [],
    selected_skills: labels,
    runtime_features: features,
    ...(usage ? {
      token_budget: {
        status: 'tracking',
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
      },
    } : {}),
    counters: {
      eventCount: Number(counters.eventCount ?? events.length),
      toolUseCount: Number(counters.toolUseCount ?? events.filter(event => event.type.startsWith('tool.')).length),
      turnIndex: Number(counters.turnIndex ?? 0),
    },
  };
}

function getRuntimeFeatures(event?: BeeGameEvent): Array<{
  id?: string;
  label?: string;
  stage?: string;
  status?: string;
}> {
  const raw = getPayloadArray(event, 'features');
  return raw
    .filter(isRecord)
    .map(feature => ({
      id: String(feature.id || '').trim() || undefined,
      label: String(feature.label || '').trim() || undefined,
      stage: String(feature.stage || '').trim() || undefined,
      status: String(feature.status || '').trim() || undefined,
    }))
    .filter(feature => feature.id || feature.label);
}

function getLatestTokenUsage(events: BeeGameEvent[]): { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null {
  const assistantUsage = sumAssistantMessageUsage(events);
  if (assistantUsage.total_tokens > 0) return assistantUsage;

  for (const event of [...events].reverse()) {
    if (event.type !== 'result') continue;
    const usage = getUsageFromEventPayload(event.payload);
    if (usage) return usage;
  }
  return null;
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
  const visible: BeeGameEvent[] = [];
  const seenUserTexts = new Set<string>();
  const turnsWithFinal = new Set(
    events
      .filter(event => event.type === 'assistant.message')
      .map(getTurnDisplayId),
  );
  let bufferedPartial: BeeGameEvent | null = null;
  const flushPartial = () => {
    if (bufferedPartial) {
      visible.push(bufferedPartial);
      bufferedPartial = null;
    }
  };
  for (const event of events) {
    if (event.type !== 'assistant.partial') {
      flushPartial();
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
    visible.push(event);
  }
  flushPartial();
  return visible;
}

function normalizeLiveEvents(_projectId: string, events: BeeGameEvent[]): BeeGameEvent[] {
  return normalizeBeeGameEvents(events, {
    includeUserMessages: false,
    includePartialsWhenFinalExists: true,
  });
}

function deriveRuntimeStatus(
  events: BeeGameEvent[],
  pending: BeeGameEvent[],
  recoveredFromTranscript = false,
): {
  phase: string;
  nextAction: string;
  updatedAt: string;
  activeAgents: string[];
  agentStatus: string;
} {
  const latest = events.at(-1);
  const updatedAt = latest?.createdAt || new Date().toISOString();
  if (pending.length > 0) {
    return {
      phase: 'waiting_approval',
      nextAction: 'Review BeeGame permission request',
      updatedAt,
      activeAgents: ['beegame'],
      agentStatus: 'waiting',
    };
  }

  const activeTurn = getActiveTurn(events);
  if (activeTurn) {
    if (recoveredFromTranscript) {
      return {
        phase: 'idle',
        nextAction: 'Ready for next request',
        updatedAt,
        activeAgents: [],
        agentStatus: 'idle',
      };
    }
    const latestActiveEvent = [...events].reverse().find(event => event.turnId === activeTurn) || latest;
    return {
      phase: 'running',
      nextAction: describeRuntimeAction(latestActiveEvent),
      updatedAt,
      activeAgents: ['beegame'],
      agentStatus: 'working',
    };
  }

  if (latest?.type === 'turn.failed' || latest?.type === 'session.failed') {
    return {
      phase: 'paused',
      nextAction: latest.text || 'BeeGame turn failed',
      updatedAt,
      activeAgents: [],
      agentStatus: 'failed',
    };
  }
  if (latest?.type === 'turn.completed' || latest?.type === 'turn.empty' || latest?.type === 'assistant.message' || latest?.type === 'result') {
    return {
      phase: 'idle',
      nextAction: 'Ready for next request',
      updatedAt,
      activeAgents: [],
      agentStatus: 'idle',
    };
  }
  return {
    phase: 'idle',
    nextAction: 'Ready for input',
    updatedAt,
    activeAgents: [],
    agentStatus: 'idle',
  };
}

function getActiveTurn(events: BeeGameEvent[]): string | null {
  const openTurns = new Set<string>();
  for (const event of events) {
    if (event.type === 'turn.started') {
      openTurns.add(getTurnDisplayId(event));
      continue;
    }
    if (
      event.type === 'turn.completed' ||
      event.type === 'turn.empty' ||
      event.type === 'turn.failed' ||
      event.type === 'session.stopped' ||
      event.type === 'session.failed'
    ) {
      openTurns.delete(getTurnDisplayId(event));
      continue;
    }
  }
  return [...openTurns].at(-1) || null;
}

function describeRuntimeAction(event?: BeeGameEvent): string {
  if (!event) return 'BeeGame is working';
  if (event.type === 'assistant.partial') return 'Streaming BeeGame response';
  if (event.type === 'assistant.message') return 'Finalizing BeeGame response';
  if (event.type === 'permission.resolved') {
    const decision = getPayloadString(event, 'decision');
    const toolName = getPayloadString(event, 'toolName') || 'tool';
    const reason = getPayloadString(event, 'reason');
    if (decision === 'deny' && reason) return reason;
    if (decision === 'deny') return `${toolName} was denied`;
    return `${toolName} permission resolved`;
  }
  if (event.type.startsWith('tool.')) {
    const toolName = getPayloadString(event, 'toolName') || 'tool';
    if (event.type === 'tool.started') return `Running ${toolName}`;
    if (event.type === 'tool.completed') return `${toolName} completed`;
    if (event.type === 'tool.failed') return `${toolName} failed`;
    return `${toolName} in progress`;
  }
  return 'BeeGame is working';
}

function baseMessage(type: 'token' | 'agent_message', event: BeeGameEvent, projectId: string, sender: string): WebSocketMessage {
  const clientMessageId = sender === 'user'
    ? getPayloadString(event, 'clientMessageId') || getPayloadString(event, 'client_message_id')
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

function sumAssistantMessageUsage(events: BeeGameEvent[]): { prompt_tokens: number; completion_tokens: number; total_tokens: number } {
  return events
    .filter(event => event.type === 'assistant.message')
    .map(event => getUsageFromEventPayload(event.payload))
    .filter((usage): usage is { prompt_tokens: number; completion_tokens: number; total_tokens: number } => Boolean(usage))
    .reduce((total, usage) => ({
      prompt_tokens: total.prompt_tokens + usage.prompt_tokens,
      completion_tokens: total.completion_tokens + usage.completion_tokens,
      total_tokens: total.total_tokens + usage.total_tokens,
    }), {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
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
  return `beegame-event-${event.id}`;
}

function getTurnDisplayId(event: BeeGameEvent): string {
  return event.turnId || `beegame-turn-${event.sessionId}-${event.id}`;
}

function normalizeIdeaIntakeResult(
  response: Partial<BeeGameIdeaIntakeResult> & { options?: BeeGameIntakeOption[] },
): BeeGameIdeaIntakeResult {
  const options = (response.options || []).map((option) => normalizeIntakeOption(option));
  const clarification = normalizeClarification(response.clarification);
  const maturity = response.maturity === 'directional' || response.maturity === 'concrete' || response.maturity === 'vague'
    ? response.maturity
    : 'vague';
  return {
    maturity,
    needsOptions: typeof response.needsOptions === 'boolean' ? response.needsOptions : maturity !== 'concrete',
    needsClarification: response.needsClarification === true,
    ...(clarification ? { clarification } : {}),
    clarificationQuestions: Array.isArray(response.clarificationQuestions) ? response.clarificationQuestions.map(String).filter(Boolean) : [],
    detectedConstraints: Array.isArray(response.detectedConstraints) ? response.detectedConstraints.map(String).filter(Boolean) : [],
    recommendedNextStep: typeof response.recommendedNextStep === 'string' && response.recommendedNextStep
      ? response.recommendedNextStep
      : maturity === 'concrete' ? 'configure_details' : 'choose_direction',
    options,
  };
}

function normalizeClarification(value: unknown): BeeGameClarification | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : '';
  if (!prompt) return undefined;
  const options = Array.isArray(record.options)
    ? record.options
      .map((item, index): BeeGameClarificationOption | undefined => {
        if (!item || typeof item !== 'object') return undefined;
        const option = item as Record<string, unknown>;
        const label = typeof option.label === 'string' ? option.label.trim() : '';
        if (!label) return undefined;
        const id = typeof option.id === 'string' && option.id.trim()
          ? option.id.trim()
          : `clarification_${index + 1}`;
        const description = typeof option.description === 'string' ? option.description.trim() : '';
        const optionValue = typeof option.value === 'string' ? option.value.trim() : '';
        return {
          id,
          label,
          ...(description ? { description } : {}),
          ...(optionValue ? { value: optionValue } : {}),
        };
      })
      .filter((item): item is BeeGameClarificationOption => Boolean(item))
      .slice(0, 4)
    : [];
  const freeformLabel = typeof record.freeformLabel === 'string'
    ? record.freeformLabel.trim()
    : typeof record.freeform_label === 'string'
      ? record.freeform_label.trim()
      : '';
  return {
    prompt,
    options,
    ...(freeformLabel ? { freeformLabel } : {}),
  };
}

function normalizeIntakeOption(option: BeeGameIntakeOption): BeeGameIntakeOption {
  return {
    ...option,
    projectFolderName: option.projectFolderName || (option as BeeGameIntakeOption & { project_folder_name?: string }).project_folder_name || '',
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
  };
}

function buildIdeaIntakePrompt(idea: string): string {
  return [
    'The user submitted this game idea:',
    idea,
    '',
    getResponseLanguageInstruction(idea),
    '',
    'Before implementing or modifying files, first help the user choose a direction.',
    'Return 2-3 concise options that clarify gameplay, scope, tech approach, and visual style.',
    'Ask the user to pick one option or describe changes. Do not write code, create files, or run implementation commands until the user chooses.',
  ].join('\n');
}

function buildConfirmedBriefPrompt(brief: BeeGameBuildBrief): string {
  const settings = brief.settings;
  const languageSource = [
    brief.idea,
    brief.option.title,
    brief.option.pitch,
    brief.option.gameplay,
    settings.notes ?? '',
  ].join('\n');
  const language = normalizeBeeGameLanguage(brief.language, languageSource);
  if (language === 'zh' || language === 'zh-TW') {
    return [
      '请使用中文与用户沟通。除代码、命令、文件路径、包名、API 名称和错误原文外，所有面向用户的说明、提问、总结和文档正文默认使用中文。',
      '',
      '我要做一个完整游戏项目。请像在终端里协作一样，自主规划、实现、运行检查、修复问题，并在需要我决策时提问。',
      '当前游戏方向和构建设置已经由用户确认。不要重新进入需求头脑风暴、视觉 companion、方案审批或“是否要继续”的确认流程；除非缺少真正阻塞实现的信息，否则请直接开始写项目文档并实现。',
      '',
      `原始想法：${brief.idea}`,
      `已选择的游戏方向：${brief.option.title}`,
      `方向简介：${brief.option.pitch}`,
      `玩法：${brief.option.gameplay}`,
      `核心机制：${brief.option.coreMechanic}`,
      `第一分钟体验：${brief.option.playerFirstMinute}`,
      `第一版目标：${brief.option.firstBuild}`,
      `主要风险：${brief.option.risk}`,
      `目标平台：${settings.platform}`,
      `开发引擎/技术栈：${settings.engine || 'React'}`,
      `视觉风格：${settings.visualStyle}`,
      `表现形式：${settings.dimension}`,
      `游戏类型：${settings.genre}`,
      `输入方式：${settings.inputs.join(', ')}`,
      `范围：${settings.scope}`,
      settings.notes ? `补充说明：${settings.notes}` : '',
      '',
      '请先在 docs/ 下写清项目资源：GDD、技术方案、美术方向、UI/UX、音频方向、placeholder/asset slots、调参与验收说明。',
      '同时创建平台无关的 assets/asset-manifest.json，声明项目资源合同：2D/3D/动画/材质/VFX/音频/字体/数据/本地化等资源位、用途、推荐规格、placeholder 状态、目标位置，以及 integration_mode。React/Web 等普通文件项目使用 filesystem；Unity/Godot/Unreal/Blender 等需要编辑器上下文的项目可声明 mcp 和对应 mcp_server。',
      '这些文档必须区分“本次交付已实现”和“后续路线图”。不要把 roadmap 写成已交付能力。',
      'docs 里的 acceptance/checklist 只能作为验收标准，不要预先打勾或写成已通过；只有最终验证报告可以基于真实证据记录 pass/fail/untested。',
      '然后基于这些文档实现游戏。没有正式美术和音频资源时，请创建清晰命名、方便替换的 placeholder 或 asset slot，并说明替换规则。',
      '实现后请使用当前项目自己的工具链和目标平台选择合适的检查与验证方式；不要强行使用某个固定平台、包管理器、测试框架或浏览器。',
      '不能只用类型检查、lint、构建命令、空测试或模型自评证明游戏完成。发现问题就继续修复。',
      '请验证真实玩家路径：启动/进入体验、理解目标、执行核心操作、看到反馈、达到胜负/进度变化，并能重开、继续或恢复。',
      '如果创建可执行的玩家路径验证、自动化检查或测试脚本，测试脚本必须包含断言，失败时必须以非零状态退出；不能只打印 true/false、success 或截图日志就当作通过。',
      '交付前必须做文档与代码一致性检查：文档里声明的规则、资源、常量、文件路径、输入方式、UI/UX 行为和已实现功能必须能在代码或资源中找到证据；不一致时请修正文档或实现。',
      '修 bug、继续任务或调整已有项目时，必须补最小复现、回归测试或对应玩家路径验证，并重新运行相关检查。',
      '交付前请使用可用的游戏验收指导或自检清单。最终总结必须分为：已实现、已验证证据、未验证/已知缺口。只能声明你实际验证过的内容，必须列出验证方式、命令或操作证据、发现并修复的问题，以及仍然遗留的问题。',
    ].filter(Boolean).join('\n');
  }
  return [
    'I want to build a complete game project. Work like an interactive terminal session: plan, implement, run checks, fix issues, and ask me when a decision is needed.',
    'The game direction and build settings have already been confirmed by the user. Do not re-enter ideation, brainstorming, visual companion, plan approval, or "should I continue" confirmation flows. Unless genuinely blocking implementation information is missing, start writing the project docs and implementation directly.',
    '',
    `Original idea: ${brief.idea}`,
    `Selected game direction: ${brief.option.title}`,
    `Direction pitch: ${brief.option.pitch}`,
    `Gameplay: ${brief.option.gameplay}`,
    `Core mechanic: ${brief.option.coreMechanic}`,
    `Player first minute: ${brief.option.playerFirstMinute}`,
    `First build target: ${brief.option.firstBuild}`,
    `Main risk: ${brief.option.risk}`,
    `Target platform: ${settings.platform}`,
    `Engine / technology stack: ${settings.engine || 'React'}`,
    `Visual style: ${settings.visualStyle}`,
    `Dimension: ${settings.dimension}`,
    `Genre: ${settings.genre}`,
    `Inputs: ${settings.inputs.join(', ')}`,
    `Scope: ${settings.scope}`,
    settings.notes ? `Notes: ${settings.notes}` : '',
    '',
    'First create project documents under docs/: GDD, technical design, art direction, UI/UX, audio direction, placeholder/asset slots, tuning, and acceptance notes.',
    'Also create a platform-neutral assets/asset-manifest.json that declares the project asset contracts: 2D/3D assets, animation, materials, VFX, audio, fonts, text data, localization, purpose, recommended specs, placeholder state, target location, and integration_mode. Use filesystem for React/Web or normal file projects; use mcp with the matching mcp_server only for Unity/Godot/Unreal/Blender-style projects that need editor context.',
    'Those docs must separate what is implemented in this delivery from roadmap/future work. Do not present roadmap items as delivered features.',
    'Acceptance criteria or checklists in docs are requirements only. Do not pre-check them or mark them as passed there; only a final verification report may record pass/fail/untested based on real evidence.',
    'Then implement the game from those documents. When production art or audio is unavailable, create clearly named placeholder assets or asset slots that are easy to replace and document the replacement rules.',
    'After implementation, choose checks and validation that fit this project, its target platform, and its own tooling. Do not force a specific platform, package manager, test framework, or browser.',
    'Do not use typecheck, lint, build success, empty tests, or model self-review alone as proof that the game is complete. If you find problems, keep fixing them.',
    'Validate the real player path: start or enter the experience, understand the objective, perform the core action, receive feedback, reach win/fail/progression, and restart, continue, or recover.',
    'If you create executable player-path checks, automated validation, or test scripts, they must contain assertions and fail with a non-zero exit status when expectations are not met. Do not count log-only scripts, true/false prints, success messages, or screenshots alone as evidence.',
    'Before delivery, perform a docs-to-code consistency review: rules, assets, constants, file paths, inputs, UI/UX behavior, and implemented features claimed in docs must have evidence in code or resources. If they do not match, fix the docs or the implementation.',
    'When fixing bugs, continuing a task, or changing an existing project, add a minimal reproduction, regression test, or matching player-path validation and rerun the relevant checks.',
    'Before delivery, use available game acceptance guidance or your own checklist. In the final summary, use exactly these sections: Implemented, Verified with evidence, Not verified / Known gaps. Only claim what you actually verified and include validation method, command or action evidence, issues found and fixed, and any remaining gaps.',
  ].filter(Boolean).join('\n');
}

function getResponseLanguageInstruction(text: string): string {
  return containsCjk(text)
    ? 'Response language: reply to the user in Simplified Chinese. Keep code, file paths, package names, commands, and API identifiers unchanged.'
    : 'Response language: reply in the same language as the user. Keep code, file paths, package names, commands, and API identifiers unchanged.';
}

function normalizeBeeGameLanguage(language: string | undefined, fallbackText: string): 'en' | 'zh' | 'zh-TW' | 'ja' | 'ko' {
  const normalized = String(language || '').trim();
  if (normalized === 'zh-TW' || normalized === 'zh-HK') return 'zh-TW';
  if (normalized === 'zh' || normalized === 'zh-CN' || normalized === 'zh-Hans') return 'zh';
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja';
  if (normalized === 'ko' || normalized.startsWith('ko-')) return 'ko';
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

function getContinuePrompt(language: BeeGameLanguage): string {
  if (language === 'zh') return '继续任务';
  if (language === 'zh-TW') return '繼續任務';
  if (language === 'ja') return 'タスクを続けてください';
  if (language === 'ko') return '작업을 계속해 주세요';
  return 'Continue the task.';
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text);
}

function rememberSentDisplayText(sessionId: string, transportText: string, displayText: string): void {
  const storageKey = scopedAdapterCacheKey(SENT_DISPLAY_KEY);
  const values = readJson<Record<string, string>>(storageKey, {});
  values[`${sessionId}:${stableTextHash(transportText)}`] = displayText;
  writeJson(storageKey, values);
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

function getPendingPermissionEvents(events: BeeGameEvent[]): BeeGameEvent[] {
  const resolved = new Set(
    events
      .filter(event => event.type === 'permission.resolved')
      .map(event => getPayloadString(event, 'toolUseID'))
      .filter(Boolean),
  );
  return events
    .filter(event => event.type === 'permission.requested')
    .filter(event => {
      const toolUseID = getPayloadString(event, 'toolUseID');
      return toolUseID && !resolved.has(toolUseID);
    });
}

function isUserQuestionPermissionEvent(event: BeeGameEvent): boolean {
  return getPayloadString(event, 'toolName') === USER_QUESTION_TOOL;
}

function describeUserQuestionEvent(event: BeeGameEvent): string {
  const input = getPayloadRecord(event, 'input');
  const questions = Array.isArray(input.questions) ? input.questions : [];
  if (questions.length > 0) {
    const lines: string[] = ['BeeGame 需要你补充几个选择：'];
    for (const item of questions) {
      if (!item || typeof item !== 'object') continue;
      const question = item as Record<string, unknown>;
      const header = String(question.header || '').trim();
      const text = String(question.question || question.prompt || '').trim();
      if (header) lines.push('', `【${header}】`);
      if (text) lines.push(text);
      const options = Array.isArray(question.options) ? question.options : [];
      for (const option of options) {
        if (!option || typeof option !== 'object') continue;
        const optionRecord = option as Record<string, unknown>;
        const label = String(optionRecord.label || '').trim();
        const description = String(optionRecord.description || '').trim();
        if (label && description) {
          lines.push(`- ${label}: ${description}`);
        } else if (label) {
          lines.push(`- ${label}`);
        }
      }
    }
    const content = lines.join('\n').trim();
    if (content) return content;
  }
  const question = String(input.question || input.prompt || input.message || '').trim();
  return question || event.text || 'BeeGame needs more details from you.';
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
  if (isUserQuestionPermissionEvent(event)) {
    return userQuestionEventToReview(event, binding);
  }

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

function userQuestionEventToReview(event: BeeGameEvent, binding: ProjectSessionBinding): PendingUserReviewItem {
  const toolUseID = getPayloadString(event, 'toolUseID');
  const input = event.payload?.input && typeof event.payload.input === 'object'
    ? event.payload.input as Record<string, unknown>
    : {};
  const question = getPrimaryUserQuestion(input);
  const title = question.header || 'BeeGame clarification';
  const content = describeUserQuestionEvent(event);
  return {
    gate_id: toolUseID,
    task_id: binding.sessionId,
    type: 'INTENT_CLARIFICATION',
    gate_kind: 'beegame_permission',
    user_action_kind: 'approve',
    title,
    status: 'awaiting_approval',
    artifact_type: 'intent_clarification',
    ready_for_user_approval: true,
    ready_for_promotion: true,
    created_at: event.createdAt,
    artifact: {
      title,
      artifact_type: 'intent_clarification',
      content,
      input,
    },
    summary: {
      block_reason: question.text || event.text,
      next_action: question.text || content,
    },
    binding: {
      workspace_path: binding.workspacePath,
      workspace_ref: binding.workspacePath,
    },
    review_status: {
      workflow_id: 'beegame',
      lane_id: 'clarification',
      lane_status: 'awaiting_approval',
      decision_status: 'awaiting_user',
      user_action_kind: 'approve',
      requires_user_action: true,
      pending_issue_count: 1,
      blocking_issue_count: 1,
    },
  };
}

function getPrimaryUserQuestion(input: Record<string, unknown>): { header: string; text: string } {
  const questions = Array.isArray(input.questions) ? input.questions : [];
  for (const item of questions) {
    if (!item || typeof item !== 'object') continue;
    const question = item as Record<string, unknown>;
    return {
      header: String(question.header || '').trim(),
      text: String(question.question || question.prompt || '').trim(),
    };
  }
  return {
    header: '',
    text: String(input.question || input.prompt || input.message || '').trim(),
  };
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

function getPayloadArray(event: BeeGameEvent | undefined, field: string): unknown[] {
  const value = event?.payload?.[field];
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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

async function runIdeaIntakeJob(data: { idea: string; language?: BeeGameLanguage | string }): Promise<(Partial<BeeGameIdeaIntakeResult> & { options?: BeeGameIntakeOption[] }) | undefined> {
  const createResponse = await authenticatedFetch('/api/beegame-intake/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idea: data.idea, ...(data.language ? { language: data.language } : {}) }),
  });
  if (createResponse.status === 404) return undefined;
  const created = await readResponse<BeeGameIntakeJobCreated>(createResponse);
  for (let index = 0; index < BEEGAME_INTAKE_JOB_MAX_POLLS; index += 1) {
    const poll = await getJson<BeeGameIntakeJobPoll>(`/api/beegame-intake/jobs/${created.jobId}`);
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

async function postForm<T>(path: string, body: FormData): Promise<T> {
  const response = await authenticatedFetch(path, {
    method: 'POST',
    body,
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

async function deleteJson<T = unknown>(path: string): Promise<T> {
  const response = await authenticatedFetch(path, { method: 'DELETE' });
  return readResponse<T>(response);
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : response.statusText;
    throw new Error(message);
  }
  return response.json() as Promise<T>;
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
