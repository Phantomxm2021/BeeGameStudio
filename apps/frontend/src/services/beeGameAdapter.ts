import type {
  ContinueTaskResponse,
  PendingUserReviewItem,
  ProjectBaselineStatusPayload,
  SendMessageResponse,
  StopTaskResponse,
} from './api';
import type { Project } from '../types/project';
import type { WebSocketMessage } from '../types/message';

type BeeGameSession = {
  id: string;
  cwd: string;
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

type ModelConfig = {
  id: string;
  isDefault?: boolean;
};

type ProjectSessionBinding = {
  projectId: string;
  sessionId: string;
  workspacePath: string;
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
  path: string;
  status: 'active';
  created_by: 'beegame';
  created_at: string;
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
  root_path?: string;
  title?: string;
};

const PROJECTS_KEY = 'beegame-adapter-projects';
const BINDINGS_KEY = 'beegame-adapter-bindings';
const WORKSPACE_KEY = 'beegame-adapter-workspace-path';
const WORKSPACE_ROOT_KEY = 'beegame-adapter-workspace-root';
const SUBAGENTS_ENABLED_KEY = 'beegame-adapter-subagents-enabled';
const SENT_DISPLAY_KEY = 'beegame-adapter-sent-display-text';
const ARTIFACT_ID_PREFIX = 'beegame-artifact:';
const USER_QUESTION_TOOL = 'AskUserQuestion';
const ENV_WORKSPACE_PATH = String(import.meta.env.VITE_BEEGAME_WORKSPACE_PATH ?? '').trim();
const DISPLAY_MESSAGE_ID_KEY = '__displayMessageId';

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
  const normalized = path.trim();
  if (!isAbsolutePath(normalized)) {
    throw new Error('工作路径必须是绝对路径');
  }
  localStorage.setItem(WORKSPACE_ROOT_KEY, normalized);
  return { workspacePath: normalized, isDefault: false };
}

