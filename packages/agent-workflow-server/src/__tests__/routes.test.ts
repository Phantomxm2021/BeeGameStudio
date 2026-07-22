import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetAgentWorkflow } from '@bee-game-studio/agent-workflow'
import type { AgentWorkflowAppOptions } from '../app'
import { createAgentWorkflowApp } from '../app'
import { recordNativeAcceptanceReportForTest } from '../beegame/native-acceptance-evidence'
import { recordNativeDocumentReviewForTest } from '../beegame/native-document-review-evidence'
import { recordNativeImplementationAuditReportForTest } from '../beegame/native-implementation-audit-evidence'
import type {
  BeeGameModelRuntimeHost,
} from '../beegame/model-runtime-host'
import {
  getCreditBalance,
  reserveCredits,
  settleCreditReservation,
} from '../credit-store'

describe('agent workflow server routes', () => {
  const testOwner = { id: 'owner-user', role: 'owner' } as const
  const originalEncryptionKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  let testRoot = ''
  let app: ReturnType<typeof createAgentWorkflowApp>

  const createTestModelRuntimeHost = (): BeeGameModelRuntimeHost => ({
    async generate(input) {
      const baseUrl = input.runtimeEnv.OPENAI_BASE_URL ??
        input.runtimeEnv.ANTHROPIC_BASE_URL
      const apiKey = input.runtimeEnv.OPENAI_API_KEY ??
        input.runtimeEnv.ANTHROPIC_AUTH_TOKEN
      const model = input.runtimeEnv.OPENAI_DEFAULT_SONNET_MODEL ??
        input.runtimeEnv.ANTHROPIC_DEFAULT_SONNET_MODEL
      if (!baseUrl || !apiKey || !model) {
        throw new Error('Test model runtime is incomplete')
      }
      const anthropic = Boolean(input.runtimeEnv.ANTHROPIC_BASE_URL)
      const response = await globalThis.fetch(
        `${baseUrl.replace(/\/$/, '')}${anthropic ? '/v1/messages' : '/chat/completions'}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
            ...(anthropic ? { 'anthropic-version': '2023-06-01' } : {}),
          },
          body: JSON.stringify(anthropic
            ? {
                model,
                system: input.systemPrompt,
                messages: input.messages,
                max_tokens: input.maxTokens,
                temperature: input.temperature,
              }
            : {
                model,
                messages: [
                  { role: 'system', content: input.systemPrompt },
                  ...input.messages,
                ],
                max_tokens: input.maxTokens,
                temperature: input.temperature,
                response_format: { type: 'json_object' },
                stream: false,
                thinking: { type: 'disabled' },
                enable_thinking: false,
              }),
        },
      )
      if (!response.ok) throw new Error(`Model runtime request failed: ${response.status}`)
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const text = await response.text()
        return text
          .split('\n')
          .filter(line => line.startsWith('data:') && !line.includes('[DONE]'))
          .flatMap(line => {
            const event = JSON.parse(line.slice(5).trim()) as {
              choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>
            }
            return event.choices?.map(choice =>
              choice.delta?.content ?? choice.message?.content ?? '',
            ) ?? []
          })
          .join('')
      }
      const payload = await response.json() as {
        content?: Array<{ type?: string; text?: string }>
        choices?: Array<{ message?: { content?: string } }>
      }
      return anthropic
        ? payload.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('') ?? ''
        : payload.choices?.[0]?.message?.content ?? ''
    },
  })

  const loopbackOutboundTargetResolver: NonNullable<AgentWorkflowAppOptions['outboundTargetResolver']> = async value => ({
    url: new URL(value),
    addresses: ['127.0.0.1'],
    lookup: (_hostname, _options, callback) => callback(null, '127.0.0.1', 4),
  })

  beforeEach(async () => {
    resetAgentWorkflow()
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 41).toString('base64')
    testRoot = await mkdtemp(join(tmpdir(), 'beegame-routes-'))
    app = createAgentWorkflowApp({
      defaultWorkspacePath: testRoot,
      currentUser: testOwner,
      modelRuntimeHost: createTestModelRuntimeHost(),
      skillsConfig: false,
      outboundTargetPolicyOptions: {
        resolve4: async () => ['93.184.216.34'],
        resolve6: async () => ['2606:2800:220:1:248:1893:25c8:1946'],
      },
    })
  })

  afterEach(async () => {
    if (originalEncryptionKey === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = originalEncryptionKey
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

  const requestBeeGameIntake = async (
    targetApp: ReturnType<typeof createAgentWorkflowApp>,
    init: RequestInit,
  ): Promise<Response> => {
    const createdResponse = await targetApp.request('/api/beegame-intake/jobs', init)
    if (createdResponse.status !== 202) return createdResponse

    const created = await createdResponse.json() as { jobId: string }
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await targetApp.request(`/api/beegame-intake/jobs/${created.jobId}`, {
        headers: init.headers,
      })
      if (!response.ok) return response
      const job = await response.json() as {
        status: 'running' | 'completed' | 'failed'
        result?: unknown
        error?: string
        errorStatus?: number
      }
      if (job.status === 'completed') return Response.json(job.result)
      if (job.status === 'failed') {
        return Response.json({ error: job.error || 'Intake job failed' }, {
          status: job.errorStatus ?? 400,
        })
      }
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    return Response.json({ error: 'Intake job did not reach a terminal state' }, { status: 504 })
  }

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

  test('resolves the default model server-side when a session is created', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Session default LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    const created = await createRes.json() as { id: string }

    const sessionRes = await app.request('/api/beegame-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspacePath: join(testRoot, 'session-default') }),
    })

    expect(sessionRes.status).toBe(200)
    expect(await sessionRes.json()).toEqual(expect.objectContaining({
      modelConfigId: created.id,
    }))
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
        'skills.manage',
      ],
    })
  })

  test('denies privileged routes before repository or audit access', async () => {
    const cases = [
      ['/api/model-configs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, ['owner']],
      ['/api/web-tools', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' }, ['owner']],
      ['/api/runtime-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' }, ['owner']],
      ['/api/mcp-servers', undefined, ['owner']],
      ['/api/admin/credits/ledger', undefined, ['owner']],
      ['/api/admin/projects/lifecycle', undefined, ['owner']],
      ['/api/projects/missing-project', { method: 'DELETE' }, ['viewer', 'developer', 'owner']],
      ['/api/beegame-sessions/missing-session/package', undefined, ['viewer', 'developer', 'owner']],
      ['/api/projects/missing-project/assets/missing-slot/upload', { method: 'POST' }, ['developer', 'owner']],
    ] as const

    for (const [path, init, allowedRoles] of cases) {
      for (const role of ['viewer', 'developer', 'owner'] as const) {
        const root = await mkdtemp(join(tmpdir(), `beegame-permission-${role}-`))
        try {
          const routeApp = createAgentWorkflowApp({
            defaultWorkspacePath: root,
            currentUser: { id: `${role}-user`, role },
            skillsConfig: false,
          })
          const response = await routeApp.request(path, init)
          if ((allowedRoles as readonly string[]).includes(role)) {
            expect(response.status, `${path}/${role}`).not.toBe(403)
          } else {
            expect(response.status, `${path}/${role}`).toBe(403)
            expect(await response.json()).toEqual({ error: 'Forbidden' })
            expect(await readdir(root)).toEqual([])
          }
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      }
    }
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

  test('does not expose internal session request errors', async () => {
    const response = await app.request('/api/beegame-sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: 'Request failed', traceId: expect.any(String) })
    expect(JSON.stringify(body)).not.toContain('Unexpected end of JSON input')
  })

  test('does not expose internal account deletion errors', async () => {
    const response = await createAgentWorkflowApp({
      currentUser: { id: 'account-error-user', role: 'owner' },
    }).request('/api/current-user', { method: 'DELETE' })

    expect(response.status).toBe(501)
    const body = await response.json()
    expect(body.error).toBe('Account deletion unavailable')
    expect(body.traceId).toEqual(expect.any(String))
    expect(JSON.stringify(body)).not.toContain('Account deletion requires Supabase RPC')
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

  test('reconciles stale credit reservations for the current user', async () => {
    const dataDir = join(testRoot, 'users', 'owner-user')
    const staleReservation = reserveCredits('owner-user', {
      dataDir,
      credits: 6,
      kind: 'edit_turn',
      projectId: 'project-a',
      now: new Date('2026-07-08T08:00:00.000Z'),
    })
    reserveCredits('owner-user', {
      dataDir,
      credits: 4,
      kind: 'edit_turn',
      projectId: 'project-a',
      now: new Date('2026-07-08T10:00:00.000Z'),
    })

    const res = await app.request('/api/credits/reconcile-stale-reservations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        olderThan: '2026-07-08T09:00:00.000Z',
        projectId: 'project-a',
      }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      expiredReservations: [staleReservation.id],
      refundedCredits: 6,
      balance: expect.objectContaining({
        reservedCredits: 4,
        balanceCredits: 296,
      }),
    })
    expect(getCreditBalance('owner-user', { dataDir })).toEqual(expect.objectContaining({
      reservedCredits: 4,
      balanceCredits: 296,
    }))
  })

  test('exposes permission-gated credit audit ledger details', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-credit-audit-'))
    try {
      const authApp = createAgentWorkflowApp({
        defaultWorkspacePath: projectsRoot,
        currentUserResolver: request => {
          const header = request.headers.get('authorization')
          if (header === 'Bearer owner-token') return { id: 'owner-user', role: 'owner' }
          if (header === 'Bearer developer-token') return { id: 'developer-user', role: 'developer' }
          return undefined
        },
      })
      const ownerADataDir = join(projectsRoot, 'users', 'owner-a')
      const ownerBDataDir = join(projectsRoot, 'users', 'owner-b')
      const ownerAReservation = reserveCredits('owner-a', {
        dataDir: ownerADataDir,
        credits: 5,
        kind: 'edit_turn',
        projectId: 'project-a',
        metadata: { taskType: 'edit_turn', phase: 'build' },
      })
      settleCreditReservation('owner-a', {
        dataDir: ownerADataDir,
        reservationId: ownerAReservation.id,
        weightedTokens: 12_000,
        projectId: 'project-a',
        metadata: { taskType: 'edit_turn', phase: 'build' },
      })
      reserveCredits('owner-b', {
        dataDir: ownerBDataDir,
        credits: 3,
        kind: 'idea_intake',
        projectId: 'project-b',
        metadata: { taskType: 'idea_intake', phase: 'intake' },
      })

      const forbiddenRes = await authApp.request('/api/admin/credits/ledger', {
        headers: { authorization: 'Bearer developer-token' },
      })
      expect(forbiddenRes.status).toBe(403)

      const allRes = await authApp.request('/api/admin/credits/ledger', {
        headers: { authorization: 'Bearer owner-token' },
      })
      expect(allRes.status).toBe(200)
      const allLedger = await allRes.json()
      expect(allLedger.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          userId: 'owner-a',
          kind: 'reserve',
          credits: 5,
          projectId: 'project-a',
          reservationId: ownerAReservation.id,
          metadata: expect.objectContaining({ taskType: 'edit_turn', phase: 'build' }),
        }),
        expect.objectContaining({
          userId: 'owner-a',
          kind: 'settle',
          credits: 2,
          weightedTokens: 12_000,
          projectId: 'project-a',
          reservationId: ownerAReservation.id,
        }),
        expect.objectContaining({
          userId: 'owner-a',
          kind: 'refund',
          credits: 3,
          projectId: 'project-a',
          reservationId: ownerAReservation.id,
        }),
        expect.objectContaining({
          userId: 'owner-b',
          kind: 'reserve',
          credits: 3,
          projectId: 'project-b',
        }),
      ]))
      expect(allLedger.entries).toHaveLength(4)
      expect(allLedger.summary).toEqual({
        entriesCount: 4,
        reservedCredits: 8,
        settledCredits: 2,
        refundedCredits: 3,
        outstandingReservedCredits: 3,
        weightedTokens: 12_000,
      })

      const filteredRes = await authApp.request('/api/admin/credits/ledger?userId=owner-a&kind=settle', {
        headers: { authorization: 'Bearer owner-token' },
      })
      expect(filteredRes.status).toBe(200)
      expect(await filteredRes.json()).toEqual({
        entries: [
          expect.objectContaining({
            userId: 'owner-a',
            kind: 'settle',
            credits: 2,
            reservationId: ownerAReservation.id,
          }),
        ],
        summary: {
          entriesCount: 1,
          reservedCredits: 0,
          settledCredits: 2,
          refundedCredits: 0,
          outstandingReservedCredits: 0,
          weightedTokens: 12_000,
        },
      })
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('grants credits through a permission-gated provider-neutral admin route', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-credit-grant-'))
    try {
      const authApp = createAgentWorkflowApp({
        defaultWorkspacePath: projectsRoot,
        currentUserResolver: request => {
          const header = request.headers.get('authorization')
          if (header === 'Bearer owner-token') return { id: 'owner-user', role: 'owner' }
          if (header === 'Bearer developer-token') return { id: 'developer-user', role: 'developer' }
          if (header === 'Bearer audit-token') return {
            id: 'audit-user',
            role: 'viewer',
            permissions: ['audit.read'],
          }
          if (header === 'Bearer credits-admin-token') return {
            id: 'credits-admin-user',
            role: 'viewer',
            permissions: ['credits.admin'],
          }
          return undefined
        },
      })

      const auditReaderRes = await authApp.request('/api/admin/credits/grants', {
        method: 'POST',
        headers: {
          authorization: 'Bearer audit-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ userId: 'customer-a', credits: 40 }),
      })
      expect(auditReaderRes.status).toBe(403)

      const forbiddenRes = await authApp.request('/api/admin/credits/grants', {
        method: 'POST',
        headers: {
          authorization: 'Bearer developer-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          userId: 'customer-a',
          credits: 40,
        }),
      })
      expect(forbiddenRes.status).toBe(403)

      const grantRes = await authApp.request('/api/admin/credits/grants', {
        method: 'POST',
        headers: {
          authorization: 'Bearer credits-admin-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          userId: 'customer-a',
          credits: 40,
          metadata: {
            source: 'payment_provider',
            provider: 'manual',
            providerReference: 'manual-topup-3',
          },
        }),
      })

      expect(grantRes.status).toBe(200)
      expect(await grantRes.json()).toEqual({
        grantedCredits: 40,
        balance: expect.objectContaining({
          userId: 'customer-a',
          includedCredits: 340,
          balanceCredits: 340,
        }),
      })

      const auditRes = await authApp.request('/api/admin/credits/ledger?userId=customer-a&kind=grant', {
        headers: { authorization: 'Bearer owner-token' },
      })
      expect(auditRes.status).toBe(200)
      expect(await auditRes.json()).toEqual({
        entries: [
          expect.objectContaining({
            userId: 'customer-a',
            kind: 'grant',
            credits: 40,
            metadata: expect.objectContaining({
              source: 'payment_provider',
              provider: 'manual',
              providerReference: 'manual-topup-3',
              grantedBy: 'credits-admin-user',
            }),
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
    } finally {
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('grants mapped credits from a signed Stripe checkout webhook idempotently', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-stripe-webhook-'))
    const originalSecret = process.env.BEEGAME_STRIPE_WEBHOOK_SECRET
    const originalMapping = process.env.BEEGAME_STRIPE_PRICE_CREDITS
    try {
      process.env.BEEGAME_STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
      process.env.BEEGAME_STRIPE_PRICE_CREDITS = JSON.stringify({
        price_beegame_100: 100,
      })
      const stripeApp = createAgentWorkflowApp({
        defaultWorkspacePath: projectsRoot,
        currentUserResolver: request => (
          request.headers.get('authorization') === 'Bearer owner-token'
            ? { id: 'owner-user', role: 'owner' }
            : undefined
        ),
      })
      const payload = JSON.stringify({
        id: 'evt_beegame_checkout_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_beegame_1',
            object: 'checkout.session',
            client_reference_id: 'customer-a',
            metadata: {
              beeGameUserId: 'customer-a',
              beeGamePriceId: 'price_beegame_100',
            },
            payment_status: 'paid',
          },
        },
      })
      const signature = signStripePayload(payload, 'whsec_test_secret')

      const firstRes = await stripeApp.request('/api/payments/stripe/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signature,
        },
        body: payload,
      })
      expect(firstRes.status).toBe(200)
      expect(await firstRes.json()).toEqual({
        received: true,
        processed: true,
        eventId: 'evt_beegame_checkout_1',
        grantedCredits: 100,
      })

      const replayRes = await stripeApp.request('/api/payments/stripe/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signature,
        },
        body: payload,
      })
      expect(replayRes.status).toBe(200)
      expect(await replayRes.json()).toEqual({
        received: true,
        processed: false,
        eventId: 'evt_beegame_checkout_1',
        reason: 'duplicate_event',
      })

      const auditRes = await stripeApp.request('/api/admin/credits/ledger?userId=customer-a&kind=grant', {
        headers: { authorization: 'Bearer owner-token' },
      })
      expect(auditRes.status).toBe(200)
      const audit = await auditRes.json()
      expect(audit.entries).toHaveLength(1)
      expect(audit.entries[0]).toEqual(expect.objectContaining({
        userId: 'customer-a',
        kind: 'grant',
        credits: 100,
        metadata: expect.objectContaining({
          source: 'payment_provider',
          provider: 'stripe',
          providerReference: 'evt_beegame_checkout_1',
          stripeCheckoutSessionId: 'cs_beegame_1',
          stripePriceId: 'price_beegame_100',
        }),
      }))
    } finally {
      if (originalSecret === undefined) {
        delete process.env.BEEGAME_STRIPE_WEBHOOK_SECRET
      } else {
        process.env.BEEGAME_STRIPE_WEBHOOK_SECRET = originalSecret
      }
      if (originalMapping === undefined) {
        delete process.env.BEEGAME_STRIPE_PRICE_CREDITS
      } else {
        process.env.BEEGAME_STRIPE_PRICE_CREDITS = originalMapping
      }
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('creates a Stripe checkout session only for mapped credit prices', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-stripe-checkout-'))
    const originalSecretKey = process.env.BEEGAME_STRIPE_SECRET_KEY
    const originalMapping = process.env.BEEGAME_STRIPE_PRICE_CREDITS
    const originalFetch = globalThis.fetch
    const stripeRequests: Array<{ url: string; body: string }> = []
    try {
      process.env.BEEGAME_STRIPE_SECRET_KEY = 'sk_test_checkout'
      process.env.BEEGAME_STRIPE_PRICE_CREDITS = JSON.stringify({
        price_beegame_500: '500',
      })
      globalThis.fetch = (async (input, init) => {
        stripeRequests.push({
          url: String(input),
          body: String(init?.body ?? ''),
        })
        return Response.json({
          id: 'cs_beegame_checkout',
          url: 'https://checkout.stripe.com/c/pay/cs_beegame_checkout',
        })
      }) as typeof fetch
      const stripeApp = createAgentWorkflowApp({
        defaultWorkspacePath: projectsRoot,
        currentUser: {
          id: 'customer-a',
          email: 'customer@example.com',
          role: 'developer',
        },
      })
      const packsRes = await stripeApp.request('/api/payments/stripe/credit-packs')
      expect(packsRes.status).toBe(200)
      expect(await packsRes.json()).toEqual({
        packs: [
          {
            priceId: 'price_beegame_500',
            credits: 500,
          },
        ],
      })

      const res = await stripeApp.request('/api/payments/stripe/checkout-session', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://app.beegame.example',
        },
        body: JSON.stringify({ priceId: 'price_beegame_500' }),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        id: 'cs_beegame_checkout',
        url: 'https://checkout.stripe.com/c/pay/cs_beegame_checkout',
        credits: 500,
        priceId: 'price_beegame_500',
      })
      expect(stripeRequests).toHaveLength(1)
      expect(stripeRequests[0].url).toBe('https://api.stripe.com/v1/checkout/sessions')
      expect(stripeRequests[0].body).toContain('mode=payment')
      expect(stripeRequests[0].body).toContain('line_items%5B0%5D%5Bprice%5D=price_beegame_500')
      expect(stripeRequests[0].body).toContain('metadata%5BbeeGameUserId%5D=customer-a')
      expect(stripeRequests[0].body).toContain('metadata%5BbeeGamePriceId%5D=price_beegame_500')
      expect(stripeRequests[0].body).toContain('customer_email=customer%40example.com')

      const invalidRes = await stripeApp.request('/api/payments/stripe/checkout-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ priceId: 'price_not_mapped' }),
      })
      expect(invalidRes.status).toBe(400)
      expect(await invalidRes.json()).toEqual({
        error: 'Invalid request',
        message: 'Stripe price is not available for BeeGame credits',
      })
    } finally {
      if (originalSecretKey === undefined) {
        delete process.env.BEEGAME_STRIPE_SECRET_KEY
      } else {
        process.env.BEEGAME_STRIPE_SECRET_KEY = originalSecretKey
      }
      if (originalMapping === undefined) {
        delete process.env.BEEGAME_STRIPE_PRICE_CREDITS
      } else {
        process.env.BEEGAME_STRIPE_PRICE_CREDITS = originalMapping
      }
      globalThis.fetch = originalFetch
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('lists Stripe credit packs from comma-separated env mapping', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-stripe-pack-mapping-'))
    const originalMapping = process.env.BEEGAME_STRIPE_PRICE_CREDITS
    try {
      process.env.BEEGAME_STRIPE_PRICE_CREDITS = 'price_beegame_100=100,price_beegame_500:500'
      const stripeApp = createAgentWorkflowApp({
        defaultWorkspacePath: projectsRoot,
        currentUser: {
          id: 'customer-a',
          role: 'owner',
        },
      })
      const packsRes = await stripeApp.request('/api/payments/stripe/credit-packs')
      expect(packsRes.status).toBe(200)
      expect(await packsRes.json()).toEqual({
        packs: [
          {
            priceId: 'price_beegame_100',
            credits: 100,
          },
          {
            priceId: 'price_beegame_500',
            credits: 500,
          },
        ],
      })
    } finally {
      if (originalMapping === undefined) {
        delete process.env.BEEGAME_STRIPE_PRICE_CREDITS
      } else {
        process.env.BEEGAME_STRIPE_PRICE_CREDITS = originalMapping
      }
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('returns a clear error for invalid Stripe credit pack env mapping', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-stripe-pack-invalid-'))
    const originalMapping = process.env.BEEGAME_STRIPE_PRICE_CREDITS
    try {
      process.env.BEEGAME_STRIPE_PRICE_CREDITS = '{price_beegame_100:100}'
      const stripeApp = createAgentWorkflowApp({
        defaultWorkspacePath: projectsRoot,
        currentUser: {
          id: 'customer-a',
          role: 'owner',
        },
      })
      const packsRes = await stripeApp.request('/api/payments/stripe/credit-packs')
      expect(packsRes.status).toBe(503)
      expect(await packsRes.json()).toEqual({
        error: 'Stripe credit packs failed',
        message: 'BEEGAME_STRIPE_PRICE_CREDITS must be valid JSON when it starts with "{"',
      })
    } finally {
      if (originalMapping === undefined) {
        delete process.env.BEEGAME_STRIPE_PRICE_CREDITS
      } else {
        process.env.BEEGAME_STRIPE_PRICE_CREDITS = originalMapping
      }
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('proxies Stripe credit store requests in remote billing mode without enabling local webhook grants', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-stripe-remote-billing-'))
    const originalMode = process.env.BEEGAME_BILLING_MODE
    const originalBillingUrl = process.env.BEEGAME_BILLING_API_BASE_URL
    const originalMapping = process.env.BEEGAME_STRIPE_PRICE_CREDITS
    const originalFetch = globalThis.fetch
    const remoteRequests: Array<{
      url: string
      method: string
      authorization: string | null
      origin: string | null
      body: string
    }> = []
    try {
      process.env.BEEGAME_BILLING_MODE = 'remote'
      process.env.BEEGAME_BILLING_API_BASE_URL = 'https://billing.beegame.example/base/'
      delete process.env.BEEGAME_STRIPE_PRICE_CREDITS
      globalThis.fetch = (async (input, init) => {
        remoteRequests.push({
          url: String(input),
          method: init?.method ?? 'GET',
          authorization: init?.headers instanceof Headers
            ? init.headers.get('authorization')
            : new Headers(init?.headers).get('authorization'),
          origin: init?.headers instanceof Headers
            ? init.headers.get('origin')
            : new Headers(init?.headers).get('origin'),
          body: String(init?.body ?? ''),
        })
        if (String(input).endsWith('/api/payments/stripe/credit-packs')) {
          return Response.json({
            packs: [{ priceId: 'price_remote_500', credits: 500 }],
          })
        }
        if (String(input).endsWith('/api/admin/billing/credit-packs')) {
          return Response.json({
            pack: {
              provider: 'stripe',
              priceId: 'price_remote_1200',
              credits: 1200,
              displayName: '1,200 credits',
              enabled: true,
              sortOrder: 2,
              metadata: {},
            },
          })
        }
        return Response.json({
          id: 'cs_remote_checkout',
          url: 'https://checkout.stripe.com/c/pay/cs_remote_checkout',
          credits: 500,
          priceId: 'price_remote_500',
        }, { status: 201 })
      }) as typeof fetch

      const stripeApp = createAgentWorkflowApp({
        defaultWorkspacePath: projectsRoot,
        currentUser: {
          id: 'customer-a',
          role: 'owner',
        },
      })
      const packsRes = await stripeApp.request('/api/payments/stripe/credit-packs', {
        headers: { authorization: 'Bearer local-client-token' },
      })
      expect(packsRes.status).toBe(200)
      expect(await packsRes.json()).toEqual({
        packs: [{ priceId: 'price_remote_500', credits: 500 }],
      })

      const checkoutRes = await stripeApp.request('/api/payments/stripe/checkout-session', {
        method: 'POST',
        headers: {
          authorization: 'Bearer local-client-token',
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:62173',
        },
        body: JSON.stringify({ priceId: 'price_remote_500' }),
      })
      expect(checkoutRes.status).toBe(201)
      expect(await checkoutRes.json()).toEqual({
        id: 'cs_remote_checkout',
        url: 'https://checkout.stripe.com/c/pay/cs_remote_checkout',
        credits: 500,
        priceId: 'price_remote_500',
      })

      const adminPackRes = await stripeApp.request('/api/admin/billing/credit-packs', {
        method: 'POST',
        headers: {
          authorization: 'Bearer local-client-token',
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:62173',
        },
        body: JSON.stringify({
          priceId: 'price_remote_1200',
          credits: 1200,
          displayName: '1,200 credits',
          sortOrder: 2,
        }),
      })
      expect(adminPackRes.status).toBe(200)
      expect(await adminPackRes.json()).toEqual({
        pack: {
          provider: 'stripe',
          priceId: 'price_remote_1200',
          credits: 1200,
          displayName: '1,200 credits',
          enabled: true,
          sortOrder: 2,
          metadata: {},
        },
      })

      const webhookRes = await stripeApp.request('/api/payments/stripe/webhook', {
        method: 'POST',
        body: '{}',
      })
      expect(webhookRes.status).toBe(503)
      expect(await webhookRes.json()).toEqual({
        error: 'Billing webhook disabled',
        message: 'Stripe webhook is only enabled in server billing mode',
      })
      expect(remoteRequests).toEqual([
        {
          url: 'https://billing.beegame.example/base/api/payments/stripe/credit-packs',
          method: 'GET',
          authorization: 'Bearer local-client-token',
          origin: null,
          body: '',
        },
        {
          url: 'https://billing.beegame.example/base/api/payments/stripe/checkout-session',
          method: 'POST',
          authorization: 'Bearer local-client-token',
          origin: 'http://127.0.0.1:62173',
          body: JSON.stringify({ priceId: 'price_remote_500' }),
        },
        {
          url: 'https://billing.beegame.example/base/api/admin/billing/credit-packs',
          method: 'POST',
          authorization: 'Bearer local-client-token',
          origin: 'http://127.0.0.1:62173',
          body: JSON.stringify({
            priceId: 'price_remote_1200',
            credits: 1200,
            displayName: '1,200 credits',
            sortOrder: 2,
          }),
        },
      ])
    } finally {
      if (originalMode === undefined) {
        delete process.env.BEEGAME_BILLING_MODE
      } else {
        process.env.BEEGAME_BILLING_MODE = originalMode
      }
      if (originalBillingUrl === undefined) {
        delete process.env.BEEGAME_BILLING_API_BASE_URL
      } else {
        process.env.BEEGAME_BILLING_API_BASE_URL = originalBillingUrl
      }
      if (originalMapping === undefined) {
        delete process.env.BEEGAME_STRIPE_PRICE_CREDITS
      } else {
        process.env.BEEGAME_STRIPE_PRICE_CREDITS = originalMapping
      }
      globalThis.fetch = originalFetch
      await rm(projectsRoot, { recursive: true, force: true })
    }
  })

  test('returns a service error when remote billing is unreachable', async () => {
    const projectsRoot = await mkdtemp(join(tmpdir(), 'beegame-stripe-remote-billing-down-'))
    const originalMode = process.env.BEEGAME_BILLING_MODE
    const originalBillingUrl = process.env.BEEGAME_BILLING_API_BASE_URL
    const originalFetch = globalThis.fetch
    try {
      process.env.BEEGAME_BILLING_MODE = 'remote'
      process.env.BEEGAME_BILLING_API_BASE_URL = 'http://127.0.0.1:62175'
      globalThis.fetch = (async () => {
        throw new Error('socket closed')
      }) as unknown as typeof fetch

      const stripeApp = createAgentWorkflowApp({
        defaultWorkspacePath: projectsRoot,
        currentUser: {
          id: 'customer-a',
          role: 'developer',
        },
      })
      const packsRes = await stripeApp.request('/api/payments/stripe/credit-packs', {
        headers: { authorization: 'Bearer local-client-token' },
      })

      expect(packsRes.status).toBe(503)
      expect(await packsRes.json()).toEqual({
        error: 'Remote billing failed',
        message: 'Billing service is unavailable',
      })
    } finally {
      if (originalMode === undefined) {
        delete process.env.BEEGAME_BILLING_MODE
      } else {
        process.env.BEEGAME_BILLING_MODE = originalMode
      }
      if (originalBillingUrl === undefined) {
        delete process.env.BEEGAME_BILLING_API_BASE_URL
      } else {
        process.env.BEEGAME_BILLING_API_BASE_URL = originalBillingUrl
      }
      globalThis.fetch = originalFetch
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
          'skills.manage',
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
        outboundTargetPolicyOptions: {
          resolve4: async () => ['93.184.216.34'],
          resolve6: async () => ['2606:2800:220:1:248:1893:25c8:1946'],
        },
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
        outboundTargetPolicyOptions: {
          resolve4: async () => ['93.184.216.34'],
          resolve6: async () => ['2606:2800:220:1:248:1893:25c8:1946'],
        },
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

  test('proxies private user skill management to the skills service', async () => {
    const calls: Array<{ url: string; method: string; contentType?: string }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input, init) => {
      const headers = new Headers(init?.headers)
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        contentType: headers.get('content-type') ?? undefined,
      })
      if (String(input).endsWith('/api/user-skills')) {
        return Response.json([{
          id: 'skill_1',
          slug: 'movement-contracts',
          name: 'movement-contracts',
          description: 'Private movement guidance.',
          enabled: true,
          content: '# Movement Contracts',
          references: [],
          files: [{ path: 'SKILL.md', content: '# Movement Contracts' }],
          createdAt: '2026-07-09T00:00:00.000Z',
          updatedAt: '2026-07-09T00:00:00.000Z',
        }])
      }
      if (String(input).endsWith('/api/user-skills/import')) {
        return Response.json({
          id: 'skill_2',
          slug: 'imported-skill',
          name: 'imported-skill',
          description: 'Imported.',
          enabled: true,
          content: '# Imported',
          references: [],
          files: [{ path: 'SKILL.md', content: '# Imported' }],
          createdAt: '2026-07-09T00:00:00.000Z',
          updatedAt: '2026-07-09T00:00:00.000Z',
        })
      }
      if (String(input).endsWith('/api/user-skills/skill_1/enabled')) {
        return Response.json({
          id: 'skill_1',
          slug: 'movement-contracts',
          name: 'movement-contracts',
          description: 'Private movement guidance.',
          enabled: false,
          content: '# Movement Contracts',
          references: [],
          files: [{ path: 'SKILL.md', content: '# Movement Contracts' }],
          createdAt: '2026-07-09T00:00:00.000Z',
          updatedAt: '2026-07-09T00:00:00.000Z',
        })
      }
      if (String(input).endsWith('/api/user-skills/skill_1')) {
        return Response.json({ deleted: true })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const viewerApp = createAgentWorkflowApp({
      defaultWorkspacePath: testRoot,
      currentUser: {
        id: 'viewer-user',
        role: 'viewer',
        permissions: ['project.read', 'skills.manage'],
      },
      skillsConfig: {
        apiBaseUrl: 'http://skills.test',
      },
    })

    try {
      const listRes = await viewerApp.request('/api/user-skills')
      expect(listRes.status).toBe(200)
      expect(await listRes.json()).toMatchObject([{
        id: 'skill_1',
        slug: 'movement-contracts',
        enabled: true,
      }])

      const importRes = await viewerApp.request('/api/user-skills/import', {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        body: 'zip-bytes',
      })
      expect(importRes.status).toBe(200)
      expect(await importRes.json()).toMatchObject({
        id: 'skill_2',
        slug: 'imported-skill',
      })

      const toggleRes = await viewerApp.request('/api/user-skills/skill_1/enabled', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
      expect(toggleRes.status).toBe(200)
      expect(await toggleRes.json()).toMatchObject({
        id: 'skill_1',
        enabled: false,
      })

      const deleteRes = await viewerApp.request('/api/user-skills/skill_1', {
        method: 'DELETE',
      })
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ deleted: true })
      expect(calls.map(call => `${call.method} ${call.url}`)).toEqual([
        'GET http://skills.test/api/user-skills',
        'POST http://skills.test/api/user-skills/import',
        'PUT http://skills.test/api/user-skills/skill_1/enabled',
        'DELETE http://skills.test/api/user-skills/skill_1',
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('disables user skill management when the global skills feature is disabled', async () => {
    for (const [path, init] of [
      ['/api/user-skills', undefined],
      ['/api/user-skills/import', { method: 'POST', body: 'zip-bytes' }],
      ['/api/user-skills/skill-1/enabled', { method: 'PUT', body: '{}' }],
      ['/api/user-skills/skill-1', { method: 'DELETE' }],
    ] as const) {
      const response = await app.request(path, init)
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'User skills are disabled' })
    }
  })

  test('traces skills proxy failures without exposing upstream details', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('upstream secret: skills-token')
    }) as unknown as typeof fetch
    const skillApp = createAgentWorkflowApp({
      currentUser: { id: 'skills-user', role: 'viewer', permissions: ['skills.manage'] },
      skillsConfig: { apiBaseUrl: 'http://skills.test' },
    })
    try {
      for (const [path, init] of [
        ['/api/user-skills', undefined],
        ['/api/user-skills/skill-1/enabled', { method: 'PUT', body: '{}' }],
        ['/api/user-skills/skill-1', { method: 'DELETE' }],
      ] as const) {
        const response = await skillApp.request(path, init)
        expect(response.status).toBe(400)
        const body = await response.json()
        expect(body).toEqual({ error: 'Request failed', traceId: expect.any(String) })
        expect(JSON.stringify(body)).not.toContain('skills-token')
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('traces unexpected admin credit ledger backend failures', async () => {
    const brokenRoot = await mkdtemp(join(tmpdir(), 'beegame-ledger-failure-'))
    const brokenPath = join(brokenRoot, 'dashboard')
    await mkdir(brokenPath)
    await writeFile(join(brokenPath, 'users'), 'not a directory')
    try {
      const ledgerApp = createAgentWorkflowApp({
        defaultWorkspacePath: brokenPath,
        currentUser: { id: 'ledger-admin', role: 'owner' },
      })
      const response = await ledgerApp.request('/api/admin/credits/ledger')
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Request failed', traceId: expect.any(String) })
    } finally {
      await rm(brokenRoot, { recursive: true, force: true })
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
      ])
      expect(JSON.stringify(discovered)).not.toContain('127.0.0.1:3030')
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

  test('uses the app outbound resolver when discovering remote MCP servers', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'cc-dashboard-mcp-discover-policy-'))
    const ownerDataDir = join(dataDir, 'users', testOwner.id)
    const resolvedUrls: string[] = []
    const policyOptions = {
      resolve4: async () => ['93.184.216.34'],
      resolve6: async () => ['2606:2800:220:1:248:1893:25c8:1946'],
    }

    try {
      await mkdir(ownerDataDir, { recursive: true })
      await writeFile(join(ownerDataDir, '.mcp.json'), JSON.stringify({
        mcpServers: {
          'Remote Tools': {
            transport: 'http',
            url: 'https://mcp.discovery.test/mcp',
          },
        },
      }), 'utf8')
      const policyApp = createAgentWorkflowApp({
        defaultWorkspacePath: dataDir,
        currentUser: testOwner,
        skillsConfig: false,
        outboundTargetPolicyOptions: policyOptions,
        outboundTargetResolver: async (value, options) => {
          resolvedUrls.push(value)
          expect(options).toEqual(expect.objectContaining(policyOptions))
          return {
            url: new URL(value),
            addresses: ['93.184.216.34'],
            lookup: (_hostname, _options, callback) => callback(null, '93.184.216.34', 4),
          }
        },
      })

      const response = await policyApp.request('/api/mcp-servers/discover')

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([
        expect.objectContaining({
          name: 'Remote Tools',
          url: 'https://mcp.discovery.test/mcp',
        }),
      ])
      expect(resolvedUrls).toEqual(['https://mcp.discovery.test/mcp'])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('tests and discovers running HTTP MCP servers', async () => {
    const originalFetch = globalThis.fetch
    let usedPinnedDispatcher = false
    globalThis.fetch = (async (
      url: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const requestUrl = String(url)
      if (
        init?.method === 'POST' &&
        requestUrl === 'http://127.0.0.1:18081/mcp'
      ) {
        usedPinnedDispatcher = Boolean((init as RequestInit & { dispatcher?: unknown }).dispatcher)
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
        outboundTargetResolver: loopbackOutboundTargetResolver,
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
      expect(usedPinnedDispatcher).toBe(true)
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
        outboundTargetResolver: loopbackOutboundTargetResolver,
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

  test('persists user-editable project metadata without accepting a client-authored runtime snapshot', async () => {
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
        },
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rejects new BeeGame projects after the configured per-user quota', async () => {
    const originalLimit = process.env.BEEGAME_MAX_PROJECTS_PER_USER
    try {
      process.env.BEEGAME_MAX_PROJECTS_PER_USER = '1'
      const quotaApp = createAgentWorkflowApp({
        defaultWorkspacePath: testRoot,
        currentUser: testOwner,
      })
      const firstRes = await quotaApp.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'project_quota_one',
          name: 'Quota One',
          root_path: join(testRoot, 'quota-one'),
          created_at: 1710000000000,
        }),
      })
      expect(firstRes.status).toBe(200)

      const updateRes = await quotaApp.request('/api/projects/project_quota_one', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Quota One Updated' }),
      })
      expect(updateRes.status).toBe(200)

      const secondRes = await quotaApp.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'project_quota_two',
          name: 'Quota Two',
          root_path: join(testRoot, 'quota-two'),
          created_at: 1710000001000,
        }),
      })
      expect(secondRes.status).toBe(429)
      expect(await secondRes.json()).toEqual(expect.objectContaining({
        error: 'Project quota exceeded',
        limit: 1,
      }))
    } finally {
      if (originalLimit === undefined) {
        delete process.env.BEEGAME_MAX_PROJECTS_PER_USER
      } else {
        process.env.BEEGAME_MAX_PROJECTS_PER_USER = originalLimit
      }
    }
  })

  test('returns project lifecycle admin overview only to lifecycle administrators', async () => {
    const originalLimit = process.env.BEEGAME_MAX_PROJECTS_PER_USER
    try {
      process.env.BEEGAME_MAX_PROJECTS_PER_USER = '2'
      const forbiddenApp = createAgentWorkflowApp({
        defaultWorkspacePath: testRoot,
        currentUser: {
          id: 'viewer-user',
          role: 'viewer',
          permissions: ['project.read'],
        },
      })
      const forbiddenRes = await forbiddenApp.request('/api/admin/projects/lifecycle')
      expect(forbiddenRes.status).toBe(403)

      const managedRoot = join(testRoot, 'lifecycle-project')
      await mkdir(managedRoot, { recursive: true })
      await writeFile(join(managedRoot, 'manifest.json'), '{}', 'utf8')
      const managedRootRealpath = await realpath(managedRoot)
      const lifecycleApp = createAgentWorkflowApp({
        defaultWorkspacePath: testRoot,
        currentUser: testOwner,
      })
      const createRes = await lifecycleApp.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'project_lifecycle_one',
          name: 'Lifecycle One',
          created_at: 1720000000000,
          root_path: managedRoot,
          runtime_snapshot: {
            phase_name: 'polish',
            updated_at: 1720000001000,
          },
        }),
      })
      expect(createRes.status).toBe(200)

      const overviewRes = await lifecycleApp.request('/api/admin/projects/lifecycle')
      expect(overviewRes.status).toBe(200)
      await expect(overviewRes.json()).resolves.toEqual({
        quota: {
          limit: 2,
          used: 1,
          remaining: 1,
        },
        storage: {
          supabaseStorageConfigured: false,
        },
        projects: [
          {
            id: 'project_lifecycle_one',
            name: 'Lifecycle One',
            createdAt: 1720000000000,
            rootPath: managedRoot,
            lifecycle: {
              hasWorkspacePath: true,
              hasRuntimeSnapshot: false,
            },
          },
        ],
        recentDeletions: [],
        recentRetentionRuns: [],
      })

      const deleteRes = await lifecycleApp.request('/api/projects/project_lifecycle_one', {
        method: 'DELETE',
      })
      expect(deleteRes.status).toBe(200)
      await expect(deleteRes.json()).resolves.toEqual({
        deleted: true,
        deletedWorkspacePath: managedRootRealpath,
      })

      const afterDeleteRes = await lifecycleApp.request('/api/admin/projects/lifecycle')
      expect(afterDeleteRes.status).toBe(200)
      const afterDelete = await afterDeleteRes.json()
      expect(afterDelete.projects).toEqual([])
      expect(afterDelete.quota).toEqual({
        limit: 2,
        used: 0,
        remaining: 2,
      })
      expect(afterDelete.recentDeletions).toEqual([
        expect.objectContaining({
          projectId: 'project_lifecycle_one',
          deletedWorkspacePath: managedRootRealpath,
          cleanupOutcome: 'workspace_deleted',
        }),
      ])
    } finally {
      if (originalLimit === undefined) {
        delete process.env.BEEGAME_MAX_PROJECTS_PER_USER
      } else {
        process.env.BEEGAME_MAX_PROJECTS_PER_USER = originalLimit
      }
    }
  })

  test('plans and runs deployment retention only for lifecycle administrators', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-retention-'))
    try {
      const forbiddenApp = createAgentWorkflowApp({
        defaultWorkspacePath: workspace,
        currentUser: {
          id: 'viewer-user',
          role: 'viewer',
          permissions: ['project.read'],
        },
      })
      const forbiddenRes = await forbiddenApp.request('/api/admin/projects/retention/plan')
      expect(forbiddenRes.status).toBe(403)

      const projectRoot = join(workspace, 'owner-user', 'retention-project')
      await mkdir(projectRoot, { recursive: true })
      await writeFile(
        join(projectRoot, 'package.json'),
        JSON.stringify({ scripts: { build: 'build-static' } }),
        'utf8',
      )
      await mkdir(join(projectRoot, 'docs', 'acceptance'), { recursive: true })
      await mkdir(join(projectRoot, 'tests'), { recursive: true })
      await writeFile(join(projectRoot, 'tests', 'acceptance.test.ts'), 'export const observed = true\n')
      for (const name of ['GDD.md', 'TECHNICAL_DESIGN.md', 'ART_DIRECTION.md', 'UI_UX_SPEC.md', 'AUDIO_DESIGN.md', 'ASSET_PLAN.md']) {
        await writeFile(join(projectRoot, 'docs', name), `# ${name}\n`)
      }
      await writeFile(
        join(projectRoot, 'docs', 'acceptance', 'gameplay-checklist.md'),
        '- [x] [requirement:requirement-primary] Primary behavior\n- [x] [player-path:path-primary] Primary path\n',
        'utf8',
      )
      await mkdir(join(projectRoot, 'assets'), { recursive: true })
      await writeFile(join(projectRoot, 'assets', 'asset-manifest.json'), JSON.stringify({
        version: 5,
        project_target: {
          platform: 'selected-target',
          runtime: 'project-native',
          asset_format_capabilities: ['png'],
          resource_library_usage: 'optional',
        },
        requirements: [],
        imports: [],
        compositions: [],
      }))
      const acceptanceReport = {
        validatorId: 'beegame-acceptance-validator',
        status: 'passed',
        summary: 'Observed acceptance passed.',
        validatedChecklistIds: ['requirement:requirement-primary', 'player-path:path-primary'],
        evidence: [
          { kind: 'document', source: 'docs/', result: 'passed', detail: 'Approved documents were reviewed.' },
          { kind: 'build', source: 'project build', result: 'passed', detail: 'The native build passed.' },
          { kind: 'test', source: 'tests/acceptance.test.ts', result: 'passed', detail: 'Assertions passed.' },
          { kind: 'runtime', source: 'path-primary', result: 'passed', detail: 'The player path was observed.' },
          { kind: 'asset', source: 'project assets', result: 'passed', detail: 'Runtime asset references were verified.' },
          { kind: 'skill', source: 'beegame-game-acceptance', result: 'passed', detail: 'The acceptance skill was used.' },
        ],
        findings: [],
      }
      await writeFile(
        join(projectRoot, 'docs', 'acceptance', 'validation-report.json'),
        JSON.stringify(acceptanceReport),
        'utf8',
      )
      const retentionApp = createAgentWorkflowApp({
        defaultWorkspacePath: workspace,
        currentUser: testOwner,
        outboundTargetPolicyOptions: {
          resolve4: async () => ['93.184.216.34'],
          resolve6: async () => ['2606:2800:220:1:248:1893:25c8:1946'],
        },
        deploymentRunner: async (_command, options) => {
          const outputDir = join(options.cwd, 'dist')
          await mkdir(outputDir, { recursive: true })
          await writeFile(join(outputDir, 'index.html'), '<html>retained</html>', 'utf8')
          return { exitCode: 0, stdout: 'built', stderr: '' }
        },
      })
      const modelRes = await retentionApp.request('/api/model-configs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Retention runtime',
          provider: 'openai-compatible',
          baseUrl: 'https://llm.example.invalid/v1',
          apiKey: 'test-key',
          models: { balanced: 'test-model' },
          isDefault: true,
        }),
      })
      expect(modelRes.status).toBe(200)
      const createRes = await retentionApp.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'project_retention_one',
          name: 'Retention One',
          created_at: 1720000000000,
          root_path: projectRoot,
        }),
      })
      expect(createRes.status).toBe(200)
      const ensureSessionRes = await retentionApp.request(
        '/api/projects/project_retention_one/session/ensure',
        { method: 'POST' },
      )
      expect(ensureSessionRes.status).toBe(200)
      const ensured = await ensureSessionRes.json()
      recordNativeDocumentReviewForTest({
        dataRoot: workspace,
        sessionId: ensured.session.id,
        workspacePath: projectRoot,
        report: {
          reviewerId: 'beegame-document-reviewer',
          verdict: 'READY',
          summary: 'The current documents are implementation-ready.',
          confirmedResourceLibraryUsage: 'optional',
          findings: [],
        },
      })
      recordNativeImplementationAuditReportForTest({
        dataRoot: workspace,
        sessionId: ensured.session.id,
        workspacePath: projectRoot,
        report: {
          auditorId: 'beegame-implementation-auditor',
          status: 'passed',
          summary: 'The implementation matches the approved project contract.',
          auditedChecklistIds: ['requirement:requirement-primary', 'player-path:path-primary'],
          evidence: [{ source: 'src/main.ts', detail: 'The implementation entrypoint exists.' }],
          findings: [],
        },
      })
      recordNativeAcceptanceReportForTest({
        dataRoot: workspace,
        sessionId: ensured.session.id,
        workspacePath: projectRoot,
        report: acceptanceReport,
      })

      for (let index = 0; index < 7; index += 1) {
        const deployRes = await retentionApp.request('/api/projects/project_retention_one/deployments', {
          method: 'POST',
        })
        expect(deployRes.status).toBe(200)
      }

      const planRes = await retentionApp.request('/api/admin/projects/retention/plan')
      expect(planRes.status).toBe(200)
      const plan = await planRes.json()
      expect(plan.dryRun).toBe(true)
      expect(plan.summary).toEqual(expect.objectContaining({
        deploymentRecordsDeleted: 0,
        deploymentRecordsRetained: 6,
        deploymentRecordsPlannedForDeletion: 1,
      }))
      expect(plan.deploymentRecords.deleted).toHaveLength(0)
      expect(plan.deploymentRecords.plannedForDeletion).toHaveLength(1)

      const beforeRunRes = await retentionApp.request('/api/projects/project_retention_one/deployments')
      expect(beforeRunRes.status).toBe(200)
      expect(await beforeRunRes.json()).toHaveLength(7)

      const runRes = await retentionApp.request('/api/admin/projects/retention/run', {
        method: 'POST',
      })
      expect(runRes.status).toBe(200)
      const run = await runRes.json()
      expect(run.dryRun).toBe(false)
      expect(run.summary).toEqual(expect.objectContaining({
        deploymentRecordsDeleted: 1,
        deploymentRecordsRetained: 6,
        deploymentRecordsPlannedForDeletion: 1,
      }))
      expect(run.deploymentRecords.deleted).toHaveLength(1)

      const afterRunRes = await retentionApp.request('/api/projects/project_retention_one/deployments')
      expect(afterRunRes.status).toBe(200)
      expect(await afterRunRes.json()).toHaveLength(6)

      const lifecycleRes = await retentionApp.request('/api/admin/projects/lifecycle')
      expect(lifecycleRes.status).toBe(200)
      const lifecycle = await lifecycleRes.json()
      expect(lifecycle.recentRetentionRuns).toEqual([
        expect.objectContaining({
          dryRun: false,
          deploymentRecordsDeleted: 1,
        }),
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('deletes generated local BeeGame project workspace with project metadata', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-project-delete-'))
    try {
      const projectRoot = join(workspace, 'owner-user', 'generated-project')
      await mkdir(projectRoot, { recursive: true })
      await writeFile(join(projectRoot, 'index.html'), '<html></html>', 'utf8')
      const projectRootRealpath = await realpath(projectRoot)
      const cleanupApp = createAgentWorkflowApp({
        defaultWorkspacePath: workspace,
        currentUser: testOwner,
      })
      const createRes = await cleanupApp.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'project_delete_generated',
          name: 'Delete Generated',
          root_path: projectRoot,
          created_at: 1710000000000,
        }),
      })
      expect(createRes.status).toBe(200)

      const deleteRes = await cleanupApp.request('/api/projects/project_delete_generated', {
        method: 'DELETE',
      })
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({
        deleted: true,
        deletedWorkspacePath: projectRootRealpath,
      })
      await expect(access(projectRoot)).rejects.toThrow()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rejects BeeGame intake before reserving credits when no model config exists', async () => {
    const ledgerBeforeRes = await app.request('/api/credits/ledger')
    const ledgerBefore = await ledgerBeforeRes.json()
    const res = await requestBeeGameIntake(app, {
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
      const res = await requestBeeGameIntake(app, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea', language: 'zh' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake).toEqual(expect.objectContaining({
        maturity: 'vague',
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
      expect(systemPrompt).not.toContain('coreGameplayHypothesis must')
      expect(systemPrompt).not.toContain('whyFitsIdea must')
      expect(systemPrompt).not.toContain('playablePrototype must')
      expect(systemPrompt).not.toContain('validationTarget must')
      expect(systemPrompt).toContain('game mode')
      expect(systemPrompt).toContain('target briefs')
      expect(systemPrompt).toContain('not full design documents')
      expect(systemPrompt).toContain('Do not write full GDD')
      expect(systemPrompt).toContain('Do not output internal rubric names')
      expect(systemPrompt).toContain('maturity')
      expect(systemPrompt).not.toContain('needs_options')
      expect(systemPrompt).toContain('Always return exactly 3 valid')
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

  test('uses an Anthropic-compatible default model for BeeGame intake', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Anthropic-compatible LLM',
        provider: 'anthropic-compatible',
        baseUrl: 'https://anthropic.example.invalid/api',
        apiKey: 'anthropic-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const originalFetch = globalThis.fetch
    const fetchCalls: Array<{
      url: string
      headers: Headers
      body: Record<string, unknown>
    }> = []
    globalThis.fetch = (async (
      url: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      fetchCalls.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      })
      return Response.json({
        content: [{
          type: 'text',
          text: JSON.stringify({
            maturity: 'directional',
            needs_clarification: false,
            detected_constraints: [],
            recommended_next_step: 'choose_direction',
            options: makeModelOptions('anthropic_mode'),
          }),
        }],
      })
    }) as unknown as typeof fetch

    try {
      const res = await requestBeeGameIntake(app, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'Anthropic-compatible idea', language: 'zh' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake.options).toHaveLength(3)
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'anthropic_mode',
      }))
      expect(fetchCalls).toHaveLength(1)
      expect(fetchCalls[0]?.url).toBe(
        'https://anthropic.example.invalid/api/v1/messages',
      )
      expect(fetchCalls[0]?.headers.get('authorization')).toBe(
        'Bearer anthropic-dashboard-secret',
      )
      expect(fetchCalls[0]?.headers.get('anthropic-version')).toBe('2023-06-01')
      expect(fetchCalls[0]?.body).toEqual(expect.objectContaining({
        model: 'balanced-model',
        system: expect.stringContaining('BeeGame intake planner'),
        messages: [{ role: 'user', content: 'Game idea: Anthropic-compatible idea' }],
      }))
      expect(fetchCalls[0]?.body).not.toHaveProperty('response_format')
      expect(fetchCalls[0]?.body).not.toHaveProperty('thinking')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('handles streamed deltas when a provider ignores the non-streaming intake request', async () => {
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
      needs_clarification: false,
      detected_constraints: ['streamed model response'],
      recommended_next_step: 'choose_direction',
      options: makeModelOptions('streamed_mode', {
        title: 'Streamed Mode',
        gameplay: 'The player completes streamed gameplay rules.',
        risk: 'The main risk is validating the streamed flow.',
        fit: 'This mode fits the streamed idea.',
      }),
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
      const res = await requestBeeGameIntake(app, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea', language: 'zh' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(fetchCalls[0]?.body).toEqual(expect.objectContaining({
        model: 'balanced-model',
        response_format: { type: 'json_object' },
        stream: false,
        thinking: { type: 'disabled' },
        enable_thinking: false,
      }))
      expect(intake).toEqual(expect.objectContaining({
        maturity: 'concrete',
        needsClarification: false,
        detectedConstraints: ['streamed model response'],
        recommendedNextStep: 'choose_direction',
      }))
      expect(intake.options).toHaveLength(3)
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'streamed_mode',
        title: 'Streamed Mode',
        gameplay: 'The player completes streamed gameplay rules.',
      }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('finalizes intake when a thinking model first returns reasoning instead of the JSON contract', async () => {
    const createRes = await app.request('/api/model-configs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Reasoning LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)

    const finalContent = JSON.stringify({
      maturity: 'concrete',
      needs_clarification: false,
      detected_constraints: [],
      recommended_next_step: 'choose_direction',
      options: makeModelOptions('reasoning_final'),
    })
    const responses = [
      JSON.stringify({ thinking: 'Internal analysis without a final contract.' }),
      finalContent,
    ]
    const requestBodies: Array<Record<string, unknown>> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      const content = responses.shift() ?? finalContent
      return new Response([
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
        '',
        'data: [DONE]',
        '',
      ].join('\n'), {
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as unknown as typeof fetch

    try {
      const res = await requestBeeGameIntake(app, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'A concrete game request.' }),
      })

      expect(res.status).toBe(200)
      expect(requestBodies).toHaveLength(2)
      expect(requestBodies[0]).toEqual(expect.objectContaining({
        stream: false,
        thinking: { type: 'disabled' },
        enable_thinking: false,
      }))
      expect(requestBodies[1]).toEqual(expect.objectContaining({
        model: 'balanced-model',
        stream: false,
        thinking: { type: 'disabled' },
        enable_thinking: false,
        temperature: 0.2,
      }))
      const repairMessages = requestBodies[1]?.messages
      expect(Array.isArray(repairMessages)).toBe(true)
      expect((repairMessages as unknown[]).length).toBeGreaterThan(2)
      const intake = await res.json()
      expect(intake.options).toHaveLength(3)
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'reasoning_final',
      }))
    } finally {
      globalThis.fetch = originalFetch
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

  test('does not expose the removed synchronous BeeGame intake route', async () => {
    const response = await app.request('/api/beegame-intake/options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idea: 'A game idea' }),
    })

    expect(response.status).toBe(404)
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
      const res = await requestBeeGameIntake(app, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea', language: 'zh' }),
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Model runtime request failed: 401')
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

  test('loads the RLS-visible platform model for a legacy non-admin context during BeeGame intake', async () => {
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
        modelRuntimeHost: createTestModelRuntimeHost(),
        outboundTargetPolicyOptions: {
          resolve4: async () => ['93.184.216.34'],
          resolve6: async () => ['2606:2800:220:1:248:1893:25c8:1946'],
        },
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
      const res = await requestBeeGameIntake(supabaseApp, {
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
        call.url.includes('/beegame_model_configs?select=*') &&
          !call.url.includes('owner_id=')
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
      const res = await requestBeeGameIntake(app, {
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

  test('rejects a concrete intake response that returns only one option', async () => {
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
              maturity: 'concrete',
              needs_clarification: false,
              clarification: '',
              clarification_questions: [],
              detected_constraints: ['concrete request'],
              recommended_next_step: 'choose_direction',
              options: makeModelOptions('mode_one').slice(0, 1),
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await requestBeeGameIntake(app, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'concrete game idea' }),
      })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: expect.stringContaining('Expected 3, received 1'),
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
      const res = await requestBeeGameIntake(app, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'broad game idea' }),
      })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: expect.stringContaining('valid options'),
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
      const res = await requestBeeGameIntake(app, {
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

  test('rejects browser attempts to control intake model thinking behavior', async () => {
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
      const res = await requestBeeGameIntake(app, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea', thinkingMode: 'disabled' }),
      })

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Intake model behavior is server-owned' })
      expect(modelRequestBody).toEqual({})
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('disables model thinking for server-owned intake generation', async () => {
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
        choices: [{ message: { content: JSON.stringify({ options: makeModelOptions('non_reasoning_mode') }) } }],
      })
    }) as unknown as typeof fetch

    try {
      const res = await requestBeeGameIntake(app, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'Generate selectable game directions' }),
      })

      expect(res.status).toBe(200)
      expect(modelRequestBody.stream).toBe(false)
      expect(modelRequestBody.max_tokens).toBe(8_192)
      expect(modelRequestBody.thinking).toEqual({ type: 'disabled' })
      expect(modelRequestBody.enable_thinking).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('gives the finalization retry precise option validation feedback', async () => {
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

    const requestBodies: Array<Record<string, unknown>> = []
    const invalidOptions = makeModelOptions('repair_mode').map((option, index) =>
      index === 0 ? option : { ...option, recommendedStyle: 'unsupported-style' },
    )
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requestBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
      const options = requestBodies.length === 1 ? invalidOptions : makeModelOptions('repaired_mode')
      return Response.json({ choices: [{ message: { content: JSON.stringify({ options }) } }] })
    }) as unknown as typeof fetch

    try {
      const res = await requestBeeGameIntake(app, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'Generate selectable game directions' }),
      })

      expect(res.status).toBe(200)
      expect(requestBodies).toHaveLength(2)
      const repairMessages = requestBodies[1]?.messages as Array<{ role?: string; content?: string }>
      expect(repairMessages.at(-1)?.content).toContain('received 1 from 3 returned')
      expect(repairMessages.at(-1)?.content).toContain('recommendedStyle')
      expect(requestBodies[1]?.thinking).toEqual({ type: 'disabled' })
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
      const res = await requestBeeGameIntake(app, {
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
                  recommendedPlatform: ['PC'],
                  recommendedEngine: 'React',
                  recommendedDimension: '2.5D',
                  recommendedGenre: 'Action',
                  recommendedStyle: 'Minimal',
                  recommendedInputs: ['Keyboard/mouse', 'Touch'],
                  scope: 'Playable demo',
                },
                ...makeModelOptions('metadata_mode').slice(1),
              ],
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await requestBeeGameIntake(app, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea: 'LLM generated idea' }),
      })

      expect(res.status).toBe(200)
      const intake = await res.json()
      expect(intake.options[0]).toEqual(expect.objectContaining({
        id: 'llm_array_metadata_mode',
        recommendedPlatform: 'PC',
        recommendedEngine: 'React',
        recommendedDimension: '2.5D',
        recommendedGenre: 'Action',
        recommendedStyle: 'Minimal',
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
      const res = await requestBeeGameIntake(app, {
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
      const res = await requestBeeGameIntake(app, {
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
      const res = await requestBeeGameIntake(app, {
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

  test('derives narrative brief fields while retaining required production metadata', async () => {
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
                  recommendedPlatform: 'Web',
                  recommendedEngine: 'React',
                  recommendedDimension: '2D',
                  recommendedGenre: 'Action',
                  recommendedStyle: 'Minimal',
                  recommendedInputs: ['Keyboard/mouse'],
                },
                ...makeModelOptions('lean_mode').slice(1),
              ],
            }),
          },
        },
      ],
    })) as unknown as typeof fetch

    try {
      const res = await requestBeeGameIntake(app, {
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
        recommendedPlatform: 'Web',
        recommendedEngine: 'React',
        recommendedDimension: '2D',
        recommendedGenre: 'Action',
        recommendedStyle: 'Minimal',
        recommendedInputs: ['Keyboard/mouse'],
        scope: '',
      }))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('analyzes a complete GDD attachment without returning intake options', async () => {
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
      choices: [{
        message: {
          content: JSON.stringify({
            analysisId: 'analysis_gdd',
            sourceType: 'gdd',
            completeness: 'complete',
            confirmedFacts: [{ field: 'coreLoop', value: 'Solve puzzles', source: 'game-design.md' }],
            inferredDesign: [],
            missingFields: [],
            conflicts: [],
            gddDraft: '# Confirmed GDD',
          }),
        },
      }],
    })) as unknown as typeof fetch

    try {
      const res = await app.request('/api/beegame-intake/analyze-attachments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientRequestId: 'attachment-analysis-1',
          language: 'zh',
          attachments: [{
            type: 'file',
            mediaType: 'text/markdown',
            filename: 'game-design.md',
            data: Buffer.from('# Game Design\n').toString('base64'),
          }],
        }),
      })

      expect(res.status).toBe(200)
      const analysis = await res.json()
      expect(analysis.sourceType).toBe('gdd')
      expect(analysis.completeness).toBe('complete')
      expect(analysis.options).toBeUndefined()
      expect(analysis.gddDraft).toBe('# Confirmed GDD')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('analyzes image attachments through the bounded attachment endpoint', async () => {
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
      choices: [{
        message: {
          content: JSON.stringify({
            analysisId: 'analysis_image',
            sourceType: 'image',
            completeness: 'partial',
            confirmedFacts: [],
            inferredDesign: [{ field: 'camera', value: 'Top-down', confidence: 'medium', source: 'concept.png' }],
            missingFields: [{ field: 'winCondition', reason: 'Not visible' }],
            conflicts: [],
            gddDraft: '# Draft',
          }),
        },
      }],
    })) as unknown as typeof fetch

    try {
      const result = await app.request('/api/beegame-intake/analyze-attachments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientRequestId: 'attachment-analysis-job-1',
          attachments: [{ type: 'image', mediaType: 'image/png', filename: 'concept.png', data: 'iVBORw0KGgo=' }],
        }),
      })
      expect(result.status).toBe(200)
      expect((await result.json()).sourceType).toBe('image')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('rejects malformed attachments before model configuration or analysis', async () => {
    const payload = 'iVBORw0KGgo=malformed'
    const response = await app.request('/api/beegame-intake/analyze-attachments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attachments: [{ type: 'image', mediaType: 'image/png', filename: 'concept.png', data: payload }] }),
    })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Attachment validation failed')
    expect(body.traceId).toEqual(expect.any(String))
    expect(JSON.stringify(body)).not.toContain(payload)
  })

  test('logs upload policy rejections with the response trace id and no payload', async () => {
    const payload = 'private-attachment-payload'
    const originalWarn = console.warn
    const warnings: unknown[] = []
    console.warn = (...args) => warnings.push(args)
    try {
      const response = await app.request('/api/beegame-intake/analyze-attachments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attachments: [{ type: 'image', mediaType: 'image/png', filename: 'concept.png', data: payload }] }),
      })
      const body = await response.json()
      expect(body.traceId).toEqual(expect.any(String))
      expect(JSON.stringify(warnings)).toContain(body.traceId)
      expect(JSON.stringify(warnings)).not.toContain(payload)
    } finally {
      console.warn = originalWarn
    }
  })

  test('rejects oversized attachment JSON before parsing the request body', async () => {
    const response = await app.request('/api/beegame-intake/analyze-attachments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(49 * 1024 * 1024) },
      body: '{}',
    })
    expect(response.status).toBe(400)
  })
})

function signStripePayload(payload: string, secret: string, timestamp = 1720000000): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex')
  return `t=${timestamp},v1=${signature}`
}
