export type ModelConfig = {
  id: string
  name: string
  provider: string
  baseUrl?: string
  apiKeyPreview: string
  isDefault: boolean
  models: ModelTierMap
}

export type ModelTierMap = {
  fast?: string
  balanced?: string
  strong?: string
}

export type ModelConfigInput = {
  name: string
  provider: string
  baseUrl?: string
  apiKey: string
  models: ModelTierMap
  isDefault?: boolean
}

export type Project = {
  id: string
  name: string
  idea: string
  targetRuntime: string
  workspacePath: string
  status: string
}

export type RunPhase = {
  id: string
  title: string
  status: string
}

export type Run = {
  id: string
  projectId: string
  modelConfigId: string
  status: string
  currentPhase: string
  phases: RunPhase[]
}

export type Artifact = {
  id: string
  title: string
  kind: string
  path?: string
  url?: string
}

export type WorkflowEvent = {
  id: string
  type: string
  message: string
  phase?: string
  agentName?: string
  createdAt: string
}

export type WorkerSummary = {
  id: string
  name: string
  role: string
  status: string
  activeRunId?: string
}

export type RunDetail = {
  project: Project
  run: Run
  artifacts: Artifact[]
  events: WorkflowEvent[]
}

export type ProjectInput = {
  name: string
  idea: string
  targetRuntime: string
  workspacePath: string
}

const ownerId = 'dashboard-local'

export async function fetchModels(): Promise<ModelConfig[]> {
  return apiGet(`/api/model-configs?ownerId=${ownerId}`)
}

export async function createModelConfig(
  input: ModelConfigInput,
): Promise<ModelConfig> {
  return apiPost(`/api/model-configs?ownerId=${ownerId}`, input)
}

export async function updateModelConfig(
  id: string,
  input: Partial<ModelConfigInput>,
): Promise<ModelConfig> {
  return apiPatch(`/api/model-configs/${id}?ownerId=${ownerId}`, input)
}

export async function deleteModelConfig(
  id: string,
): Promise<{ deleted: boolean }> {
  const response = await fetch(`/api/model-configs/${id}?ownerId=${ownerId}`, {
    method: 'DELETE',
  })
  return readResponse<{ deleted: boolean }>(response)
}

export async function fetchProjects(): Promise<Project[]> {
  return apiGet(`/api/projects?ownerId=${ownerId}`)
}

export async function createProject(input: ProjectInput): Promise<Project> {
  return apiPost(`/api/projects?ownerId=${ownerId}`, input)
}

export async function createRun(
  projectId: string,
  modelConfigId: string,
): Promise<Run> {
  return apiPost(`/api/runs?ownerId=${ownerId}`, {
    projectId,
    modelConfigId,
  })
}

export async function fetchProjectRuns(projectId: string): Promise<Run[]> {
  return apiGet(`/api/projects/${projectId}/runs`)
}

export async function fetchRunDetail(runId: string): Promise<RunDetail> {
  return apiGet(`/api/runs/${runId}`)
}

export async function fetchWorkers(): Promise<WorkerSummary[]> {
  return apiGet('/api/workers')
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path)
  return readResponse<T>(response)
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readResponse<T>(response)
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readResponse<T>(response)
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : response.statusText
    throw new Error(message)
  }
  return response.json() as Promise<T>
}
