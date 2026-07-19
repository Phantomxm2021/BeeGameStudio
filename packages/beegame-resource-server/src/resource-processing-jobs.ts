import type { ResourceElement } from '@bee-game-studio/beegame-resource-core'

export type ResourceProcessingJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type ResourceProcessingJob = {
  id: string
  packId: string
  kind: 'inspect-elements'
  status: ResourceProcessingJobStatus
  totalItems: number
  completedItems: number
  failedItems: number
  failures?: readonly ResourceProcessingFailure[]
  createdAt: string
  updatedAt: string
}
export type ResourceProcessingFailure = { elementId: string; error: string }

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type JobRow = { id: string; pack_id: string; kind: 'inspect-elements'; status: ResourceProcessingJobStatus; total_items: number; completed_items: number; failed_items: number; created_at: string; updated_at: string }
type ItemRow = { id: string; job_id: string; element_id: string; status: ResourceProcessingJobStatus; attempts: number; last_error?: string | null }

export type ResourceProcessingHandlers = {
  start(packId: string, elementIds?: readonly string[]): Promise<ResourceProcessingJob>
  get(packId: string, jobId: string): Promise<ResourceProcessingJob | undefined>
  latest(packId: string): Promise<ResourceProcessingJob | undefined>
  retry(packId: string, jobId: string): Promise<ResourceProcessingJob | undefined>
  cancel(packId: string, jobId: string): Promise<ResourceProcessingJob | undefined>
  resumePending(): Promise<void>
}

