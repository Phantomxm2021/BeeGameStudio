import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import {
  createSupabaseDashboardStoreFromEnv,
  SupabaseDashboardStore,
} from '../supabase-dashboard-store'
import { encryptSecret } from '../security/secret-crypto'

describe('SupabaseDashboardStore', () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY

  beforeAll(() => {
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 41).toString('base64')
  })

  afterAll(() => {
    if (originalKey === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = originalKey
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('retries transient transport failures for idempotent reads', async () => {
    let calls = 0
    const store = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
      authToken: 'user-token',
      fetchImpl: (async () => {
        calls += 1
        if (calls === 1) throw new Error('transient transport failure')
        return Response.json([])
      }) as unknown as typeof fetch,
    })

    await expect(store.listProjects('owner-user')).resolves.toEqual([])
    expect(calls).toBe(2)
  })

  test('does not replay mutations after a transport failure', async () => {
    let calls = 0
    const store = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
      authToken: 'user-token',
      fetchImpl: (async () => {
        calls += 1
        throw new Error('mutation transport failure')
      }) as unknown as typeof fetch,
    })

    await expect(store.deleteAuthUser('owner-user')).rejects.toThrow('mutation transport failure')
    expect(calls).toBe(1)
  })

  test('persists deployment records through Supabase REST', async () => {
    const ownerId = '00000000-0000-0000-0000-000000000001'
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    const deploymentRows: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (url, init) => {
      const requestUrl = String(url)
      const method = init?.method ?? 'GET'
      const body = init?.body
        ? JSON.parse(String(init.body)) as Record<string, unknown>
        : undefined
      calls.push({
        url: requestUrl,
        method,
        ...(body ? { body } : {}),
      })

      if (requestUrl.includes('/beegame_deployments')) {
        if (method === 'POST') {
          deploymentRows.unshift(body ?? {})
          return Response.json([body])
        }
        return Response.json(deploymentRows)
      }

      return Response.json([])
    }) as typeof fetch

    const store = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
      authToken: 'user-token',
    })
    const record = await store.upsertDeploymentRecord(ownerId, {
      id: 'deploy_1',
      sessionId: 'beegame_1',
      projectId: 'project_1',
      workspacePath: '/workspace/project_1',
      status: 'succeeded',
      url: 'https://games.example.com/deploy_1/index.html',
      buildCommand: 'npm run build',
      buildLog: 'built',
      entrypoint: 'package.json',
      outputDir: '/workspace/project_1/dist',
      artifactPath: 'supabase://beegame-deployments/deployments/user/deploy_1',
      artifactHash: 'hash_1',
      message: 'Published',
      createdAt: '2026-07-04T00:00:00.000Z',
      updatedAt: '2026-07-04T00:01:00.000Z',
      deployedAt: '2026-07-04T00:01:00.000Z',
    })
    const listed = await store.listDeploymentRecords(ownerId, 'beegame_1')

    expect(record).toEqual(expect.objectContaining({
      id: 'deploy_1',
      sessionId: 'beegame_1',
      projectId: 'project_1',
      status: 'succeeded',
      url: 'https://games.example.com/deploy_1/index.html',
    }))
    expect(listed).toEqual([record])
    expect(calls.some(call =>
      call.method === 'POST' &&
      call.url.includes('/rest/v1/beegame_deployments') &&
      call.url.includes('on_conflict=id'),
    )).toBe(true)
    expect(calls.some(call =>
      call.method === 'GET' &&
      call.url.includes('/rest/v1/beegame_deployments') &&
      call.url.includes(`owner_id=eq.${encodeURIComponent(ownerId)}`) &&
      call.url.includes('session_id=eq.beegame_1'),
    )).toBe(true)
  })

  test('deletes project Supabase Storage artifacts and related metadata', async () => {
    const ownerId = '00000000-0000-0000-0000-000000000001'
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    globalThis.fetch = (async (url, init) => {
      const requestUrl = String(url)
      const method = init?.method ?? 'GET'
      const body = init?.body
        ? JSON.parse(String(init.body)) as Record<string, unknown>
        : undefined
      calls.push({
        url: requestUrl,
        method,
        ...(body ? { body } : {}),
      })

      if (
        requestUrl.includes('/rest/v1/beegame_deployments') &&
        method === 'GET'
      ) {
        return Response.json([
          {
            id: 'deploy_1',
            session_id: 'session_1',
            project_id: 'project_1',
            owner_id: ownerId,
            workspace_path: '/workspace/project_1',
            status: 'succeeded',
            url: 'https://games.example.com/deploy_1/index.html',
            build_command: null,
            build_log: null,
            entrypoint: null,
            output_dir: null,
            artifact_path: 'supabase://beegame-deployments/deployments/user/deploy_1',
            artifact_hash: null,
            message: null,
            created_at: '2026-07-04T00:00:00.000Z',
            updated_at: '2026-07-04T00:01:00.000Z',
            deployed_at: '2026-07-04T00:01:00.000Z',
          },
        ])
      }
      if (
        requestUrl.includes('/storage/v1/object/beegame-assets') ||
        requestUrl.includes('/storage/v1/object/beegame-deployments')
      ) {
        return Response.json([])
      }
      if (method === 'DELETE') return Response.json([{ id: 'deleted' }])
      return Response.json([])
    }) as typeof fetch

    const store = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
      authToken: 'user-token',
      assetBucket: 'beegame-assets',
    })

    expect(await store.deleteProject(ownerId, 'project_1')).toBe(true)

    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'DELETE',
        url: 'https://project.supabase.co/storage/v1/object/beegame-assets',
        body: {
          prefixes: [
            'projects/00000000-0000-0000-0000-000000000001/project_1',
          ],
        },
      }),
      expect.objectContaining({
        method: 'DELETE',
        url: 'https://project.supabase.co/storage/v1/object/beegame-deployments',
        body: {
          prefixes: ['deployments/user/deploy_1'],
        },
      }),
    ]))
    for (const table of [
      'beegame_assets',
      'beegame_previews',
      'beegame_deployments',
      'beegame_sessions',
      'beegame_projects',
    ]) {
      expect(calls.some(call =>
        call.method === 'DELETE' &&
        call.url.includes(`/rest/v1/${table}`) &&
        call.url.includes('project_id=eq.project_1'),
      ) || (
        table === 'beegame_projects' &&
        calls.some(call =>
          call.method === 'DELETE' &&
          call.url.includes('/rest/v1/beegame_projects') &&
          call.url.includes('id=eq.project_1'),
        )
      )).toBe(true)
    }
  })

  test('persists deleted-project audit tombstones without a dangling project foreign key', async () => {
    const ownerId = '00000000-0000-0000-0000-000000000001'
    let insertedBody: Record<string, unknown> | undefined
    globalThis.fetch = (async (url, init) => {
      if (String(url).includes('/rest/v1/beegame_audit_events') && init?.method === 'POST') {
        insertedBody = JSON.parse(String(init.body)) as Record<string, unknown>
        return Response.json([{
          id: '11111111-1111-1111-1111-111111111111',
          created_at: '2026-07-13T00:00:00.000Z',
          ...insertedBody,
        }])
      }
      return Response.json([])
    }) as typeof fetch
    const store = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
      authToken: 'user-token',
    })

    const event = await store.appendAuditEvent(ownerId, {
      actorId: ownerId,
      action: 'project.deleted',
      targetType: 'project',
      targetId: 'deleted-project',
      projectReference: 'detached',
      metadata: { cleanupOutcome: 'workspace_deleted' },
    })

    expect(insertedBody).toEqual(expect.objectContaining({
      actor_id: ownerId,
      project_id: null,
      action: 'project.deleted',
      metadata: expect.objectContaining({
        targetType: 'project',
        targetId: 'deleted-project',
        cleanupOutcome: 'workspace_deleted',
      }),
    }))
    expect(event).toEqual(expect.objectContaining({
      targetType: 'project',
      targetId: 'deleted-project',
    }))
  })

  test('accepts frontend Supabase env names for dashboard data access', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (url, init) => {
      calls.push(String(url))
      expect(new Headers(init?.headers).get('apikey')).toBe('vite-anon-key')
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer user-token',
      )
      return Response.json([])
    }) as typeof fetch

    const store = createSupabaseDashboardStoreFromEnv({
      VITE_SUPABASE_URL: 'https://vite-project.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'vite-anon-key',
    })
    expect(store).toBeDefined()

    await store?.withAuthToken('user-token').listPublicModelConfigs('owner-user')

    expect(calls).toEqual([
      'https://vite-project.supabase.co/rest/v1/beegame_model_configs?owner_id=eq.owner-user&select=*&order=created_at.asc',
    ])
  })

  test('loads an RLS-visible model config as a decrypted runtime environment', async () => {
    const encrypted = encryptSecret('sk-runtime-secret', 'model-config:api-key')
    const calls: string[] = []
    const store = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
      authToken: 'user-token',
      fetchImpl: (async (input: Parameters<typeof fetch>[0]) => {
        calls.push(String(input))
        return Response.json([{
          id: 'llm_platform_default',
          owner_id: 'platform-owner',
          name: 'Platform Default',
          provider: 'openai-compatible',
          base_url: 'https://llm.example/v1',
          api_key_ciphertext: encrypted,
          models: { fast: 'fast-model', balanced: 'balanced-model' },
          is_default: true,
          created_at: '2026-07-17T00:00:00.000Z',
          updated_at: '2026-07-17T00:00:00.000Z',
        }])
      }) as unknown as typeof fetch,
    })

    await expect(
      store.loadRlsVisibleModelRuntimeEnv('llm_platform_default'),
    ).resolves.toEqual({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://llm.example/v1',
      OPENAI_API_KEY: 'sk-runtime-secret',
      OPENAI_DEFAULT_HAIKU_MODEL: 'fast-model',
      OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
    })
    expect(calls).toEqual([
      'https://project.supabase.co/rest/v1/beegame_model_configs?id=eq.llm_platform_default&select=*&limit=1',
    ])
  })

  test('creates missing Supabase credit accounts with zero included credits', async () => {
    const ownerId = '00000000-0000-0000-0000-000000000001'
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    globalThis.fetch = (async (url, init) => {
      const requestUrl = String(url)
      const method = init?.method ?? 'GET'
      const body = init?.body
        ? JSON.parse(String(init.body)) as Record<string, unknown>
        : undefined
      calls.push({
        url: requestUrl,
        method,
        ...(body ? { body } : {}),
      })

      if (requestUrl.includes('/beegame_credit_accounts')) {
        if (method === 'POST') return Response.json([body])
        return Response.json([])
      }
      return Response.json([])
    }) as typeof fetch

    const store = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
      authToken: 'user-token',
    })

    const balance = await store.getCreditBalance(ownerId)

    expect(balance.includedCredits).toBe(0)
    expect(balance.balanceCredits).toBe(0)
    expect(calls).toContainEqual(expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        user_id: ownerId,
        included_credits: 0,
      }),
    }))
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

      if (requestUrl.includes('/beegame_platform_settings')) {
        if (init?.method === 'POST') {
          return Response.json([JSON.parse(String(init.body))])
        }
        return Response.json([
          {
            key: 'runtime_settings',
            config: {
              skillSearchEnabled: true,
              webBrowserToolEnabled: true,
              ignored: true,
            },
            updated_at: '2026-06-27T00:00:00.000Z',
          },
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

      if (requestUrl.includes('/rpc/beegame_reserve_credits')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        const reservationId = `reservation-${creditLedger.length + 1}`
        const credits = Number(body.p_credits)
        creditAccount.reserved_credits += credits
        creditLedger.push({
          id: reservationId,
          user_id: body.p_user_id,
          project_id: body.p_project_id,
          reservation_id: reservationId,
          kind: 'reserve',
          credits,
          weighted_tokens: null,
          metadata: {
            ...(body.p_kind ? { kind: body.p_kind } : {}),
            ...((body.p_metadata as Record<string, unknown> | undefined) ?? {}),
          },
          created_at: '2026-06-27T00:00:00.000Z',
        })
        return Response.json({
          reservation_id: reservationId,
          reserved_credits: credits,
          account: creditAccount,
        })
      }

      if (requestUrl.includes('/rpc/beegame_settle_credit_reservation')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        const reservationId = String(body.p_reservation_id)
        const reservation = creditLedger.find(row =>
          row.reservation_id === reservationId && row.kind === 'reserve'
        )
        const reservedCredits = Number(reservation?.credits ?? 0)
        const weightedTokens = Number(body.p_weighted_tokens ?? 0)
        const creditUnit = Number(body.p_credit_unit_weighted_tokens ?? 10_000)
        const settledCredits = Math.min(
          reservedCredits,
          Math.max(1, Math.ceil(weightedTokens / creditUnit)),
        )
        const refundedCredits = Math.max(0, reservedCredits - settledCredits)
        creditAccount.consumed_credits += settledCredits
        creditAccount.reserved_credits = Math.max(
          0,
          creditAccount.reserved_credits - reservedCredits,
        )
        creditLedger.push({
          id: '44444444-4444-4444-4444-444444444444',
          user_id: body.p_user_id,
          project_id: body.p_project_id,
          reservation_id: reservationId,
          kind: 'settle',
          credits: settledCredits,
          weighted_tokens: weightedTokens,
          metadata: body.p_metadata ?? {},
          created_at: '2026-06-27T00:00:00.000Z',
        })
        if (refundedCredits > 0) {
          creditLedger.push({
            id: '55555555-5555-5555-5555-555555555555',
            user_id: body.p_user_id,
            project_id: body.p_project_id,
            reservation_id: reservationId,
            kind: 'refund',
            credits: refundedCredits,
            weighted_tokens: null,
            metadata: { reason: 'unused_reservation' },
            created_at: '2026-06-27T00:00:00.000Z',
          })
        }
        return Response.json({
          reservation_id: reservationId,
          reserved_credits: reservedCredits,
          settled_credits: settledCredits,
          refunded_credits: refundedCredits,
          account: creditAccount,
        })
      }

      if (requestUrl.includes('/rpc/beegame_expire_stale_credit_reservations')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        const olderThan = Date.parse(String(body.p_older_than))
        const projectId = body.p_project_id ? String(body.p_project_id) : undefined
        const completedReservationIds = new Set(
          creditLedger
            .filter(row => row.kind === 'settle' || row.kind === 'refund')
            .map(row => String(row.reservation_id)),
        )
        const staleReservations = creditLedger.filter(row => (
          row.user_id === body.p_user_id &&
          row.kind === 'reserve' &&
          !completedReservationIds.has(String(row.reservation_id)) &&
          (!projectId || row.project_id === projectId) &&
          Date.parse(String(row.created_at)) < olderThan
        ))
        const refundedCredits = staleReservations.reduce(
          (sum, row) => sum + Number(row.credits ?? 0),
          0,
        )
        creditAccount.reserved_credits = Math.max(
          0,
          creditAccount.reserved_credits - refundedCredits,
        )
        for (const reservation of staleReservations) {
          creditLedger.push({
            id: '66666666-6666-6666-6666-666666666666',
            user_id: body.p_user_id,
            project_id: reservation.project_id,
            reservation_id: reservation.reservation_id,
            kind: 'refund',
            credits: Number(reservation.credits ?? 0),
            weighted_tokens: null,
            metadata: body.p_metadata ?? { reason: 'stale_reservation_expired' },
            created_at: '2026-07-08T09:00:00.000Z',
          })
        }
        return Response.json({
          expired_reservation_ids: staleReservations.map(row => row.reservation_id),
          refunded_credits: refundedCredits,
          account: creditAccount,
        })
      }

      if (requestUrl.includes('/rpc/beegame_admin_grant_credits')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        const credits = Number(body.p_credits)
        creditAccount.included_credits += credits
        creditLedger.push({
          id: '77777777-7777-7777-7777-777777777777',
          user_id: body.p_target_user_id,
          project_id: null,
          reservation_id: null,
          kind: 'grant',
          credits,
          weighted_tokens: null,
          metadata: body.p_metadata ?? {},
          created_at: '2026-07-08T12:00:00.000Z',
        })
        return Response.json({
          granted_credits: credits,
          account: creditAccount,
        })
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
          return Response.json(creditLedger.filter(row => row.reservation_id === reservationId))
        }
        const projectId = requestUrl.includes('project_id=eq.')
          ? decodeURIComponent(requestUrl.split('project_id=eq.')[1]?.split('&')[0] ?? '')
          : undefined
        const kind = requestUrl.includes('kind=eq.')
          ? decodeURIComponent(requestUrl.split('kind=eq.')[1]?.split('&')[0] ?? '')
          : undefined
        const userId = requestUrl.includes('user_id=eq.')
          ? decodeURIComponent(requestUrl.split('user_id=eq.')[1]?.split('&')[0] ?? '')
          : undefined
        return Response.json(creditLedger.filter(row => (
          (!projectId || row.project_id === projectId) &&
          (!kind || row.kind === kind) &&
          (!userId || row.user_id === userId)
        )))
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

      if (requestUrl.includes('/beegame_deployments')) {
        if (init?.method === 'DELETE') {
          return Response.json([{ id: 'deploy_1' }])
        }
        return Response.json([])
      }

      if (requestUrl.includes('/storage/v1/object/')) {
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
      anonKey: 'anon-key',
      authToken: 'user-token',
    })
    const ownerId = '00000000-0000-0000-0000-000000000001'

    expect(await store.listPublicModelConfigs(ownerId)).toEqual([
      expect.objectContaining({
        id: 'llm_1',
        ownerId,
        apiKeyPreview: 'sk-s...cret',
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
    expect(await store.loadPlatformRuntimeSettings()).toEqual({
      skillSearchEnabled: true,
      webBrowserToolEnabled: true,
    })
    expect(await store.savePlatformRuntimeSettings({
      bashClassifierEnabled: true,
    })).toEqual({
      skillSearchEnabled: true,
      webBrowserToolEnabled: true,
      bashClassifierEnabled: true,
    })
    expect(await store.saveWebTools(ownerId, {
      webSearchAdapter: 'brave',
      braveApiKey: undefined,
    })).toEqual({
      webSearchAdapter: 'brave',
      braveApiKeyPreview: 'brav…-key',
      braveApiKey: undefined,
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
    expect(await store.listCreditAuditLedger({
      userId: ownerId,
      projectId: 'session_1',
      kind: 'settle',
    })).toEqual({
      entries: [
        expect.objectContaining({
          userId: ownerId,
          projectId: 'session_1',
          kind: 'settle',
          credits: 2,
          weightedTokens: 12_500,
        }),
      ],
      summary: {
        entriesCount: 1,
        reservedCredits: 0,
        settledCredits: 2,
        refundedCredits: 0,
        outstandingReservedCredits: 0,
        weightedTokens: 12_500,
      },
    })
    const staleReservation = await store.reserveCredits(ownerId, {
      credits: 4,
      kind: 'edit_turn',
      projectId: 'session_1',
      metadata: { taskType: 'edit_turn' },
    })
    expect(await store.expireStaleCreditReservations(ownerId, {
      olderThan: new Date('2026-07-08T09:00:00.000Z'),
      projectId: 'session_1',
    })).toEqual({
      expiredReservations: [staleReservation.id],
      refundedCredits: 4,
      balance: expect.objectContaining({
        reservedCredits: 0,
      }),
    })
    expect(await store.grantCredits(ownerId, {
      credits: 20,
      metadata: {
        source: 'payment_provider',
        provider: 'manual',
        providerReference: 'manual-topup-2',
      },
    })).toEqual({
      grantedCredits: 20,
      balance: expect.objectContaining({
        includedCredits: 320,
        balanceCredits: 318,
      }),
    })
    expect(await store.listCreditAuditLedger({
      userId: ownerId,
      kind: 'grant',
    })).toEqual({
      entries: [
        expect.objectContaining({
          userId: ownerId,
          kind: 'grant',
          credits: 20,
          metadata: {
            source: 'payment_provider',
            provider: 'manual',
            providerReference: 'manual-topup-2',
          },
        }),
      ],
      summary: {
        entriesCount: 1,
        reservedCredits: 0,
        settledCredits: 0,
        refundedCredits: 0,
        outstandingReservedCredits: 0,
        weightedTokens: 0,
      },
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
      requirements: [{
        id: 'main_logo',
        name: 'Main logo',
        type: 'image_2d',
        status: 'uploaded',
        uploaded_files: ['public/assets/logo.png'],
      }],
    })).resolves.toEqual(expect.objectContaining({
      version: 1,
      requirements: [
        expect.objectContaining({
          id: 'main_logo',
          uploaded_files: ['public/assets/logo.png'],
        }),
      ],
    }))
    expect(await store.loadAssetManifest(ownerId, 'project_1')).toEqual(
      expect.objectContaining({
        requirements: [expect.objectContaining({ id: 'main_logo' })],
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
    expect(calls.some(call => call.url.includes('/rest/v1/rpc/beegame_reserve_credits'))).toBe(true)
    expect(calls.some(call => call.url.includes('/rest/v1/rpc/beegame_settle_credit_reservation'))).toBe(true)
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
    expect(postedBodies).toContain('"api_key_ciphertext":"v1.')
    expect(postedBodies).toContain('"braveApiKey":"v1.')
    expect(postedBodies).toContain('"value":"v1.')
  })

  test('sets default model configs through the Supabase RPC', async () => {
    const ownerId = '00000000-0000-0000-0000-000000000001'
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    const rows: Array<Record<string, unknown>> = [{
      id: 'llm_existing',
      owner_id: ownerId,
      name: 'Existing LLM',
      provider: 'openai-compatible',
      base_url: 'https://llm.example/v1',
      api_key_ciphertext: 'sk-existing',
      models: { balanced: 'existing-model' },
      is_default: true,
      created_at: '2026-06-27T00:00:00.000Z',
      updated_at: '2026-06-27T00:00:00.000Z',
    }]

    globalThis.fetch = (async (url, init) => {
      const requestUrl = String(url)
      const method = init?.method ?? 'GET'
      const body = init?.body
        ? JSON.parse(String(init.body)) as Record<string, unknown>
        : undefined
      calls.push({
        url: requestUrl,
        method,
        ...(body ? { body } : {}),
      })

      if (requestUrl.includes('/rpc/beegame_set_default_model_config')) {
        const configId = String(body?.p_model_config_id ?? '')
        for (const row of rows) row.is_default = row.id === configId
        const selected = rows.find(row => row.id === configId)
        return selected
          ? Response.json(selected)
          : new Response('not found', { status: 404 })
      }

      if (requestUrl.includes('/beegame_model_configs')) {
        if (method === 'POST') {
          const row = {
            created_at: '2026-06-27T00:00:00.000Z',
            updated_at: '2026-06-27T00:00:00.000Z',
            ...body,
          }
          rows.push(row)
          return Response.json([row])
        }
        if (method === 'PATCH') {
          const id = decodeURIComponent(
            requestUrl.split('id=eq.')[1]?.split('&')[0] ?? '',
          )
          const index = rows.findIndex(row => row.id === id)
          if (index < 0) return Response.json([])
          rows[index] = { ...rows[index], ...body }
          return Response.json([rows[index]])
        }
        return Response.json(rows)
      }

      return new Response('Not found', { status: 404 })
    }) as typeof fetch

    const store = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
      authToken: 'user-token',
    })

    const created = await store.createModelConfig(ownerId, {
      name: 'New Default',
      provider: 'openai-compatible',
      baseUrl: 'https://new-llm.example/v1',
      apiKey: 'sk-new',
      models: { balanced: 'new-model' },
      isDefault: true,
    })
    expect(created.isDefault).toBe(true)

    await expect(store.updateModelConfig(ownerId, 'llm_existing', {
      isDefault: true,
    })).resolves.toEqual(expect.objectContaining({
      id: 'llm_existing',
      isDefault: true,
    }))

    const modelPosts = calls.filter(call =>
      call.url.includes('/rest/v1/beegame_model_configs') &&
      call.method === 'POST'
    )
    expect(modelPosts[0]?.body).toEqual(expect.objectContaining({
      is_default: false,
    }))
    const directDefaultWrites = calls.filter(call =>
      call.url.includes('/rest/v1/beegame_model_configs') &&
      JSON.stringify(call.body ?? {}).includes('"is_default":true')
    )
    expect(directDefaultWrites).toHaveLength(0)
    expect(calls.filter(call =>
      call.url.includes('/rest/v1/rpc/beegame_set_default_model_config')
    )).toHaveLength(2)
    expect(calls.some(call =>
      call.url.includes('/rest/v1/beegame_model_configs') &&
      call.url.includes('is_default=eq.true')
    )).toBe(false)
  })

  test('encrypts RLS-protected secrets while reading legacy plaintext rows', async () => {
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
      if (requestUrl.includes('/rpc/beegame_set_default_model_config')) {
        row = { ...row, is_default: true }
        return Response.json(row)
      }
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
      anonKey: 'anon-key-v1',
      authToken: 'user-token',
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
    expect(legacyCiphertext).not.toBe('sk-legacy-secret')
    expect(legacyCiphertext).toMatch(/^v1\./u)

    const storeWithDedicatedKey = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key-v1',
      authToken: 'user-token',
    })
    expect(await storeWithDedicatedKey.listPublicModelConfigs(row.owner_id)).toEqual([
      expect.objectContaining({ apiKeyPreview: 'sk-l...cret' }),
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
    expect(dedicatedCiphertext).not.toBe('sk-new-secret')
    expect(dedicatedCiphertext).toMatch(/^v1\./u)

    const rotatedAnonKeyStore = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key-v2',
      authToken: 'user-token',
    })
    expect(await rotatedAnonKeyStore.listPublicModelConfigs(row.owner_id)).toEqual([
      expect.objectContaining({ apiKeyPreview: 'sk-n...cret' }),
    ])
  })

  test('records local migration secret counts without values or ids', async () => {
    let auditBody: Record<string, unknown> | undefined
    globalThis.fetch = (async (url, init) => {
      if (String(url).includes('/beegame_audit_events')) {
        auditBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return Response.json([{
          id: 'audit_1',
          created_at: '2026-07-10T00:00:00.000Z',
          ...auditBody,
        }])
      }
      return Response.json([])
    }) as typeof fetch

    const store = new SupabaseDashboardStore({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
      authToken: 'user-token',
    })
    await store.recordSecretMigration('owner_1', {
      modelConfigs: 2,
      webTools: 1,
      mcpServers: 3,
      count: 6,
    })

    expect(auditBody).toEqual(expect.objectContaining({
      actor_id: 'owner_1',
      action: 'secret.migrated',
      metadata: {
        modelConfigs: 2,
        webTools: 1,
        mcpServers: 3,
        count: 6,
        targetType: 'secret',
        targetId: 'migration',
      },
    }))
    expect(JSON.stringify(auditBody)).not.toContain('secret-value')
    expect(JSON.stringify(auditBody)).not.toContain('secret-id')
  })
})
