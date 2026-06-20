import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'

export type ProjectStatus =
  | 'draft'
  | 'running'
  | 'ready'
  | 'failed'
  | 'archived'
export type RunStatus =
  | 'queued'
  | 'running'
  | 'requires_action'
  | 'completed'
  | 'failed'
  | 'canceled'
export type PhaseStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
export type ArtifactKind =
  | 'gdd'
  | 'tech_design'
  | 'implementation_plan'
  | 'source_file'
  | 'test_report'
  | 'preview'
export type WorkflowEventType =
  | 'run.created'
  | 'phase.updated'
  | 'agent.log'
  | 'artifact.created'
  | 'permission.requested'
  | 'run.completed'
  | 'run.failed'
  | 'run.canceled'

export type GameProject = {
  id: string
  ownerId: string
  name: string
  idea: string
  targetRuntime: string
  workspacePath: string
  status: ProjectStatus
  createdAt: Date
  updatedAt: Date
}

export type RunPhase = {
  id: string
  title: string
  status: PhaseStatus
}

export type GameRun = {
  id: string
  projectId: string
  modelConfigId: string
  status: RunStatus
  currentPhase: string
  phases: RunPhase[]
  createdAt: Date
  updatedAt: Date
}

export type Artifact = {
  id: string
  projectId: string
  runId: string
  kind: ArtifactKind
  title: string
  path?: string
  url?: string
  mimeType?: string
  createdAt: Date
}

export type WorkflowEvent = {
  id: string
  runId: string
  type: WorkflowEventType
  message: string
  phase?: string
  agentName?: string
  artifactId?: string
  createdAt: Date
}

export type WorkerSummary = {
  id: string
  name: string
  role: string
  status: 'idle' | 'running' | 'blocked' | 'offline'
  activeRunId?: string
}

export type CreateGameProjectInput = {
  name: string
  idea: string
  targetRuntime: string
  workspacePath: string
}

export type CreateGameRunInput = {
  projectId: string
  modelConfigId: string
}

export type CreateArtifactInput = {
  projectId: string
  runId: string
  kind: ArtifactKind
  title: string
  path?: string
  url?: string
  mimeType?: string
}

export type WorkflowEventInput = {
  type: WorkflowEventType
  message: string
  phase?: string
  agentName?: string
  artifactId?: string
}

export type RunDetail = {
  project: GameProject
  run: GameRun
  artifacts: Artifact[]
  events: WorkflowEvent[]
}

const WORKFLOW_PHASES: RunPhase[] = [
  { id: 'idea-intake', title: 'Idea Intake', status: 'pending' },
  { id: 'gdd', title: 'GDD', status: 'pending' },
  { id: 'technical-design', title: 'Technical Design', status: 'pending' },
  {
    id: 'implementation-plan',
    title: 'Implementation Plan',
    status: 'pending',
  },
  { id: 'implementation', title: 'Implementation', status: 'pending' },
  { id: 'build-test', title: 'Build/Test', status: 'pending' },
  { id: 'preview', title: 'Preview', status: 'pending' },
  { id: 'iteration', title: 'Iteration', status: 'pending' },
]

const workers: WorkerSummary[] = [
  { id: 'idea-agent', name: 'Idea Agent', role: 'intake', status: 'idle' },
  {
    id: 'design-agent',
    name: 'Design Agent',
    role: 'documents',
    status: 'idle',
  },
  {
    id: 'build-agent',
    name: 'Build Agent',
    role: 'implementation',
    status: 'idle',
  },
]

const projects = new Map<string, GameProject>()
const runs = new Map<string, GameRun>()
const artifacts = new Map<string, Artifact>()
const events = new Map<string, WorkflowEvent[]>()

export function resetWorkflows(): void {
  projects.clear()
  runs.clear()
  artifacts.clear()
  events.clear()
}

