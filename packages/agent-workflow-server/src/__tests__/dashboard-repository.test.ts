import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DashboardRepository } from '../dashboard-repository'
import { SupabaseDashboardStore } from '../supabase-dashboard-store'

describe('DashboardRepository Supabase boundaries', () => {
  test('requires a user bearer token instead of falling back to anonymous Supabase or local storage', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-repository-'))
    let fetchCalls = 0
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => dataRoot,
      supabaseStore: new SupabaseDashboardStore({
        url: 'https://project.supabase.co',
        anonKey: 'anon-key',
        fetchImpl: (async () => {
          fetchCalls += 1
          return Response.json([])
        }) as unknown as typeof fetch,
      }),
    })

    try {
      await expect(repository.getCreditBalance(
        new Request('http://beegame.test/api/credits'),
        { id: '00000000-0000-0000-0000-000000000001', role: 'owner' },
      )).rejects.toThrow('Supabase user token is required')
      expect(fetchCalls).toBe(0)
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })
})
