import { describe, expect, test } from 'bun:test'
import { ResourceExternalTransportError } from '@bee-game-studio/beegame-resource-core'
import {
  createSupabaseResourceProcessingHandlers,
  type ResourceProcessingJob,
  type ResourceProcessingProviderBatchResult,
} from '../resource-processing-jobs'

type Row = Record<string, unknown>
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

describe('persistent resource processing jobs with native provider batches', () => {
  test('submits one provider batch for all ordered semantic items and persists its id before polling', async () => {
    const elements = elementsFor(9)
    const database = createRestDatabase({ beegame_resource_elements: elements })
    const submissions: string[][] = []
    const retrieved: string[] = []
    let pollCount = 0
    const handlers = createHandlers(database.fetch, {
      submitProviderBatch: async (_kind, _packId, _batchId, items) => {
        submissions.push(items.map(item => item.elementId))
        return { providerBatchId: 'provider-batch-1' }
      },
      retrieveProviderBatch: async (_kind, _packId, batchId, providerBatchId, items): Promise<ResourceProcessingProviderBatchResult> => {
        retrieved.push(providerBatchId)
        pollCount += 1
        if (pollCount === 1) return { status: 'processing' }
        return { status: 'ended', receipt: { batchId, items: items.map(item => ({ elementId: item.elementId, receiptId: `receipt-${item.elementId}` })), retryItems: [] } }
      },
    })

    const created = await handlers.start('pack-1', elements.map(element => element.id), semanticStart())
    const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id), 600)

    expect(terminal).toEqual(expect.objectContaining({ status: 'completed', completedItems: 9, failedItems: 0 }))
    expect(submissions).toEqual([elements.map(element => element.id)])
    expect(retrieved).toEqual(['provider-batch-1', 'provider-batch-1'])
  })

  test('recovery polls the persisted provider batch without submitting another one', async () => {
    const now = new Date().toISOString()
    const database = createRestDatabase({
      beegame_resource_elements: elementsFor(2),
      beegame_resource_processing_jobs: [{ id: 'job-1', pack_id: 'pack-1', kind: 'semantic-curate-elements', status: 'running', total_items: 2, completed_items: 0, failed_items: 0, provider_batch_id: 'provider-batch-recovered', provider_batch_status: 'processing', created_at: now, updated_at: now }],
      beegame_resource_processing_items: elementsFor(2).map((element, index) => ({ id: `item-${index + 1}`, job_id: 'job-1', element_id: element.id, status: 'running', attempts: 1, batch_id: 'resource-batch-job-1', source_content_hash: `${index + 1}`.repeat(64), curator_revision: 'semantic-curator-v1', created_at: now, updated_at: now })),
    })
    const submitted: string[] = []
    const polled: string[] = []
    const handlers = createHandlers(database.fetch, {
      submitProviderBatch: async () => { submitted.push('unexpected'); return { providerBatchId: 'unexpected' } },
      retrieveProviderBatch: async (_kind, _packId, batchId, providerBatchId, items) => {
        polled.push(providerBatchId)
        return { status: 'ended', receipt: { batchId, items: items.map(item => ({ elementId: item.elementId, receiptId: `receipt-${item.elementId}` })), retryItems: [] } }
      },
    })

    await handlers.resumePending()
    const terminal = await waitForTerminal(() => handlers.get('pack-1', 'job-1'))

    expect(terminal).toEqual(expect.objectContaining({ status: 'completed', completedItems: 2 }))
    expect(submitted).toEqual([])
    expect(polled).toEqual(['provider-batch-recovered'])
  })

  test('commits successful subrequests and requeues only failed subrequest items', async () => {
    const elements = elementsFor(4)
    const database = createRestDatabase({ beegame_resource_elements: elements })
    let submitCount = 0
    let retrieveCount = 0
    const handlers = createHandlers(database.fetch, {
      submitProviderBatch: async () => ({ providerBatchId: `provider-batch-${++submitCount}` }),
      retrieveProviderBatch: async (_kind, _packId, batchId, _providerBatchId, items) => {
        retrieveCount += 1
        if (retrieveCount === 1) {
          return { status: 'ended', receipt: {
            batchId,
            items: items.slice(0, 2).map(item => ({ elementId: item.elementId, receiptId: `receipt-${item.elementId}` })),
            retryItems: items.slice(2).map(item => ({ elementId: item.elementId, error: 'provider subrequest failed' })),
          } }
        }
        return { status: 'ended', receipt: { batchId, items: items.map(item => ({ elementId: item.elementId, receiptId: `retry-receipt-${item.elementId}` })), retryItems: [] } }
      },
    })

    const created = await handlers.start('pack-1', elements.map(element => element.id), semanticStart())
    const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id), 300)

    expect(terminal).toEqual(expect.objectContaining({ status: 'completed', completedItems: 4, failedItems: 0 }))
    expect(submitCount).toBe(2)
  })

  test('preview failures are requeued before provider submission and retried in a later batch', async () => {
    const elements = elementsFor(2)
    const database = createRestDatabase({ beegame_resource_elements: elements })
    const submitted: string[][] = []
    let attempt = 0
    const handlers = createHandlers(database.fetch, {
      submitProviderBatch: async (_kind, _packId, _batchId, items) => {
        submitted.push(items.map(item => item.elementId))
        attempt += 1
        return attempt === 1
          ? { retryItems: [{ elementId: 'element-1', error: 'preview unavailable' }], providerBatchId: 'provider-batch-ready' }
          : { providerBatchId: 'provider-batch-retry' }
      },
      retrieveProviderBatch: async (_kind, _packId, batchId, _providerBatchId, items) => ({ status: 'ended', receipt: { batchId, items: items.map(item => ({ elementId: item.elementId, receiptId: `receipt-${item.elementId}` })), retryItems: [] } }),
    })

    const created = await handlers.start('pack-1', ['element-1', 'element-2'], semanticStart())
    const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id), 300)

    expect(terminal?.status).toBe('completed')
    expect(submitted).toEqual([['element-1', 'element-2'], ['element-1']])
  })

  test('an ambiguous provider submission never becomes an automatic second submission', async () => {
    const database = createRestDatabase({ beegame_resource_elements: elementsFor(1) })
    let submissions = 0
    const handlers = createHandlers(database.fetch, {
      submitProviderBatch: async () => {
        submissions += 1
        throw new ResourceExternalTransportError('resource-runtime', 'provider batch submit', 'submission outcome is unknown')
      },
      retrieveProviderBatch: async () => ({ status: 'processing' }),
    })

    const created = await handlers.start('pack-1', ['element-1'], semanticStart())
    const terminal = await waitForTerminal(() => handlers.get('pack-1', created.id))

    expect(terminal?.status).toBe('failed')
    expect(terminal?.providerBatchStatus).toBe('unknown')
    expect(submissions).toBe(1)
  })

  test('a durable submitting state never submits again after recovery', async () => {
    const now = new Date().toISOString()
    const database = createRestDatabase({
      beegame_resource_elements: elementsFor(1),
      beegame_resource_processing_jobs: [{ id: 'job-submitting', pack_id: 'pack-1', kind: 'semantic-curate-elements', status: 'running', total_items: 1, completed_items: 0, failed_items: 0, provider_batch_status: 'submitting', created_at: now, updated_at: now }],
      beegame_resource_processing_items: [{ id: 'item-submitting', job_id: 'job-submitting', element_id: 'element-1', status: 'running', attempts: 1, batch_id: 'resource-batch-submitting', source_content_hash: '1'.repeat(64), curator_revision: 'semantic-curator-v1', created_at: now, updated_at: now }],
    })
    let submissions = 0
    const handlers = createHandlers(database.fetch, {
      submitProviderBatch: async () => { submissions += 1; return { providerBatchId: 'unexpected' } },
      retrieveProviderBatch: async () => ({ status: 'processing' }),
    })

    await handlers.resumePending()
    const terminal = await waitForTerminal(() => handlers.get('pack-1', 'job-submitting'))

    expect(terminal?.providerBatchStatus).toBe('unknown')
    expect(terminal?.status).toBe('failed')
    expect(submissions).toBe(0)
  })
})