export async function resetBeeGameWorkspaceRoot(): Promise<BeeGameWorkspaceSettings> {
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
      if (projects.length === 0 && localProjects.length > 0) {
        await Promise.all(localProjects.map(project => syncProjectMetadata(project)));
        return localProjects;
      }
      saveProjects(projects);
      return projects;
    } catch {
      return readProjects();
    }
  },

  async createProject(data: { name: string; root_path?: string }): Promise<Project> {
    const project = createLocalProject(data.name, data.root_path);
    saveProjects(upsertProject(readProjects(), project));
    await syncProjectMetadata(project);
    rememberWorkspace(data.root_path);
    return project;
  },

  async runIdeaIntake(data: { idea: string }): Promise<BeeGameIdeaIntakeResult> {
    const response = await postJson<Partial<BeeGameIdeaIntakeResult> & { options?: BeeGameIntakeOption[] }>(
      '/api/beegame-intake/options?ownerId=dashboard-local',
      { idea: data.idea },
    );
    const intake = normalizeIdeaIntakeResult(response);
    if (intake.options.length === 0 && !intake.clarification) {
      throw new Error('BeeGame intake did not return game mode options');
    }
    return intake;
  },

  async generateIntakeOptions(data: { idea: string }): Promise<BeeGameIntakeOption[]> {
    return (await this.runIdeaIntake(data)).options;
  },

  async bootstrapProjectFromBrief(data: BeeGameBuildBrief): Promise<{
    project: Project;
    task_id: string;
    status: string;
    pipeline: { pipeline_id: string; status: string };
  }> {
    const title = getBriefDisplayTitle(data);
    const workspacePath = await resolveProjectWorkspacePath(data.root_path, getBriefFolderName(data, title));
    const session = await startBeeGameSession(workspacePath);
    const project = createLocalProject(title, workspacePath, `project_${session.id}`);
    saveProjects(upsertProject(readProjects(), project));
    await syncProjectMetadata(project);
    saveBinding({ projectId: project.id, sessionId: session.id, workspacePath });
    const prompt = buildConfirmedBriefPrompt(data);
    rememberSentDisplayText(session.id, prompt, data.idea);
    await sendBeeGameInput(session.id, prompt);
    return {
      project,
      task_id: session.id,
      status: 'running',
      pipeline: { pipeline_id: session.id, status: 'running' },
    };
  },

  async bootstrapProjectFromIdea(data: {
    idea: string;
    root_path?: string;
    title?: string;
  }): Promise<{
    project: Project;
    task_id: string;
    status: string;
    pipeline: { pipeline_id: string; status: string };
  }> {
    const title = data.title || summarizeTitle(data.idea);
    const workspacePath = await resolveProjectWorkspacePath(data.root_path, title);
    const session = await startBeeGameSession(workspacePath);
    const project = createLocalProject(title, workspacePath, `project_${session.id}`);
    saveProjects(upsertProject(readProjects(), project));
    await syncProjectMetadata(project);
    saveBinding({ projectId: project.id, sessionId: session.id, workspacePath });
    const prompt = buildIdeaIntakePrompt(data.idea);
    rememberSentDisplayText(session.id, prompt, data.idea);
    await sendBeeGameInput(session.id, prompt);
    return {
      project,
      task_id: session.id,
      status: 'running',
      pipeline: { pipeline_id: session.id, status: 'running' },
    };
  },

  async openProject(projectId: string): Promise<{ opened: boolean }> {
    const binding = getBinding(projectId);
    if (binding) rememberWorkspace(binding.workspacePath);
    return { opened: true };
  },

  async updateProject(projectId: string, data: { name?: string; root_path?: string }): Promise<Project> {
    const projects = readProjects();
    const existing = projects.find(project => project.id === projectId);
    if (!existing) throw new Error('Project not found');
    const updated: Project = {
      ...existing,
      ...(data.name !== undefined ? { name: data.name.trim() || existing.name } : {}),
      ...(data.root_path !== undefined ? { root_path: data.root_path } : {}),
    };
    saveProjects(upsertProject(projects, updated));
    await syncProjectMetadata(updated);
    if (data.root_path) {
      const binding = getBinding(projectId);
      if (binding) saveBinding({ ...binding, workspacePath: data.root_path });
      rememberWorkspace(data.root_path);
    }
    return updated;
  },

  async deleteProject(projectId: string): Promise<{ ok: boolean }> {
    const binding = getBinding(projectId);
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
  }): Promise<SendMessageResponse> {
    const handle = await ensureProjectSession(data.project_id);
    const { session } = handle;
    const prompt = data.content;
    rememberSentDisplayText(session.id, prompt, data.content);
    await sendBeeGameInput(session.id, prompt);
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
    const prompt = '继续任务';
    rememberSentDisplayText(session.id, prompt, '继续任务');
    await sendBeeGameInput(session.id, prompt);
    return {
      command_id: session.id,
      resume_task_id: session.id,
      resume_mode: 'resume',
      state: 'resuming',
      trace_id: session.id,
    };
  },

  async stopTask(data: { task_id: string }): Promise<StopTaskResponse> {
    await postJson(`/api/beegame-sessions/${data.task_id}/stop`, {});
    return {
      command_id: data.task_id,
      task_id: data.task_id,
      state: 'stopped',
      trace_id: data.task_id,
    };
  },

  async getChatHistory(projectId: string): Promise<unknown[]> {
    const binding = getBinding(projectId);
    if (!binding) return [];
    let events: BeeGameEvent[];
    try {
      events = await fetchBeeGameEvents(binding.sessionId);
    } catch (error) {
      if (!isSessionNotFoundError(error)) throw error;
      events = await fetchBeeGameTranscript(binding.sessionId, binding.workspacePath);
    }
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
    return {
      lastEventId,
      messages: normalizeLiveEvents(projectId, events)
        .flatMap(event => eventToWebSocketMessages(projectId, event, binding.workspacePath)),
    };
  },

  async getProjectStatus(projectId: string): Promise<ProjectBaselineStatusPayload> {
    const binding = await ensureProjectBinding(projectId);
    const eventResult = binding
      ? await fetchBeeGameEventsResultForBinding(binding)
      : { events: [], recoveredFromTranscript: false };
    const events = eventResult.events;
    const pending = eventResult.recoveredFromTranscript ? [] : getPendingPermissionEvents(events);
    const runtimeStatus = deriveRuntimeStatus(events, pending, eventResult.recoveredFromTranscript);
    return {
      project_id: projectId,
      phase: runtimeStatus.phase,
      blocked: pending.length > 0 || runtimeStatus.agentStatus === 'failed',
      blocked_reason: pending[0]?.text ?? (runtimeStatus.agentStatus === 'failed' ? runtimeStatus.nextAction : null),
      active_agents: runtimeStatus.activeAgents,
      updated_at: runtimeStatus.updatedAt,
      approval_required: pending.length > 0,
      next_action: runtimeStatus.nextAction,
      context: deriveContextVisibility(events),
      build_report: null,
      review_status: null,
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
      const events = await fetchBeeGameEvents(latest.sessionId);
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
    const events = binding ? await fetchBeeGameEventsForBinding(binding) : [];
    return derivePhaseInfo(events);
  },

  async getTokenUsage(): Promise<Record<string, unknown>> {
    return {};
  },

  async getTasks(): Promise<unknown[]> {
    return [];
  },

  async getArtifacts(projectId: string): Promise<BeeGameArtifact[]> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) return [];
    const events = await fetchBeeGameEventsForBinding(binding);
    return extractArtifacts(projectId, events);
  },

  async getArtifactContent(artifactId: string): Promise<string> {
    const artifactRef = decodeArtifactId(artifactId);
    if (!artifactRef) throw new Error('Invalid BeeGame artifact id');
    const result = await getJson<{ path: string; content: string }>(
      `/api/beegame-sessions/${artifactRef.sessionId}/artifacts?path=${encodeURIComponent(artifactRef.path)}`,
    );
    return result.content;
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
  return readJson<Project[]>(PROJECTS_KEY, []);
}

