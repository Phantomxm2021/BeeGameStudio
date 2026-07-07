import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetAgentWorkflow } from '@claude-code-best/agent-workflow'
import { createAgentWorkflowApp } from '../app'

describe('agent workflow server routes', () => {
  const testOwner = { id: 'owner-user', role: 'owner' } as const
  let testRoot = ''
  let app: ReturnType<typeof createAgentWorkflowApp>

  beforeEach(async () => {
    resetAgentWorkflow()
    testRoot = await mkdtemp(join(tmpdir(), 'beegame-routes-'))
    app = createAgentWorkflowApp({
      defaultWorkspacePath: testRoot,
      currentUser: testOwner,
    })
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  const makeModelOptions = (baseId: string, firstOption: Record<string, unknown> = {}) => [
    {
      id: baseId,
      title: 'Mode One',
      gameplay: 'First playable mode.',
      recommendedPlatform: 'Web',
      recommendedEngine: 'React',
      recommendedDimension: '2D',
      recommendedGenre: 'Action',
      recommendedStyle: 'Minimal',
      recommendedInputs: ['Keyboard/mouse'],
      scope: 'Playable demo',
      ...firstOption,
    },
    {
      id: `${baseId}_two`,
      title: 'Mode Two',
      gameplay: 'Second playable mode.',
      recommendedPlatform: 'Web',
      recommendedEngine: 'React',
      recommendedDimension: '2D',
      recommendedGenre: 'Action',
      recommendedStyle: 'Minimal',
      recommendedInputs: ['Keyboard/mouse'],
      scope: 'Playable demo',
    },
    {
      id: `${baseId}_three`,
      title: 'Mode Three',
      gameplay: 'Third playable mode.',
      recommendedPlatform: 'Web',
      recommendedEngine: 'React',
      recommendedDimension: '2D',
      recommendedGenre: 'Action',
      recommendedStyle: 'Minimal',
      recommendedInputs: ['Keyboard/mouse'],
      scope: 'Playable demo',
    },
  ]

  test('creates and lists masked model configs for the current user', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)
    const created = await createRes.json()
    expect(created.apiKey).toBeUndefined()
    expect(created.apiKeyPreview).toBe('sk-d...cret')

    const listRes = await app.request('/api/model-configs')
    expect(listRes.status).toBe(200)
    expect(await listRes.json()).toEqual([
      expect.objectContaining({ id: created.id, name: 'Primary LLM' }),
    ])
  })

  test('returns the current user role and permissions', async () => {
    const anonymousApp = createAgentWorkflowApp()
    const anonymousRes = await anonymousApp.request('/api/current-user')
    expect(anonymousRes.status).toBe(401)

    const viewerApp = createAgentWorkflowApp({
      currentUser: {
        id: 'viewer-user',
        role: 'viewer',
        modelConfigOwnerId: 'platform-owner',
      },
    })
    const viewerRes = await viewerApp.request('/api/current-user')
    expect(viewerRes.status).toBe(200)
    expect(await viewerRes.json()).toEqual({
      id: 'viewer-user',
      role: 'viewer',
      modelConfigOwnerId: 'platform-owner',
      permissions: [
        'workspace.read',
        'project.read',
        'project.export',
      ],
    })
  })

  test('does not run account deletion from the local dev or offline runtime host', async () => {
    const authApp = createAgentWorkflowApp({
      currentUser: {
        id: '00000000-0000-0000-0000-000000000001',
        role: 'owner',
      },
    })

    const res = await authApp.request('/api/current-user', {
      method: 'DELETE',
    })

    expect(res.status).toBe(501)
    expect(await res.json()).toEqual(expect.objectContaining({
      error: 'Account deletion unavailable',
    }))
  })

  test('deletes the current user through authenticated Supabase RPC when configured', async () => {
    const originalUrl = process.env.BEEGAME_SUPABASE_URL
    const originalAnonKey = process.env.BEEGAME_SUPABASE_ANON_KEY
    const originalFetch = globalThis.fetch
    const calls: Array<{ url: string; authorization?: string }> = []
    try {
      process.env.BEEGAME_SUPABASE_URL = 'https://supabase.example.test'
      process.env.BEEGAME_SUPABASE_ANON_KEY = 'anon-test-key'
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push({
          url,
          authorization: new Headers(init?.headers).get('authorization') ?? undefined,
        })
        if (url.endsWith('/rest/v1/rpc/beegame_delete_current_user')) {
          return new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response('not found', { status: 404 })
      }) as typeof fetch

      const authApp = createAgentWorkflowApp({
        currentUserResolver: request => {
          const header = request.headers.get('authorization')
          if (header !== 'Bearer user-token') return undefined
          return {
            id: '00000000-0000-0000-0000-000000000001',
            role: 'owner',
          }
        },
      })

      const res = await authApp.request('/api/current-user', {
        method: 'DELETE',
        headers: { authorization: 'Bearer user-token' },
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(calls).toEqual([
        {
          url: 'https://supabase.example.test/rest/v1/rpc/beegame_delete_current_user',
          authorization: 'Bearer user-token',
        },
      ])
    } finally {
      globalThis.fetch = originalFetch
      if (originalUrl === undefined) {
        delete process.env.BEEGAME_SUPABASE_URL
      } else {
        process.env.BEEGAME_SUPABASE_URL = originalUrl
      }
      if (originalAnonKey === undefined) {
        delete process.env.BEEGAME_SUPABASE_ANON_KEY
      } else {
        process.env.BEEGAME_SUPABASE_ANON_KEY = originalAnonKey
      }
    }
  })

  test('returns an owner-scoped credit balance with generation estimates', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-credit-root-'))
    try {
      const authApp = createAgentWorkflowApp({
        defaultWorkspacePath: projectsRoot,
        currentUserResolver: request => {
          const header = request.headers.get('authorization')
          if (header === 'Bearer owner-a-token') return { id: 'owner-a', role: 'owner' }
          if (header === 'Bearer owner-b-token') return { id: 'owner-b', role: 'owner' }
          return undefined
        },
      })

      const ownerARes = await authApp.request('/api/credits', {
        headers: { authorization: 'Bearer owner-a-token' },
      })
      expect(ownerARes.status).toBe(200)
      expect(await ownerARes.json()).toEqual({
        userId: 'owner-a',
        plan: 'free',
        balanceCredits: 300,
        includedCredits: 300,
        consumedCredits: 0,
        reservedCredits: 0,
        creditUnitWeightedTokens: 10000,
        estimates: {
          ideaIntake: { minCredits: 3, maxCredits: 3 },
          planningDocs: { minCredits: 8, maxCredits: 30 },
          smallPlayableGame: { minCredits: 80, maxCredits: 200 },
          standardGame: { minCredits: 200, maxCredits: 600 },
          complexGame: { minCredits: 600, maxCredits: 1500 },
        },
      })

      const quoteRes = await authApp.request('/api/credits/quote', {
        method: 'POST',
        headers: {
          authorization: 'Bearer owner-a-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ taskType: 'edit_turn' }),
      })
      expect(quoteRes.status).toBe(200)
      expect(await quoteRes.json()).toEqual(expect.objectContaining({
        taskType: 'edit_turn',
        reservedCredits: 50,
        balanceCredits: 300,
        canStart: true,
      }))

      const summaryRes = await authApp.request('/api/credits/summary?projectId=project-a', {
        headers: { authorization: 'Bearer owner-a-token' },
      })
      expect(summaryRes.status).toBe(200)
      expect(await summaryRes.json()).toEqual({
        entriesCount: 0,
        reservedCredits: 0,
        settledCredits: 0,
        refundedCredits: 0,
        outstandingReservedCredits: 0,
        weightedTokens: 0,
      })

      const ownerBRes = await authApp.request('/api/credits', {
        headers: { authorization: 'Bearer owner-b-token' },
      })
      expect(ownerBRes.status).toBe(200)
      expect(await ownerBRes.json()).toEqual(expect.objectContaining({
        userId: 'owner-b',
        balanceCredits: 300,
      }))
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('resolves current user from bearer auth tokens when configured', async () => {
    const originalTokens = process.env.BEEGAME_AUTH_TOKENS
    try {
      process.env.BEEGAME_AUTH_TOKENS = JSON.stringify({
        'owner-token': { id: 'owner-user', role: 'owner' },
        'viewer-token': { id: 'viewer-user', role: 'viewer' },
      })
      const authApp = createAgentWorkflowApp()

      const missingRes = await authApp.request('/api/current-user')
      expect(missingRes.status).toBe(401)
      expect(await missingRes.json()).toEqual({
        error: 'Unauthorized',
        message: 'authentication required',
      })

      const viewerRes = await authApp.request('/api/current-user', {
        headers: { authorization: 'Bearer viewer-token' },
      })
      expect(viewerRes.status).toBe(200)
      expect(await viewerRes.json()).toEqual({
        id: 'viewer-user',
        role: 'viewer',
        permissions: [
          'workspace.read',
          'project.read',
          'project.export',
        ],
      })

      const ownerRes = await authApp.request('/api/current-user', {
        headers: { authorization: 'Bearer owner-token' },
      })
      expect(ownerRes.status).toBe(200)
      expect(await ownerRes.json()).toEqual(expect.objectContaining({
        id: 'owner-user',
        role: 'owner',
        permissions: expect.arrayContaining(['project.delete']),
      }))
    } finally {
      if (originalTokens === undefined) {
        delete process.env.BEEGAME_AUTH_TOKENS
      } else {
        process.env.BEEGAME_AUTH_TOKENS = originalTokens
      }
    }
  })

  test('resolves current user from an async resolver', async () => {
    const authApp = createAgentWorkflowApp({
      currentUserResolver: async request => {
        const header = request.headers.get('authorization')
        if (header !== 'Bearer async-token') return undefined
        return { id: 'async-user', role: 'developer' }
      },
    })

    const res = await authApp.request('/api/current-user', {
      headers: { authorization: 'Bearer async-token' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(expect.objectContaining({
      id: 'async-user',
      role: 'developer',
      permissions: expect.arrayContaining(['agent.send_message']),
    }))
  })

  test('records owner-scoped audit events for sensitive settings changes', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-audit-root-'))
    try {
      const authApp = createAgentWorkflowApp({
        defaultWorkspacePath: projectsRoot,
        currentUserResolver: request => {
          const header = request.headers.get('authorization')
          if (header === 'Bearer owner-token') {
            return { id: 'owner-a', role: 'owner' }
          }
          if (header === 'Bearer viewer-token') {
            return { id: 'viewer-a', role: 'viewer' }
          }
          return undefined
        },
      })

      const saveRes = await authApp.request('/api/web-tools', {
        method: 'PUT',
        headers: {
          authorization: 'Bearer owner-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          webSearchAdapter: 'brave',
          braveApiKey: 'bsa-secret',
        }),
      })
      expect(saveRes.status).toBe(200)

      const viewerRes = await authApp.request('/api/audit-events', {
        headers: { authorization: 'Bearer viewer-token' },
      })
      expect(viewerRes.status).toBe(403)

      const ownerRes = await authApp.request('/api/audit-events', {
        headers: { authorization: 'Bearer owner-token' },
      })
      expect(ownerRes.status).toBe(200)
      expect(await ownerRes.json()).toEqual([
        expect.objectContaining({
          actorId: 'owner-a',
          action: 'web_tools.updated',
          targetType: 'web_tools',
          targetId: 'owner-a',
          metadata: expect.objectContaining({
            webSearchAdapter: 'brave',
            braveApiKeyChanged: true,
          }),
        }),
      ])
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('stores audit events in Supabase when configured', async () => {
    const originalUrl = process.env.BEEGAME_SUPABASE_URL
    const originalAnonKey = process.env.BEEGAME_SUPABASE_ANON_KEY
    const originalFetch = globalThis.fetch
    const auditRows: Array<Record<string, unknown>> = []
    try {
      process.env.BEEGAME_SUPABASE_URL = 'https://project.supabase.co'
      process.env.BEEGAME_SUPABASE_ANON_KEY = 'anon-key'
      globalThis.fetch = (async (input, init) => {
        const requestUrl = String(input)
        if (requestUrl.includes('/rest/v1/beegame_web_tools')) {
          if (init?.method === 'POST') {
            return Response.json([JSON.parse(String(init.body))])
          }
          return Response.json([])
        }
        if (requestUrl.includes('/rest/v1/beegame_audit_events')) {
          if (init?.method === 'POST') {
            const body = JSON.parse(String(init.body)) as Record<string, unknown>
            const row = {
              id: '33333333-3333-3333-3333-333333333333',
              created_at: '2026-06-27T00:00:00.000Z',
              ...body,
            }
            auditRows.push(row)
            return Response.json([row])
          }
          return Response.json(auditRows)
        }
        return new Response('Not found', { status: 404 })
      }) as typeof fetch
      const authApp = createAgentWorkflowApp({
        currentUser: {
          id: '00000000-0000-0000-0000-000000000001',
          role: 'owner',
        },
      })
      const authHeaders = { authorization: 'Bearer user-token' }

      const saveRes = await authApp.request('/api/web-tools', {
        method: 'PUT',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({
          webSearchAdapter: 'brave',
          braveApiKey: 'bsa-secret',
        }),
      })
      expect(saveRes.status).toBe(200)

      const auditRes = await authApp.request('/api/audit-events', {
        headers: authHeaders,
      })
      expect(auditRes.status).toBe(200)
      expect(await auditRes.json()).toEqual([
        expect.objectContaining({
          actorId: '00000000-0000-0000-0000-000000000001',
          action: 'web_tools.updated',
          targetType: 'web_tools',
          targetId: '00000000-0000-0000-0000-000000000001',
          metadata: expect.objectContaining({
            webSearchAdapter: 'brave',
            braveApiKeyChanged: true,
          }),
        }),
      ])
    } finally {
      globalThis.fetch = originalFetch
      if (originalUrl === undefined) {
        delete process.env.BEEGAME_SUPABASE_URL
      } else {
        process.env.BEEGAME_SUPABASE_URL = originalUrl
      }
      if (originalAnonKey === undefined) {
        delete process.env.BEEGAME_SUPABASE_ANON_KEY
      } else {
        process.env.BEEGAME_SUPABASE_ANON_KEY = originalAnonKey
      }
    }
  })

  test('scopes project metadata by bearer authenticated user', async () => {
    const originalTokens = process.env.BEEGAME_AUTH_TOKENS
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-auth-projects-'))
    try {
      process.env.BEEGAME_AUTH_TOKENS = JSON.stringify({
        'owner-a-token': { id: 'owner-a', role: 'owner' },
        'owner-b-token': { id: 'owner-b', role: 'owner' },
      })
      const authApp = createAgentWorkflowApp({
        defaultWorkspacePath: projectsRoot,
      })

      const createRes = await authApp.request('/api/projects', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer owner-a-token',
        },
        body: JSON.stringify({
          id: 'owner_a_project',
          name: 'Owner A Project',
          created_at: 1,
        }),
      })
      expect(createRes.status).toBe(200)

      const ownerAProjectsRes = await authApp.request('/api/projects', {
        headers: { authorization: 'Bearer owner-a-token' },
      })
      expect(ownerAProjectsRes.status).toBe(200)
      expect(await ownerAProjectsRes.json()).toEqual([
        expect.objectContaining({ id: 'owner_a_project' }),
      ])

      const ownerBProjectsRes = await authApp.request('/api/projects', {
        headers: { authorization: 'Bearer owner-b-token' },
      })
      expect(ownerBProjectsRes.status).toBe(200)
      expect(await ownerBProjectsRes.json()).toEqual([])
    } finally {
      if (originalTokens === undefined) {
        delete process.env.BEEGAME_AUTH_TOKENS
      } else {
        process.env.BEEGAME_AUTH_TOKENS = originalTokens
      }
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('does not expose the local single-user fallback as a signed-in account', async () => {
    const originalRole = process.env.BEEGAME_LOCAL_USER_ROLE
    try {
      process.env.BEEGAME_LOCAL_USER_ROLE = 'viewer'
      const viewerApp = createAgentWorkflowApp()
      const viewerRes = await viewerApp.request('/api/current-user')

      expect(viewerRes.status).toBe(401)

      process.env.BEEGAME_LOCAL_USER_ROLE = 'unknown-role'
      const fallbackApp = createAgentWorkflowApp()
      const fallbackRes = await fallbackApp.request('/api/current-user')

      expect(fallbackRes.status).toBe(401)
    } finally {
      if (originalRole === undefined) {
        delete process.env.BEEGAME_LOCAL_USER_ROLE
      } else {
        process.env.BEEGAME_LOCAL_USER_ROLE = originalRole
      }
    }
  })

  test('uses the authenticated owner for model configs without owner query parameters', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)
    const created = await createRes.json()

    const listRes = await app.request('/api/model-configs')
    expect(listRes.status).toBe(200)
    expect(await listRes.json()).toEqual([
      expect.objectContaining({ id: created.id, name: 'Primary LLM' }),
    ])
  })

  test('does not expose the removed workflow run API', async () => {
    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(404)
  })

  test('persists model configs across app instances when storage is enabled', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'cc-dashboard-models-'))

    try {
      const firstApp = createAgentWorkflowApp({
        modelConfigStore: { dataDir },
        currentUser: testOwner,
      })
      const createRes = await firstApp.request(
        '/api/model-configs',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Persistent LLM',
            provider: 'openai-compatible',
            baseUrl: 'https://llm.example.invalid/v1',
            apiKey: 'sk-persistent-secret',
            models: { balanced: 'balanced-model' },
            isDefault: true,
          }),
        },
      )
      expect(createRes.status).toBe(200)
      const created = await createRes.json()

      resetAgentWorkflow()
      const secondApp = createAgentWorkflowApp({
        modelConfigStore: { dataDir },
        currentUser: testOwner,
      })
      const listRes = await secondApp.request(
        '/api/model-configs',
      )

      expect(listRes.status).toBe(200)
      expect(await listRes.json()).toEqual([
        expect.objectContaining({
          id: created.id,
          name: 'Persistent LLM',
          apiKeyPreview: 'sk-p...cret',
        }),
      ])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('persists runtime capability settings across app instances', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'cc-dashboard-runtime-'))

    try {
      const firstApp = createAgentWorkflowApp({
        defaultWorkspacePath: dataDir,
        currentUser: testOwner,
      })
      const saveRes = await firstApp.request('/api/runtime-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          autoMemoryEnabled: true,
          autoDreamEnabled: false,
          skillSearchEnabled: true,
          treeSitterBashEnabled: true,
          webBrowserToolEnabled: true,
          bashClassifierEnabled: false,
          mcpSkillsEnabled: true,
          ignored: true,
        }),
      })

      expect(saveRes.status).toBe(200)
      expect(await saveRes.json()).toEqual({
        autoMemoryEnabled: true,
        autoDreamEnabled: false,
        skillSearchEnabled: true,
        treeSitterBashEnabled: true,
        webBrowserToolEnabled: true,
        bashClassifierEnabled: false,
        mcpSkillsEnabled: true,
      })

      const secondApp = createAgentWorkflowApp({
        defaultWorkspacePath: dataDir,
        currentUser: testOwner,
      })
      const listRes = await secondApp.request('/api/runtime-settings')

      expect(listRes.status).toBe(200)
      expect(await listRes.json()).toEqual({
        autoMemoryEnabled: true,
        autoDreamEnabled: false,
        skillSearchEnabled: true,
        treeSitterBashEnabled: true,
        webBrowserToolEnabled: true,
        bashClassifierEnabled: false,
        mcpSkillsEnabled: true,
      })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('rejects sensitive settings routes for read-only users', async () => {
    const viewerApp = createAgentWorkflowApp({
      currentUser: {
        id: 'viewer-user',
        role: 'viewer',
      },
    })

    const requests = [
      viewerApp.request('/api/web-tools'),
      viewerApp.request('/api/web-tools', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ braveApiKey: 'brave-secret' }),
      }),
      viewerApp.request('/api/runtime-settings'),
      viewerApp.request('/api/runtime-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillSearchEnabled: true }),
      }),
      viewerApp.request('/api/mcp-servers'),
      viewerApp.request('/api/mcp-servers/discover'),
      viewerApp.request('/api/mcp-servers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Local MCP',
          enabled: true,
          transport: 'http',
          scope: 'beegame',
          url: 'http://127.0.0.1:18081/mcp',
        }),
      }),
      viewerApp.request('/api/mcp-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Local MCP',
          enabled: true,
          transport: 'http',
          scope: 'beegame',
          url: 'http://127.0.0.1:18081/mcp',
        }),
      }),
      viewerApp.request('/api/mcp-servers/server-id', {
        method: 'DELETE',
      }),
    ]

    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'Forbidden' })
    }
  })

  test('applies project and workspace route permissions by role', async () => {
    const viewerApp = createAgentWorkflowApp({
      currentUser: {
        id: 'viewer-user',
        role: 'viewer',
      },
    })
    const developerApp = createAgentWorkflowApp({
      currentUser: {
        id: 'developer-user',
        role: 'developer',
      },
    })

    const viewerListRes = await viewerApp.request('/api/projects')
    expect(viewerListRes.status).toBe(200)

    const viewerCreateRes = await viewerApp.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'project_viewer_denied',
        name: 'Viewer Denied',
        created_at: 1710000000000,
      }),
    })
    expect(viewerCreateRes.status).toBe(403)
    expect(await viewerCreateRes.json()).toEqual({ error: 'Forbidden' })

    const developerCreateRes = await developerApp.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'project_developer_allowed',
        name: 'Developer Allowed',
        created_at: 1710000000000,
      }),
    })
    expect(developerCreateRes.status).toBe(200)

    const developerDeleteRes = await developerApp.request(
      '/api/projects/project_developer_allowed',
      { method: 'DELETE' },
    )
    expect(developerDeleteRes.status).toBe(200)
    expect(await developerDeleteRes.json()).toEqual({ deleted: true })

    const viewerDirectoriesRes = await viewerApp.request(
      '/api/filesystem/directories',
    )
    expect(viewerDirectoriesRes.status).toBe(403)
    expect(await viewerDirectoriesRes.json()).toEqual({ error: 'Forbidden' })
  })

  test('persists MCP servers and masks environment secrets', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'cc-dashboard-mcp-'))

    try {
      const firstApp = createAgentWorkflowApp({
        defaultWorkspacePath: dataDir,
        currentUser: testOwner,
      })
      const createRes = await firstApp.request('/api/mcp-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Unity Bridge',
          enabled: true,
          transport: 'stdio',
          scope: 'beegame',
          command: 'npx',
          args: ['unity-mcp'],
          env: [{ key: 'UNITY_TOKEN', value: 'unity-secret-token' }],
          autoStart: true,
        }),
      })

      expect(createRes.status).toBe(200)
      const created = await createRes.json()
      expect(created).toEqual(expect.objectContaining({
        name: 'Unity Bridge',
        transport: 'stdio',
        command: 'npx',
        args: ['unity-mcp'],
      }))
      expect(created.env).toEqual([
        { key: 'UNITY_TOKEN', valuePreview: 'unit…oken' },
      ])
      expect(JSON.stringify(created)).not.toContain('unity-secret-token')

      const updateRes = await firstApp.request(`/api/mcp-servers/${created.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Unity Bridge Updated',
          enabled: false,
          transport: 'stdio',
          scope: 'beegame',
          command: 'npx',
          args: ['unity-mcp', '--stdio'],
          env: [{ key: 'UNITY_TOKEN' }],
          autoStart: false,
        }),
      })
      expect(updateRes.status).toBe(200)
      const updated = await updateRes.json()
      expect(updated.env).toEqual([
        { key: 'UNITY_TOKEN', valuePreview: 'unit…oken' },
      ])

      const secondApp = createAgentWorkflowApp({
        defaultWorkspacePath: dataDir,
        currentUser: testOwner,
      })
      const listRes = await secondApp.request('/api/mcp-servers')

      expect(listRes.status).toBe(200)
      expect(await listRes.json()).toEqual([
        expect.objectContaining({
          id: created.id,
          name: 'Unity Bridge Updated',
          enabled: false,
          args: ['unity-mcp', '--stdio'],
          env: [{ key: 'UNITY_TOKEN', valuePreview: 'unit…oken' }],
        }),
      ])

      const deleteRes = await secondApp.request(`/api/mcp-servers/${created.id}`, {
        method: 'DELETE',
      })
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ deleted: true })
      expect(await (await secondApp.request('/api/mcp-servers')).json()).toEqual([])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('discovers local MCP servers from structured config files', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'cc-dashboard-mcp-discover-'))
    const ownerDataDir = join(dataDir, 'users', testOwner.id)

    try {
      await mkdir(ownerDataDir, { recursive: true })
      await writeFile(
        join(ownerDataDir, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            'Local Tools': {
              command: 'npx',
              args: ['local-tools-mcp'],
              env: {
                LOCAL_TOKEN: 'local-secret-token',
              },
            },
            'Remote Tools': {
              transport: 'http',
              url: 'http://127.0.0.1:3030/mcp',
            },
          },
        }),
        'utf8',
      )

      const firstApp = createAgentWorkflowApp({
        defaultWorkspacePath: dataDir,
        currentUser: testOwner,
      })
      const discoverRes = await firstApp.request('/api/mcp-servers/discover')
      expect(discoverRes.status).toBe(200)
      const discovered = await discoverRes.json()
      expect(discovered).toEqual([
        expect.objectContaining({
          name: 'Local Tools',
          transport: 'stdio',
          command: 'npx',
          args: ['local-tools-mcp'],
          env: [{ key: 'LOCAL_TOKEN', valuePreview: 'loca…oken' }],
          sourcePath: join(ownerDataDir, '.mcp.json'),
          exists: false,
        }),
        expect.objectContaining({
          name: 'Remote Tools',
          transport: 'http',
          url: 'http://127.0.0.1:3030/mcp',
          sourcePath: join(ownerDataDir, '.mcp.json'),
          exists: false,
        }),
      ])
      expect(JSON.stringify(discovered)).not.toContain('local-secret-token')

      const importRes = await firstApp.request('/api/mcp-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(discovered[0]),
      })
      expect(importRes.status).toBe(200)

      const rediscoverRes = await firstApp.request('/api/mcp-servers/discover')
      expect(rediscoverRes.status).toBe(200)
      const rediscovered = await rediscoverRes.json()
      expect(rediscovered[0]).toEqual(expect.objectContaining({
        name: 'Local Tools',
        exists: true,
      }))
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('tests and discovers running HTTP MCP servers', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url, init) => {
      const requestUrl = String(url)
      if (
        init?.method === 'POST' &&
        requestUrl === 'http://127.0.0.1:18081/mcp'
      ) {
        const body = JSON.parse(String(init.body ?? '{}')) as { id?: number }
        return Response.json({
          jsonrpc: '2.0',
          id: body.id ?? 1,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: {
              name: 'Runtime MCP',
              version: '1.0.0',
            },
            capabilities: {
              tools: {},
            },
          },
        })
      }
      return new Response('Not found', { status: 404 })
    }) as typeof fetch
    const dataDir = await mkdtemp(join(tmpdir(), 'cc-dashboard-mcp-active-'))

    try {
      const runtimeApp = createAgentWorkflowApp({
        defaultWorkspacePath: dataDir,
        currentUser: testOwner,
      })
      const endpoint = 'http://127.0.0.1:18081/mcp'
      const testRes = await runtimeApp.request('/api/mcp-servers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Runtime MCP',
          enabled: true,
          transport: 'http',
          scope: 'beegame',
          url: endpoint,
        }),
      })
      expect(testRes.status).toBe(200)
      expect(await testRes.json()).toEqual(expect.objectContaining({
        ok: true,
        status: 'available',
        endpoint,
        serverInfo: {
          name: 'Runtime MCP',
          version: '1.0.0',
        },
      }))

      const discoverRes = await runtimeApp.request(
        '/api/mcp-servers/discover-active?ports=18081',
      )
      expect(discoverRes.status).toBe(200)
      expect(await discoverRes.json()).toEqual([
        expect.objectContaining({
          name: 'Runtime MCP',
          transport: 'http',
          url: endpoint,
          endpoint,
          exists: false,
          test: expect.objectContaining({
            ok: true,
            status: 'available',
          }),
        }),
      ])
    } finally {
      globalThis.fetch = originalFetch
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('accepts MCP initialize responses delivered as event streams', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (url, init) => {
      const requestUrl = String(url)
      if (
        init?.method === 'POST' &&
        requestUrl === 'http://127.0.0.1:18082/mcp'
      ) {
        const body = JSON.parse(String(init.body ?? '{}')) as { id?: number }
        return new Response([
          'event: message',
          `data: ${JSON.stringify({
            jsonrpc: '2.0',
            id: body.id ?? 1,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: {
                name: 'Stream MCP',
                version: '2.0.0',
              },
              capabilities: {
                tools: {
                  listChanged: true,
                },
              },
            },
          })}`,
          '',
        ].join('\n'), {
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
            'mcp-session-id': 'test-session',
          },
        })
      }
      return new Response('Not found', { status: 404 })
    }) as typeof fetch
    const dataDir = await mkdtemp(join(tmpdir(), 'cc-dashboard-mcp-stream-'))

    try {
      const runtimeApp = createAgentWorkflowApp({
        defaultWorkspacePath: dataDir,
        currentUser: testOwner,
      })
      const endpoint = 'http://127.0.0.1:18082/mcp'
      const testRes = await runtimeApp.request('/api/mcp-servers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Stream MCP',
          enabled: true,
          transport: 'http',
          scope: 'beegame',
          url: endpoint,
        }),
      })

      expect(testRes.status).toBe(200)
      expect(await testRes.json()).toEqual(expect.objectContaining({
        ok: true,
        status: 'available',
        endpoint,
        serverInfo: {
          name: 'Stream MCP',
          version: '2.0.0',
        },
      }))
    } finally {
      globalThis.fetch = originalFetch
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('persists BeeGame project metadata across app instances in SQLite', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-project-store-'))

    try {
      const firstApp = createAgentWorkflowApp({
        defaultWorkspacePath: workspace,
        currentUser: testOwner,
      })
      const createRes = await firstApp.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'project_beegame_sqlite',
          name: 'SQLite Project',
          root_path: join(workspace, 'sqlite-project'),
          created_at: 1710000000000,
          runtime_snapshot: {
            usage: {
              prompt_tokens: 120,
              completion_tokens: 34,
              total_tokens: 154,
            },
            phase_name: 'implementation',
            model_config_id: 'model-balanced',
            model_name: 'balanced-model',
            updated_at: 1710000001000,
          },
        }),
      })
      expect(createRes.status).toBe(200)

      const secondApp = createAgentWorkflowApp({
        defaultWorkspacePath: workspace,
        currentUser: testOwner,
      })
      const listRes = await secondApp.request('/api/projects')

      expect(listRes.status).toBe(200)
      expect(await listRes.json()).toEqual([
        {
          id: 'project_beegame_sqlite',
          name: 'SQLite Project',
          root_path: join(workspace, 'sqlite-project'),
          created_at: 1710000000000,
          runtime_snapshot: {
            usage: {
              prompt_tokens: 120,
              completion_tokens: 34,
              total_tokens: 154,
            },
            phase_name: 'implementation',
            model_config_id: 'model-balanced',
            model_name: 'balanced-model',
            updated_at: 1710000001000,
          },
        },
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rejects BeeGame intake before reserving credits when no model config exists', async () => {
    const ledgerBeforeRes = await app.request('/api/credits/ledger')
    const ledgerBefore = await ledgerBeforeRes.json()
    const res = await app.request('/api/beegame-intake/options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idea: 'LLM generated idea', language: 'zh' }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'No model config found. Configure a default model before generating.',
    })
    const ledgerAfterRes = await app.request('/api/credits/ledger')
    expect(await ledgerAfterRes.json()).toEqual(ledgerBefore)
  })

  test('analyzes BeeGame intake and returns game-mode options from the default model config', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    const fetchCalls: Array<{ url: string; body: unknown }> = []
    globalThis.fetch = (async (url, init) => {
      fetchCalls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? '{}')),
      })
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                maturity: 'vague',
                needs_options: true,
                needs_clarification: false,
                detected_constraints: ['browser playable demo'],
                recommended_next_step: 'choose_direction',
                options: [
                  {
                    id: 'llm_mode',
                    title: 'LLM Mode',
                    pitch: 'LLM generated pitch.',
                    coreGameplayHypothesis: 'LLM generated hypothesis.',
                    experienceSnapshot: 'LLM generated snapshot.',
                    playerFirstMinute: 'LLM generated first minute.',
                    whyFitsIdea: 'LLM generated fit.',
                    playablePrototype: 'LLM generated playable build.',
                    validationTarget: 'LLM generated validation target.',
                    coreMechanic: 'LLM generated core mechanic.',
                    firstBuild: 'LLM generated first build.',
                    validationGoal: 'LLM generated validation goal.',
                    risk: 'LLM generated risk.',
                    fit: 'LLM generated fit.',
                    firstPlayableValidation: 'LLM generated validation.',
                    riskComplexity: 'LLM generated complexity.',
                    gameplay: 'LLM generated gameplay rules.',
                    recommendedPlatform: 'Web',
                    recommendedEngine: 'React',
                    recommendedDimension: '2D',
                    recommendedGenre: 'Strategy',
                    recommendedStyle: 'Pixel',
                    recommendedInputs: ['Keyboard/mouse'],
                    scope: 'Playable demo',
                  },
                  {
                    id: 'mode_two',
                    title: 'Mode Two',
                    gameplay: 'Second playable mode.',
                    recommendedPlatform: 'Web',
                    recommendedEngine: 'React',
                    recommendedDimension: '2D',
                    recommendedGenre: 'Action',
                    recommendedStyle: 'Minimal',
                    recommendedInputs: ['Keyboard/mouse'],
                    scope: 'Playable demo',
                  },
                  {
                    id: 'mode_three',
                    title: 'Mode Three',
                    gameplay: 'Third playable mode.',
                    recommendedPlatform: 'Web',
                    recommendedEngine: 'React',
                    recommendedDimension: '2D',
                    recommendedGenre: 'Action',
                    recommendedStyle: 'Minimal',
                    recommendedInputs: ['Keyboard/mouse'],
                    scope: 'Playable demo',
                  },
                  { id: 'mode_four', title: 'Mode Four', gameplay: 'Fourth playable mode.' },
                ],
              }),
            },
          },
        ],
      })
    }) as typeof fetch

    try {
      const ledgerBeforeRes = await app.request('/api/credits/ledger')
      const ledgerBefore = await ledgerBeforeRes.json()
      const res = await app.request('/api/beegame-intake/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea', language: 'zh' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake).toEqual(expect.objectContaining({
        maturity: 'vague',
        needsOptions: true,
        needsClarification: false,
        clarificationQuestions: [],
        detectedConstraints: ['browser playable demo'],
        recommendedNextStep: 'choose_direction',
      }))
      expect(intake.options).toHaveLength(3)
      expect(intake.options.map((option: { id: string }) => option.id)).toEqual([
        'llm_mode',
        'mode_two',
        'mode_three',
      ])
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'llm_mode',
        title: 'LLM Mode',
        coreGameplayHypothesis: 'LLM generated hypothesis.',
        playerFirstMinute: 'LLM generated first minute.',
        whyFitsIdea: 'LLM generated fit.',
        playablePrototype: 'LLM generated playable build.',
        validationTarget: 'LLM generated validation target.',
        fit: 'LLM generated fit.',
        firstPlayableValidation: 'LLM generated validation.',
        riskComplexity: 'LLM generated complexity.',
        recommendedPlatform: 'Web',
      }))
      const ledgerAfterRes = await app.request('/api/credits/ledger')
      const ledgerAfter = await ledgerAfterRes.json()
      expect(ledgerAfter.slice(ledgerBefore.length).map((entry: {
        kind: string
        credits: number
      }) => ({
        kind: entry.kind,
        credits: entry.credits,
      }))).toEqual([
        { kind: 'reserve', credits: 3 },
        { kind: 'settle', credits: 3 },
      ])
      expect(fetchCalls[0]?.url).toBe('https://llm.example.invalid/v1/chat/completions')
      expect(fetchCalls[0]?.body).toEqual(expect.objectContaining({
        model: 'balanced-model',
        response_format: { type: 'json_object' },
      }))
      const requestBody = fetchCalls[0]?.body as { messages?: Array<{ role: string; content: string }> }
      const systemPrompt = requestBody.messages?.find(message => message.role === 'system')?.content || ''
      expect(systemPrompt).toContain('understand the game request before proposing game modes')
      expect(systemPrompt).toContain('title must be a game mode name')
      expect(systemPrompt).toContain('gameplay must explain the playable rules')
      expect(systemPrompt).toContain('coreGameplayHypothesis')
      expect(systemPrompt).toContain('whyFitsIdea')
      expect(systemPrompt).toContain('playablePrototype')
      expect(systemPrompt).toContain('validationTarget')
      expect(systemPrompt).toContain('game mode')
      expect(systemPrompt).toContain('target briefs')
      expect(systemPrompt).toContain('not full design documents')
      expect(systemPrompt).toContain('Do not write full GDD')
      expect(systemPrompt).toContain('Do not output internal rubric names')
      expect(systemPrompt).toContain('maturity')
      expect(systemPrompt).toContain('needs_options')
      expect(systemPrompt).toContain('At least one option must stay faithful to the original idea')
      expect(systemPrompt).toContain('not from a fixed menu')
      expect(systemPrompt).toContain('do not force a specific platform')
      expect(systemPrompt).toContain('Do not output Auto or placeholder values for recommended metadata')
      expect(systemPrompt).toContain('Use this selected UI language for every user-facing natural-language JSON value: zh')
      expect(systemPrompt).toContain('Keep JSON property names in English')
      expect(systemPrompt).not.toContain('prototype title')
      expect(systemPrompt).not.toContain('playable prototype name')
      expect(systemPrompt).not.toContain('Core Loop')
      expect(systemPrompt).not.toContain('Fun Hook')
      expect(systemPrompt).not.toContain('Risk/Reward')
      expect(systemPrompt).not.toContain('First 3 Minutes')
      expect(systemPrompt).not.toContain('MVP Acceptance')
      expect(systemPrompt).not.toContain('FPS')
      expect(systemPrompt).not.toContain('2D Arcade')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('analyzes BeeGame intake from streamed model deltas', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Streaming LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const modelContent = JSON.stringify({
      maturity: 'concrete',
      needs_options: false,
      needs_clarification: false,
      detected_constraints: ['streamed model response'],
      recommended_next_step: 'configure_details',
      options: [
        {
          id: 'streamed_mode',
          title: 'Streamed Mode',
          gameplay: 'The player completes streamed gameplay rules.',
          risk: 'The main risk is validating the streamed flow.',
          fit: 'This mode fits the streamed idea.',
          recommendedPlatform: 'Web',
          recommendedEngine: 'React',
          recommendedDimension: '2D',
          recommendedGenre: 'Action',
          recommendedStyle: 'Minimal',
          recommendedInputs: ['Keyboard/mouse'],
          scope: 'Playable demo',
        },
      ],
    })
    const streamBody = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: modelContent.slice(0, 80) } }] })}`,
      '',
      `data: ${JSON.stringify({ choices: [{ delta: { content: modelContent.slice(80) } }] })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n')

    const originalFetch = globalThis.fetch
    const originalDebug = process.env.BEEGAME_INTAKE_STREAM_DEBUG
    const originalLogPath = process.env.BEEGAME_INTAKE_STREAM_LOG_PATH
    const streamLogPath = join(testRoot, 'intake-stream-debug.jsonl')
    const fetchCalls: Array<{ body: unknown }> = []
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        body: JSON.parse(String(init?.body ?? '{}')),
      })
      return new Response(streamBody, {
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as unknown as typeof fetch

    try {
      process.env.BEEGAME_INTAKE_STREAM_DEBUG = '1'
      process.env.BEEGAME_INTAKE_STREAM_LOG_PATH = streamLogPath
      const res = await app.request('/api/beegame-intake/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea', language: 'zh' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(fetchCalls[0]?.body).toEqual(expect.objectContaining({
        model: 'balanced-model',
        response_format: { type: 'json_object' },
        stream: true,
      }))
      expect(intake).toEqual(expect.objectContaining({
        maturity: 'concrete',
        needsOptions: false,
        needsClarification: false,
        detectedConstraints: ['streamed model response'],
        recommendedNextStep: 'configure_details',
      }))
      expect(intake.options).toHaveLength(1)
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'streamed_mode',
        title: 'Streamed Mode',
        gameplay: 'The player completes streamed gameplay rules.',
      }))
      const streamLog = await readFile(streamLogPath, 'utf8')
      expect(streamLog).toContain('"event":"raw_chunk"')
      expect(streamLog).toContain('"event":"content_delta"')
      expect(streamLog).toContain('"event":"complete"')
      expect(streamLog).toContain('Streamed Mode')
    } finally {
      globalThis.fetch = originalFetch
      if (originalDebug === undefined) {
        delete process.env.BEEGAME_INTAKE_STREAM_DEBUG
      } else {
        process.env.BEEGAME_INTAKE_STREAM_DEBUG = originalDebug
      }
      if (originalLogPath === undefined) {
        delete process.env.BEEGAME_INTAKE_STREAM_LOG_PATH
      } else {
        process.env.BEEGAME_INTAKE_STREAM_LOG_PATH = originalLogPath
      }
    }
  })


  test('creates a BeeGame intake job and returns the completed result through polling', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Async LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    let resolveModel: ((response: Response) => void) | undefined
    globalThis.fetch = (async () => new Promise<Response>(resolve => {
      resolveModel = resolve
    })) as unknown as typeof fetch

    try {
      const jobRes = await app.request('/api/beegame-intake/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea', language: 'zh' }),
      })

      expect(jobRes.status).toBe(202)
      const created = await jobRes.json() as { jobId: string; status: string }
      expect(created.jobId).toStartWith('intake_')
      expect(created.status).toBe('running')

      const runningRes = await app.request(`/api/beegame-intake/jobs/${created.jobId}`)
      expect(runningRes.status).toBe(200)
      expect(await runningRes.json()).toEqual({ status: 'running' })

      resolveModel?.(Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                maturity: 'directional',
                needs_options: true,
                needs_clarification: false,
                detected_constraints: [],
                recommended_next_step: 'choose_direction',
                options: makeModelOptions('async_mode', {
                  title: 'Async Mode',
                  pitch: 'Async generated pitch.',
                  gameplay: 'Async generated gameplay rules.',
                }),
              }),
            },
          },
        ],
      }))

      let completed: unknown
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const pollRes = await app.request(`/api/beegame-intake/jobs/${created.jobId}`)
        expect(pollRes.status).toBe(200)
        completed = await pollRes.json()
        if ((completed as { status?: string }).status === 'completed') break
        await new Promise(resolve => setTimeout(resolve, 0))
      }

      expect(completed).toEqual(expect.objectContaining({
        status: 'completed',
        result: expect.objectContaining({
          maturity: 'directional',
          needsOptions: true,
        }),
      }))
      expect((completed as { result?: { options?: Array<{ id: string; title: string }> } }).result?.options).toHaveLength(3)
      expect((completed as { result?: { options?: Array<{ id: string; title: string }> } }).result?.options?.[0]).toEqual(
        expect.objectContaining({ id: 'async_mode', title: 'Async Mode' }),
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('refunds BeeGame intake credits and explains provider authentication failures', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Rejected LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-rejected-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      Response.json({ error: { message: 'invalid api key' } }, { status: 401 })
    ) as unknown as typeof fetch

    try {
      const ledgerBeforeRes = await app.request('/api/credits/ledger')
      const ledgerBefore = await ledgerBeforeRes.json()
      const res = await app.request('/api/beegame-intake/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea', language: 'zh' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('平台默认模型认证失败（401）')
      expect(body.error).toContain('重新保存有效 API Key')
      const ledgerAfterRes = await app.request('/api/credits/ledger')
      const ledgerAfter = await ledgerAfterRes.json()
      expect(ledgerAfter.slice(ledgerBefore.length).map((entry: {
        kind: string
        credits: number
      }) => ({
        kind: entry.kind,
        credits: entry.credits,
      }))).toEqual([
        { kind: 'reserve', credits: 3 },
        { kind: 'refund', credits: 3 },
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('loads Supabase runtime env from frontend env names during BeeGame intake', async () => {
    const originalEnv = {
      BEEGAME_SUPABASE_URL: process.env.BEEGAME_SUPABASE_URL,
      SUPABASE_URL: process.env.SUPABASE_URL,
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
      BEEGAME_SUPABASE_ANON_KEY: process.env.BEEGAME_SUPABASE_ANON_KEY,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    }
    const originalFetch = globalThis.fetch
    const calls: Array<{ url: string; body: unknown }> = []
    const userId = '00000000-0000-0000-0000-000000000001'
    try {
      delete process.env.BEEGAME_SUPABASE_URL
      delete process.env.SUPABASE_URL
      delete process.env.BEEGAME_SUPABASE_ANON_KEY
      delete process.env.SUPABASE_ANON_KEY
      process.env.VITE_SUPABASE_URL = 'https://vite-project.supabase.co'
      process.env.VITE_SUPABASE_ANON_KEY = 'vite-anon-key'

      globalThis.fetch = (async (url, init) => {
        const requestUrl = String(url)
        const requestBody = JSON.parse(String(init?.body ?? '{}')) as unknown
        calls.push({ url: requestUrl, body: requestBody })

        if (requestUrl.includes('/beegame_credit_accounts')) {
          return Response.json([{
            user_id: userId,
            plan: 'free',
            included_credits: 300,
            consumed_credits: 0,
            reserved_credits: 0,
            updated_at: '2026-06-30T00:00:00.000Z',
          }])
        }
        if (requestUrl.includes('/beegame_model_configs')) {
          return Response.json([{
            id: 'llm_platform_default',
            owner_id: 'platform-owner',
            name: 'Platform Default',
            provider: 'openai-compatible',
            base_url: 'https://llm.example.invalid/v1',
            api_key_ciphertext: 'sk-secret',
            models: { balanced: 'balanced-model' },
            is_default: true,
            created_at: '2026-06-30T00:00:00.000Z',
            updated_at: '2026-06-30T00:00:00.000Z',
          }])
        }
        if (requestUrl.includes('/rpc/beegame_reserve_credits')) {
          return Response.json({
            reservation_id: 'reserve_1',
            reserved_credits: 3,
            account: {
              user_id: userId,
              plan: 'free',
              included_credits: 300,
              consumed_credits: 0,
              reserved_credits: 3,
              updated_at: '2026-06-30T00:00:00.000Z',
            },
          })
        }
        if (requestUrl.includes('/rpc/beegame_runtime_env')) {
          return Response.json({
            CLAUDE_CODE_USE_OPENAI: '1',
            OPENAI_BASE_URL: 'https://llm.example.invalid/v1',
            OPENAI_API_KEY: 'sk-secret',
            OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
          })
        }
        if (requestUrl.includes('/rpc/beegame_settle_credit_reservation')) {
          return Response.json({
            reservation_id: 'reserve_1',
            reserved_credits: 3,
            settled_credits: 3,
            refunded_credits: 0,
            account: {
              user_id: userId,
              plan: 'free',
              included_credits: 300,
              consumed_credits: 3,
              reserved_credits: 0,
              updated_at: '2026-06-30T00:00:00.000Z',
            },
          })
        }
        return Response.json({
          choices: [{
            message: {
              content: JSON.stringify({
                maturity: 'vague',
                needs_options: true,
                needs_clarification: false,
                detected_constraints: [],
                recommended_next_step: 'choose_direction',
	                options: makeModelOptions('mode_one'),
              }),
            },
          }],
        })
      }) as typeof fetch

      const supabaseApp = createAgentWorkflowApp({
        defaultWorkspacePath: testRoot,
        currentUserResolver: request => {
          if (request.headers.get('authorization') !== 'Bearer user-token') {
            return undefined
          }
          return {
            id: userId,
            role: 'developer',
            permissions: ['project.create'],
          }
        },
      })
      const res = await supabaseApp.request('/api/beegame-intake/options', {
        method: 'POST',
        headers: {
          authorization: 'Bearer user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ idea: 'LLM generated idea', language: 'zh' }),
      })

      expect(res.status).toBe(200)
      expect(calls.some(call =>
        call.url === 'https://vite-project.supabase.co/rest/v1/rpc/beegame_runtime_env'
      )).toBe(true)
      expect(calls.some(call =>
        call.url === 'https://llm.example.invalid/v1/chat/completions'
      )).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })

  test('rejects intake responses that ask for clarification instead of returning options', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              maturity: 'vague',
              needs_options: false,
              needs_clarification: true,
              clarification: {
                prompt: 'Which interpretation should BeeGame use?',
                options: [
                  { id: 'direction_a', label: 'Direction A', description: 'Use direction A.' },
                  { id: 'direction_b', label: 'Direction B', value: 'Use direction B.' },
                ],
                freeform_label: 'Add detail',
              },
              clarification_questions: [],
              detected_constraints: [],
              recommended_next_step: 'clarify',
              options: [],
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'idea requiring clarification' }),
      })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: expect.stringContaining('Model intake response did not include valid options'),
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('rejects broad intake responses that return fewer than three options', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              maturity: 'vague',
              needs_options: true,
              needs_clarification: false,
              clarification: '',
              clarification_questions: [],
              detected_constraints: ['broad request'],
              recommended_next_step: 'choose_direction',
              options: makeModelOptions('mode_one').slice(0, 2),
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'broad game idea' }),
      })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: expect.stringContaining('Expected 3, received 2'),
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('rejects clarification choices because they do not contain production metadata', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              maturity: 'vague',
              needs_options: true,
              needs_clarification: true,
              clarification: 'Which direction should the first playable focus on?',
              clarification_questions: [
                {
                  prompt: 'Which direction should the first playable focus on?',
                  options: [
                    {
                      id: 'core_loop',
                      label: 'Core Loop',
                      description: 'Focus on the primary repeated action.',
                      value: 'core_loop',
                    },
                    {
                      id: 'exploration',
                      label: 'Exploration',
                      description: 'Focus on discovery and navigation.',
                      value: 'exploration',
                    },
                    {
                      id: 'challenge',
                      label: 'Challenge',
                      description: 'Focus on difficulty and pressure.',
                      value: 'challenge',
                    },
                  ],
                  freeform_label: 'Describe another direction',
                },
              ],
              detected_constraints: ['broad request'],
              recommended_next_step: 'clarify',
              options: [],
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'broad game idea' }),
      })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: expect.stringContaining('recommendedPlatform'),
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('accepts minimal LLM game-mode options and derives internal brief fields', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              maturity: 'directional',
              needs_options: true,
              needs_clarification: false,
              recommended_next_step: 'choose_direction',
              options: makeModelOptions('llm_minimal_mode', {
                title: 'LLM Minimal Mode',
                gameplay: 'LLM generated playable rules.',
                recommended_platform: 'Web',
                recommended_dimension: '2D',
                recommended_genre: 'Action',
                recommended_style: 'Minimal',
                recommended_inputs: ['Keyboard/mouse'],
                scope: 'Playable demo',
              }),
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'llm_minimal_mode',
        title: 'LLM Minimal Mode',
        gameplay: 'LLM generated playable rules.',
        pitch: 'LLM generated playable rules.',
        coreGameplayHypothesis: 'LLM generated playable rules.',
        playablePrototype: 'LLM generated playable rules.',
        recommendedPlatform: 'Web',
        recommendedDimension: '2D',
        recommendedGenre: 'Action',
        recommendedStyle: 'Minimal',
        recommendedInputs: ['Keyboard/mouse'],
      }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('passes selected BeeGame intake thinking mode into the model request', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    let modelRequestBody: Record<string, unknown> = {}
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      modelRequestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                maturity: 'directional',
                needs_options: true,
                needs_clarification: false,
                recommended_next_step: 'choose_direction',
                options: makeModelOptions('llm_thinking_mode', {
                  title: 'LLM Thinking Mode',
                  gameplay: 'LLM generated playable rules.',
                  recommended_platform: 'Web',
                  recommended_dimension: '2D',
                  recommended_genre: 'Action',
                  recommended_style: 'Minimal',
                  recommended_inputs: ['Keyboard/mouse'],
                  scope: 'Playable demo',
                }),
              }),
            },
          },
        ],
      })
    }) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea', thinkingMode: 'disabled' }),
      })

      expect(res.status).toBe(200)
      expect(modelRequestBody).toEqual(expect.objectContaining({
        stream: true,
        enable_thinking: false,
      }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('accepts OpenAI-compatible content arrays for intake options', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => Response.json({
      choices: [
        {
          message: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  maturity: 'directional',
                  needs_options: true,
                  needs_clarification: false,
                  recommended_next_step: 'choose_direction',
                  options: makeModelOptions('llm_content_array_mode', {
                    title: 'LLM Content Array Mode',
                    gameplay: 'LLM generated playable rules from content array.',
                    recommended_platform: 'Web',
                    recommended_dimension: '2D',
                    recommended_genre: 'Action',
                    recommended_style: 'Minimal',
                    recommended_inputs: ['Keyboard/mouse'],
                    scope: 'Playable demo',
                  }),
                }),
              },
            ],
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'llm_content_array_mode',
        title: 'LLM Content Array Mode',
        gameplay: 'LLM generated playable rules from content array.',
      }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('accepts LLM metadata strings or arrays without dropping valid game modes', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              options: [
                {
                  id: 'llm_array_metadata_mode',
                  title: 'LLM Array Metadata Mode',
                  gameplay: 'LLM generated playable rules with array metadata.',
                  recommendedPlatform: ['PC', 'Mobile'],
                  recommendedDimension: '2.5D',
                  recommendedGenre: 'STG',
                  recommendedStyle: 'Vector',
                  recommendedInputs: ['Keyboard/mouse', 'Touch'],
                  scope: 'Playable demo',
                },
              ],
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'llm_array_metadata_mode',
        recommendedPlatform: 'PC, Mobile',
        recommendedDimension: '2.5D',
        recommendedGenre: 'STG',
        recommendedStyle: 'Vector',
        recommendedInputs: ['Keyboard/mouse', 'Touch'],
      }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('rejects intake options when recommended inputs are omitted', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              maturity: 'directional',
              needs_options: true,
              options: makeModelOptions('llm_no_inputs_mode', {
                title: 'LLM No Inputs Mode',
                gameplay: 'LLM generated playable rules without input metadata.',
              }).map(option => ({
                ...option,
                recommendedInputs: [],
              })),
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea' }),
      })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: expect.stringContaining('recommendedInputs'),
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('accepts a single selected input value from model metadata', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              maturity: 'directional',
              needs_options: true,
              options: makeModelOptions('single_input_mode', {
                title: 'Single Input Mode',
                gameplay: 'LLM generated playable rules with one selected input.',
                recommendedInputs: 'Keyboard/mouse',
              }),
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'single_input_mode',
        recommendedInputs: ['Keyboard/mouse'],
      }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('extracts the first complete JSON object from prose-wrapped model output', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const modelJson = JSON.stringify({
      maturity: 'directional',
      needs_options: true,
      options: makeModelOptions('llm_wrapped_mode', {
        title: 'LLM Wrapped Mode',
        gameplay: 'LLM generated playable rules from wrapped output.',
        recommendedPlatform: 'Web',
        recommendedDimension: '2D',
        recommendedGenre: 'Action',
        recommendedStyle: 'Minimal',
        scope: 'Playable demo',
      }),
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => Response.json({
      choices: [
        {
          message: {
            content: `这里是模型的说明：\n${modelJson}\n补充说明里的 {中文内容} 不应该进入 JSON 解析。`,
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'llm_wrapped_mode',
        title: 'LLM Wrapped Mode',
      }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('accepts game-mode options with only title and gameplay', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              options: [
                {
                  title: 'LLM Lean Mode',
                  gameplay: 'LLM generated playable rules without metadata.',
                },
              ],
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/options', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'mode_1',
        title: 'LLM Lean Mode',
        gameplay: 'LLM generated playable rules without metadata.',
        recommendedPlatform: '',
        recommendedDimension: '',
        recommendedGenre: '',
        recommendedStyle: '',
        recommendedInputs: [],
        scope: '',
      }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
