import { afterEach, describe, expect, test } from 'bun:test'
import { SupabaseDashboardStore } from '../supabase-dashboard-store'

describe('SupabaseDashboardStore', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('loads and upserts owner scoped dashboard data through Supabase REST', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    const creditAccount = {
      user_id: '00000000-0000-0000-0000-000000000001',
      plan: 'free',
      included_credits: 300,
      consumed_credits: 0,
      reserved_credits: 0,
      updated_at: '2026-06-27T00:00:00.000Z',
    }
    const creditLedger: Array<Record<string, unknown>> = []
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

      if (requestUrl.includes('/beegame_credit_accounts')) {
        if (init?.method === 'POST') {
          Object.assign(creditAccount, JSON.parse(String(init.body)))
          return Response.json([creditAccount])
        }
        return Response.json([creditAccount])
      }

      if (requestUrl.includes('/beegame_credit_ledger')) {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>
          const row = {
            created_at: '2026-06-27T00:00:00.000Z',
            ...body,
          }
          creditLedger.push(row)
          return Response.json([row])
        }
        if (requestUrl.includes('reservation_id=eq.')) {
          const reservationId = decodeURIComponent(
            requestUrl.split('reservation_id=eq.')[1]?.split('&')[0] ?? '',
          )
          return Response.json(
            creditLedger.filter(row => row.reservation_id === reservationId),
          )
        }
        return Response.json(creditLedger)
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
    const reservation = await store.reserveCredits(ownerId, {
      credits: 5,
      kind: 'edit_turn',
      projectId: 'session_1',
      metadata: { taskType: 'edit_turn' },
    })
    expect(reservation.reservedCredits).toBe(5)
    expect(await store.settleCreditReservation(ownerId, {
      reservationId: reservation.id,
      weightedTokens: 12_500,
      projectId: 'session_1',
    })).toEqual(expect.objectContaining({
      reservedCredits: 5,
      settledCredits: 2,
      refundedCredits: 3,
    }))
    expect(await store.listCreditLedger(ownerId)).toEqual([
      expect.objectContaining({ kind: 'reserve', credits: 5 }),
      expect.objectContaining({ kind: 'settle', credits: 2, weightedTokens: 12_500 }),
      expect.objectContaining({ kind: 'refund', credits: 3 }),
    ])
    expect(await store.summarizeCreditLedger(ownerId, 'session_1')).toEqual({
      entriesCount: 3,
      reservedCredits: 5,
      settledCredits: 2,
      refundedCredits: 3,
      outstandingReservedCredits: 0,
      weightedTokens: 12_500,
    })

    expect(calls.some(call => call.url.includes('/rest/v1/beegame_model_configs'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_runtime_settings'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_web_tools'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_mcp_servers'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_projects'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_credit_accounts'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_credit_ledger'))).toBe(true)
  })
})