export function createSupabaseResourceProcessingHandlers(options: {
  baseUrl: string
  serviceRoleKey: string
  inspectElement: (packId: string, elementId: string) => Promise<ResourceElement | undefined>
  fetchImpl?: FetchImplementation
  concurrency?: number
}): ResourceProcessingHandlers {
  const fetchImpl = options.fetchImpl ?? fetch
  const rest = `${options.baseUrl.replace(/\/+$/, '')}/rest/v1`
  const headers = { apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}`, 'content-type': 'application/json' }
  const activeJobs = new Set<string>()
  const request = async <T>(path: string): Promise<T[]> => {
    const response = await fetchImpl(`${rest}/${path}`, { headers })
    if (!response.ok) throw new Error(`Resource processing lookup failed (${response.status})`)
    return response.json() as Promise<T[]>
  }
  const mutate = async <T>(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<T[]> => {
    const response = await fetchImpl(`${rest}/${path}`, { method, headers: { ...headers, prefer: 'return=representation' }, body: JSON.stringify(body) })
    if (!response.ok) throw new Error(`Resource processing persistence failed (${response.status})`)
    return response.json() as Promise<T[]>
  }
  const getJobRow = async (packId: string, jobId: string) => (await request<JobRow>(`beegame_resource_processing_jobs?id=eq.${encodeURIComponent(jobId)}&pack_id=eq.${encodeURIComponent(packId)}&select=*`))[0]
  const withFailures = async (row: JobRow): Promise<ResourceProcessingJob> => {
    if (!row.failed_items) return toJob(row)
    const items = await request<Pick<ItemRow, 'element_id' | 'last_error'>>(`beegame_resource_processing_items?job_id=eq.${encodeURIComponent(row.id)}&status=eq.failed&select=element_id,last_error`)
    return { ...toJob(row), failures: items.map(item => ({ elementId: item.element_id, error: item.last_error || 'Resource processing failed' })) }
  }
  const updateAggregate = async (jobId: string): Promise<JobRow | undefined> => {
    const [job] = await request<JobRow>(`beegame_resource_processing_jobs?id=eq.${encodeURIComponent(jobId)}&select=*`)
    if (!job || job.status === 'cancelled') return job
    const items = await request<ItemRow>(`beegame_resource_processing_items?job_id=eq.${encodeURIComponent(jobId)}&select=*`)
    const completed = items.filter(item => item.status === 'completed').length
    const failed = items.filter(item => item.status === 'failed').length
    const pending = items.some(item => item.status === 'queued' || item.status === 'running')
    const status: ResourceProcessingJobStatus = pending ? 'running' : failed ? 'failed' : 'completed'
    return (await mutate<JobRow>(`beegame_resource_processing_jobs?id=eq.${encodeURIComponent(jobId)}`, 'PATCH', { status, completed_items: completed, failed_items: failed, updated_at: new Date().toISOString() }))[0]
  }
  const run = async (jobId: string): Promise<void> => {
    if (activeJobs.has(jobId)) return
    activeJobs.add(jobId)
    try {
      await mutate<JobRow>(`beegame_resource_processing_jobs?id=eq.${encodeURIComponent(jobId)}&status=in.(queued,running)`, 'PATCH', { status: 'running', updated_at: new Date().toISOString() })
      const worker = async () => {
        for (;;) {
          const [job] = await request<JobRow>(`beegame_resource_processing_jobs?id=eq.${encodeURIComponent(jobId)}&select=*`)
          if (!job || job.status === 'cancelled') return
          const [candidate] = await request<ItemRow>(`beegame_resource_processing_items?job_id=eq.${encodeURIComponent(jobId)}&status=eq.queued&order=created_at.asc&limit=1&select=*`)
          if (!candidate) return
          const [claimed] = await mutate<ItemRow>(`beegame_resource_processing_items?id=eq.${encodeURIComponent(candidate.id)}&status=eq.queued`, 'PATCH', { status: 'running', attempts: candidate.attempts + 1, last_error: null, updated_at: new Date().toISOString() })
          if (!claimed) continue
          try {
            const element = await options.inspectElement(job.pack_id, claimed.element_id)
            if (!element) throw new Error('Resource element not found')
            await mutate<ItemRow>(`beegame_resource_processing_items?id=eq.${encodeURIComponent(claimed.id)}`, 'PATCH', { status: 'completed', updated_at: new Date().toISOString() })
          } catch (error) {
            await mutate<ItemRow>(`beegame_resource_processing_items?id=eq.${encodeURIComponent(claimed.id)}`, 'PATCH', { status: 'failed', last_error: safeError(error), updated_at: new Date().toISOString() })
          }
          await updateAggregate(jobId)
        }
      }
      await Promise.all(Array.from({ length: Math.max(1, Math.min(4, options.concurrency ?? 2)) }, () => worker()))
      await updateAggregate(jobId)
    } finally {
      activeJobs.delete(jobId)
    }
  }
  const schedule = (jobId: string) => { queueMicrotask(() => { void run(jobId).catch(error => console.warn('Resource processing job failed:', error)) }) }
  return {
    async start(packId, elementIds) {
      const available = await request<{ id: string; content_profile?: unknown }>(`beegame_resource_elements?pack_id=eq.${encodeURIComponent(packId)}&select=id,content_profile`)
      const availableIds = new Set(available.map(row => row.id))
      const ids = elementIds?.length
        ? [...new Set(elementIds)]
        : available.filter(row => inspectionStatus(row.content_profile) !== 'complete').map(row => row.id)
      if (ids.some(id => !availableIds.has(id))) throw new Error('Resource processing element does not belong to Pack')
      const now = new Date().toISOString()
      const jobId = `resource-job-${crypto.randomUUID()}`
      const [row] = await mutate<JobRow>('beegame_resource_processing_jobs', 'POST', { id: jobId, pack_id: packId, kind: 'inspect-elements', status: ids.length ? 'queued' : 'completed', total_items: ids.length, completed_items: 0, failed_items: 0, created_at: now, updated_at: now })
      if (ids.length) {
        await mutate<ItemRow>('beegame_resource_processing_items', 'POST', ids.map(elementId => ({ id: `resource-item-${crypto.randomUUID()}`, job_id: jobId, element_id: elementId, status: 'queued', attempts: 0, created_at: now, updated_at: now })))
        schedule(jobId)
      }
      return toJob(row)
    },
    async get(packId, jobId) {
      const row = await getJobRow(packId, jobId)
      return row ? withFailures(row) : undefined
    },
    async latest(packId) {
      const [row] = await request<JobRow>(`beegame_resource_processing_jobs?pack_id=eq.${encodeURIComponent(packId)}&order=created_at.desc&limit=1&select=*`)
      return row ? withFailures(row) : undefined
    },
    async retry(packId, jobId) {
      const row = await getJobRow(packId, jobId)
      if (!row) return undefined
      await mutate<ItemRow>(`beegame_resource_processing_items?job_id=eq.${encodeURIComponent(jobId)}&status=eq.failed`, 'PATCH', { status: 'queued', last_error: null, updated_at: new Date().toISOString() })
      const [updated] = await mutate<JobRow>(`beegame_resource_processing_jobs?id=eq.${encodeURIComponent(jobId)}`, 'PATCH', { status: 'queued', failed_items: 0, updated_at: new Date().toISOString() })
      schedule(jobId)
      return toJob(updated)
    },
    async cancel(packId, jobId) {
      const row = await getJobRow(packId, jobId)
      if (!row) return undefined
      const [updated] = await mutate<JobRow>(`beegame_resource_processing_jobs?id=eq.${encodeURIComponent(jobId)}`, 'PATCH', { status: 'cancelled', updated_at: new Date().toISOString() })
      await mutate<ItemRow>(`beegame_resource_processing_items?job_id=eq.${encodeURIComponent(jobId)}&status=eq.queued`, 'PATCH', { status: 'cancelled', updated_at: new Date().toISOString() })
      return toJob(updated)
    },
    async resumePending() {
      const rows = await request<JobRow>('beegame_resource_processing_jobs?status=in.(queued,running)&select=id')
      for (const row of rows) {
        await mutate<ItemRow>(`beegame_resource_processing_items?job_id=eq.${encodeURIComponent(row.id)}&status=eq.running`, 'PATCH', { status: 'queued', updated_at: new Date().toISOString() })
        schedule(row.id)
      }
    },
  }
}

function toJob(row: JobRow): ResourceProcessingJob {
  return { id: row.id, packId: row.pack_id, kind: row.kind, status: row.status, totalItems: row.total_items, completedItems: row.completed_items, failedItems: row.failed_items, createdAt: row.created_at, updatedAt: row.updated_at }
}

function safeError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return value.replaceAll('\r', ' ').replaceAll('\n', ' ').replaceAll('\t', ' ').slice(0, 500)
}

function inspectionStatus(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const inspection = (value as { inspection?: unknown }).inspection
  if (!inspection || typeof inspection !== 'object' || Array.isArray(inspection)) return undefined
  const status = (inspection as { status?: unknown }).status
  return typeof status === 'string' ? status : undefined
}
