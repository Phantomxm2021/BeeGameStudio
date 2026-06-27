import { afterEach, describe, expect, test } from 'bun:test'
import { SupabaseDashboardStore } from '../supabase-dashboard-store'

describe('SupabaseDashboardStore', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('loads and upserts owner scoped dashboard data through Supabase REST', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    globalThis.fetch = (async (url, init) => {
      const requestUrl = String(url)
      calls.push({
        url: requestUrl,
        method: init?.method ?? 'GET',
        ...(init?.body
          ? { body: JSON.parse(String(init.body)) as unknown }
          : {}),
      })

      if (requestUrl.includes('/beegame_model_configs?select=*')) {
        return Response.json([
          {
            id: 'llm_1',
            owner_id: '00000000-0000-0000-0000-000000000001',
            name: 'Default LLM',
            provider: 'openai-compatible',
            base_url: 'https://llm.example/v1',
            api_key_ciphertext: 'sk-secret',
            models: { balanced: 'balanced-model' },
            is_default: true,
            created_at: '2026-06-27T00:00:00.000Z',
            updated_at: '2026-06-27T00:00:00.000Z',
          },
        ])
      }

      if (requestUrl.includes('/beegame_runtime_settings')) {
        if (init?.method === 'POST') {
          return Response.json([JSON.parse(String(init.body))])
        }
        return Response.json([
          { settings: { skillSearchEnabled: true, ignored: true } },
        ])
      }

      if (requestUrl.includes('/beegame_web_tools')) {
        if (init?.method === 'POST') {
          return Response.json([JSON.parse(String(init.body))])
        }
        return Response.json([
          { config: { webSearchAdapter: 'brave', braveApiKey: 'brave-key' } },
        ])
      }

      if (requestUrl.includes('/beegame_mcp_servers')) {
        if (init?.method === 'POST') {
          return Response.json([JSON.parse(String(init.body))])
        }
        return Response.json([])
      }

      if (requestUrl.includes('/beegame_workspaces')) {
        if (init?.method === 'POST') {
          return Response.json([
            {
              id: '11111111-1111-1111-1111-111111111111',
              owner_id: '00000000-0000-0000-0000-000000000001',
              name: 'Default Workspace',
            },
          ])
        }
        return Response.json([])
      }

      if (requestUrl.includes('/beegame_workspace_members')) {
        return Response.json([JSON.parse(String(init?.body ?? '{}'))])
      }

      if (requestUrl.includes('/beegame_projects')) {
        if (init?.method === 'POST') {
          return Response.json([JSON.parse(String(init.body))])
        }
        return Response.json([])
      }

      return new Response('Not found', { status: 404 })
    }) as typeof fetch

    const store = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      serviceRoleKey: 'service-role-key',
    })
    const ownerId = '00000000-0000-0000-0000-000000000001'

    expect(await store.loadModelConfigSnapshot()).toEqual([
      expect.objectContaining({
        id: 'llm_1',
        ownerId,
        apiKey: 'sk-secret',
      }),
    ])
    expect(await store.loadRuntimeSettings(ownerId)).toEqual({
      skillSearchEnabled: true,
    })
    expect(await store.saveWebTools(ownerId, {
      webSearchAdapter: 'brave',
      braveApiKey: undefined,
    })).toEqual({
      webSearchAdapter: 'brave',
      braveApiKey: 'brave-key',
    })
    expect(await store.upsertMcpServer(ownerId, {
      name: 'Local MCP',
      enabled: true,
      transport: 'stdio',
      scope: 'beegame',
      command: 'npx',
      args: ['local-mcp'],
      env: [{ key: 'TOKEN', value: 'secret-token' }],
      autoStart: true,
    })).toEqual(expect.objectContaining({
      name: 'Local MCP',
      env: [{ key: 'TOKEN', valuePreview: 'secr…oken' }],
    }))
    expect(await store.upsertProject(ownerId, {
      id: 'project_1',
      name: 'Project One',
      root_path: '/tmp/project-one',
      created_at: 1780000000000,
    })).toEqual(expect.objectContaining({
      id: 'project_1',
      name: 'Project One',
    }))

    expect(calls.some(call => call.url.includes('/rest/v1/beegame_model_configs'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_runtime_settings'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_web_tools'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_mcp_servers'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_projects'))).toBe(true)
  })
})
