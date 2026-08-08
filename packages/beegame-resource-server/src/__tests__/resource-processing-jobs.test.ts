import { describe, expect, test } from 'bun:test'
import { createSupabaseResourceProcessingHandlers, type ResourceProcessingJob } from '../resource-processing-jobs'
import { ResourceExternalTransportError } from '@bee-game-studio/beegame-resource-core'

type Row = Record<string, unknown>
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

describe('persistent resource processing jobs', () => {
  test('processes semantic items through one synchronous model call without a provider batch', async () => {
    const elements = Array.from({ length: 2 }, (_, index) => ({ id: `element-${index + 1}`, pack_id: 'pack-1', specs: { contentHash: `${index + 1}`.repeat(64) }, usage_tags: [] }))
    const database = createRestDatabase({ beegame_resource_elements: elements })
    const processed: string[][] = []
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
      inspectElement: async () => undefined,
      processBatch: async (_kind, _packId, batchId, items) => {
        processed.push(items.map(item => item.elementId))
        return {
          batchId,
          items: items.map(item => ({ elementId: item.elementId, receiptId: `receipt-${item.elementId}` })),
          retryItems: [],
        }
      },
    } as Parameters<typeof createSupabaseResourceProcessingHandlers>[0])
    const created = await handlers.start('pack-1', elements.map(element => element.id), { kind: 'semantic-curate-elements', curatorRevision: 'semantic-curator-v1', ownerId: 'owner-1', modelConfigId: 'model-1' })
    const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id), 300)
    expect(terminal).toEqual(expect.objectContaining({ status: 'completed', completedItems: 2, failedItems: 0 }))
    expect(processed).toEqual([elements.map(element => element.id)])
  })

  test('preserves the database diagnostic when creating a processing job is rejected', async () => {
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
        if (init?.method === 'POST' && url.pathname.endsWith('/beegame_resource_processing_jobs')) {
          return Response.json({ code: 'PGRST204', details: null, hint: null, message: "Could not find the 'input_tokens' column of 'beegame_resource_processing_jobs' in the schema cache" }, { status: 400 })
        }
        return Response.json([{ id: 'element-1', pack_id: 'pack-1', specs: { contentHash: 'a'.repeat(64) }, usage_tags: [] }])
      },
      inspectElement: async () => undefined,
    })

    await expect(handlers.start('pack-1', ['element-1'], { kind: 'semantic-curate-elements', curatorRevision: 'semantic-curator-v1', ownerId: 'owner-1', modelConfigId: 'model-1' })).rejects.toThrow("Could not find the 'input_tokens' column of 'beegame_resource_processing_jobs' in the schema cache")
  })

  test('runs semantic curation through the same durable state machine and requires a receipt', async () => {
    const database = createRestDatabase({ beegame_resource_elements: [{ id: 'element-1', pack_id: 'pack-1', specs: { contentHash: 'a'.repeat(64) }, usage_tags: [] }] })
    const processed: string[] = []
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
      inspectElement: async () => undefined,
      processBatch: async (kind, packId, batchId, items) => {
        processed.push(`${kind}:${packId}:${batchId}:${items.map(item => item.elementId).join(',')}`)
        return { batchId, items: items.map(item => ({ elementId: item.elementId, receiptId: `semantic-receipt-${item.elementId}` })), retryItems: [] }
      },
    })

    const created = await handlers.start('pack-1', ['element-1'], { kind: 'semantic-curate-elements', curatorRevision: 'semantic-curator-v1', ownerId: 'owner-1', modelConfigId: 'model-1' })
    const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id))

    expect(terminal).toEqual(expect.objectContaining({ kind: 'semantic-curate-elements', status: 'completed', completedItems: 1, failedItems: 0 }))
    expect(processed[0]).toContain('semantic-curate-elements:pack-1:resource-batch-')
    expect(processed[0]).toContain(':element-1')
  })

  test('claims semantic elements in ordered batches of at most eight', async () => {
    const elements = Array.from({ length: 9 }, (_, index) => ({ id: `element-${index + 1}`, pack_id: 'pack-1', specs: { contentHash: `${index}`.repeat(64) }, usage_tags: [] }))
    const database = createRestDatabase({ beegame_resource_elements: elements })
    const batchSizes: number[] = []
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
      inspectElement: async () => undefined,
      processBatch: async (_kind, _packId, batchId, items) => {
        batchSizes.push(items.length)
        return { batchId, items: items.map(item => ({ elementId: item.elementId, receiptId: `receipt-${item.elementId}` })), retryItems: [] }
      },
    })

    const created = await handlers.start('pack-1', elements.map(element => element.id), { kind: 'semantic-curate-elements', curatorRevision: 'semantic-curator-v1', ownerId: 'owner-1', modelConfigId: 'model-1' })
    const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id))

    expect(terminal).toEqual(expect.objectContaining({ status: 'completed', completedItems: 9, failedItems: 0 }))
    expect(batchSizes).toEqual([8, 1])
  })

  test('requeues a preview failure for the next batch without sending it to the current model call', async () => {
    const elements = Array.from({ length: 3 }, (_, index) => ({ id: `element-${index + 1}`, pack_id: 'pack-1', specs: { contentHash: `${index + 1}`.repeat(64) }, usage_tags: [] }))
    const database = createRestDatabase({ beegame_resource_elements: elements })
    const batches: string[][] = []
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
      inspectElement: async () => undefined,
      batchSize: 2,
      processBatch: async (_kind, _packId, batchId, items) => {
        batches.push(items.map(item => item.elementId))
        if (batches.length === 1) {
          return {
            batchId,
            items: [{ elementId: 'element-2', receiptId: 'receipt-element-2' }],
            retryItems: [{ elementId: 'element-1', error: 'Resource model semantic preview could not be rendered' }],
          }
        }
        return { batchId, items: items.map(item => ({ elementId: item.elementId, receiptId: `receipt-${item.elementId}` })), retryItems: [] }
      },
    })

    const created = await handlers.start('pack-1', elements.map(element => element.id), { kind: 'semantic-curate-elements', curatorRevision: 'semantic-curator-v1', ownerId: 'owner-1', modelConfigId: 'model-1' })
    const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id), 1_500)

    expect(terminal).toEqual(expect.objectContaining({ status: 'completed', completedItems: 3, failedItems: 0 }))
    expect(batches[0]).toEqual(['element-1', 'element-2'])
    expect(batches.slice(1).some(batch => batch.includes('element-3'))).toBe(true)
    expect(batches.slice(1).some(batch => batch.includes('element-1'))).toBe(true)
  })

  test('persists cumulative semantic model usage on the durable job', async () => {
    const database = createRestDatabase({ beegame_resource_elements: [
      { id: 'element-1', pack_id: 'pack-1', specs: { contentHash: 'a'.repeat(64) }, usage_tags: [] },
      { id: 'element-2', pack_id: 'pack-1', specs: { contentHash: 'b'.repeat(64) }, usage_tags: [] },
    ] })
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
      inspectElement: async () => undefined,
      concurrency: 2,
      processBatch: async (_kind, _packId, batchId, items) => ({
        batchId,
        items: items.map(item => ({ elementId: item.elementId, receiptId: `semantic-receipt-${item.elementId}` })),
        retryItems: [],
        usage: {
          inputTokens: 140,
          cacheReadTokens: 30,
          cacheCreationTokens: 10,
          outputTokens: 40,
          totalTokens: 210,
          creditsMicro: 1_000,
        },
      }),
    })

    const created = await handlers.start('pack-1', ['element-1', 'element-2'], { kind: 'semantic-curate-elements', curatorRevision: 'semantic-curator-v1', ownerId: 'owner-1', modelConfigId: 'model-1' })
    const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id))

    expect(terminal?.usage).toEqual({
      inputTokens: 140,
      cacheReadTokens: 30,
      cacheCreationTokens: 10,
      outputTokens: 40,
      totalTokens: 210,
      creditsMicro: 1_000,
    })
  })

  test('does not mark semantic work complete when no accepted durable receipt exists', async () => {
    const database = createRestDatabase({ beegame_resource_elements: [{ id: 'element-1', pack_id: 'pack-1', specs: { contentHash: 'a'.repeat(64) }, usage_tags: [] }] })
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
      inspectElement: async () => undefined,
      processBatch: async () => undefined,
    })

    const created = await handlers.start('pack-1', ['element-1'], { kind: 'semantic-curate-elements', curatorRevision: 'semantic-curator-v1', ownerId: 'owner-1', modelConfigId: 'model-1' })
    const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id))

    expect(terminal).toEqual(expect.objectContaining({ kind: 'semantic-curate-elements', status: 'failed', completedItems: 0, failedItems: 1 }))
    expect(terminal?.failures?.[0]?.error).toContain('accepted durable semantic batch receipt')
  })

  test('requeues a transport failure without losing the durable semantic batch identity', async () => {
    const database = createRestDatabase({ beegame_resource_elements: [{ id: 'element-1', pack_id: 'pack-1', specs: { contentHash: 'a'.repeat(64) }, usage_tags: [] }] })
    const batchIds: string[] = []
    let attempts = 0
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
      inspectElement: async () => undefined,
      processBatch: async (_kind, _packId, batchId, items) => {
        batchIds.push(batchId)
        attempts += 1
        if (attempts === 1) throw new ResourceExternalTransportError('resource-runtime', 'semantic curation request', 'temporary certificate failure')
        return { batchId, items: items.map(item => ({ elementId: item.elementId, receiptId: `receipt-${item.elementId}` })), retryItems: [] }
      },
    })

    const created = await handlers.start('pack-1', ['element-1'], { kind: 'semantic-curate-elements', curatorRevision: 'semantic-curator-v1', ownerId: 'owner-1', modelConfigId: 'model-1' })
    const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id), 1_500)

    expect(terminal?.status).toBe('completed')
    expect(batchIds).toHaveLength(2)
    expect(batchIds[0]).toBe(batchIds[1])
  })

  test('persists progress and reaches a terminal result independently of the browser', async () => {
    const database = createRestDatabase({ beegame_resource_elements: [{ id: 'element-1', pack_id: 'pack-1', content_profile: null }, { id: 'element-2', pack_id: 'pack-1', content_profile: null }] })
    const inspected: string[] = []
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
      inspectElement: async (packId, elementId) => { inspected.push(`${packId}:${elementId}`); return { id: elementId, packId, name: elementId, path: `${elementId}.glb`, category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready' } },
    })

    const created = await handlers.start('pack-1', ['element-1', 'element-2'])
    const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id))

    expect(terminal).toEqual(expect.objectContaining({ status: 'completed', totalItems: 2, completedItems: 2, failedItems: 0 }))
    expect(inspected.sort()).toEqual(['pack-1:element-1', 'pack-1:element-2'])
  })

  test('requeues an interrupted running item during service recovery', async () => {
    const now = new Date().toISOString()
    const database = createRestDatabase({
      beegame_resource_elements: [{ id: 'element-1', pack_id: 'pack-1', content_profile: null }],
      beegame_resource_processing_jobs: [{ id: 'job-1', pack_id: 'pack-1', kind: 'inspect-elements', status: 'running', total_items: 1, completed_items: 0, failed_items: 0, created_at: now, updated_at: now }],
      beegame_resource_processing_items: [{ id: 'item-1', job_id: 'job-1', element_id: 'element-1', status: 'running', attempts: 1, created_at: now, updated_at: now }],
    })
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
      inspectElement: async (packId, elementId) => ({ id: elementId, packId, name: elementId, path: `${elementId}.glb`, category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready' }),
    })

    await handlers.resumePending()
    const terminal = await waitForTerminal(() => handlers.get('pack-1', 'job-1'))

    expect(terminal).toEqual(expect.objectContaining({ status: 'completed', completedItems: 1 }))
  })

  test('resumes an interrupted semantic batch with its durable batch identity', async () => {
    const now = new Date().toISOString()
    const database = createRestDatabase({
      beegame_resource_elements: [{ id: 'element-1', pack_id: 'pack-1', specs: { contentHash: 'a'.repeat(64) }, usage_tags: [] }],
      beegame_resource_processing_jobs: [{ id: 'job-1', pack_id: 'pack-1', kind: 'semantic-curate-elements', status: 'running', total_items: 1, completed_items: 0, failed_items: 0, created_at: now, updated_at: now }],
      beegame_resource_processing_items: [{ id: 'item-1', job_id: 'job-1', element_id: 'element-1', status: 'running', attempts: 1, batch_id: 'batch-1', created_at: now, updated_at: now }],
    })
    const batchIds: string[] = []
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
      inspectElement: async () => undefined,
      processBatch: async (_kind, _packId, batchId, items) => {
        batchIds.push(batchId)
        return { batchId, items: items.map(item => ({ elementId: item.elementId, receiptId: 'receipt-1' })), retryItems: [] }
      },
    })

    await handlers.resumePending()
    const terminal = await waitForTerminal(() => handlers.get('pack-1', 'job-1'))

    expect(terminal).toEqual(expect.objectContaining({ status: 'completed', completedItems: 1 }))
    expect(batchIds).toEqual(['batch-1'])
  })

  test('persists full analysis mode and passes it through recovery batches', async () => {
    const database = createRestDatabase({
      beegame_resource_elements: [{ id: 'element-1', pack_id: 'pack-1', specs: { contentHash: 'a'.repeat(64) }, usage_tags: ['environment'] }],
    })
    const modes: unknown[] = []
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
      inspectElement: async () => undefined,
      processBatch: async (_kind, _packId, batchId, items, analysisMode) => {
        modes.push(analysisMode)
        return { batchId, items: items.map(item => ({ elementId: item.elementId, receiptId: 'receipt-1' })), retryItems: [] }
      },
    })

    const created = await handlers.start('pack-1', ['element-1'], { kind: 'semantic-curate-elements', analysisMode: 'all', curatorRevision: 'semantic-curator-v1', ownerId: 'owner-1', modelConfigId: 'model-1' })
    const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id))

    expect(terminal?.analysisMode).toBe('all')
    expect(modes).toEqual(['all'])
  })

  test('retries only failed semantic items in a new scoped job', async () => {
    const elements = Array.from({ length: 3 }, (_, index) => ({
      id: `element-${index + 1}`,
      pack_id: 'pack-1',
      specs: { contentHash: `${index + 1}`.repeat(64) },
      usage_tags: [],
    }))
    const database = createRestDatabase({ beegame_resource_elements: elements })
    let attempts = 0
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
      inspectElement: async () => undefined,
      batchSize: 2,
      processBatch: async (_kind, _packId, batchId, items) => {
        attempts += 1
        if (attempts === 1) return undefined
        return { batchId, items: items.map(item => ({ elementId: item.elementId, receiptId: `receipt-${item.elementId}` })), retryItems: [] }
      },
    })

    const created = await handlers.start('pack-1', elements.map(element => element.id), {
      kind: 'semantic-curate-elements', analysisMode: 'all', curatorRevision: 'semantic-curator-v1', ownerId: 'owner-1', modelConfigId: 'model-1',
    })
    const original = await waitForTerminal(() => handlers.get('pack-1', created.id))

    expect(original).toEqual(expect.objectContaining({ status: 'failed', totalItems: 3, completedItems: 1, failedItems: 2 }))
    const retry = await handlers.retry('pack-1', created.id)
    expect(retry).toEqual(expect.objectContaining({ retryOfJobId: created.id, analysisMode: 'all', totalItems: 2, completedItems: 0, failedItems: 0 }))
    expect(retry?.id).not.toBe(created.id)

    const retried = await waitForTerminal(() => handlers.get('pack-1', retry!.id))
    expect(retried).toEqual(expect.objectContaining({ status: 'completed', totalItems: 2, completedItems: 2, failedItems: 0 }))
    expect(await handlers.get('pack-1', created.id)).toEqual(expect.objectContaining({ status: 'failed', totalItems: 3, completedItems: 1, failedItems: 2 }))
  })

  test('returns per-element diagnostics for failed processing items', async () => {
    const database = createRestDatabase({ beegame_resource_elements: [{ id: 'element-1', pack_id: 'pack-1', content_profile: null }] })
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
      inspectElement: async () => { throw new Error('Processor rejected malformed model') },
    })

    const created = await handlers.start('pack-1', ['element-1'])
    const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id))

    expect(terminal).toEqual(expect.objectContaining({
      status: 'failed',
      failedItems: 1,
      failures: [{ elementId: 'element-1', error: 'Processor rejected malformed model' }],
    }))
  })

  test('persists the failing runtime stage and trace on the durable item', async () => {
    const database = createRestDatabase({ beegame_resource_elements: [{ id: 'element-1', pack_id: 'pack-1', content_profile: null }] })
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
      inspectElement: async () => {
        const error = new Error('unknown certificate verification error') as Error & { stage?: string; traceId?: string }
        error.stage = 'usage_billing'
        error.traceId = 'trace-1'
        throw error
      },
    })

    const created = await handlers.start('pack-1', ['element-1'])
    const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id))

    expect(terminal?.failures).toEqual([{
      elementId: 'element-1',
      error: 'unknown certificate verification error',
      stage: 'usage_billing',
      traceId: 'trace-1',
    }])
  })

  test('emits one aggregate diagnostic when a durable job finishes with failures', async () => {
    const database = createRestDatabase({ beegame_resource_elements: [{ id: 'element-1', pack_id: 'pack-1', content_profile: null }] })
    const warnings: unknown[][] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => { warnings.push(args) }
    try {
      const handlers = createSupabaseResourceProcessingHandlers({
        baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
        inspectElement: async () => { throw new Error('Processor rejected malformed model') },
      })

      const created = await handlers.start('pack-1', ['element-1'])
      const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id))

      expect(terminal?.status).toBe('failed')
      expect(warnings.some(args => args[0] === '[BeeGame] resource processing job completed with failures')).toBe(true)
    } finally {
      console.warn = originalWarn
    }
  })

  test('separates the inspection latest job from semantic curation jobs', async () => {
    const now = new Date().toISOString()
    const database = createRestDatabase({
      beegame_resource_processing_jobs: [
        { id: 'semantic-job', pack_id: 'pack-1', kind: 'semantic-curate-elements', status: 'running', total_items: 1, completed_items: 0, failed_items: 0, created_at: now, updated_at: now },
        { id: 'inspection-job', pack_id: 'pack-1', kind: 'inspect-elements', status: 'completed', total_items: 1, completed_items: 1, failed_items: 0, created_at: now, updated_at: now },
      ],
    })
    const handlers = createSupabaseResourceProcessingHandlers({
      baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl: database.fetch,
      inspectElement: async () => undefined,
    })

    await expect(handlers.latest('pack-1', 'inspect-elements')).resolves.toEqual(expect.objectContaining({ id: 'inspection-job', kind: 'inspect-elements' }))
  })
})