function saveProjects(projects: Project[]): void {
  writeJson(PROJECTS_KEY, projects);
}

async function syncProjectMetadata(project: Project): Promise<void> {
  try {
    await postJson<Project>('/api/projects', project);
  } catch {
    // Local storage remains the offline fallback when the dashboard API is down.
  }
}

async function deleteProjectMetadata(projectId: string): Promise<void> {
  try {
    await deleteJson(`/api/projects/${encodeURIComponent(projectId)}`);
  } catch {
    // Local storage remains the offline fallback when the dashboard API is down.
  }
}

function upsertProject(projects: Project[], project: Project): Project[] {
  return [project, ...projects.filter(item => item.id !== project.id)];
}

function readBindings(): ProjectSessionBinding[] {
  return readJson<ProjectSessionBinding[]>(BINDINGS_KEY, []);
}

function saveBinding(binding: ProjectSessionBinding): void {
  const bindings = [binding, ...readBindings().filter(item => item.projectId !== binding.projectId)];
  writeJson(BINDINGS_KEY, bindings);
  rememberWorkspace(binding.workspacePath);
}

function deleteBinding(projectId: string): void {
  writeJson(BINDINGS_KEY, readBindings().filter(item => item.projectId !== projectId));
}

function getBinding(projectId: string): ProjectSessionBinding | undefined {
  return readBindings().find(binding => binding.projectId === projectId);
}

