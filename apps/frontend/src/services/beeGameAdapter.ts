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
    | 'workflow.phase'
    | 'workflow.blocked'
    | 'system.status'
    | 'result'
    | 'turn.completed'
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
  pitch: string;
  gameplay: string;
  recommendedPlatform: string;
  recommendedDimension: string;
  recommendedGenre: string;
  recommendedStyle: string;
  recommendedInputs: string[];
  scope: string;
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
const SENT_DISPLAY_KEY = 'beegame-adapter-sent-display-text';
const ARTIFACT_ID_PREFIX = 'beegame-artifact:';
const USER_QUESTION_TOOL = 'AskUserQuestion';
const ENV_WORKSPACE_PATH = String(import.meta.env.VITE_BEEGAME_WORKSPACE_PATH ?? '').trim();
const DISPLAY_MESSAGE_ID_KEY = '__displayMessageId';

export function isBeeGameAdapterEnabled(): boolean {
  return String(import.meta.env.VITE_BEEGAME_ADAPTER ?? '1') !== '0';
}

export const beeGameAdapter = {
  async getProjects(): Promise<Project[]> {
    return readProjects();
  },

  async createProject(data: { name: string; root_path?: string }): Promise<Project> {
    const project = createLocalProject(data.name, data.root_path);
    saveProjects(upsertProject(readProjects(), project));
    rememberWorkspace(data.root_path);
    return project;
  },

  async generateIntakeOptions(data: { idea: string }): Promise<BeeGameIntakeOption[]> {
    try {
      const response = await postJson<{ options: BeeGameIntakeOption[] }>(
        '/api/beegame-intake/options?ownerId=dashboard-local',
        { idea: data.idea },
      );
      if (Array.isArray(response.options) && response.options.length > 0) {
        return response.options;
      }
    } catch (error) {
      console.warn('Falling back to local BeeGame intake options:', error);
    }
    return buildFallbackIntakeOptions(data.idea);
  },

  async bootstrapProjectFromBrief(data: BeeGameBuildBrief): Promise<{
    project: Project;
    task_id: string;
    status: string;
    pipeline: { pipeline_id: string; status: string };
  }> {
    const workspacePath = await resolveWorkspacePath(data.root_path);
    const session = await startBeeGameSession(workspacePath);
    const project = createLocalProject(data.title || summarizeTitle(data.idea), workspacePath, `project_${session.id}`);
    saveProjects(upsertProject(readProjects(), project));
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
    const workspacePath = await resolveWorkspacePath(data.root_path);
    const session = await startBeeGameSession(workspacePath);
    const project = createLocalProject(data.title || summarizeTitle(data.idea), workspacePath, `project_${session.id}`);
    saveProjects(upsertProject(readProjects(), project));
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
      await deleteBeeGameSession(binding.sessionId, true);
    }
    saveProjects(readProjects().filter(project => project.id !== projectId));
    deleteBinding(projectId);
    return { ok: true };
  },

  async sendMessage(data: {
    content: string;
    project_id: string;
    client_message_id?: string;
  }): Promise<SendMessageResponse> {
    const session = await ensureProjectSession(data.project_id);
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
    const session = await ensureProjectSession(data.project_id);
    return {
      command_id: session.id,
      resume_task_id: data.task_id || session.id,
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
    const binding = await ensureProjectBinding(projectId);
    if (!binding) return [];
    const events = await fetchBeeGameEvents(binding.sessionId);
    return eventsToHistory(projectId, events, binding.workspacePath);
  },

  async pollMessages(projectId: string, afterEventId: number): Promise<{
    lastEventId: number;
    messages: WebSocketMessage[];
  }> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) return { lastEventId: afterEventId, messages: [] };
    const events = await fetchBeeGameEvents(binding.sessionId, afterEventId);
    const lastEventId = events.length > 0 ? events[events.length - 1].id : afterEventId;
    return {
      lastEventId,
      messages: normalizeLiveEvents(projectId, events).flatMap(event => eventToWebSocketMessages(projectId, event, binding.workspacePath)),
    };
  },

  async getProjectStatus(projectId: string): Promise<ProjectBaselineStatusPayload> {
    const binding = await ensureProjectBinding(projectId);
    const events = binding ? await fetchBeeGameEvents(binding.sessionId) : [];
    const pending = getPendingPermissionEvents(events);
    const runtimeStatus = deriveRuntimeStatus(events, pending);
    return {
      project_id: projectId,
      phase: runtimeStatus.phase,
      blocked: pending.length > 0,
      blocked_reason: pending[0]?.text ?? null,
      active_agents: runtimeStatus.activeAgents,
      updated_at: runtimeStatus.updatedAt,
      approval_required: pending.length > 0,
      next_action: runtimeStatus.nextAction,
      review_status: pending.length > 0
        ? {
            workflow_id: 'beegame',
            lane_id: 'permission',
            lane_status: 'awaiting_approval',
            decision_status: 'awaiting_user',
            reason_codes: ['beegame_permission_request'],
            requires_user_action: true,
            user_action_kind: 'approve',
            pending_issue_count: pending.length,
            blocking_issue_count: pending.length,
          }
        : null,
    };
  },

  async getPendingUserReviews(projectId: string): Promise<{ items: PendingUserReviewItem[] }> {
    const binding = await ensureProjectBinding(projectId);
    if (!binding) return { items: [] };
    const events = await fetchBeeGameEvents(binding.sessionId);
    return {
      items: getPendingPermissionEvents(events).map(event => permissionEventToReview(event, binding)),
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

  async getWorkflowPhases(projectId: string): Promise<unknown[]> {
    const status = await this.getProjectStatus(projectId);
    return [{ id: 'beegame', name: 'BeeGame', status: status.phase }];
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
    const events = await fetchBeeGameEvents(binding.sessionId);
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

async function ensureProjectSession(projectId: string): Promise<BeeGameSession> {
  const binding = getBinding(projectId);
  if (binding) {
    try {
      return await fetchBeeGameSession(binding.sessionId);
    } catch (error) {
      if (!isSessionNotFoundError(error)) throw error;
      deleteBinding(projectId);
    }
  }

  const project = readProjects().find(item => item.id === projectId);
  const workspacePath = await resolveWorkspacePath(project?.root_path);
  const session = await startBeeGameSession(workspacePath);
  saveBinding({ projectId, sessionId: session.id, workspacePath });
  return session;
}

async function ensureProjectBinding(projectId: string): Promise<ProjectSessionBinding | undefined> {
  const binding = getBinding(projectId);
  if (!binding) return undefined;
  try {
    await fetchBeeGameSession(binding.sessionId);
    return binding;
  } catch (error) {
    if (!isSessionNotFoundError(error)) throw error;
    deleteBinding(projectId);
    const project = readProjects().find(item => item.id === projectId);
    const workspacePath = await resolveWorkspacePath(project?.root_path || binding.workspacePath);
    const session = await startBeeGameSession(workspacePath);
    const nextBinding = { projectId, sessionId: session.id, workspacePath };
    saveBinding(nextBinding);
    return nextBinding;
  }
}

function isSessionNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Session not found';
}

async function resolveWorkspacePath(input?: string): Promise<string> {
  const workspacePath = (input || ENV_WORKSPACE_PATH || '').trim();
  if (workspacePath.startsWith('/')) {
    rememberWorkspace(workspacePath);
    return workspacePath;
  }

  let fallback: { path: string };
  try {
    fallback = await getJson<{ path: string }>('/api/filesystem/default-workspace');
  } catch (error) {
    throw new Error(
      `无法获取默认 Workspace path，请重启 agent-workflow-server 后端服务。${error instanceof Error ? ` (${error.message})` : ''}`,
    );
  }
  if (!fallback.path?.startsWith('/')) {
    throw new Error('后端没有返回可用的默认 Workspace path');
  }
  rememberWorkspace(fallback.path);
  return fallback.path;
}

function rememberWorkspace(path?: string): void {
  if (path?.trim().startsWith('/')) {
    localStorage.setItem(WORKSPACE_KEY, path.trim());
  }
}

async function startBeeGameSession(workspacePath: string): Promise<BeeGameSession> {
  const modelConfigId = await getDefaultModelConfigId();
  if (!modelConfigId) {
    throw new Error('请先在模型设置中配置 BeeGame LLM API Key、Base URL 和 Model，并设为默认模型。');
  }
  return postJson('/api/beegame-sessions', {
    workspacePath,
    modelConfigId,
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

async function deleteBeeGameSession(sessionId: string, deleteArtifacts: boolean): Promise<void> {
  const query = deleteArtifacts ? '?deleteArtifacts=1' : '';
  await deleteJson(`/api/beegame-sessions/${sessionId}${query}`);
}

async function fetchBeeGameEvents(sessionId: string, after = 0): Promise<BeeGameEvent[]> {
  return getJson(`/api/beegame-sessions/${sessionId}/events?after=${after}`);
}

function eventsToHistory(projectId: string, events: BeeGameEvent[], workspacePath = ''): unknown[] {
  return normalizeDisplayEvents(events).flatMap(event => eventToWebSocketMessages(projectId, event, workspacePath)).map(message => ({
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
      if (event.payload) return [];
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
    case 'workflow.phase':
      return [];
    case 'workflow.blocked':
      return [baseMessage('agent_message', {
        ...event,
        text: describeWorkflowBlocked(event),
      }, projectId, 'system')];
    case 'turn.completed':
    case 'session.stopped':
      return [{ type: 'status', task_id: taskId, project_id: projectId, status: 'finished' } as WebSocketMessage];
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

function deriveRuntimeStatus(events: BeeGameEvent[], pending: BeeGameEvent[]): {
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
  if (latest?.type === 'turn.completed' || latest?.type === 'assistant.message' || latest?.type === 'result') {
    return {
      phase: 'finished',
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
    if (event.type === 'turn.completed' || event.type === 'turn.failed') {
      openTurns.delete(getTurnDisplayId(event));
    }
  }
  return [...openTurns].at(-1) || null;
}

function describeRuntimeAction(event?: BeeGameEvent): string {
  if (!event) return 'BeeGame is working';
  if (event.type === 'assistant.partial') return 'Streaming BeeGame response';
  if (event.type === 'assistant.message') return 'Finalizing BeeGame response';
  if (event.type === 'workflow.phase') return describeWorkflowPhase(event);
  if (event.type === 'workflow.blocked') return describeWorkflowBlocked(event);
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

function describeWorkflowPhase(event: BeeGameEvent): string {
  const phase = getPayloadString(event, 'phase') || event.text;
  if (phase === 'planning') return 'Designing Playable Spec';
  if (phase === 'building') return 'Building the game';
  if (phase === 'completed') return 'BeeGame workflow completed';
  return event.text;
}

function describeWorkflowBlocked(event: BeeGameEvent): string {
  const toolName = getPayloadString(event, 'blockedToolName') || 'tool';
  const reason = getPayloadString(event, 'reason') || event.text;
  return `BeeGame paused build before ${toolName}: ${reason}`;
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
  const lines = [`Tool: ${toolName}`, `Status: ${status}`];
  const command = String(input.command || '').trim();
  const targetPath = String(input.file_path || input.path || input.notebook_path || '').trim();
  if (command) {
    lines.push(`Command: ${command}`);
  } else if (targetPath) {
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

function buildFallbackIntakeOptions(idea: string): BeeGameIntakeOption[] {
  const normalizedIdea = idea.trim() || 'Game';
  return [
    {
      id: 'classic_web',
      title: '经典 Web 版',
      pitch: `把「${normalizedIdea}」做成快速可玩的浏览器原型。`,
      gameplay: '保留核心玩法，优先做清晰规则、即时反馈、分数和失败条件。',
      recommendedPlatform: 'Web',
      recommendedDimension: '2D',
      recommendedGenre: 'Arcade',
      recommendedStyle: 'Pixel',
      recommendedInputs: ['Keyboard/mouse', 'Touch'],
      scope: 'Playable demo',
    },
    {
      id: 'progression_demo',
      title: '增强成长版',
      pitch: `为「${normalizedIdea}」加入关卡、道具或难度成长。`,
      gameplay: '在核心循环外增加目标、奖励、局内变化和可重复游玩的进度感。',
      recommendedPlatform: 'Web',
      recommendedDimension: '2D',
      recommendedGenre: 'Casual',
      recommendedStyle: 'Cartoon',
      recommendedInputs: ['Keyboard/mouse', 'Gamepad'],
      scope: 'Vertical slice',
    },
    {
      id: 'experimental_input',
      title: '实验交互版',
      pitch: `探索「${normalizedIdea}」在新输入方式或沉浸场景中的玩法。`,
      gameplay: '围绕触屏、语音、手柄或 XR 手追等输入设计差异化体验。',
      recommendedPlatform: 'XR',
      recommendedDimension: 'Mixed',
      recommendedGenre: 'Action',
      recommendedStyle: 'Minimal',
      recommendedInputs: ['Touch', 'Voice', 'Hand tracking XR'],
      scope: 'Prototype',
    },
  ];
}

function buildIdeaIntakePrompt(idea: string): string {
  return [
    'The user submitted this game idea:',
    idea,
    '',
    getResponseLanguageInstruction(idea),
    '',
    getBeeGameBrandInstruction(),
    '',
    'Workspace rule: use only the current working directory for all project files. Do not create, read, edit, or cd into paths outside the current working directory. If you create a game, place it inside this workspace.',
    '',
    'Before implementing or modifying files, first help the user choose a direction.',
    'Return 2-4 concise options that clarify gameplay, scope, tech approach, and visual style.',
    'Ask the user to pick one option or describe changes. Do not write code, create files, or run implementation commands until the user chooses.',
  ].join('\n');
}

function buildConfirmedBriefPrompt(brief: BeeGameBuildBrief): string {
  const settings = brief.settings;
  return [
    'Confirmed BeeGame build brief:',
    '',
    `Idea: ${brief.idea}`,
    `Selected direction: ${brief.option.title}`,
    `Direction pitch: ${brief.option.pitch}`,
    `Gameplay: ${brief.option.gameplay}`,
    `Platform: ${settings.platform}`,
    `Visual style: ${settings.visualStyle}`,
    `Dimension: ${settings.dimension}`,
    `Genre: ${settings.genre}`,
    `Inputs: ${settings.inputs.join(', ')}`,
    `Scope: ${settings.scope}`,
    settings.notes ? `Notes: ${settings.notes}` : '',
    '',
    getResponseLanguageInstruction(brief.idea),
    '',
    getBeeGameBrandInstruction(),
    '',
    'Workspace rule: create game files only inside the active BeeGame workspace.',
    'Prefer a new workspace-local game directory such as ./snake-game or ./games/snake.',
    'Do not create, edit, or suggest using BeeGame dashboard or host application source paths.',
    'Do not modify the BeeGame dashboard source code unless the user explicitly asks to modify the dashboard itself.',
    '',
    'First produce a Playable Spec, not a generic GDD.',
    'The Playable Spec must include: Core Loop, Fun Hook, Skill Test, Risk/Reward, Failure Pressure, First 3 Minutes, MVP Acceptance, technical architecture, art direction, asset slots, and level plan.',
    'Every proposed mechanic must explain why it improves player decisions, risk, skill, feedback, or replayability. Remove mechanics that do not serve one of those purposes.',
    'Create a Playability Acceptance Checklist before implementation. It must cover clarity within 30 seconds, first interesting decision within 60 seconds, responsive input feel, readable feedback, failure pressure, and one replayable challenge.',
    'When the Playable Spec and checklist are complete and internally checked, include this exact standalone line before implementation: PLAYABLE_SPEC_READY: yes',
    'Do not start implementation until the Playable Spec is internally checked against the checklist.',
    'After implementation, run build checks and then self-review the playable result against the Playability Acceptance Checklist.',
  ].filter(Boolean).join('\n');
}

function getBeeGameBrandInstruction(): string {
  return [
    'Branding rule: use BeeGame only for user-facing product wording, UI copy, README prose, and legacy runtime/dot-config labels.',
    'Do not apply BeeGame branding to code identifiers, import paths, package names, dependency scopes, commands, file paths, API identifiers, or tool inputs.',
    'Use real existing package names exactly as they are. Never invent or rewrite package scopes such as @beegame/*.',
    'For Ink UI code in this repository, use the real package name @ant/ink.',
  ].join(' ');
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