async function waitForTerminal(read: () => Promise<ResourceProcessingJob | undefined>, maxAttempts = 100): Promise<ResourceProcessingJob> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const job = await read()
    if (job && !['queued', 'running'].includes(job.status)) return job
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error('Processing job did not reach a terminal state')
}

function createRestDatabase(seed: Record<string, Row[]>): { fetch: FetchImplementation } {
  const tables = new Map(Object.entries(seed).map(([table, rows]) => [table, rows.map(row => ({ ...row }))]))
  const fetchImpl: FetchImplementation = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
    const table = url.pathname.split('/').filter(Boolean).at(-1) || ''
    const rows = tables.get(table) ?? []
    const method = init?.method ?? 'GET'
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Row | Row[]
      const inserted = (Array.isArray(body) ? body : [body]).map(row => ({ ...row }))
      rows.push(...inserted); tables.set(table, rows)
      return Response.json(inserted)
    }
    const filtered = rows.filter(row => [...url.searchParams.entries()].every(([key, filter]) => {
      if (['select', 'order', 'limit'].includes(key)) return true
      if (filter.startsWith('eq.')) return String(row[key]) === filter.slice(3)
      if (filter.startsWith('in.(') && filter.endsWith(')')) return filter.slice(4, -1).split(',').includes(String(row[key]))
      if (filter === 'is.null') return row[key] == null
      return true
    }))
    const limited = filtered.slice(0, Number(url.searchParams.get('limit') || filtered.length))
    if (method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as Row
      limited.forEach(row => Object.assign(row, body))
    }
    return Response.json(limited)
  }
  return { fetch: fetchImpl }
}
