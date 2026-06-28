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
    const auditEvents: Array<Record<string, unknown>> = []
    const assetRows: Array<Record<string, unknown>> = []
    const previewRows: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (url, init) => {
      const requestUrl = String(url)
      calls.push({
        url: requestUrl,
        method: init?.method ?? 'GET',
        ...(init?.body
          ? { body: JSON.parse(String(init.body)) as unknown }
          : {}),
      })

      if (requestUrl.includes('/beegame_model_configs')) {
        if (init?.method === 'POST') {
          return Response.json([JSON.parse(String(init.body))])
        }
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
        if (requestUrl.includes('project_id=eq.')) {
          const projectId = decodeURIComponent(
            requestUrl.split('project_id=eq.')[1]?.split('&')[0] ?? '',
          )
          return Response.json(
            creditLedger.filter(row => row.project_id === projectId),
          )
        }
        return Response.json(creditLedger)
      }

      if (requestUrl.includes('/beegame_audit_events')) {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>
          const row = {
            id: '22222222-2222-2222-2222-222222222222',
            created_at: '2026-06-27T00:00:00.000Z',
            ...body,
          }
          auditEvents.push(row)
          return Response.json([row])
        }
        return Response.json(auditEvents)
      }

      if (requestUrl.includes('/beegame_assets')) {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>
          const existingIndex = assetRows.findIndex(row => row.id === body.id)
          const row = {
            created_at: '2026-06-27T00:00:00.000Z',
            updated_at: '2026-06-27T00:00:00.000Z',
            ...body,
          }
          if (existingIndex >= 0) {
            assetRows[existingIndex] = row
          } else {
            assetRows.push(row)
          }
          return Response.json([row])
        }
        const projectId = decodeURIComponent(
          requestUrl.split('project_id=eq.')[1]?.split('&')[0] ?? '',
        )
        return Response.json(assetRows.filter(row => row.project_id === projectId))
      }

      if (requestUrl.includes('/beegame_previews')) {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>
          const existingIndex = previewRows.findIndex(row => row.id === body.id)
          const row = {
            created_at: '2026-06-27T00:00:00.000Z',
            updated_at: '2026-06-27T00:00:00.000Z',
            ...body,
          }
          if (existingIndex >= 0) {
            previewRows[existingIndex] = row
          } else {
            previewRows.push(row)
          }
          return Response.json([row])
        }
        const projectId = decodeURIComponent(
          requestUrl.split('project_id=eq.')[1]?.split('&')[0] ?? '',
        )
        return Response.json(previewRows.filter(row => row.project_id === projectId))
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
        if (init?.method === 'DELETE') {
          return Response.json([{ id: 'project_1' }])
        }
        if (init?.method === 'POST') {
          return Response.json([JSON.parse(String(init.body))])
        }
        return Response.json([])
      }

      if (requestUrl.includes('/beegame_sessions')) {
        if (init?.method === 'DELETE') {
          return Response.json([{ id: 'session_1' }])
        }
        if (init?.method === 'POST') {
          return Response.json([JSON.parse(String(init.body))])
        }
        return Response.json([
          {
            id: 'session_1',
            project_id: 'project_1',
            owner_id: ownerId,
            workspace_path: '/tmp/project-one',
            status: 'running',
            transcript_path: '/tmp/project-one/transcripts/project-one__abcd1234.jsonl',
            model_config_id: 'llm_1',
            created_at: '2026-06-27T00:00:00.000Z',
            updated_at: '2026-06-27T00:00:00.000Z',
          },
        ])
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
    await store.upsertModelConfig({
      id: 'llm_2',
      ownerId,
      name: 'Encrypted LLM',
      provider: 'openai-compatible',
      baseUrl: 'https://secure-llm.example/v1',
      apiKey: 'sk-new-secret',
      models: { balanced: 'secure-model' },
      isDefault: false,
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:00.000Z',
    })
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
    expect(await store.upsertSession(ownerId, {
      id: 'session_2',
      projectId: 'project_1',
      workspacePath: '/tmp/project-one',
      status: 'running',
      transcriptPath: '/tmp/project-one/transcripts/project-one__efgh5678.jsonl',
      modelConfigId: 'llm_1',
      createdAt: new Date('2026-06-27T00:00:00.000Z'),
      updatedAt: new Date('2026-06-27T00:00:00.000Z'),
    })).toEqual(expect.objectContaining({
      id: 'session_2',
      projectId: 'project_1',
      transcriptPath: '/tmp/project-one/transcripts/project-one__efgh5678.jsonl',
    }))
    expect(await store.listSessions(ownerId)).toEqual([
      expect.objectContaining({
        id: 'session_1',
        projectId: 'project_1',
        transcriptPath: '/tmp/project-one/transcripts/project-one__abcd1234.jsonl',
      }),
    ])
    expect(await store.deleteProject(ownerId, 'project_1')).toBe(true)
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
    expect(await store.appendAuditEvent(ownerId, {
      actorId: ownerId,
      action: 'web_tools.updated',
      targetType: 'web_tools',
      targetId: ownerId,
      metadata: { webSearchAdapter: 'brave' },
    })).toEqual(expect.objectContaining({
      id: '22222222-2222-2222-2222-222222222222',
      actorId: ownerId,
      action: 'web_tools.updated',
      targetType: 'web_tools',
      targetId: ownerId,
      metadata: { webSearchAdapter: 'brave' },
    }))
    expect(await store.listAuditEvents(ownerId)).toEqual([
      expect.objectContaining({
        actorId: ownerId,
        action: 'web_tools.updated',
        targetType: 'web_tools',
        targetId: ownerId,
      }),
    ])
    await expect(store.upsertAssetManifest(ownerId, 'project_1', {
      version: 1,
      project_target: { integration_mode: 'filesystem' },
      slots: [{
        id: 'main_logo',
        name: 'Main logo',
        type: 'image_2d',
        status: 'uploaded',
        uploaded_files: ['public/assets/logo.png'],
      }],
    })).resolves.toEqual(expect.objectContaining({
      version: 1,
      slots: [
        expect.objectContaining({
          id: 'main_logo',
          uploaded_files: ['public/assets/logo.png'],
        }),
      ],
    }))
    expect(await store.loadAssetManifest(ownerId, 'project_1')).toEqual(
      expect.objectContaining({
        slots: [expect.objectContaining({ id: 'main_logo' })],
      }),
    )
    await expect(store.upsertPreviewSnapshot(ownerId, 'project_1', {
      sessionId: 'session_1',
      workspacePath: '/tmp/project-one',
      status: 'running',
      url: 'http://127.0.0.1:63100/',
      port: 63100,
      command: 'npm run dev -- --port 63100',
      script: 'dev',
      entrypoint: 'package.json',
      message: 'Preview running',
      updatedAt: '2026-06-27T00:00:00.000Z',
    })).resolves.toEqual(expect.objectContaining({
      sessionId: 'session_1',
      status: 'running',
      url: 'http://127.0.0.1:63100/',
      port: 63100,
    }))
    expect(await store.loadPreviewSnapshot(ownerId, 'project_1', 'session_1')).toEqual(
      expect.objectContaining({
        sessionId: 'session_1',
        workspacePath: '/tmp/project-one',
        status: 'running',
        command: 'npm run dev -- --port 63100',
      }),
    )

    expect(calls.some(call => call.url.includes('/rest/v1/beegame_model_configs'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_runtime_settings'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_web_tools'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_mcp_servers'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_projects'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_sessions'))).toBe(true)
    expect(calls.some(call =>
      call.method === 'DELETE' &&
      call.url.includes('/rest/v1/beegame_sessions') &&
      call.url.includes(`project_id=eq.${encodeURIComponent('project_1')}`),
    )).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_credit_accounts'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_credit_ledger'))).toBe(true)
    expect(calls.some(call =>
      call.url.includes('/rest/v1/beegame_credit_ledger') &&
      call.url.includes('order=created_at.asc') &&
      call.url.includes('limit=100'),
    )).toBe(true)
    expect(calls.some(call =>
      call.url.includes('/rest/v1/beegame_credit_ledger') &&
      call.url.includes(`project_id=eq.${encodeURIComponent('session_1')}`) &&
      call.url.includes('select=kind%2Ccredits%2Cweighted_tokens'),
    )).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_audit_events'))).toBe(true)
    expect(calls.some(call =>
      call.url.includes('/rest/v1/beegame_audit_events') &&
      call.url.includes('order=created_at.desc') &&
      call.url.includes('limit=100'),
    )).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_assets'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/beegame_previews'))).toBe(true)
    const postedBodies = calls
      .filter(call => call.method === 'POST')
      .map(call => JSON.stringify(call.body))
      .join('\n')
    expect(postedBodies).not.toContain('sk-new-secret')
    expect(postedBodies).not.toContain('brave-key')
    expect(postedBodies).not.toContain('secret-token')
  })

  test('manages default workspace members through Supabase REST', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    const workspace = {
      id: '11111111-1111-1111-1111-111111111111',
      owner_id: '00000000-0000-0000-0000-000000000001',
      name: 'Default Workspace',
    }
    const members: Array<Record<string, unknown>> = [{
      workspace_id: workspace.id,
      user_id: '00000000-0000-0000-0000-000000000001',
      role: 'owner',
      created_at: '2026-06-27T00:00:00.000Z',
    }]
    globalThis.fetch = (async (url, init) => {
      const requestUrl = String(url)
      calls.push({
        url: requestUrl,
        method: init?.method ?? 'GET',
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      })
      if (requestUrl.includes('/beegame_workspaces')) {
        return Response.json([workspace])
      }
      if (requestUrl.includes('/beegame_workspace_members')) {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>
          const index = members.findIndex(row =>
            row.workspace_id === body.workspace_id &&
            row.user_id === body.user_id
          )
          const row = {
            created_at: '2026-06-27T00:00:00.000Z',
            ...body,
          }
          if (index >= 0) {
            members[index] = row
          } else {
            members.push(row)
          }
          return Response.json([row])
        }
        if (init?.method === 'DELETE') {
          const userId = decodeURIComponent(
            requestUrl.split('user_id=eq.')[1]?.split('&')[0] ?? '',
          )
          const deleted = members.filter(row => row.user_id === userId)
          for (const row of deleted) members.splice(members.indexOf(row), 1)
          return Response.json(deleted)
        }
        return Response.json(members)
      }
      return new Response('Not found', { status: 404 })
    }) as typeof fetch
    const store = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      serviceRoleKey: 'service-role-key',
    })

    await expect(
      store.listWorkspaceMembers('00000000-0000-0000-0000-000000000001'),
    ).resolves.toEqual([
      {
        workspaceId: workspace.id,
        userId: '00000000-0000-0000-0000-000000000001',
        role: 'owner',
        createdAt: '2026-06-27T00:00:00.000Z',
      },
    ])
    await expect(store.upsertWorkspaceMember(
      '00000000-0000-0000-0000-000000000001',
      {
        userId: '00000000-0000-0000-0000-000000000002',
        role: 'developer',
      },
    )).resolves.toEqual({
      workspaceId: workspace.id,
      userId: '00000000-0000-0000-0000-000000000002',
      role: 'developer',
      createdAt: '2026-06-27T00:00:00.000Z',
    })
    await expect(store.deleteWorkspaceMember(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
    )).resolves.toBe(true)
    await expect(store.deleteWorkspaceMember(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
    )).rejects.toThrow('Cannot remove the workspace owner')

    expect(calls.some(call =>
      call.url.includes('/rest/v1/beegame_workspace_members') &&
      call.method === 'POST' &&
      (call.body as Record<string, unknown>).role === 'developer',
    )).toBe(true)
  })

  test('uses a dedicated secrets key while preserving service-role encrypted secrets', async () => {
    let row = {
      id: 'llm_1',
      owner_id: '00000000-0000-0000-0000-000000000001',
      name: 'Default LLM',
      provider: 'openai-compatible',
      base_url: 'https://llm.example/v1',
      api_key_ciphertext: 'sk-legacy-secret',
      models: { balanced: 'balanced-model' },
      is_default: true,
      created_at: '2026-06-27T00:00:00.000Z',
      updated_at: '2026-06-27T00:00:00.000Z',
    }
    globalThis.fetch = (async (url, init) => {
      const requestUrl = String(url)
      if (requestUrl.includes('/beegame_model_configs')) {
        if (init?.method === 'POST') {
          row = JSON.parse(String(init.body)) as typeof row
          return Response.json([row])
        }
        return Response.json([row])
      }
      return new Response('Not found', { status: 404 })
    }) as typeof fetch

    const legacyStore = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      serviceRoleKey: 'service-role-key-v1',
    })
    await legacyStore.upsertModelConfig({
      id: 'llm_1',
      ownerId: row.owner_id,
      name: row.name,
      provider: 'openai-compatible',
      baseUrl: row.base_url,
      apiKey: 'sk-legacy-secret',
      models: row.models,
      isDefault: true,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
    const legacyCiphertext = row.api_key_ciphertext
    expect(legacyCiphertext).not.toContain('sk-legacy-secret')

    const storeWithDedicatedKey = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      serviceRoleKey: 'service-role-key-v1',
      secretKey: 'stable-beegame-secret-key',
    })
    expect(await storeWithDedicatedKey.loadModelConfigSnapshot()).toEqual([
      expect.objectContaining({ apiKey: 'sk-legacy-secret' }),
    ])

    await storeWithDedicatedKey.upsertModelConfig({
      id: 'llm_1',
      ownerId: row.owner_id,
      name: row.name,
      provider: 'openai-compatible',
      baseUrl: row.base_url,
      apiKey: 'sk-new-secret',
      models: row.models,
      isDefault: true,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
    const dedicatedCiphertext = row.api_key_ciphertext
    expect(dedicatedCiphertext).not.toBe(legacyCiphertext)
    expect(dedicatedCiphertext).not.toContain('sk-new-secret')

    const rotatedServiceRoleStore = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      serviceRoleKey: 'service-role-key-v2',
      secretKey: 'stable-beegame-secret-key',
    })
    expect(await rotatedServiceRoleStore.loadModelConfigSnapshot()).toEqual([
      expect.objectContaining({ apiKey: 'sk-new-secret' }),
    ])
  })
})