async function ensureProjectSession(projectId: string): Promise<BeeGameSessionHandle> {
  const binding = getBinding(projectId);
  const project = readProjects().find(item => item.id === projectId);
  if (binding) {
    try {
      return {
        session: await fetchBeeGameSession(binding.sessionId),
        recoveredEvents: [],
      };
    } catch (error) {
      if (!isSessionNotFoundError(error)) throw error;
      const recoveredEvents = await fetchBeeGameTranscriptIfAvailable(binding);
      const workspacePath = await resolveExistingProjectWorkspacePath(project, binding.workspacePath);
      const session = await startBeeGameSession(workspacePath, binding.sessionId);
      saveBinding({ projectId, sessionId: session.id, workspacePath });
      return {
        session,
        recoveredEvents,
        previousSessionId: binding.sessionId,
      };
    }
  }

  const workspacePath = await resolveExistingProjectWorkspacePath(project);
  const session = await startBeeGameSession(workspacePath);
  saveBinding({ projectId, sessionId: session.id, workspacePath });
  return { session, recoveredEvents: [] };
}

async function ensureProjectBinding(projectId: string): Promise<ProjectSessionBinding | undefined> {
  const binding = getBinding(projectId);
  if (!binding) return undefined;
  return binding;
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
  rememberWorkspace(projectPath);
  return projectPath;
}

async function resolveExistingProjectWorkspacePath(
  project: Project | undefined,
  bindingWorkspacePath?: string,
): Promise<string> {
  const candidate = project?.root_path || bindingWorkspacePath;
  if (!candidate) {
    return resolveProjectWorkspacePath(undefined, project?.name || 'BeeGame Project');
  }
  const projectsRoot = await resolveWorkspacePath();
  if (normalizePath(candidate) !== normalizePath(projectsRoot)) {
    rememberWorkspace(candidate);
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
  rememberWorkspace(migratedPath);
  return migratedPath;
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '');
}

function rememberWorkspace(path?: string): void {
  const trimmedPath = path?.trim() || '';
  if (isAbsolutePath(trimmedPath)) {
    localStorage.setItem(WORKSPACE_KEY, trimmedPath);
  }
}

function readConfiguredWorkspaceRoot(): string {
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

async function startBeeGameSession(workspacePath: string, transcriptSessionId?: string): Promise<BeeGameSession> {
  const modelConfigId = await getDefaultModelConfigId();
  if (!modelConfigId) {
    throw new Error('请先在模型设置中配置 BeeGame LLM API Key、Base URL 和 Model，并设为默认模型。');
  }
  return postJson('/api/beegame-sessions', {
    workspacePath,
    modelConfigId,
    ...(transcriptSessionId ? { transcriptSessionId } : {}),
  });
}

async function getDefaultModelConfigId(): Promise<string> {
  try {
    const configs = await getJson<ModelConfig[]>('/api/model-configs?ownerId=dashboard-local');
    return configs.find(config => config.isDefault)?.id || configs[0]?.id || '';
  } catch {
    return '';
  }
}

async function fetchBeeGameSession(sessionId: string): Promise<BeeGameSession> {
  return getJson(`/api/beegame-sessions/${sessionId}`);
}

async function sendBeeGameInput(sessionId: string, text: string): Promise<BeeGameSession> {
  return postJson(`/api/beegame-sessions/${sessionId}/input`, { text });
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
    if (isDeleteAlreadyGoneError(error)) return;
    throw error;
  }
}

async function fetchBeeGameEvents(sessionId: string, after = 0): Promise<BeeGameEvent[]> {
  return getJson(`/api/beegame-sessions/${sessionId}/events?after=${after}`);
}

