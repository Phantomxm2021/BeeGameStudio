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

  test('uses the effective model config owner as the Supabase model config scope', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-repository-'))
    const calls: Array<{ url: string; body?: unknown }> = []
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => dataRoot,
      supabaseStore: new SupabaseDashboardStore({
        url: 'https://project.supabase.co',
        anonKey: 'anon-key',
        fetchImpl: (async (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          const url = String(input)
          calls.push({
            url,
            ...(init?.body
              ? { body: JSON.parse(String(init.body)) as unknown }
              : {}),
          })
          if (url.includes('/beegame_model_configs')) {
            return Response.json([
              {
                id: 'llm_platform_default',
                owner_id: 'platform-owner',
                name: 'Platform Default',
                provider: 'openai-compatible',
                base_url: 'https://llm.example/v1',
                api_key_ciphertext: 'sk-secret',
                models: { balanced: 'balanced-model' },
                is_default: true,
                created_at: '2026-06-30T00:00:00.000Z',
                updated_at: '2026-06-30T00:00:00.000Z',
              },
            ])
          }
          if (url.includes('/rpc/beegame_set_default_model_config')) {
            return Response.json({
              id: 'llm_platform_default',
              owner_id: 'platform-owner',
              name: 'Platform Default',
              provider: 'openai-compatible',
              base_url: 'https://llm.example/v1',
              api_key_ciphertext: 'sk-secret',
              models: { balanced: 'balanced-model' },
              is_default: true,
              created_at: '2026-06-30T00:00:00.000Z',
              updated_at: '2026-06-30T00:00:00.000Z',
            })
          }
          return new Response('not found', { status: 404 })
        }) as unknown as typeof fetch,
      }),
    })
    const user = {
      id: 'developer-user',
      role: 'developer' as const,
      workspaceOwnerId: 'platform-owner',
      modelConfigOwnerId: 'platform-owner',
    }
    const request = new Request('http://beegame.test/api/model-configs', {
      headers: { authorization: 'Bearer user-token' },
    })

    try {
      await repository.listModelConfigs(request, user)
      await repository.modelConfigExists(
        request,
        user,
        'llm_platform_default',
      )

      expect(calls[0]?.url).toContain('owner_id=eq.platform-owner')
      expect(calls[1]?.url).toContain('owner_id=eq.platform-owner')
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('does not fall back to a regular user model config scope in Supabase mode', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-repository-'))
    const calls: string[] = []
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => dataRoot,
      supabaseStore: new SupabaseDashboardStore({
        url: 'https://project.supabase.co',
        anonKey: 'anon-key',
        fetchImpl: (async (input: Parameters<typeof fetch>[0]) => {
          calls.push(String(input))
          return Response.json([])
        }) as unknown as typeof fetch,
      }),
    })
    const user = {
      id: 'developer-user',
      role: 'developer' as const,
      workspaceOwnerId: 'developer-user',
    }
    const request = new Request('http://beegame.test/api/model-configs', {
      headers: { authorization: 'Bearer user-token' },
    })

    try {
      expect(await repository.listModelConfigs(request, user)).toEqual([])
      expect(await repository.modelConfigExists(
        request,
        user,
        'llm_default',
      )).toBe(false)
      expect(calls).toEqual([])
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })
})
