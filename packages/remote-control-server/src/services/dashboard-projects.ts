import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'

export type TargetPlatform = 'web' | 'unity' | 'godot' | 'custom'

export type GameProjectStatus =
  | 'draft'
  | 'running'
  | 'ready'
  | 'failed'
  | 'archived'

export type GameRunStatus =
  | 'queued'
  | 'running'
  | 'requires_action'
  | 'completed'
  | 'failed'
  | 'canceled'

export type GameRunPhaseStatus =
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

export type GameProject = {
  id: string
  ownerId: string
  name: string
  idea: string
  targetPlatform: TargetPlatform
  workspacePath: string
  status: GameProjectStatus
  createdAt: Date
  updatedAt: Date
}

export type GameRunPhase = {
  id: string
  title: string
  status: GameRunPhaseStatus
}

export type GameRun = {
  id: string
  projectId: string
  modelConfigId: string
  status: GameRunStatus
  currentPhase: string
  phases: GameRunPhase[]
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

export type CreateGameProjectInput = {
  name: string
  idea: string
  targetPlatform: TargetPlatform
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

const PHASE_TITLES = [
  'Idea Intake',
  'GDD',
  'Technical Design',
  'Implementation Plan',
  'Implementation',
  'Build/Test',
  'Preview',
  'Iteration',
]

const projects = new Map<string, GameProject>()
const runs = new Map<string, GameRun>()
const artifacts = new Map<string, Artifact>()

export function resetDashboardProjects(): void {
  projects.clear()
  runs.clear()
  artifacts.clear()
}

export function createGameProject(
  ownerId: string,
  input: CreateGameProjectInput,
): GameProject {
  const now = new Date()
  const project: GameProject = {
    id: `game_${randomUUID().replace(/-/g, '')}`,
    ownerId,
    name: input.name,
    idea: input.idea,
    targetPlatform: input.targetPlatform,
    workspacePath: input.workspacePath,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
  projects.set(project.id, project)
  return project
}

export function createGameRun(input: CreateGameRunInput): GameRun {
  if (!projects.has(input.projectId)) {
    throw new Error('Project not found')
  }

  const now = new Date()
  const phases = PHASE_TITLES.map(title => ({
    id: title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),
    title,
    status: 'pending' as const,
  }))
  const run: GameRun = {
    id: `run_${randomUUID().replace(/-/g, '')}`,
    projectId: input.projectId,
    modelConfigId: input.modelConfigId,
    status: 'queued',
    currentPhase: phases[0].title,
    phases,
    createdAt: now,
    updatedAt: now,
  }
  runs.set(run.id, run)
  return run
}

export function createArtifact(input: CreateArtifactInput): Artifact {
  const project = projects.get(input.projectId)
  if (!project) throw new Error('Project not found')
  if (!runs.has(input.runId)) throw new Error('Run not found')

  if (input.path && !isInsideWorkspace(project.workspacePath, input.path)) {
    throw new Error('Artifact path must stay inside the project workspace')
  }

  const artifact: Artifact = {
    id: `artifact_${randomUUID().replace(/-/g, '')}`,
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
  return artifact
}

export function listArtifactsByRun(runId: string): Artifact[] {
  return [...artifacts.values()].filter(artifact => artifact.runId === runId)
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
