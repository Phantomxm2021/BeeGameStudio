import {
  isResourceExternalTransportError,
  withResourceExternalTransport,
  type ResourceElement,
  type ResourceSemanticRuntimeFailureStage,
} from '@bee-game-studio/beegame-resource-core'

export type ResourceProcessingJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type ResourceProcessingJobKind = 'inspect-elements' | 'semantic-curate-elements'
export type ResourceSemanticAnalysisMode = 'missing' | 'all'
export type ResourceProcessingUsage = {
  inputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  outputTokens: number
  totalTokens: number
  creditsMicro: number
}
export type ResourceProcessingBatchItem = { elementId: string; receiptId: string }
export type ResourceProcessingBatchRetry = {
  elementId: string
  error: string
  stage?: ResourceSemanticRuntimeFailureStage
  traceId?: string
}
export type ResourceProcessingBatchReceipt = {
  batchId: string
  items: readonly ResourceProcessingBatchItem[]
  retryItems: readonly ResourceProcessingBatchRetry[]
  usage?: ResourceProcessingUsage
}
export type ResourceProcessingJob = {
  id: string
  packId: string
  kind: ResourceProcessingJobKind
  status: ResourceProcessingJobStatus
  totalItems: number
  completedItems: number
  failedItems: number
  failures?: readonly ResourceProcessingFailure[]
  createdAt: string
  updatedAt: string
  ownerId?: string
  modelConfigId?: string
  analysisMode?: ResourceSemanticAnalysisMode
  retryOfJobId?: string
  usage?: ResourceProcessingUsage
}
export type ResourceProcessingFailure = {
  elementId: string
  error: string
  stage?: ResourceSemanticRuntimeFailureStage
  traceId?: string
}

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type JobRow = UsageRow & { id: string; pack_id: string; kind: ResourceProcessingJobKind; status: ResourceProcessingJobStatus; total_items: number; completed_items: number; failed_items: number; owner_id?: string | null; model_config_id?: string | null; analysis_mode?: ResourceSemanticAnalysisMode | null; retry_of_job_id?: string | null; created_at: string; updated_at: string }
type ItemRow = UsageRow & { id: string; job_id: string; element_id: string; status: ResourceProcessingJobStatus; attempts: number; source_content_hash?: string | null; curator_revision?: string | null; batch_id?: string | null; batch_receipt_id?: string | null; failure_stage?: ResourceSemanticRuntimeFailureStage | null; failure_trace_id?: string | null; last_error?: string | null }

export type ResourceProcessingHandlers = {
  start(packId: string, elementIds?: readonly string[], options?: { kind?: ResourceProcessingJobKind; analysisMode?: ResourceSemanticAnalysisMode; curatorRevision?: string; ownerId?: string; modelConfigId?: string; retryOfJobId?: string }): Promise<ResourceProcessingJob>
  get(packId: string, jobId: string): Promise<ResourceProcessingJob | undefined>
  latest(packId: string, kind?: ResourceProcessingJobKind): Promise<ResourceProcessingJob | undefined>
  retry(packId: string, jobId: string): Promise<ResourceProcessingJob | undefined>
  cancel(packId: string, jobId: string): Promise<ResourceProcessingJob | undefined>
  resumePending(): Promise<void>
}

