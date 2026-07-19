import { describe, expect, test } from 'bun:test'
import { createSupabaseResourceProcessingHandlers, type ResourceProcessingJob } from '../resource-processing-jobs'

type Row = Record<string, unknown>
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

describe('persistent resource processing jobs', () => {
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
})

async function waitForTerminal(read: () => Promise<ResourceProcessingJob | undefined>): Promise<ResourceProcessingJob> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
