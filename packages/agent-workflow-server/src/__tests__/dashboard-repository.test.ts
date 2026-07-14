import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DashboardRepository } from '../dashboard-repository'
import { saveRuntimeSettingsConfig } from '../runtime-settings-store'
import { SupabaseDashboardStore } from '../supabase-dashboard-store'

const originalEncryptionKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY

beforeAll(() => {
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 59).toString('base64')
})

afterAll(() => {
  if (originalEncryptionKey === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = originalEncryptionKey
})

describe('DashboardRepository Supabase boundaries', () => {
  test('does not treat user runtime settings as platform runtime capabilities', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-repository-'))
    const userRoot = join(dataRoot, 'users', 'owner-user')
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => userRoot,
      skillsConfig: false,
    })
    const request = new Request('http://beegame.test/api/runtime-settings')
    const user = { id: 'owner-user', role: 'owner' as const }

    try {
      saveRuntimeSettingsConfig({ skillSearchEnabled: true }, { dataDir: userRoot })

      await expect(repository.loadRuntimeSettings(request, user)).resolves.toEqual({})
      await expect(repository.getRuntimeEnv(userRoot, user.id)).resolves.not.toHaveProperty('SKILL_SEARCH_ENABLED')
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('maps platform runtime capabilities into every user runtime settings file', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-repository-'))
    const userARoot = join(dataRoot, 'users', 'owner-a')
    const userBRoot = join(dataRoot, 'users', 'owner-b')
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => userARoot,
      skillsConfig: false,
    })

    try {
      saveRuntimeSettingsConfig({
        skillSearchEnabled: true,
        mcpSkillsEnabled: false,
      }, { dataDir: dataRoot })

      const ownerAEnv = await repository.getRuntimeEnv(userARoot, 'owner-a')
      const ownerBEnv = await repository.getRuntimeEnv(userBRoot, 'owner-b')

      expect(ownerAEnv).not.toHaveProperty('SKILL_SEARCH_ENABLED')
      expect(ownerBEnv).not.toHaveProperty('SKILL_SEARCH_ENABLED')
      expect(ownerAEnv.FEATURE_MCP_SKILLS).toBe('0')
      expect(ownerBEnv.FEATURE_MCP_SKILLS).toBe('0')
      await expect(readFile(
        join(ownerAEnv.CLAUDE_CONFIG_DIR, 'settings.json'),
        'utf8',
      )).resolves.toContain('"skillSearchEnabled": true')
      await expect(readFile(
        join(ownerBEnv.CLAUDE_CONFIG_DIR, 'settings.json'),
        'utf8',
      )).resolves.toContain('"skillSearchEnabled": true')
      await expect(readFile(
        join(ownerBEnv.CLAUDE_CONFIG_DIR, 'settings.json'),
        'utf8',
      )).resolves.toContain('"mcpSkillsEnabled": false')
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('materializes enabled remote user skills before runtime env is returned', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-repository-'))
    const userRoot = join(dataRoot, 'users', 'owner-user')
    const calls: string[] = []
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => userRoot,
      skillsConfig: {
        apiBaseUrl: 'http://skills.test',
        serviceToken: 'skills-token',
      },
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input, init) => {
      calls.push(String(input))
      expect(init?.headers).toEqual({
        authorization: 'Bearer skills-token',
      })
      return Response.json([{
        id: 'skill_1',
        slug: 'runtime-skill',
        name: 'runtime-skill',
        description: 'Runtime injected skill.',
        enabled: true,
        content: [
          '---',
          'name: runtime-skill',
          'description: Runtime injected skill.',
          '---',
          '',
          '# Runtime Skill',
        ].join('\n'),
        references: [],
        files: [{
          path: 'SKILL.md',
          content: [
            '---',
            'name: runtime-skill',
            'description: Runtime injected skill.',
            '---',
            '',
            '# Runtime Skill',
          ].join('\n'),
        }],
        createdAt: '2026-07-09T00:00:00.000Z',
        updatedAt: '2026-07-09T00:00:00.000Z',
      }])
    }) as typeof fetch

    try {
      const env = await repository.getRuntimeEnv(userRoot, 'owner-user')

      expect(calls).toEqual([
        'http://skills.test/api/internal/user-skills/enabled?userId=owner-user',
      ])
      expect(env.CLAUDE_CONFIG_DIR).toBe(join(userRoot, '.runtime', 'app'))
      expect(env.CLAUDE_CONFIG_DIR).toBe(env.BEEGAME_CONFIG_DIR)
      await expect(readFile(
        join(env.CLAUDE_CONFIG_DIR, 'skills', 'user-runtime-skill', 'SKILL.md'),
        'utf8',
      )).resolves.toContain('Runtime Skill')
      await expect(readFile(
        join(
          env.CLAUDE_CONFIG_DIR,
          'skills',
          'builtinskills',
          'beegame-game-acceptance',
          'SKILL.md',
        ),
        'utf8',
      )).resolves.toContain('name: beegame-game-acceptance')
    } finally {
      globalThis.fetch = originalFetch
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('fails closed when required user skills cannot be synchronized', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-repository-required-skills-'))
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => dataRoot,
      skillsConfig: {
        apiBaseUrl: 'http://skills.test',
        required: true,
      },
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('skills unavailable')
    }) as unknown as typeof fetch

    try {
      await expect(repository.getRuntimeEnv(dataRoot, 'owner-user'))
        .rejects.toThrow('User skills synchronization failed')
    } finally {
      globalThis.fetch = originalFetch
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('continues without stale user skills when optional development sync is unavailable', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-repository-optional-skills-'))
    const staleSkillDir = join(dataRoot, '.runtime', 'app', 'skills', 'user-stale')
    await mkdir(staleSkillDir, { recursive: true })
    await writeFile(join(staleSkillDir, 'SKILL.md'), 'stale', 'utf8')
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => dataRoot,
      skillsConfig: {
        apiBaseUrl: 'http://skills.test',
        required: false,
      },
    })
    const originalFetch = globalThis.fetch
    const originalWarn = console.warn
    let warningCount = 0
    globalThis.fetch = (async () => {
      throw new Error('skills unavailable')
    }) as unknown as typeof fetch
    console.warn = () => { warningCount += 1 }

    try {
      await repository.getRuntimeEnv(dataRoot, 'owner-user')
      await repository.getRuntimeEnv(dataRoot, 'owner-user')
      await expect(readFile(join(staleSkillDir, 'SKILL.md'), 'utf8')).rejects.toThrow()
      expect(warningCount).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
      console.warn = originalWarn
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('removes stale user skill materialization when remote skills are disabled', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-repository-disabled-skills-'))
    const staleSkillDir = join(dataRoot, '.runtime', 'app', 'skills', 'user-stale')
    await mkdir(staleSkillDir, { recursive: true })
    await writeFile(join(staleSkillDir, 'SKILL.md'), 'stale', 'utf8')
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => dataRoot,
      skillsConfig: false,
    })

    try {
      await repository.getRuntimeEnv(dataRoot, 'owner-user')
      await expect(readFile(join(staleSkillDir, 'SKILL.md'), 'utf8')).rejects.toThrow()
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('reads and writes platform runtime settings through the global Supabase table', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-repository-'))
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => join(dataRoot, 'users', 'owner-auth-user'),
      supabaseStore: new SupabaseDashboardStore({
        url: 'https://project.supabase.co',
        anonKey: 'anon-key',
        authToken: 'user-token',
        fetchImpl: (async (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          const url = String(input)
          calls.push({
            url,
            method: init?.method ?? 'GET',
            ...(init?.body
              ? { body: JSON.parse(String(init.body)) as unknown }
              : {}),
          })
          if (url.includes('/beegame_platform_settings')) {
            if (init?.method === 'POST') {
              return Response.json([JSON.parse(String(init.body))])
            }
            return Response.json([
              {
                key: 'runtime_settings',
                config: { skillSearchEnabled: true },
                updated_at: '2026-07-09T00:00:00.000Z',
              },
            ])
          }
          return new Response('not found', { status: 404 })
        }) as unknown as typeof fetch,
      }),
    })
    const request = new Request('http://beegame.test/api/runtime-settings', {
      headers: { authorization: 'Bearer user-token' },
    })
    const user = { id: 'owner-auth-user', role: 'owner' as const }

    try {
      await expect(repository.loadRuntimeSettings(request, user)).resolves.toEqual({
        skillSearchEnabled: true,
      })
      await expect(repository.saveRuntimeSettings(request, user, {
        webBrowserToolEnabled: true,
      })).resolves.toEqual({
        skillSearchEnabled: true,
        webBrowserToolEnabled: true,
      })

      expect(calls.some(call =>
        call.url.includes('/rest/v1/beegame_platform_settings') &&
        call.url.includes('key=eq.runtime_settings'),
      )).toBe(true)
      expect(calls.some(call =>
        call.url.includes('/rest/v1/beegame_runtime_settings') ||
        call.url.includes('owner_id=eq.owner-auth-user'),
      )).toBe(false)
      expect(calls.some(call =>
        call.method === 'POST' &&
        call.url.includes('/rest/v1/beegame_platform_settings') &&
        call.url.includes('on_conflict=key'),
      )).toBe(true)
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('delegates credit mutations to remote credit control when configured', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-repository-'))
    const calls: Array<{ operation: string; userId: string; input: unknown }> = []
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => dataRoot,
      remoteCreditControl: {
        reserveCredits: async (userId, input) => {
          calls.push({ operation: 'reserve', userId, input })
          return {
            id: 'reservation-remote',
            reservedCredits: input.credits,
            balance: {
              userId,
              plan: 'free',
              balanceCredits: 290,
              includedCredits: 300,
              consumedCredits: 0,
              reservedCredits: input.credits,
              creditUnitWeightedTokens: 10000,
              estimates: {},
            } as any,
          }
        },
        settleCreditReservation: async (userId, input) => {
          calls.push({ operation: 'settle', userId, input })
          return {
            reservationId: input.reservationId,
            reservedCredits: 10,
            settledCredits: 1,
            refundedCredits: 9,
            balance: {
              userId,
              plan: 'free',
              balanceCredits: 299,
              includedCredits: 300,
              consumedCredits: 1,
              reservedCredits: 0,
              creditUnitWeightedTokens: 10000,
              estimates: {},
            } as any,
          }
        },
        refundCreditReservation: async (userId, input) => {
          calls.push({ operation: 'refund', userId, input })
          return {
            reservationId: input.reservationId,
            reservedCredits: 10,
            settledCredits: 0,
            refundedCredits: 10,
            balance: {
              userId,
              plan: 'free',
              balanceCredits: 300,
              includedCredits: 300,
              consumedCredits: 0,
              reservedCredits: 0,
              creditUnitWeightedTokens: 10000,
              estimates: {},
            } as any,
          }
        },
        expireStaleCreditReservations: async (userId, input) => {
          calls.push({ operation: 'expire', userId, input })
          return {
            expiredReservations: [],
            refundedCredits: 0,
            balance: {
              userId,
              plan: 'free',
              balanceCredits: 300,
              includedCredits: 300,
              consumedCredits: 0,
              reservedCredits: 0,
              creditUnitWeightedTokens: 10000,
              estimates: {},
            } as any,
          }
        },
      },
    })
    const request = new Request('http://beegame.test/api/credits')
    const user = {
      id: 'oauth-provider-user',
      accountId: 'canonical-user',
      role: 'developer' as const,
    }

    try {
      await repository.reserveCredits(request, user, {
        credits: 10,
        kind: 'edit_turn',
      })
      const backend = repository.createSessionCreditBackend()
      await backend.settleCreditReservation('canonical-user', {
        dataDir: dataRoot,
        reservationId: 'reservation-remote',
        weightedTokens: 1000,
      })

      expect(calls).toEqual([
        {
          operation: 'reserve',
          userId: 'canonical-user',
          input: { credits: 10, kind: 'edit_turn' },
        },
        {
          operation: 'settle',
          userId: 'canonical-user',
          input: {
            dataDir: dataRoot,
            reservationId: 'reservation-remote',
            weightedTokens: 1000,
          },
        },
      ])
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

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

  test('uses canonical account id for Supabase credit balance and ledger', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-repository-'))
    const calls: string[] = []
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => dataRoot,
      supabaseStore: new SupabaseDashboardStore({
        url: 'https://project.supabase.co',
        anonKey: 'anon-key',
        fetchImpl: (async (input: Parameters<typeof fetch>[0]) => {
          const url = String(input)
          calls.push(url)
          if (url.includes('/beegame_credit_accounts')) {
            return Response.json([{
              user_id: 'canonical-user',
              plan: 'free',
              included_credits: 300,
              consumed_credits: 7,
              reserved_credits: 2,
              updated_at: '2026-07-01T00:00:00.000Z',
            }])
          }
          if (url.includes('/beegame_credit_ledger')) {
            return Response.json([])
          }
          return new Response('not found', { status: 404 })
        }) as unknown as typeof fetch,
      }),
    })
    const request = new Request('http://beegame.test/api/credits', {
      headers: { authorization: 'Bearer user-token' },
    })
    const user = {
      id: 'oauth-provider-user',
      accountId: 'canonical-user',
      role: 'developer' as const,
    }

    try {
      const balance = await repository.getCreditBalance(request, user)
      await repository.listCreditLedger(request, user)

      expect(balance.userId).toBe('canonical-user')
      expect(calls[0]).toContain('user_id=eq.canonical-user')
      expect(calls[1]).toContain('user_id=eq.canonical-user')
      expect(calls.join('\n')).not.toContain('oauth-provider-user')
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('lists Supabase RLS-readable model configs without requiring an app-level owner scope', async () => {
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

      expect(calls[0]?.url).toContain('/rest/v1/beegame_model_configs?select=*')
      expect(calls[0]?.url).not.toContain('owner_id=')
      expect(calls[1]?.url).toContain('/rest/v1/beegame_model_configs?id=eq.llm_platform_default')
      expect(calls[1]?.url).not.toContain('owner_id=')
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('updates platform-owned model configs through the resolved model config owner', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-repository-'))
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
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
            method: init?.method ?? 'GET',
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
                api_key_ciphertext: 'sk-new-secret',
                models: { balanced: 'balanced-model' },
                is_default: true,
                created_at: '2026-06-30T00:00:00.000Z',
                updated_at: '2026-06-30T00:00:00.000Z',
              },
            ])
          }
          return new Response('not found', { status: 404 })
        }) as unknown as typeof fetch,
      }),
    })
    const request = new Request('http://beegame.test/api/model-configs/llm_platform_default', {
      headers: { authorization: 'Bearer user-token' },
    })

    try {
      const updated = await repository.updateModelConfig(
        request,
        {
          id: 'owner-auth-user',
          role: 'owner',
          modelConfigOwnerId: 'platform-owner',
        },
        'llm_platform_default',
        { apiKey: 'sk-new-secret' },
      )

      expect(updated?.apiKeyPreview).toBe('sk-n...cret')
      expect(calls[0]?.method).toBe('PATCH')
      expect(calls[0]?.url).toContain('owner_id=eq.platform-owner')
      expect(calls[0]?.url).not.toContain('owner_id=eq.owner-auth-user')
      expect(calls[0]?.body).toEqual(expect.objectContaining({
        api_key_ciphertext: expect.stringMatching(/^v1\./u),
      }))
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('returns an empty list when Supabase RLS exposes no model configs', async () => {
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
      expect(calls).toEqual([
        'https://project.supabase.co/rest/v1/beegame_model_configs?select=*&order=created_at.asc',
        'https://project.supabase.co/rest/v1/beegame_model_configs?id=eq.llm_default&select=id&limit=1',
      ])
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })
})