export function createSupabaseResourceProcessingHandlers(options: {
  baseUrl: string
  serviceRoleKey: string
  inspectElement: (packId: string, elementId: string) => Promise<ResourceElement | undefined>
  processBatch?: (kind: ResourceProcessingJobKind, packId: string, batchId: string, items: readonly { elementId: string; sourceContentHash?: string; curatorRevision?: string; ownerId?: string; modelConfigId?: string; jobId: string; attempt: number }[], analysisMode: ResourceSemanticAnalysisMode) => Promise<ResourceProcessingBatchReceipt | undefined>
  canProcessKind?: (kind: ResourceProcessingJobKind) => boolean
  fetchImpl?: FetchImplementation
  concurrency?: number
  batchSize?: number
}): ResourceProcessingHandlers {
  const fetchImpl = options.fetchImpl ?? fetch
  const rest = `${options.baseUrl.replace(/\/+$/, '')}/rest/v1`
  const headers = { apikey: options.serviceRoleKey, authorization: `Bearer ${options.serviceRoleKey}`, 'content-type': 'application/json' }
  const activeJobs = new Set<string>()
  const scheduledRetries = new Set<string>()
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined
  let resumePending: () => Promise<void>
  const request = async <T>(path: string): Promise<T[]> => {
    const response = await withResourceExternalTransport({
      service: 'supabase',
      operation: `read ${path}`,
      execute: () => fetchImpl(`${rest}/${path}`, { headers }),
    })
    if (!response.ok) throw new Error(`Resource processing lookup failed (${response.status})`)
    return response.json() as Promise<T[]>
  }
  const mutate = async <T>(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<T[]> => {
    const response = await withResourceExternalTransport({
      service: 'supabase',
      operation: `${method} ${path}`,
      execute: () => fetchImpl(`${rest}/${path}`, { method, headers: { ...headers, prefer: 'return=representation' }, body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      const payload = await response.text().catch(() => '')
      const detail = persistenceErrorDetail(payload)
      throw new Error(`Resource processing persistence failed (${response.status})${detail ? `: ${detail}` : ''}`)
    }
    return response.json() as Promise<T[]>
  }
  const getJobRow = async (packId: string, jobId: string) => (await request<JobRow>(`beegame_resource_processing_jobs?id=eq.${encodeURIComponent(jobId)}&pack_id=eq.${encodeURIComponent(packId)}&select=*`))[0]
  const withFailures = async (row: JobRow): Promise<ResourceProcessingJob> => {
    if (!row.failed_items) return toJob(row)
    const items = await request<Pick<ItemRow, 'element_id' | 'last_error' | 'failure_stage' | 'failure_trace_id'>>(`beegame_resource_processing_items?job_id=eq.${encodeURIComponent(row.id)}&status=eq.failed&select=element_id,last_error,failure_stage,failure_trace_id`)
    return {
      ...toJob(row),
      failures: items.map(item => ({
        elementId: item.element_id,
        error: item.last_error || 'Resource processing failed',
        ...(item.failure_stage ? { stage: item.failure_stage } : {}),
        ...(item.failure_trace_id ? { traceId: item.failure_trace_id } : {}),
      })),
    }
  }
  const updateAggregate = async (jobId: string): Promise<JobRow | undefined> => {
    const [job] = await request<JobRow>(`beegame_resource_processing_jobs?id=eq.${encodeURIComponent(jobId)}&select=*`)
    if (!job || job.status === 'cancelled') return job
    const items = await request<ItemRow>(`beegame_resource_processing_items?job_id=eq.${encodeURIComponent(jobId)}&select=*`)
    const completed = items.filter(item => item.status === 'completed').length
    const failed = items.filter(item => item.status === 'failed').length
    const pending = items.some(item => item.status === 'queued' || item.status === 'running')
    const status: ResourceProcessingJobStatus = pending ? 'running' : failed ? 'failed' : 'completed'
    const usage = items.reduce((total, item) => addUsage(total, usageFromRow(item)), emptyUsage())
    return (await mutate<JobRow>(`beegame_resource_processing_jobs?id=eq.${encodeURIComponent(jobId)}`, 'PATCH', { status, completed_items: completed, failed_items: failed, ...usageToRow(usage), updated_at: new Date().toISOString() }))[0]
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
          const limit = job.kind === 'semantic-curate-elements' ? Math.max(1, Math.min(8, options.batchSize ?? 8)) : 1
          const running = job.kind === 'semantic-curate-elements'
            ? await request<ItemRow>(`beegame_resource_processing_items?job_id=eq.${encodeURIComponent(jobId)}&status=eq.running&order=created_at.asc&limit=${limit}&select=*`)
            : []
          const candidates = running.length > 0
            ? running
            : await request<ItemRow>(`beegame_resource_processing_items?job_id=eq.${encodeURIComponent(jobId)}&status=eq.queued&order=updated_at.asc,created_at.asc&limit=${limit}&select=*`)
          if (!candidates.length) return
          const claimed: ItemRow[] = []
          const existingBatchId = running[0]?.batch_id?.trim() || candidates.find(item => item.batch_id?.trim())?.batch_id?.trim() || ''
          const batchId = existingBatchId || `resource-batch-${job.id}-${candidates.map(item => item.id).join('-')}`
          for (const candidate of candidates) {
            if (running.length > 0) {
              if (candidate.batch_id?.trim() === batchId) {
                claimed.push(candidate)
              } else {
                const [item] = await mutate<ItemRow>(`beegame_resource_processing_items?id=eq.${encodeURIComponent(candidate.id)}&status=eq.running`, 'PATCH', { batch_id: batchId, updated_at: new Date().toISOString() })
                if (item) claimed.push(item)
              }
              continue
            }
            const [item] = await mutate<ItemRow>(`beegame_resource_processing_items?id=eq.${encodeURIComponent(candidate.id)}&status=eq.queued`, 'PATCH', { status: 'running', attempts: candidate.attempts + 1, batch_id: batchId, last_error: null, updated_at: new Date().toISOString() })
            if (item) claimed.push(item)
          }
          if (!claimed.length) continue
          try {
            if (job.kind === 'inspect-elements') {
              const element = await options.inspectElement(job.pack_id, claimed[0]!.element_id)
              if (!element) throw new Error('Resource element not found')
              await mutate<ItemRow>(`beegame_resource_processing_items?id=eq.${encodeURIComponent(claimed[0]!.id)}`, 'PATCH', { status: 'completed', updated_at: new Date().toISOString() })
            } else {
              if (!options.processBatch) throw new Error('Semantic resource processing is not configured')
              const receipt = await options.processBatch(job.kind, job.pack_id, batchId, claimed.map(item => ({
                elementId: item.element_id,
                ...(item.source_content_hash ? { sourceContentHash: item.source_content_hash } : {}),
                ...(item.curator_revision ? { curatorRevision: item.curator_revision } : {}),
                ...(job.owner_id ? { ownerId: job.owner_id } : {}),
                ...(job.model_config_id ? { modelConfigId: job.model_config_id } : {}),
                jobId: job.id,
                attempt: item.attempts,
              })), job.analysis_mode ?? 'missing')
              if (!receipt?.batchId?.trim() || receipt.batchId !== batchId) throw new Error('accepted durable semantic batch receipt is required')
              const expectedIds = new Set(claimed.map(item => item.element_id))
              const seenIds = new Set<string>()
              for (const result of receipt.items) {
                if (!result.receiptId.trim() || !expectedIds.has(result.elementId) || seenIds.has(result.elementId)) throw new Error('accepted durable semantic batch receipt is invalid')
                seenIds.add(result.elementId)
              }
              const retryIds = new Set<string>()
              for (const retry of receipt.retryItems) {
                if (!retry.error.trim() || !expectedIds.has(retry.elementId) || seenIds.has(retry.elementId) || retryIds.has(retry.elementId)) throw new Error('accepted durable semantic batch receipt is invalid')
                retryIds.add(retry.elementId)
              }
              if (seenIds.size + retryIds.size !== expectedIds.size) throw new Error('accepted durable semantic batch receipt is incomplete')
              for (const [index, item] of claimed.entries()) {
                const usage = index === 0 ? addUsage(usageFromRow(item), receipt.usage ?? emptyUsage()) : usageFromRow(item)
                if (retryIds.has(item.element_id)) {
                  const retry = receipt.retryItems.find(candidate => candidate.elementId === item.element_id)!
                  await mutate<ItemRow>(`beegame_resource_processing_items?id=eq.${encodeURIComponent(item.id)}&status=eq.running`, 'PATCH', {
                    status: 'queued', batch_id: null, batch_receipt_id: null, last_error: retry.error,
                    ...(retry.stage ? { failure_stage: retry.stage } : { failure_stage: null }),
                    ...(retry.traceId ? { failure_trace_id: retry.traceId } : { failure_trace_id: null }),
                    ...usageToRow(usage), updated_at: new Date().toISOString(),
                  })
                } else {
                  await mutate<ItemRow>(`beegame_resource_processing_items?id=eq.${encodeURIComponent(item.id)}&status=eq.running`, 'PATCH', { status: 'completed', batch_id: batchId, batch_receipt_id: `${batchId}:accepted`, ...usageToRow(usage), updated_at: new Date().toISOString() })
                }
              }
              await updateAggregate(jobId)
              if (retryIds.size === claimed.length) {
                scheduleRetry(jobId)
                return
              }
            }
          } catch (error) {
            if (isResourceExternalTransportError(error)) {
              for (const item of claimed) {
                await mutate<ItemRow>(`beegame_resource_processing_items?id=eq.${encodeURIComponent(item.id)}&status=eq.running`, 'PATCH', { status: 'queued', last_error: null, updated_at: new Date().toISOString() })
              }
              await mutate<JobRow>(`beegame_resource_processing_jobs?id=eq.${encodeURIComponent(jobId)}&status=in.(queued,running)`, 'PATCH', { status: 'queued', updated_at: new Date().toISOString() })
              scheduleRetry(jobId)
              return
            }
            const usage = usageFromError(error)
            const diagnostic = processingFailureDiagnostic(error)
            for (const [index, item] of claimed.entries()) {
              const cumulative = index === 0 ? addUsage(usageFromRow(item), usage ?? emptyUsage()) : usageFromRow(item)
              await mutate<ItemRow>(`beegame_resource_processing_items?id=eq.${encodeURIComponent(item.id)}`, 'PATCH', {
                status: 'failed',
                batch_id: batchId,
                last_error: diagnostic.message,
                ...(diagnostic.stage ? { failure_stage: diagnostic.stage } : {}),
                ...(diagnostic.traceId ? { failure_trace_id: diagnostic.traceId } : {}),
                ...usageToRow(cumulative),
                updated_at: new Date().toISOString(),
              })
            }
          }
          await updateAggregate(jobId)
        }
      }
      const workerCount = options.processBatch ? 1 : Math.max(1, Math.min(4, options.concurrency ?? 2))
      await Promise.all(Array.from({ length: workerCount }, () => worker()))
      const finalJob = await updateAggregate(jobId)
      if (finalJob && finalJob.failed_items > 0 && finalJob.status === 'failed') {
        console.warn('[BeeGame] resource processing job completed with failures', {
          jobId: finalJob.id,
          kind: finalJob.kind,
          failedItems: finalJob.failed_items,
          totalItems: finalJob.total_items,
        })
      }
    } catch (error) {
      if (isResourceExternalTransportError(error)) {
        try {
          await mutate<JobRow>(`beegame_resource_processing_jobs?id=eq.${encodeURIComponent(jobId)}&status=in.(queued,running)`, 'PATCH', { status: 'queued', updated_at: new Date().toISOString() })
        } catch {
          // The durable row remains authoritative; startup recovery will retry it.
        }
        scheduleRetry(jobId)
        return
      }
      throw error
    } finally {
      activeJobs.delete(jobId)
    }
  }
  const schedule = (jobId: string) => { queueMicrotask(() => { void run(jobId).catch(error => console.warn('Resource processing job failed:', error)) }) }
  const scheduleRetry = (jobId: string) => {
    if (scheduledRetries.has(jobId)) return
    scheduledRetries.add(jobId)
    const timer = setTimeout(() => {
      scheduledRetries.delete(jobId)
      schedule(jobId)
    }, 2_000)
    timer.unref?.()
  }
  const scheduleRecovery = () => {
    if (recoveryTimer) return
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined
      void resumePending().catch((error: unknown) => console.warn('Resource processing recovery failed:', error))
    }, 2_000)
    recoveryTimer.unref?.()
  }
  const handlers: ResourceProcessingHandlers = {
    async start(packId, elementIds, startOptions = {}) {
      const kind = startOptions.kind ?? 'inspect-elements'
      const analysisMode = startOptions.analysisMode ?? 'missing'
      const curatorRevision = startOptions.curatorRevision?.trim() || undefined
      if (kind === 'semantic-curate-elements' && !curatorRevision) throw new Error('Semantic resource processing curator revision is required')
      if (kind === 'semantic-curate-elements' && (!startOptions.ownerId?.trim() || !startOptions.modelConfigId?.trim())) throw new Error('Semantic resource processing model identity is required')
      if (options.canProcessKind && !options.canProcessKind(kind)) throw new Error('Semantic resource processing is not configured')
      const available = await request<{ id: string; content_profile?: unknown; specs?: Record<string, unknown> }>(`beegame_resource_elements?pack_id=eq.${encodeURIComponent(packId)}&select=id,content_profile,specs`)
      const availableIds = new Set(available.map(row => row.id))
      const ids = elementIds?.length
        ? [...new Set(elementIds)]
        : available.filter(row => inspectionStatus(row.content_profile) !== 'complete').map(row => row.id)
      if (ids.some(id => !availableIds.has(id))) throw new Error('Resource processing element does not belong to Pack')
      const sourceHashById = new Map(available.map(row => [row.id, typeof row.specs?.contentHash === 'string' ? row.specs.contentHash : undefined]))
      if (kind === 'semantic-curate-elements' && ids.some(id => !sourceHashById.get(id))) throw new Error('Semantic resource processing requires inspected content hashes')
      const now = new Date().toISOString()
      const jobId = `resource-job-${crypto.randomUUID()}`
      const [row] = await mutate<JobRow>('beegame_resource_processing_jobs', 'POST', { id: jobId, pack_id: packId, kind, analysis_mode: analysisMode, status: ids.length ? 'queued' : 'completed', total_items: ids.length, completed_items: 0, failed_items: 0, ...usageToRow(emptyUsage()), ...(startOptions.ownerId ? { owner_id: startOptions.ownerId } : {}), ...(startOptions.modelConfigId ? { model_config_id: startOptions.modelConfigId } : {}), ...(startOptions.retryOfJobId ? { retry_of_job_id: startOptions.retryOfJobId } : {}), created_at: now, updated_at: now })
      if (ids.length) {
        await mutate<ItemRow>('beegame_resource_processing_items', 'POST', ids.map(elementId => ({
          id: `resource-item-${crypto.randomUUID()}`, job_id: jobId, element_id: elementId, status: 'queued', attempts: 0,
          ...(sourceHashById.get(elementId) ? { source_content_hash: sourceHashById.get(elementId) } : {}),
          ...(curatorRevision ? { curator_revision: curatorRevision } : {}),
          created_at: now, updated_at: now,
        })))
        schedule(jobId)
      }
      return toJob(row)
    },
    async get(packId, jobId) {
      const row = await getJobRow(packId, jobId)
      return row ? withFailures(row) : undefined
    },
    async latest(packId, kind) {
      const kindFilter = kind ? `&kind=eq.${encodeURIComponent(kind)}` : ''
      const [row] = await request<JobRow>(`beegame_resource_processing_jobs?pack_id=eq.${encodeURIComponent(packId)}${kindFilter}&order=created_at.desc&limit=1&select=*`)
      return row ? withFailures(row) : undefined
    },
    async retry(packId, jobId) {
      const row = await getJobRow(packId, jobId)
      if (!row) return undefined
      const failedItems = await request<ItemRow>(`beegame_resource_processing_items?job_id=eq.${encodeURIComponent(jobId)}&status=eq.failed&select=*`)
      if (!failedItems.length) return toJob(row)
      return handlers.start(packId, failedItems.map(item => item.element_id), {
        kind: row.kind,
        analysisMode: row.analysis_mode ?? 'missing',
        ...(row.kind === 'semantic-curate-elements' && row.owner_id ? { ownerId: row.owner_id } : {}),
        ...(row.kind === 'semantic-curate-elements' && row.model_config_id ? { modelConfigId: row.model_config_id } : {}),
        ...(row.kind === 'semantic-curate-elements' && failedItems[0]?.curator_revision ? { curatorRevision: failedItems[0].curator_revision } : {}),
        retryOfJobId: row.id,
      })
    },
    async cancel(packId, jobId) {
      const row = await getJobRow(packId, jobId)
      if (!row) return undefined
      const [updated] = await mutate<JobRow>(`beegame_resource_processing_jobs?id=eq.${encodeURIComponent(jobId)}`, 'PATCH', { status: 'cancelled', updated_at: new Date().toISOString() })
      await mutate<ItemRow>(`beegame_resource_processing_items?job_id=eq.${encodeURIComponent(jobId)}&status=eq.queued`, 'PATCH', { status: 'cancelled', updated_at: new Date().toISOString() })
      return toJob(updated)
    },
    async resumePending() {
      try {
        const rows = await request<JobRow>('beegame_resource_processing_jobs?status=in.(queued,running)&select=id,kind')
        for (const row of rows) {
          if (options.canProcessKind && !options.canProcessKind(row.kind)) continue
          if (row.kind === 'inspect-elements') {
            await mutate<ItemRow>(`beegame_resource_processing_items?job_id=eq.${encodeURIComponent(row.id)}&status=eq.running`, 'PATCH', { status: 'queued', updated_at: new Date().toISOString() })
          }
          schedule(row.id)
        }
      } catch (error) {
        if (isResourceExternalTransportError(error)) scheduleRecovery()
        throw error
      }
    },
  }
  resumePending = handlers.resumePending
  return handlers
}