export function createGameProject(
  ownerId: string,
  input: CreateGameProjectInput,
): GameProject {
  const now = new Date()
  const project: GameProject = {
    id: `game_${randomUUID().replaceAll('-', '')}`,
    ownerId,
    name: input.name,
    idea: input.idea,
    targetRuntime: input.targetRuntime,
    workspacePath: input.workspacePath,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
  projects.set(project.id, project)
  return { ...project }
}

export function listGameProjectsByOwner(ownerId: string): GameProject[] {
  return [...projects.values()]
    .filter(project => project.ownerId === ownerId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(project => ({ ...project }))
}

export function getGameProject(id: string): GameProject | undefined {
  const project = projects.get(id)
  return project ? { ...project } : undefined
}

export function createGameRun(input: CreateGameRunInput): GameRun {
  const project = projects.get(input.projectId)
  if (!project) throw new Error('Project not found')

  const now = new Date()
  const run: GameRun = {
    id: `run_${randomUUID().replaceAll('-', '')}`,
    projectId: project.id,
    modelConfigId: input.modelConfigId,
    status: 'queued',
    currentPhase: WORKFLOW_PHASES[0].title,
    phases: WORKFLOW_PHASES.map(phase => ({ ...phase })),
    createdAt: now,
    updatedAt: now,
  }
  runs.set(run.id, run)
  appendWorkflowEvent(run.id, {
    type: 'run.created',
    message: 'Run queued',
    phase: run.currentPhase,
  })
  return cloneRun(run)
}

export function listGameRunsByProject(projectId: string): GameRun[] {
  return [...runs.values()]
    .filter(run => run.projectId === projectId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(cloneRun)
}

export function getGameRun(id: string): GameRun | undefined {
  const run = runs.get(id)
  return run ? cloneRun(run) : undefined
}

export function updateRunPhase(
  runId: string,
  phaseTitle: string,
  status: PhaseStatus,
): GameRun | undefined {
  const run = runs.get(runId)
  if (!run) return undefined
  const phase = run.phases.find(candidate => candidate.title === phaseTitle)
  if (!phase) return undefined

  phase.status = status
  run.currentPhase = phase.title
  run.status = status === 'failed' ? 'failed' : 'running'
  run.updatedAt = new Date()
  appendWorkflowEvent(run.id, {
    type: 'phase.updated',
    message: `${phase.title} ${status}`,
    phase: phase.title,
  })
  return cloneRun(run)
}

export function completeRun(
  runId: string,
  message = 'Run completed',
): GameRun | undefined {
  const run = runs.get(runId)
  if (!run) return undefined
  run.status = 'completed'
  run.updatedAt = new Date()
  const project = projects.get(run.projectId)
  if (project) {
    project.status = 'ready'
    project.updatedAt = run.updatedAt
  }
  appendWorkflowEvent(run.id, {
    type: 'run.completed',
    message,
    phase: run.currentPhase,
  })
  return cloneRun(run)
}

export function failRun(
  runId: string,
  message = 'Run failed',
): GameRun | undefined {
  const run = runs.get(runId)
  if (!run) return undefined
  run.status = 'failed'
  run.updatedAt = new Date()
  const currentPhase = run.phases.find(
    phase => phase.title === run.currentPhase,
  )
  if (currentPhase) currentPhase.status = 'failed'
  const project = projects.get(run.projectId)
  if (project) {
    project.status = 'failed'
    project.updatedAt = run.updatedAt
  }
  appendWorkflowEvent(run.id, {
    type: 'run.failed',
    message,
    phase: run.currentPhase,
  })
  return cloneRun(run)
}

export function cancelRun(
  runId: string,
  message = 'Run canceled',
): GameRun | undefined {
  const run = runs.get(runId)
  if (!run) return undefined
  run.status = 'canceled'
  run.updatedAt = new Date()
  appendWorkflowEvent(run.id, {
    type: 'run.canceled',
    message,
    phase: run.currentPhase,
  })
  return cloneRun(run)
}

export function requestRunPermission(
  runId: string,
  input: {
    message: string
    phase?: string
    agentName?: string
  },
): GameRun | undefined {
  const run = runs.get(runId)
  if (!run) return undefined
  run.status = 'requires_action'
  if (input.phase) run.currentPhase = input.phase
  run.updatedAt = new Date()
  appendWorkflowEvent(run.id, {
    type: 'permission.requested',
    message: input.message,
    ...(input.phase ? { phase: input.phase } : {}),
    ...(input.agentName ? { agentName: input.agentName } : {}),
  })
  return cloneRun(run)
}

export function createArtifact(input: CreateArtifactInput): Artifact {
  const project = projects.get(input.projectId)
  if (!project) throw new Error('Project not found')
  if (!runs.has(input.runId)) throw new Error('Run not found')
  if (input.path && !isInsideWorkspace(project.workspacePath, input.path)) {
    throw new Error('Artifact path must stay inside the project workspace')
  }

  const artifact: Artifact = {
    id: `artifact_${randomUUID().replaceAll('-', '')}`,
    projectId: input.projectId,
    runId: input.runId,
    kind: input.kind,
    title: input.title,
    ...(input.path ? { path: input.path } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    createdAt: new Date(),
  }
  artifacts.set(artifact.id, artifact)
  appendWorkflowEvent(input.runId, {
    type: 'artifact.created',
    message: artifact.title,
    artifactId: artifact.id,
  })
  return { ...artifact }
}

export function listArtifactsByRun(runId: string): Artifact[] {
  return [...artifacts.values()]
    .filter(artifact => artifact.runId === runId)
    .map(artifact => ({ ...artifact }))
}

export function appendWorkflowEvent(
  runId: string,
  input: WorkflowEventInput,
): WorkflowEvent {
  if (!runs.has(runId)) throw new Error('Run not found')
  const event: WorkflowEvent = {
    id: `event_${randomUUID().replaceAll('-', '')}`,
    runId,
    type: input.type,
    message: input.message,
    ...(input.phase ? { phase: input.phase } : {}),
    ...(input.agentName ? { agentName: input.agentName } : {}),
    ...(input.artifactId ? { artifactId: input.artifactId } : {}),
    createdAt: new Date(),
  }
  const current = events.get(runId) ?? []
  current.push(event)
  events.set(runId, current)
  return { ...event }
}

export function listWorkflowEvents(runId: string): WorkflowEvent[] {
  return (events.get(runId) ?? []).map(event => ({ ...event }))
}

export function getRunDetail(runId: string): RunDetail | undefined {
  const run = runs.get(runId)
  if (!run) return undefined
  const project = projects.get(run.projectId)
  if (!project) return undefined

  return {
    project: { ...project },
    run: cloneRun(run),
    artifacts: listArtifactsByRun(run.id),
    events: listWorkflowEvents(run.id),
  }
}

export function listWorkers(): WorkerSummary[] {
  return workers.map(worker => ({ ...worker }))
}

function cloneRun(run: GameRun): GameRun {
  return {
    ...run,
    phases: run.phases.map(phase => ({ ...phase })),
  }
}

function isInsideWorkspace(
  workspacePath: string,
  artifactPath: string,
): boolean {
  const workspace = resolve(workspacePath)
  const artifact = resolve(artifactPath)
  const rel = relative(workspace, artifact)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