async function fetchBeeGameTranscript(sessionId: string, workspacePath: string): Promise<BeeGameEvent[]> {
  return getJson(`/api/beegame-sessions/${sessionId}/transcript?workspacePath=${encodeURIComponent(workspacePath)}`);
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
  try {
    return {
      events: await fetchBeeGameEvents(binding.sessionId, after),
      recoveredFromTranscript: false,
    };
  } catch (error) {
    if (!isSessionNotFoundError(error)) throw error;
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
  const messages = normalizeDisplayEvents(events)
    .flatMap(event => eventToWebSocketMessages(projectId, event, workspacePath));
  return messages.map(message => ({
    id: message.message_id || `${message.type}-${message.task_id}-${Date.now()}`,
    message_id: message.message_id,
    sender: message.sender || 'system',
    content: message.content || '',
    task_id: message.task_id,
    timestamp: message.timestamp || Date.now(),
    type: message.type === 'agent_message' ? 'text' : message.type === 'tool_start' || message.type === 'tool_end' ? 'tool' : 'normal',
  }));
}

function eventToWebSocketMessages(projectId: string, event: BeeGameEvent, workspacePath = ''): WebSocketMessage[] {
  const taskId = event.sessionId;
  switch (event.type) {
    case 'user.message':
      return [baseMessage('agent_message', { ...event, text: resolveSentDisplayText(event.sessionId, event.text) }, projectId, 'user')];
    case 'turn.started':
      return [
        { type: 'status', task_id: taskId, project_id: projectId, status: 'running' } as WebSocketMessage,
      ];
    case 'system.status':
      return [];
    case 'assistant.partial':
      return [];
    case 'assistant.message':
      return [baseMessage('agent_message', event, projectId, 'beegame')];
    case 'result': {
      const usage = getUsageFromResultEvent(event);
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
      return [{
        type: 'tool_start',
        task_id: taskId,
        project_id: projectId,
        message_id: getToolMessageId(event),
        tool_use_id: getPayloadString(event, 'toolUseID'),
        tool: startedTool,
        content: formatToolContent(startedTool, 'running', startedInput, workspacePath),
        timestamp: Date.parse(event.createdAt) || Date.now(),
      } as WebSocketMessage];
    case 'tool.progress': {
      const progressInput = getPayloadRecord(event, 'input');
      const progressTool = getPayloadString(event, 'toolName') || event.text;
      const output = typeof event.payload?.output === 'string' ? event.payload.output : event.text;
      return [{
        type: 'tool_start',
        task_id: taskId,
        project_id: projectId,
        message_id: getToolMessageId(event),
        tool_use_id: getPayloadString(event, 'toolUseID'),
        tool: progressTool,
        content: formatToolContent(progressTool, 'running', progressInput, workspacePath, output),
        timestamp: Date.parse(event.createdAt) || Date.now(),
      } as WebSocketMessage];
    }
    case 'tool.completed':
    case 'tool.failed': {
      const finishedInput = getPayloadRecord(event, 'input');
      const finishedTool = getPayloadString(event, 'toolName') || event.text;
      const output = typeof event.payload?.output === 'string' ? event.payload.output : event.text;
      return [{
        type: 'tool_end',
        task_id: taskId,
        project_id: projectId,
        message_id: getToolMessageId(event),
        tool_use_id: getPayloadString(event, 'toolUseID'),
        tool: finishedTool,
        output,
        content: formatToolContent(finishedTool, event.type === 'tool.failed' ? 'failed' : 'completed', finishedInput, workspacePath, output),
        timestamp: Date.parse(event.createdAt) || Date.now(),
      } as WebSocketMessage];
    }
    case 'permission.requested':
      if (isUserQuestionPermissionEvent(event)) {
        return [{
          ...baseMessage('agent_message', {
          ...event,
          text: describeUserQuestionEvent(event),
          }, projectId, 'beegame'),
          task_kind: 'clarification_question',
          requires_user_action: true,
        } as WebSocketMessage];
      }
      return [{
        type: 'human_gate',
        task_id: taskId,
        project_id: projectId,
        content: event.text,
        sender: 'beegame',
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
    case 'turn.completed':
      return [{ type: 'status', task_id: taskId, project_id: projectId, status: 'idle' } as WebSocketMessage];
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

function derivePhaseInfo(events: BeeGameEvent[]): {
  current_phase: number;
  phase_name: string;
  history: Array<{ phase: number; name: string; timestamp: number }>;
} {
  const status = deriveRuntimeStatus(events, getPendingPermissionEvents(events));
  const currentPhase = status.phase === 'running' ? 'running' : '';
  return {
    current_phase: currentPhase ? 1 : 0,
    phase_name: currentPhase,
    history: [],
  };
}

function deriveContextVisibility(events: BeeGameEvent[]) {
  const observation = [...events].reverse().find(event => event.type === 'runtime.observation');
  const usage = getLatestTokenUsage(events);
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
  for (const event of [...events].reverse()) {
    if (event.type !== 'result') continue;
    const usage = getUsageFromResultEvent(event);
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
      const displayText = resolveSentDisplayText(event.sessionId, event.text);
      if (seenUserTexts.has(displayText)) continue;
      seenUserTexts.add(displayText);
      visible.push(event);
      continue;
    }
    if (event.type === 'system.status' && event.text.trim().toLowerCase() === 'system') {
      continue;
    }
    if (event.type === 'result' && !getUsageFromResultEvent(event)) {
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
    if (event.type === 'turn.completed' || event.type === 'turn.empty' || event.type === 'turn.failed') {
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
  const messageId = sender === 'beegame'
    ? getBeeGameAssistantMessageId(event)
    : `beegame-event-${event.id}`;
  return {
    type,
    task_id: event.sessionId,
    project_id: projectId,
    sender,
    content: event.text,
    message_id: messageId,
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

function getToolMessageId(event: BeeGameEvent): string {
  const toolUseId = getPayloadString(event, 'toolUseID');
  if (toolUseId) return `beegame-tool-${event.sessionId}-${toolUseId}`;
  return `beegame-event-${event.id}`;
}

function formatToolContent(
  toolName: string,
  status: 'running' | 'completed' | 'failed',
  input: Record<string, unknown>,
  workspacePath: string,
  output = '',
): string {
  const normalizedTool = toolName.toLowerCase();
  const isSubagent = normalizedTool === 'agent' || normalizedTool === 'task';
  const description = String(input.description || '').trim();
  const subagentType = String(input.subagent_type || input.agent_type || '').trim();
  const prompt = String(input.prompt || '').trim();
  const lines = isSubagent
    ? [`Subagent: ${description || toolName}`, `Status: ${status}`]
    : [`Tool: ${toolName}`, `Status: ${status}`];
  if (isSubagent && subagentType) {
    lines.push(`Type: ${subagentType}`);
  }
  if (isSubagent && prompt) {
    lines.push(`Prompt: ${prompt.length > 220 ? `${prompt.slice(0, 220)}...` : prompt}`);
  }
  const command = String(input.command || '').trim();
  const targetPath = String(input.file_path || input.path || input.notebook_path || '').trim();
  if (!isSubagent && command) {
    lines.push(`Command: ${command}`);
  } else if (!isSubagent && targetPath) {
    lines.push(`Target: ${formatWorkspaceRelativePath(targetPath, workspacePath)}`);
  }
  if (output) {
    const summary = output.length > 160 ? `${output.slice(0, 160)}...` : output;
    lines.push(`Output: ${summary}`);
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

function getUsageFromResultEvent(event: BeeGameEvent): { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null {
  const usage = getPayloadRecord(event, 'usage');
  const promptTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const completionTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens);
  if (!promptTokens && !completionTokens && !totalTokens) return null;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
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
  if (containsCjk(languageSource)) {
    return [
      '我要做一个完整游戏项目。',
      '',
      `原始想法：${brief.idea}`,
      `已选择的游戏方向：${brief.option.title}`,
      `方向简介：${brief.option.pitch}`,
      `玩法：${brief.option.gameplay}`,
      `核心机制：${brief.option.coreMechanic}`,
      `第一分钟体验：${brief.option.playerFirstMinute}`,
      `第一版目标：${brief.option.firstBuild}`,
      `主要风险：${brief.option.risk}`,
      `Platform: ${settings.platform}`,
      `Visual style: ${settings.visualStyle}`,
      `Dimension: ${settings.dimension}`,
      `Genre: ${settings.genre}`,
      `Inputs: ${settings.inputs.join(', ')}`,
      `Scope: ${settings.scope}`,
      settings.notes ? `补充说明：${settings.notes}` : '',
      '',
      '请先在 docs/ 下完成游戏策划、GDD、技术方案、art direction、美术资源占位说明、audio direction、UI/UX、调参与验收说明。',
      '然后基于这些文档实现游戏。没有正式美术和音频资源时，请创建清晰命名、方便替换的 placeholder asset，并说明 replaceable 规则。',
      '实现后请运行你认为适合当前项目的检查和验证，发现问题就继续修复。',
      '最终请总结已完成内容、验证结果和仍然遗留的问题。',
    ].filter(Boolean).join('\n');
  }
  return [
    'I want to build a complete game project.',
    '',
    `Original idea: ${brief.idea}`,
    `Selected game direction: ${brief.option.title}`,
    `Direction pitch: ${brief.option.pitch}`,
    `Gameplay: ${brief.option.gameplay}`,
    `Core mechanic: ${brief.option.coreMechanic}`,
    `Player first minute: ${brief.option.playerFirstMinute}`,
    `First build target: ${brief.option.firstBuild}`,
    `Main risk: ${brief.option.risk}`,
    `Platform: ${settings.platform}`,
    `Visual style: ${settings.visualStyle}`,
    `Dimension: ${settings.dimension}`,
    `Genre: ${settings.genre}`,
    `Inputs: ${settings.inputs.join(', ')}`,
    `Scope: ${settings.scope}`,
    settings.notes ? `Notes: ${settings.notes}` : '',
    '',
    'First create project documents under docs/: game design, GDD, technical design, art direction, placeholder asset inventory, audio direction, UI/UX, tuning, and acceptance notes.',
    'Then implement the game from those documents. When production art or audio is unavailable, create clearly named placeholder asset files that are easy to replace and document the replaceable rules.',
    'After implementation, run the checks and validation you think fit this project. If you find problems, keep fixing them.',
    'Finally summarize what was completed, what was validated, and what remains.',
  ].filter(Boolean).join('\n');
}

function getResponseLanguageInstruction(text: string): string {
  return containsCjk(text)
    ? 'Response language: reply to the user in Simplified Chinese. Keep code, file paths, package names, commands, and API identifiers unchanged.'
    : 'Response language: reply in the same language as the user. Keep code, file paths, package names, commands, and API identifiers unchanged.';
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text);
}

function rememberSentDisplayText(sessionId: string, transportText: string, displayText: string): void {
  const values = readJson<Record<string, string>>(SENT_DISPLAY_KEY, {});
  values[`${sessionId}:${stableTextHash(transportText)}`] = displayText;
  writeJson(SENT_DISPLAY_KEY, values);
}

function resolveSentDisplayText(sessionId: string, transportText: string): string {
  const values = readJson<Record<string, string>>(SENT_DISPLAY_KEY, {});
  return values[`${sessionId}:${stableTextHash(transportText)}`] || transportText;
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
    .filter(event => !isUserQuestionPermissionEvent(event))
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

function extractArtifacts(projectId: string, events: BeeGameEvent[]): BeeGameArtifact[] {
  const artifacts = new Map<string, BeeGameArtifact>();
  for (const event of events) {
    if (event.type !== 'tool.started' && event.type !== 'tool.completed') continue;
    const toolName = getPayloadString(event, 'toolName') || '';
    const input = getPayloadRecord(event, 'input');
    const path = getArtifactPath(toolName, input);
    if (!path) continue;
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
  return [...artifacts.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function getArtifactPath(toolName: string, input: Record<string, unknown>): string {
  const normalizedTool = toolName.toLowerCase();
  if (!['write', 'edit', 'multiedit', 'notebookedit'].includes(normalizedTool)) return '';
  return String(input.file_path || input.path || input.notebook_path || '').trim();
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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  return readResponse<T>(response);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return readResponse<T>(response);
}

async function deleteJson<T = unknown>(path: string): Promise<T> {
  const response = await fetch(path, { method: 'DELETE' });
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