function toJob(row: JobRow): ResourceProcessingJob {
  const usage = usageFromRow(row)
  return { id: row.id, packId: row.pack_id, kind: row.kind, status: row.status, totalItems: row.total_items, completedItems: row.completed_items, failedItems: row.failed_items, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.owner_id ? { ownerId: row.owner_id } : {}), ...(row.model_config_id ? { modelConfigId: row.model_config_id } : {}), ...(row.kind === 'semantic-curate-elements' ? { analysisMode: row.analysis_mode ?? 'missing' } : {}), ...(row.retry_of_job_id ? { retryOfJobId: row.retry_of_job_id } : {}), ...(hasUsageColumns(row) ? { usage } : {}) }
}

const USAGE_ROW_KEYS = ['input_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'output_tokens', 'total_tokens', 'credits_micro'] as const
type UsageRow = Partial<Record<typeof USAGE_ROW_KEYS[number], number | string | null>>

function emptyUsage(): ResourceProcessingUsage {
  return { inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, totalTokens: 0, creditsMicro: 0 }
}

function usageFromRow(row: UsageRow): ResourceProcessingUsage {
  return {
    inputTokens: nonNegativeInteger(row.input_tokens),
    cacheReadTokens: nonNegativeInteger(row.cache_read_tokens),
    cacheCreationTokens: nonNegativeInteger(row.cache_creation_tokens),
    outputTokens: nonNegativeInteger(row.output_tokens),
    totalTokens: nonNegativeInteger(row.total_tokens),
    creditsMicro: nonNegativeInteger(row.credits_micro),
  }
}

function usageFromValue(value: unknown): ResourceProcessingUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const keys = ['inputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'outputTokens', 'totalTokens', 'creditsMicro']
  if (!keys.some(key => Object.hasOwn(record, key))) return undefined
  return {
    inputTokens: nonNegativeInteger(record.inputTokens),
    cacheReadTokens: nonNegativeInteger(record.cacheReadTokens),
    cacheCreationTokens: nonNegativeInteger(record.cacheCreationTokens),
    outputTokens: nonNegativeInteger(record.outputTokens),
    totalTokens: nonNegativeInteger(record.totalTokens),
    creditsMicro: nonNegativeInteger(record.creditsMicro),
  }
}

function usageFromError(error: unknown): ResourceProcessingUsage | undefined {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return undefined
  return usageFromValue((error as { usage?: unknown }).usage)
}

function usageToRow(usage: ResourceProcessingUsage | undefined): Record<string, number> {
  const value = usage ?? emptyUsage()
  return {
    input_tokens: value.inputTokens,
    cache_read_tokens: value.cacheReadTokens,
    cache_creation_tokens: value.cacheCreationTokens,
    output_tokens: value.outputTokens,
    total_tokens: value.totalTokens,
    credits_micro: value.creditsMicro,
  }
}

function addUsage(left: ResourceProcessingUsage, right: ResourceProcessingUsage): ResourceProcessingUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    creditsMicro: left.creditsMicro + right.creditsMicro,
  }
}

