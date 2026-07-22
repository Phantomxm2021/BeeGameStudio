import { describe, expect, test } from 'bun:test'
import { fetchAllSupabaseRows } from '../supabase-rest-pagination'

describe('Supabase REST pagination', () => {
  test('reads every page with stable non-overlapping ranges', async () => {
    const ranges: string[] = []
    const rows = await fetchAllSupabaseRows<{ id: number }>({
      baseUrl: 'https://database.test/',
      path: 'objects?select=id&order=id.asc',
      headers: { apikey: 'key' },
      pageSize: 2,
      fetchImpl: (async (_input, init) => {
        const range = new Headers(init?.headers).get('range') || ''
        ranges.push(range)
        if (range === '0-1') return Response.json([{ id: 1 }, { id: 2 }])
        if (range === '2-3') return Response.json([{ id: 3 }])
        return Response.json([])
      }) as typeof fetch,
    })

    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(ranges).toEqual(['0-1', '2-3'])
  })

  test('fails instead of silently accepting a truncated or invalid response', async () => {
    await expect(
      fetchAllSupabaseRows({
        baseUrl: 'https://database.test',
        path: 'objects?select=id',
        headers: {},
        fetchImpl: (async () =>
          new Response('unavailable', { status: 503 })) as typeof fetch,
      }),
    ).rejects.toThrow('Supabase paginated request failed (503)')
  })
})
