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

export type ConsoleSession = {
  id: string
  cwd: string
  modelConfigId?: string
  status: 'running' | 'exited' | 'stopped' | 'failed'
  exitCode?: number | null
  createdAt: string
  updatedAt: string
}

export type ConsoleEvent = {
  id: number
  sessionId: string
  type:
    | 'session.started'
    | 'input'
    | 'stdout'
    | 'stderr'
    | 'session.exited'
    | 'session.stopped'
    | 'session.failed'
  text: string
  createdAt: string
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

export async function fetchConsoleSessions(): Promise<ConsoleSession[]> {
  return apiGet('/api/console/sessions')
}

export async function startConsoleSession(input: {
  workspacePath: string
  modelConfigId?: string
}): Promise<ConsoleSession> {
  return apiPost('/api/console/sessions', input)
}

export async function fetchConsoleSession(
  sessionId: string,
): Promise<ConsoleSession> {
  return apiGet(`/api/console/sessions/${sessionId}`)
}

export async function fetchConsoleEvents(
  sessionId: string,
  after = 0,
): Promise<ConsoleEvent[]> {
  return apiGet(`/api/console/sessions/${sessionId}/events?after=${after}`)
}

export async function sendConsoleInput(
  sessionId: string,
  text: string,
): Promise<ConsoleSession> {
  return apiPost(`/api/console/sessions/${sessionId}/input`, { text })
}

export async function stopConsoleSession(
  sessionId: string,
): Promise<ConsoleSession> {
  return apiPost(`/api/console/sessions/${sessionId}/stop`, {})
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
