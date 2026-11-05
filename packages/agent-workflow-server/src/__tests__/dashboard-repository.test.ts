import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DashboardRepository } from '../dashboard-repository'
import { resolveRuntimeFeatureSettings } from '../runtime-settings-store'
import { SupabaseDashboardStore } from '../supabase-dashboard-store'
import { SupabaseRuntimeEnvClient } from '../supabase-runtime-env-client'
import { upsertMcpServer } from '../mcp-servers-store'

const originalEncryptionKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY

beforeAll(() => {
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 59).toString(
    'base64',
  )
})

afterAll(() => {
  if (originalEncryptionKey === undefined)
    delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = originalEncryptionKey
})

describe('DashboardRepository Supabase boundaries', () => {
  test('model configuration does not require the game Skill catalog to be installed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-intake-without-skills-'))
    const previous = process.env.BEEGAME_BUILTIN_SKILLS_DIR
    const missingCatalog = join(root, 'missing-game-skills')
    const repository = new DashboardRepository({
      dashboardDataRoot: root, getUserDataRoot: () => root, skillsConfig: false,
    })
    try {
      process.env.BEEGAME_BUILTIN_SKILLS_DIR = missingCatalog
      const env = await repository.getRuntimeEnv(root)
      expect(env.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR).toBe(missingCatalog)
      expect(existsSync(missingCatalog)).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.BEEGAME_BUILTIN_SKILLS_DIR
      else process.env.BEEGAME_BUILTIN_SKILLS_DIR = previous
      await rm(root, { recursive: true, force: true })
    }
  })

  test('stored stdio auto-start checks current owner permissions, including revocation and identity mismatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-mcp-host-permission-'))
    let user = { id: 'alice', role: 'owner' as 'owner' | 'developer' }
    const repository = new DashboardRepository({ dashboardDataRoot: root, getUserDataRoot: () => root,
      skillsConfig: false, resolveRuntimeUser: async (_id, token) => {
        expect(token).toBe('synthetic-owner-token')
        return user
      } })
    try {
      // Simulates a previously saved entry. It must not gain trust merely by existing in storage.
      upsertMcpServer({ name: 'Stored host command', enabled: true, autoStart: true, scope: 'global',
        transport: 'stdio', command: 'never-executed' }, { dataDir: root })
      expect(JSON.parse((await repository.getRuntimeEnv(root, 'alice', 'synthetic-owner-token'))
        .BEEGAME_NATIVE_MCP_SERVERS_JSON)).toHaveLength(1)
      user = { id: 'alice', role: 'developer' }
      await expect(repository.getRuntimeEnv(root, 'alice', 'synthetic-owner-token')).rejects.toThrow('workspace.manage')
      user = { id: 'bob', role: 'owner' }
      await expect(repository.getRuntimeEnv(root, 'alice', 'synthetic-owner-token')).rejects.toThrow('workspace.manage')
      const unbound = new DashboardRepository({ dashboardDataRoot: root, getUserDataRoot: () => root, skillsConfig: false })
      await expect(unbound.getRuntimeEnv(root, 'alice')).rejects.toThrow('workspace.manage')
      await expect(repository.upsertMcpServer(new Request('http://fixture'), { id: 'alice', role: 'developer' }, {
        name: 'Host', transport: 'stdio', command: 'never-executed', enabled: true, scope: 'global',
      })).rejects.toThrow('workspace.manage')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  test('runtime MCP configuration remains owner-scoped and public listings redact credentials', async()=>{
    const root = await mkdtemp(join(tmpdir(),'bgs-runtime-mcp-owner-'))
    const a = join(root,'owner-a'), b = join(root,'owner-b')
    const repository = new DashboardRepository({dashboardDataRoot:root,getUserDataRoot:()=>a,skillsConfig:false,
      resolveRuntimeUser:async id=>({id,role:'owner'})})
    try {
      upsertMcpServer({name:'Fixture',enabled:true,transport:'stdio',scope:'beegame',command:'fixture',
        autoStart:true,env:[{key:'TOKEN',value:'synthetic-private-token'}]}, {dataDir:a})
      expect(JSON.parse((await repository.getRuntimeEnv(a,'a')).BEEGAME_NATIVE_MCP_SERVERS_JSON)).toMatchObject([
        {command:'fixture',env:[{key:'TOKEN',value:'synthetic-private-token'}]},
      ])
      expect(JSON.parse((await repository.getRuntimeEnv(b,'b')).BEEGAME_NATIVE_MCP_SERVERS_JSON)).toEqual([])
      expect(JSON.stringify(await repository.listMcpServers(new Request('http://fixture'),{id:'a',role:'owner'}))).not.toContain('synthetic-private-token')
    } finally { await rm(root,{recursive:true,force:true}) }
  })
  test('retired host tool credentials are not forwarded or removed from the host environment', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-retired-tool-env-'))
    const keys = ['BEEGAME_ARTIFACTS_URL', 'BEEGAME_ARTIFACTS_TOKEN', 'TAVILY_API_KEY']
    const previous = keys.map(key => process.env[key])
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot, getUserDataRoot: () => dataRoot, skillsConfig: false,
    })
    try {
      for (const key of keys) process.env[key] = 'retained-fixture-value'
      const env = await repository.getRuntimeEnv(dataRoot)
      for (const key of keys) {
        expect(env).not.toHaveProperty(key)
        expect(process.env[key]).toBe('retained-fixture-value')
      }
    } finally {
      keys.forEach((key, i) => {
        if (previous[i] === undefined) delete process.env[key]
        else process.env[key] = previous[i]
      })
      await rm(dataRoot, { recursive: true, force: true })
    }
  })
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
      await mkdir(userRoot, { recursive: true })
      await writeFile(join(userRoot, 'runtime-settings.json'), JSON.stringify({ version: 1, config: { skillSearchEnabled: true } }))

      await expect(
        repository.loadRuntimeSettings(request, user),
      ).resolves.toEqual(resolveRuntimeFeatureSettings({}))
      await expect(
        repository.getRuntimeEnv(userRoot, user.id),
      ).resolves.not.toHaveProperty('SKILL_SEARCH_ENABLED')
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('exposes the shared built-in Skill catalog without mixing user configuration', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-repository-'))
    const userARoot = join(dataRoot, 'users', 'owner-a')
    const userBRoot = join(dataRoot, 'users', 'owner-b')
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => userARoot,
      skillsConfig: false,
    })

    try {
      await writeFile(join(dataRoot, 'runtime-settings.json'), JSON.stringify({ version: 1, config: { mcpSkillsEnabled: false } }))

      const ownerAEnv = await repository.getRuntimeEnv(userARoot, 'owner-a')
      const ownerBEnv = await repository.getRuntimeEnv(userBRoot, 'owner-b')

      expect(ownerAEnv.BGS_HOME).toBe(join(userARoot,'.runtime','app','bgs'))
      expect(ownerBEnv.BGS_HOME).toBe(join(userBRoot,'.runtime','app','bgs'))
      expect(ownerAEnv.BEEGAME_CONFIG_DIR).not.toBe(ownerBEnv.BEEGAME_CONFIG_DIR)
      expect(ownerAEnv.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR)
        .toBe(ownerBEnv.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR)
      expect(existsSync(join(ownerBEnv.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR,
        'game-art-director-expert', 'SKILL.md'))).toBe(true)
      expect(existsSync(join(ownerBEnv.BEEGAME_CONFIG_DIR,
        'skills', 'game-art-director-expert'))).toBe(false)
      expect(existsSync(join(ownerAEnv.BEEGAME_CONFIG_DIR,'settings.json'))).toBe(false)
      expect(existsSync(join(ownerBEnv.BEEGAME_CONFIG_DIR,'settings.json'))).toBe(false)
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('keeps Supabase logical runtime config while forcing the authenticated user isolation directory', async () => {
    const dataRoot = await mkdtemp(
      join(tmpdir(), 'beegame-repository-supabase-env-'),
    )
    const userRoot = join(dataRoot, 'users', 'owner-user')
    const runtimeCalls: Array<{ url: string; body: unknown }> = []
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => userRoot,
      skillsConfig: false,
      supabaseStore: new SupabaseDashboardStore({
        url: 'https://project.supabase.co',
        anonKey: 'anon-key',
        authToken: 'user-token',
        fetchImpl: (async () => Response.json([])) as unknown as typeof fetch,
      }),
      supabaseRuntimeEnvClient: new SupabaseRuntimeEnvClient({
        url: 'https://project.supabase.co',
        anonKey: 'anon-key',
        fetchImpl: (async (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          runtimeCalls.push({
            url: String(input),
            body: JSON.parse(String(init?.body)),
          })
          return Response.json({
            env: {
              OPENAI_BASE_URL: 'https://provider.test/v1',
              FEATURE_MCP_SKILLS: '0',
              BEEGAME_RUNTIME_SETTINGS_JSON: JSON.stringify({ skillSearchEnabled: true, verificationAgentEnabled: true }),
              BEEGAME_CONFIG_DIR: '/forged/other-user',
              NPM_CONFIG_CACHE: '/forged/other-user/npm-cache',
              NPM_CONFIG_USERCONFIG: '/forged/other-user/npmrc',
            },
          })
        }) as unknown as typeof fetch,
      }),
    })

    try {
      const env = await repository.getRuntimeEnv(
        userRoot,
        'owner-user',
        'authenticated-user-token',
      )

      expect(runtimeCalls).toHaveLength(1)
      expect(runtimeCalls[0]?.body).toEqual({
        p_user_id: 'owner-user',
        p_data_dir: userRoot,
      })
      expect(env.OPENAI_BASE_URL).toBe('https://provider.test/v1')
      expect(env).not.toHaveProperty('WEB_SEARCH_ADAPTER')
      expect(existsSync(join(env.BEEGAME_CONFIG_DIR!, 'settings.json'))).toBe(false)
      expect(env.BEEGAME_CONFIG_DIR).toBe(join(userRoot, '.runtime', 'app'))
      expect(env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
      expect(env).not.toHaveProperty('BEEGAME_PROJECT_CONFIG_DIR_NAME')
      expect(env.NPM_CONFIG_CACHE).toBe(
        join(userRoot, '.runtime', 'tooling', 'npm-cache'),
      )
      expect(env.NPM_CONFIG_USERCONFIG).toBe(
        join(userRoot, '.runtime', 'tooling', 'npmrc'),
      )
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
      return Response.json([
        {
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
          files: [
            {
              path: 'SKILL.md',
              content: [
                '---',
                'name: runtime-skill',
                'description: Runtime injected skill.',
                '---',
                '',
                '# Runtime Skill',
              ].join('\n'),
            },
          ],
          createdAt: '2026-07-09T00:00:00.000Z',
          updatedAt: '2026-07-09T00:00:00.000Z',
        },
      ])
    }) as typeof fetch

    try {
      const env = await repository.getRuntimeEnv(userRoot, 'owner-user')

      expect(calls).toEqual([
        'http://skills.test/api/internal/user-skills/enabled?userId=owner-user',
      ])
      expect(env.BEEGAME_CONFIG_DIR).toBe(join(userRoot, '.runtime', 'app'))
      expect(env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
      expect(env).not.toHaveProperty('BEEGAME_PROJECT_CONFIG_DIR_NAME')
      await expect(
        readFile(
          join(
            env.BEEGAME_CONFIG_DIR,
            'skills',
            'user-runtime-skill',
            'SKILL.md',
          ),
          'utf8',
        ),
      ).resolves.toContain('Runtime Skill')
      expect(existsSync(join(
        env.BEEGAME_CONFIG_DIR,
        'skills',
        '.beegame-builtins.json',
      ))).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('fails closed when required user skills cannot be synchronized', async () => {
    const dataRoot = await mkdtemp(
      join(tmpdir(), 'beegame-repository-required-skills-'),
    )
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
      await expect(
        repository.getRuntimeEnv(dataRoot, 'owner-user'),
      ).rejects.toThrow('User skills synchronization failed')
    } finally {
      globalThis.fetch = originalFetch
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('continues without stale user skills when optional development sync is unavailable', async () => {
    const dataRoot = await mkdtemp(
      join(tmpdir(), 'beegame-repository-optional-skills-'),
    )
    const staleSkillDir = join(
      dataRoot,
      '.runtime',
      'app',
      'skills',
      'user-stale',
    )
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
    console.warn = () => {
      warningCount += 1
    }

    try {
      await repository.getRuntimeEnv(dataRoot, 'owner-user')
      await repository.getRuntimeEnv(dataRoot, 'owner-user')
      await expect(
        readFile(join(staleSkillDir, 'SKILL.md'), 'utf8'),
      ).rejects.toThrow()
      expect(warningCount).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
      console.warn = originalWarn
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('removes stale user skill materialization when remote skills are disabled', async () => {
    const dataRoot = await mkdtemp(
      join(tmpdir(), 'beegame-repository-disabled-skills-'),
    )
    const staleSkillDir = join(
      dataRoot,
      '.runtime',
      'app',
      'skills',
      'user-stale',
    )
    await mkdir(staleSkillDir, { recursive: true })
    await writeFile(join(staleSkillDir, 'SKILL.md'), 'stale', 'utf8')
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => dataRoot,
      skillsConfig: false,
    })

    try {
      await repository.getRuntimeEnv(dataRoot, 'owner-user')
      await expect(
        readFile(join(staleSkillDir, 'SKILL.md'), 'utf8'),
      ).rejects.toThrow()
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
      await expect(
        repository.loadRuntimeSettings(request, user),
      ).resolves.toEqual({
        ...resolveRuntimeFeatureSettings({}),
      })
      await expect(
        repository.saveRuntimeSettings(request, user, {
          resourceLibraryEnabled: false,
        }),
      ).resolves.toEqual({
        resourceLibraryEnabled: false,
      })

      expect(
        calls.some(
          call =>
            call.url.includes('/rest/v1/beegame_platform_settings') &&
            call.url.includes('key=eq.runtime_settings'),
        ),
      ).toBe(true)
      expect(
        calls.some(
          call =>
            call.url.includes('/rest/v1/beegame_runtime_settings') ||
            call.url.includes('owner_id=eq.owner-auth-user'),
        ),
      ).toBe(false)
      expect(
        calls.some(
          call =>
            call.method === 'POST' &&
            call.url.includes('/rest/v1/beegame_platform_settings') &&
            call.url.includes('on_conflict=key'),
        ),
      ).toBe(true)
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('uses the configured auth transport for HttpOnly session requests', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-repository-'))
    const authorizationHeaders: string[] = []
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => dataRoot,
      getAuthToken: request =>
        request.headers.get('cookie') === 'beegame_session=session-id'
          ? 'cookie-access-token'
          : undefined,
      supabaseStore: new SupabaseDashboardStore({
        url: 'https://project.supabase.co',
        anonKey: 'anon-key',
        fetchImpl: (async (
          _input: Parameters<typeof fetch>[0],
          init?: RequestInit,
        ) => {
          authorizationHeaders.push(
            new Headers(init?.headers).get('authorization') ?? '',
          )
          return Response.json([])
        }) as unknown as typeof fetch,
      }),
    })

    try {
      await repository.listProjects(
        new Request('http://beegame.test/api/projects', {
          headers: { cookie: 'beegame_session=session-id' },
        }),
        { id: '00000000-0000-0000-0000-000000000001', role: 'owner' },
      )
      expect(authorizationHeaders).toEqual(['Bearer cookie-access-token'])
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('lists only model configs owned by the resolved platform config owner', async () => {
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
      modelConfigOwnerId: 'platform-owner',
    }
    const request = new Request('http://beegame.test/api/model-configs', {
      headers: { authorization: 'Bearer user-token' },
    })

    try {
      await repository.listModelConfigs(request, user)
      await repository.modelConfigExists(request, user, 'llm_platform_default')

      expect(calls[0]?.url).toContain(
        '/rest/v1/beegame_model_configs?owner_id=eq.platform-owner',
      )
      expect(calls[1]?.url).toContain(
        '/rest/v1/beegame_model_configs?owner_id=eq.platform-owner&id=eq.llm_platform_default',
      )
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
                api_protocol: 'responses',
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
    const request = new Request(
      'http://beegame.test/api/model-configs/llm_platform_default',
      {
        headers: { authorization: 'Bearer user-token' },
      },
    )

    try {
      const updated = await repository.updateModelConfig(
        request,
        {
          id: 'owner-auth-user',
          role: 'owner',
          modelConfigOwnerId: 'platform-owner',
        },
        'llm_platform_default',
        { apiKey: 'sk-new-secret', apiProtocol: 'responses' },
      )

      expect(updated?.apiKeyPreview).toBe('sk-n...cret')
      expect(updated?.apiProtocol).toBe('responses')
      expect(calls[0]?.method).toBe('PATCH')
      expect(calls[0]?.url).toContain('owner_id=eq.platform-owner')
      expect(calls[0]?.url).not.toContain('owner_id=eq.owner-auth-user')
      expect(calls[0]?.body).toEqual(
        expect.objectContaining({
          api_key_ciphertext: expect.stringMatching(/^v1\./u),
          api_protocol: 'responses',
        }),
      )
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('falls back to RLS-visible configs for legacy non-admin contexts without a config owner', async () => {
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
      expect(
        await repository.modelConfigExists(request, user, 'llm_default'),
      ).toBe(false)
      expect(calls).toEqual([
        'https://project.supabase.co/rest/v1/beegame_model_configs?select=*&order=created_at.asc',
        'https://project.supabase.co/rest/v1/beegame_model_configs?id=eq.llm_default&select=id&limit=1',
      ])
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('cleans provider-owned project objects before deleting project metadata', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-project-storage-delete-'))
    const calls: Array<{ ownerId: string; projectId: string; authToken: string }> = []
    const ordered: string[] = []
    const projectRow = {
      id: 'project-1',
      owner_id: 'owner-1',
      workspace_id: 'workspace-1',
      name: 'Project 1',
      root_path: null,
      runtime_snapshot: {},
      created_at: '2026-10-25T00:00:00.000Z',
      updated_at: '2026-10-25T00:00:00.000Z',
    }
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => dataRoot,
      getAuthToken: request => request.headers.get('authorization')?.replace(/^Bearer /, ''),
      projectAssetStorage: {
        uploadAssetFile: async () => 'r2-object://fixture',
        deleteAssetFile: async () => undefined,
        deleteProjectFiles: async input => { calls.push(input); ordered.push('storage') },
      },
      supabaseStore: new SupabaseDashboardStore({
        url: 'https://project.supabase.co',
        anonKey: 'anon-key',
        fetchImpl: async (input, init) => {
          const method = String(init?.method ?? 'GET').toUpperCase()
          const url = String(input)
          ordered.push(`supabase:${method}:${url}`)
          if (method === 'GET' && url.includes('beegame_projects?owner_id=eq.owner-1&id=eq.project-1'))
            return Response.json([projectRow])
          if (method === 'DELETE' && url.includes('/beegame_projects?'))
            return Response.json([{ id: 'project-1' }])
          return Response.json([])
        },
      }),
    })
    try {
      expect(await repository.deleteProject(
        new Request('http://beegame.test/api/projects/project-1', { headers: { authorization: 'Bearer owner-token' } }),
        { id: 'owner-1', role: 'owner' },
        'project-1',
      )).toBe(true)
      expect(calls).toEqual([{ ownerId: 'owner-1', projectId: 'project-1', authToken: 'owner-token' }])
      const storageIndex = ordered.indexOf('storage')
      const projectDeleteIndex = ordered.findIndex(item => item.includes('supabase:DELETE:') && item.includes('/beegame_projects?'))
      expect(storageIndex).toBeGreaterThanOrEqual(0)
      expect(projectDeleteIndex).toBeGreaterThanOrEqual(0)
      expect(storageIndex).toBeLessThan(projectDeleteIndex)
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('does not run provider cleanup for an unknown or foreign project', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-project-storage-missing-'))
    const cleanupCalls: string[] = []
    const requests: Array<{ method: string; url: string }> = []
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => dataRoot,
      getAuthToken: () => 'owner-token',
      projectAssetStorage: {
        uploadAssetFile: async () => 'r2-object://fixture',
        deleteAssetFile: async () => undefined,
        deleteProjectFiles: async input => { cleanupCalls.push(input.projectId) },
      },
      supabaseStore: new SupabaseDashboardStore({
        url: 'https://project.supabase.co',
        anonKey: 'anon-key',
        fetchImpl: async (input, init) => {
          requests.push({ method: String(init?.method ?? 'GET').toUpperCase(), url: String(input) })
          return Response.json([])
        },
      }),
    })
    try {
      await expect(repository.deleteProject(
        new Request('http://beegame.test/api/projects/project-1'),
        { id: 'owner-1', role: 'owner' },
        'project-1',
      )).resolves.toBe(false)
      expect(cleanupCalls).toEqual([])
      expect(requests).toHaveLength(1)
      expect(requests[0]?.method).toBe('GET')
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('does not delete project metadata when provider cleanup fails', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-project-storage-failure-'))
    const projectRow = {
      id: 'project-1',
      owner_id: 'owner-1',
      workspace_id: 'workspace-1',
      name: 'Project 1',
      root_path: null,
      runtime_snapshot: {},
      created_at: '2026-10-25T00:00:00.000Z',
      updated_at: '2026-10-25T00:00:00.000Z',
    }
    const requests: Array<{ method: string; url: string }> = []
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => dataRoot,
      getAuthToken: () => 'owner-token',
      projectAssetStorage: {
        uploadAssetFile: async () => 'r2-object://fixture',
        deleteAssetFile: async () => undefined,
        deleteProjectFiles: async () => { throw new Error('object cleanup failed') },
      },
      supabaseStore: new SupabaseDashboardStore({
        url: 'https://project.supabase.co',
        anonKey: 'anon-key',
        fetchImpl: async (input, init) => {
          const method = String(init?.method ?? 'GET').toUpperCase()
          const url = String(input)
          requests.push({ method, url })
          if (method === 'GET' && url.includes('beegame_projects?owner_id=eq.owner-1&id=eq.project-1'))
            return Response.json([projectRow])
          return Response.json([])
        },
      }),
    })
    try {
      await expect(repository.deleteProject(
        new Request('http://beegame.test/api/projects/project-1'),
        { id: 'owner-1', role: 'owner' },
        'project-1',
      )).rejects.toThrow('object cleanup failed')
      expect(requests.some(request => request.method === 'DELETE')).toBe(false)
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test('keeps local project metadata when the pre-delete workflow cleanup fails', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-project-workflow-delete-failure-'))
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot,
      getUserDataRoot: () => dataRoot,
      skillsConfig: false,
    })
    const request = new Request('http://beegame.test/api/projects/project-1')
    const user = { id: 'owner-1', role: 'owner' as const }
    try {
      await repository.upsertProject(request, user, {
        id: 'project-1',
        name: 'Project 1',
        created_at: Date.now(),
      })
      await expect(
        repository.deleteProject(request, user, 'project-1', async () => {
          throw new Error('workflow cleanup failed')
        }),
      ).rejects.toThrow('workflow cleanup failed')
      await expect(repository.getProject(request, user, 'project-1')).resolves.toEqual(
        expect.objectContaining({ id: 'project-1', name: 'Project 1' }),
      )
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

  test.each(['ready', 'missing-migration', 'forbidden'])('project deletion retains public releases before cleanup: %s', async retention => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-public-release-retention-'))
    const ordered: string[] = []
    const deletions: Array<{ url: URL; body: unknown }> = []
    let retentionCommitted = false
    const release = { artifact_path: 'supabase://deliveries/deployments/public-release' }
    const privateBuild = { artifact_path: 'supabase://deliveries/deployments/private-build' }
    const repository = new DashboardRepository({
      dashboardDataRoot: dataRoot, getUserDataRoot: () => dataRoot,
      getAuthToken: () => 'owner-token',
      projectAssetStorage: {
        uploadAssetFile: async () => 'r2-object://fixture',
        deleteAssetFile: async () => undefined,
        deleteProjectFiles: async () => {
          // Provider cleanup must run only after the database has moved public
          // delivery objects out of this project's deletion scope.
          expect(retentionCommitted).toBe(true)
          ordered.push('provider-cleanup')
        },
      },
      supabaseStore: new SupabaseDashboardStore({
        url: 'https://project.supabase.co', anonKey: 'anon-key',
        fetchImpl: async (input, init) => {
          const url = new URL(String(input))
          const method = init?.method ?? 'GET'
          if (url.pathname.endsWith('/beegame_projects') && method === 'GET')
            return Response.json([{ id: 'project-1', owner_id: 'owner-1', name: 'Project',
              created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', runtime_snapshot: {} }])
          if (url.pathname.endsWith('/rpc/beegame_retain_project_publications')) {
            ordered.push('retention')
            expect(JSON.parse(String(init?.body))).toEqual({ p_owner_id: 'owner-1', p_project_id: 'project-1' })
            if (retention !== 'ready') return Response.json({ message: retention }, { status: retention === 'forbidden' ? 403 : 404 })
            retentionCommitted = true
            return Response.json(null)
          }
          if (method === 'DELETE') {
            deletions.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
            return Response.json([{ id: 'project-1' }])
          }
          if (url.pathname.endsWith('/beegame_deployments')) {
            expect(url.searchParams.get('owner_id')).toBe('eq.owner-1')
            expect(url.searchParams.get('project_id')).toBe('eq.project-1')
            return Response.json(url.searchParams.get('or') === '(status.neq.succeeded,portal_published_at.is.null)'
              ? [privateBuild] : [release, privateBuild])
          }
          return Response.json([])
        },
      }),
    })
    try {
      const deleting = repository.deleteProject(new Request('http://beegame.test/api/projects/project-1', {
        headers: { authorization: 'Bearer owner-token' },
      }), { id: 'owner-1', role: 'owner' }, 'project-1', async () => { ordered.push('workflow-cleanup') })
      if (retention !== 'ready') {
        await expect(deleting).rejects.toThrow(retention)
        expect(ordered).toEqual(['retention'])
        expect(deletions).toEqual([])
        return
      }
      expect(await deleting).toBe(true)
      expect(ordered).toEqual(['retention', 'provider-cleanup', 'workflow-cleanup'])
      const deliveryDeletes = deletions.filter(item => item.url.pathname === '/storage/v1/object/deliveries')
      expect(deliveryDeletes.map(item => item.body)).toEqual([{ prefixes: ['deployments/private-build'] }])
      const records = deletions.find(item => item.url.pathname.endsWith('/beegame_deployments'))!
      expect(records.url.searchParams.get('or')).toBe('(status.neq.succeeded,portal_published_at.is.null)')
      expect(records.url.searchParams.get('owner_id')).toBe('eq.owner-1')
      expect(records.url.searchParams.get('project_id')).toBe('eq.project-1')
      expect(deletions.some(item => item.url.pathname.endsWith('/beegame_sessions'))).toBe(true)
      expect(deletions.some(item => item.url.pathname.endsWith('/beegame_projects'))).toBe(true)
      expect(deletions.some(item => item.url.pathname.endsWith('/beegame_portal_games'))).toBe(false)
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })

})


test('Supabase MCP tool selections survive real repository save, read and runtime environment assembly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beegame-repository-supabase-env-'))
  const owner = { id: 'owner-user', role: 'owner' as const }
  const request = new Request('https://fixture.test/api/mcp-servers', {
    headers: { authorization: 'Bearer user-token' },
  })
  type Row = { id: string; owner_id: string; name: string; config: Record<string, unknown> }
  const rows = new Map<string, Row>()
  const writes: Row[] = []
  const store = new SupabaseDashboardStore({
    url: 'https://project.supabase.co', anonKey: 'anon-key', authToken: 'user-token',
    fetchImpl: async (input, init) => {
      const url = new URL(String(input))
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer user-token')
      if (url.pathname === '/rest/v1/beegame_model_configs') return Response.json([])
      expect(url.pathname).toBe('/rest/v1/beegame_mcp_servers')
      if (init?.method === 'POST') {
        const row = JSON.parse(String(init.body)) as Row
        expect(row.owner_id).toBe(owner.id)
        writes.push(row)
        rows.set(row.id, row)
        return Response.json([row])
      }
      expect(url.searchParams.get('owner_id')).toBe('eq.' + owner.id)
      const id = url.searchParams.get('id')?.slice(3)
      return Response.json([...rows.values()].filter(row => !id || row.id === id))
    },
  })
  const repository = new DashboardRepository({
    dashboardDataRoot: root, getUserDataRoot: () => root, skillsConfig: false,
    resolveRuntimeUser: async () => owner, supabaseStore: store,
    supabaseRuntimeEnvClient: new SupabaseRuntimeEnvClient({
      url: 'https://project.supabase.co', anonKey: 'anon-key',
      fetchImpl: async () => Response.json({ env: {} }),
    }),
  })
  const input = { name: 'Project browser', enabled: true, autoStart: true, scope: 'project' as const,
    cwd: root, transport: 'stdio' as const, command: '/fixture/browser' }
  const enabledTools = ['browser_run_code_unsafe'], disabledTools = ['browser_click']
  const runtimeSelection = async (id: string) => {
    const env = await repository.getRuntimeEnv(root, owner.id, 'user-token')
    return JSON.parse(env.BEEGAME_NATIVE_MCP_SERVERS_JSON!).find((server: { id: string }) => server.id === id)
  }
  try {
    const saved = await repository.upsertMcpServer(request, owner, { ...input, enabledTools, disabledTools })
    expect(writes[0]?.config).toMatchObject({ enabledTools, disabledTools })
    expect((await repository.listMcpServers(request, owner))[0]).toMatchObject({ enabledTools, disabledTools })
    expect(await runtimeSelection(saved.id)).toMatchObject({ id: saved.id, scope: 'project', cwd: root, enabledTools, disabledTools })
    await repository.upsertMcpServer(request, owner, { ...input, id: saved.id, name: 'Renamed browser' })
    expect(await runtimeSelection(saved.id)).toMatchObject({ enabledTools, disabledTools })
    const beforeInvalid = writes.length
    await expect(repository.upsertMcpServer(request, owner, { ...input, id: saved.id, enabledTools: [''] }))
      .rejects.toThrow('MCP tool selection')
    expect(writes).toHaveLength(beforeInvalid)
    expect(await runtimeSelection(saved.id)).toMatchObject({ enabledTools, disabledTools })
    await repository.upsertMcpServer(request, owner, { ...input, id: saved.id, enabledTools: [], disabledTools: [] })
    expect(await runtimeSelection(saved.id)).toMatchObject({ enabledTools: [], disabledTools: [] })
    await repository.upsertMcpServer(request, owner, { ...input, id: saved.id, enabledTools: null, disabledTools: null })
    expect(await runtimeSelection(saved.id)).not.toHaveProperty('enabledTools')
    expect(await runtimeSelection(saved.id)).not.toHaveProperty('disabledTools')
    const legacy = await repository.upsertMcpServer(request, owner, { ...input, name: 'Legacy browser' })
    expect(await runtimeSelection(legacy.id)).not.toHaveProperty('enabledTools')
    expect(await runtimeSelection(legacy.id)).not.toHaveProperty('disabledTools')
  } finally { await rm(root, { recursive: true, force: true }) }
})