function semanticStart() {
  return { kind: 'semantic-curate-elements' as const, curatorRevision: 'semantic-curator-v1', ownerId: 'owner-1', modelConfigId: 'model-1' }
}

function createHandlers(fetchImpl: FetchImplementation, callbacks: {
  submitProviderBatch: NonNullable<Parameters<typeof createSupabaseResourceProcessingHandlers>[0]['submitProviderBatch']>
  retrieveProviderBatch: NonNullable<Parameters<typeof createSupabaseResourceProcessingHandlers>[0]['retrieveProviderBatch']>
  assertProviderBatchReady?: NonNullable<Parameters<typeof createSupabaseResourceProcessingHandlers>[0]['assertProviderBatchReady']>
}) {
  return createSupabaseResourceProcessingHandlers({
    baseUrl: 'https://supabase.example', serviceRoleKey: 'key', fetchImpl,
    inspectElement: async () => undefined,
    ...callbacks,
  })
}

function elementsFor(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `element-${index + 1}`, pack_id: 'pack-1', specs: { contentHash: `${index + 1}`.repeat(64) }, usage_tags: [] }))
}

async function waitForTerminal(read: () => Promise<ResourceProcessingJob | undefined>, maxAttempts = 100): Promise<ResourceProcessingJob> {
  return waitFor(read, job => Boolean(job && !['queued', 'running'].includes(job.status)), maxAttempts) as Promise<ResourceProcessingJob>
}

async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean, maxAttempts = 100): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Processing job did not reach the expected state')
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