function hasUsageColumns(row: UsageRow): boolean {
  return USAGE_ROW_KEYS.some(key => row[key] !== undefined && row[key] !== null)
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : 0
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

function safeError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return value.replaceAll('\r', ' ').replaceAll('\n', ' ').replaceAll('\t', ' ').slice(0, 500)
}

function processingFailureDiagnostic(error: unknown): {
  message: string
  stage?: ResourceSemanticRuntimeFailureStage
  traceId?: string
} {
  const value = error && typeof error === 'object' ? error as {
    message?: unknown
    stage?: unknown
    traceId?: unknown
  } : {}
  const stage = value.stage
  return {
    message: safeError(error),
    ...(stage === 'runtime_transport' || stage === 'model_request' || stage === 'model_response' || stage === 'usage_billing'
      ? { stage }
      : {}),
    ...(typeof value.traceId === 'string' && value.traceId.trim()
      ? { traceId: value.traceId.trim() }
      : {}),
  }
}

function persistenceErrorDetail(payload: string): string {
  const trimmed = payload.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed) as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return trimmed.replaceAll('\r', ' ').replaceAll('\n', ' ').replaceAll('\t', ' ').slice(0, 500)
    const code = typeof parsed.code === 'string' && parsed.code.trim() ? `[${parsed.code.trim()}] ` : ''
    const detail = [parsed.message, parsed.details, parsed.hint].find(value => typeof value === 'string' && value.trim())
    return `${code}${typeof detail === 'string' ? detail.trim() : 'Database returned a structured error without a message'}`.slice(0, 500)
  } catch {
    return trimmed.replaceAll('\r', ' ').replaceAll('\n', ' ').replaceAll('\t', ' ').slice(0, 500)
  }
}

function inspectionStatus(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const inspection = (value as { inspection?: unknown }).inspection
  if (!inspection || typeof inspection !== 'object' || Array.isArray(inspection)) return undefined
  const status = (inspection as { status?: unknown }).status
  return typeof status === 'string' ? status : undefined
}
