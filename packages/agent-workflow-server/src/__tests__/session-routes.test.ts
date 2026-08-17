import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createAgentWorkflowApp } from '../app'
import {
  registerBeeGameSessionRoutes,
  resolveValidRequestAccessToken,
  SESSION_COOKIE_NAME,
} from '../auth/session-routes'
import { encryptSecret } from '../security/secret-crypto'
import type { BeeGameSessionRunner } from '../beegame/session-manager'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import { commitAuthoredFoundationDocument } from '../beegame/authored-document-receipt'
import { renderTestCompleteGameDocument } from './complete-game-document-fixture'
import { getGameDocumentContract } from '../beegame/delivery-workflow/game-document-contracts'
import {
  computeDocumentRevision,
  computeWorkspaceRevision,
} from '../beegame/delivery-workflow/revision'
import {
  createTestDeliveryRun,
  withTestDocumentMetadata,
} from './delivery-workflow-test-helpers'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
  DELIVERY_RUN_SCHEMA_VERSION,
  type DeliveryRun,
  type WorkflowEvent,
} from '../beegame/delivery-workflow/types'
import * as deliveryControllerModule from '../beegame/delivery-workflow/controller'
import { createFoundationReviewState } from '../beegame/delivery-workflow/foundation-review-state'

const originalFlag = process.env.BEEGAME_HTTPONLY_SESSIONS
const originalKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
const originalDataDir = process.env.AGENT_WORKFLOW_DATA_DIR
const temporaryDirectories: string[] = []

function completeTestFoundationDocument(
  path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
): string {
  const contract = getGameDocumentContract(path)
  return renderTestCompleteGameDocument(path, {
    title: contract.discipline,
    executiveSummary: 'Complete test foundation authority.',
    sections: contract.sections.map(section => ({
      sectionId: section.sectionId,
      title: section.title,
      body: `Authoritative test requirements for ${section.sectionId}.`,
    })),
    productionMaterials: contract.productionMaterials.map(material =>
      material.format === 'evidence_register'
        ? {
            materialId: material.materialId,
            title: material.title,
            format: material.format,
            entries: [
              {
                evidenceId: `${material.materialId}.pending`,
                category: 'search_direction' as const,
                displayName: 'Pending reference direction',
                purpose: 'Record a production need before source selection.',
                state: 'source_not_selected' as const,
                evidenceRefs: [],
              },
            ],
          }
        : {
            materialId: material.materialId,
            title: material.title,
            format: material.format,
            body:
              material.format === 'markdown_table'
                ? '| Field | Value |\n| --- | --- |\n| Owner | Test |'
                : material.format === 'mermaid'
                  ? '```mermaid\ngraph TD\n  A --> B\n```'
                  : '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
          },
    ),
    auditAppendix: {
      acceptanceCriteria: ['The test foundation document is complete.'],
      upstreamReferences: [],
      risks: [],
      openDecisions: [],
    },
  })
}

beforeEach(async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'beegame-session-routes-default-'),
  )
  temporaryDirectories.push(directory)
  process.env.AGENT_WORKFLOW_DATA_DIR = directory
})

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true })),
  )
  if (originalFlag === undefined) delete process.env.BEEGAME_HTTPONLY_SESSIONS
  else process.env.BEEGAME_HTTPONLY_SESSIONS = originalFlag
  if (originalKey === undefined)
    delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = originalKey
  if (originalDataDir === undefined) delete process.env.AGENT_WORKFLOW_DATA_DIR
  else process.env.AGENT_WORKFLOW_DATA_DIR = originalDataDir
})

function createApp(
  fetchImpl: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response> = fetch,
  sessionStorePath?: string,
) {
  process.env.BEEGAME_HTTPONLY_SESSIONS = '1'
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString(
    'base64',
  )
  const app = new Hono()
  registerBeeGameSessionRoutes(app, {
    supabaseUrl: 'https://project.supabase.co',
    supabaseAnonKey: 'anon-key',
    fetchImpl,
    sessionStorePath,
    isOriginAllowed: origin => origin === 'http://127.0.0.1:62173',
  })
  return app
}

async function createSessionStorePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'beegame-session-routes-'))
  temporaryDirectories.push(directory)
  return join(directory, 'sessions.json')
}

function supabaseFetch(userId = 'user-1') {
  return async (
    input: Parameters<typeof fetch>[0],
    _init?: Parameters<typeof fetch>[1],
  ) => {
    if (String(input).includes('/token?grant_type=refresh_token')) {
      return Response.json({
        access_token: 'refreshed-access-token',
        expires_in: 3600,
      })
    }
    expect(String(input)).toBe('https://project.supabase.co/auth/v1/user')
    return Response.json({ id: userId, email: 'user@example.com' })
  }
}

describe('HttpOnly session routes', () => {
  it('prefers a refreshed HttpOnly session token over a stale bearer token', async () => {
    const request = new Request(
      'http://localhost/api/projects/project-1/workflow',
      {
        headers: { authorization: 'Bearer expired-bearer-token' },
      },
    )
    const token = await resolveValidRequestAccessToken(request, {
      getAccessToken: () => undefined,
      getValidAccessToken: async () => 'refreshed-session-token',
    })

    expect(token).toBe('refreshed-session-token')
  })

  it('falls back to a bearer token when no refreshable session exists', async () => {
    const request = new Request(
      'http://localhost/api/projects/project-1/workflow',
      {
        headers: { authorization: 'Bearer current-bearer-token' },
      },
    )

    expect(await resolveValidRequestAccessToken(request)).toBe(
      'current-bearer-token',
    )
  })

  it('does not reuse a stale bearer token when a cookie session cannot refresh', async () => {
    const request = new Request(
      'http://localhost/api/projects/project-1/workflow',
      {
        headers: {
          authorization: 'Bearer expired-bearer-token',
          cookie: `${SESSION_COOKIE_NAME}=session-1`,
        },
      },
    )
    const token = await resolveValidRequestAccessToken(request, {
      getAccessToken: () => undefined,
      getValidAccessToken: async () => undefined,
    })

    expect(token).toBeUndefined()
  })

  it('sets a Secure HttpOnly Lax root cookie and refreshes from the cookie', async () => {
    const app = createApp(supabaseFetch())
    const sessionResponse = await app.request('/api/auth/session', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
      }),
    })

    expect(sessionResponse.status).toBe(200)
    const cookie = sessionResponse.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=2592000')

    const cookieValue = cookie.split(';', 1)[0]
    const refreshResponse = await app.request('/api/auth/session/refresh', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        cookie: cookieValue,
      },
    })
    expect(refreshResponse.status).toBe(200)
  })

  it('rejects cross-origin cookie mutations and logs out a valid session', async () => {
    const app = createApp(supabaseFetch())
    const sessionResponse = await app.request('/api/auth/session', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      }),
    })
    const cookie = (sessionResponse.headers.get('set-cookie') ?? '').split(
      ';',
      1,
    )[0]

    const csrfResponse = await app.request('/api/auth/session/logout', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', cookie },
    })
    expect(csrfResponse.status).toBe(403)

    const logoutResponse = await app.request('/api/auth/session/logout', {
      method: 'POST',
      headers: { origin: 'http://localhost', cookie },
    })
    expect(logoutResponse.status).toBe(200)
    expect(logoutResponse.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('allows cookie refresh from a separately hosted trusted dashboard origin', async () => {
    const app = createApp(supabaseFetch())
    const sessionResponse = await app.request('/api/auth/session', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      }),
    })
    const cookie = (sessionResponse.headers.get('set-cookie') ?? '').split(
      ';',
      1,
    )[0]

    const refreshResponse = await app.request('/api/auth/session/refresh', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:62173', cookie },
    })

    expect(refreshResponse.status).toBe(200)
  })

  it('persists a session across route registration', async () => {
    const storePath = await createSessionStorePath()
    const firstApp = createApp(supabaseFetch(), storePath)
    const sessionResponse = await firstApp.request('/api/auth/session', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      }),
    })
    const cookie = (sessionResponse.headers.get('set-cookie') ?? '').split(
      ';',
      1,
    )[0]

    const restartedApp = createApp(supabaseFetch(), storePath)
    const persistedResponse = await restartedApp.request('/api/auth/session', {
      headers: { cookie },
    })

    expect(persistedResponse.status).toBe(200)
    expect(await persistedResponse.json()).toMatchObject({
      authenticated: true,
      user: { id: 'user-1' },
    })
  })

  it('persists refresh updates and logout deletion', async () => {
    const storePath = await createSessionStorePath()
    const firstApp = createApp(supabaseFetch(), storePath)
    const sessionResponse = await firstApp.request('/api/auth/session', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      }),
    })
    const cookie = (sessionResponse.headers.get('set-cookie') ?? '').split(
      ';',
      1,
    )[0]

    const refreshedApp = createApp(supabaseFetch(), storePath)
    const refreshResponse = await refreshedApp.request(
      '/api/auth/session/refresh',
      {
        method: 'POST',
        headers: { origin: 'http://localhost', cookie },
      },
    )
    expect(refreshResponse.status).toBe(200)

    const logoutApp = createApp(supabaseFetch(), storePath)
    const logoutResponse = await logoutApp.request('/api/auth/session/logout', {
      method: 'DELETE',
      headers: { origin: 'http://localhost', cookie },
    })
    expect(logoutResponse.status).toBe(200)

    const afterLogoutApp = createApp(supabaseFetch(), storePath)
    expect(
      (
        await afterLogoutApp.request('/api/auth/session', {
          headers: { cookie },
        })
      ).status,
    ).toBe(401)
  })

  it('ignores records whose refresh-capable session lifetime has expired', async () => {
    const storePath = await createSessionStorePath()
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString(
      'base64',
    )
    const sessionId = 'expired-session-id'
    const record = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1,
      sessionExpiresAt: Date.now() - 1,
      user: { id: 'user-1', role: 'viewer' },
    }
    await Bun.write(
      storePath,
      JSON.stringify({
        [sessionId]: encryptSecret(JSON.stringify(record), 'auth:session'),
      }),
    )

    const app = createApp(supabaseFetch(), storePath)
    const response = await app.request('/api/auth/session', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    })

    expect(response.status).toBe(401)
  })

  it('refreshes an expired access token while the cookie session remains valid', async () => {
    const storePath = await createSessionStorePath()
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString(
      'base64',
    )
    const sessionId = 'refreshable-expired-access-token'
    const record = {
      accessToken: 'expired-access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1,
      sessionExpiresAt: Date.now() + 60_000,
      user: { id: 'user-1', role: 'viewer' },
    }
    await Bun.write(
      storePath,
      JSON.stringify({
        [sessionId]: encryptSecret(JSON.stringify(record), 'auth:session'),
      }),
    )

    const app = createApp(supabaseFetch(), storePath)
    const cookie = `${SESSION_COOKIE_NAME}=${sessionId}`
    expect(
      (await app.request('/api/auth/session', { headers: { cookie } })).status,
    ).toBe(200)

    const refreshResponse = await app.request('/api/auth/session/refresh', {
      method: 'POST',
      headers: { origin: 'http://localhost', cookie },
    })

    expect(refreshResponse.status).toBe(200)
    expect(await refreshResponse.json()).toMatchObject({ authenticated: true })
  })

  it('proactively refreshes a near-expiry token for a background workflow dispatch', async () => {
    const storePath = await createSessionStorePath()
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString(
      'base64',
    )
    const sessionId = 'background-workflow-session'
    const record = {
      accessToken: 'expired-access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 20_000,
      sessionExpiresAt: Date.now() + 60_000,
      user: { id: 'user-1', role: 'viewer' },
    }
    await Bun.write(
      storePath,
      JSON.stringify({
        [sessionId]: encryptSecret(JSON.stringify(record), 'auth:session'),
      }),
    )
    process.env.BEEGAME_HTTPONLY_SESSIONS = '1'
    const app = new Hono()
    const auth = registerBeeGameSessionRoutes(app, {
      supabaseUrl: 'https://project.supabase.co',
      supabaseAnonKey: 'anon-key',
      fetchImpl: supabaseFetch(),
      sessionStorePath: storePath,
    })
    const request = new Request(
      'http://localhost/api/projects/project-1/workflow',
      {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
      },
    )

    expect(await auth?.getValidAccessToken(request)).toBe(
      'refreshed-access-token',
    )
    expect(auth?.getAccessToken(request)).toBe('refreshed-access-token')
    const credential = auth?.getCredential?.(request)
    expect(credential).toBeDefined()
    expect(await credential?.getValidAccessToken({ forceRefresh: true })).toBe(
      'refreshed-access-token',
    )
  })

  it('preserves the cookie session when the auth provider refresh is temporarily unavailable', async () => {
    let refreshUnavailable = false
    const app = createApp(async input => {
      if (String(input).includes('/token?grant_type=refresh_token')) {
        return refreshUnavailable
          ? new Response('upstream unavailable', { status: 503 })
          : Response.json({
              access_token: 'refreshed-access-token',
              expires_in: 3600,
            })
      }
      return Response.json({ id: 'user-1', email: 'user@example.com' })
    })
    const sessionResponse = await app.request('/api/auth/session', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      }),
    })
    const cookie = (sessionResponse.headers.get('set-cookie') ?? '').split(
      ';',
      1,
    )[0]
    refreshUnavailable = true

    const refreshResponse = await app.request('/api/auth/session/refresh', {
      method: 'POST',
      headers: { origin: 'http://localhost', cookie },
    })

    expect(refreshResponse.status).toBe(503)
    expect(
      (await app.request('/api/auth/session', { headers: { cookie } })).status,
    ).toBe(200)
  })

  it('coalesces concurrent refreshes so a rotated refresh token is consumed once', async () => {
    let refreshCalls = 0
    let releaseRefresh: (() => void) | undefined
    const refreshGate = new Promise<void>(resolve => {
      releaseRefresh = resolve
    })
    const app = createApp(async input => {
      if (String(input).includes('/token?grant_type=refresh_token')) {
        refreshCalls += 1
        await refreshGate
        return Response.json({
          access_token: 'refreshed-access-token',
          refresh_token: 'rotated-refresh-token',
          expires_in: 3600,
        })
      }
      return Response.json({ id: 'user-1', email: 'user@example.com' })
    })
    const sessionResponse = await app.request('/api/auth/session', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      }),
    })
    const cookie = (sessionResponse.headers.get('set-cookie') ?? '').split(
      ';',
      1,
    )[0]

    const first = app.request('/api/auth/session/refresh', {
      method: 'POST',
      headers: { origin: 'http://localhost', cookie },
    })
    const second = app.request('/api/auth/session/refresh', {
      method: 'POST',
      headers: { origin: 'http://localhost', cookie },
    })
    await Promise.resolve()
    releaseRefresh?.()
    const responses = await Promise.all([first, second])

    expect(responses.map(response => response.status)).toEqual([200, 200])
    expect(refreshCalls).toBe(1)
  })

  it('leaves legacy behavior untouched when the flag is disabled', async () => {
    process.env.BEEGAME_HTTPONLY_SESSIONS = '0'
    const app = new Hono()
    const routes = registerBeeGameSessionRoutes(app, { fetchImpl: fetch })
    expect(routes).toBeUndefined()
    expect((await app.request('/api/auth/session')).status).toBe(404)
  })
})

describe('delivery workflow session continuation', () => {
  it('persists simultaneous Continue mutations as exactly one resume', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-session-continue-'))
    temporaryDirectories.push(root)
    const projectsRoot = join(root, 'projects')
    const ownerId = 'session-continue-owner'
    const projectId = 'session-continue-project'
    const workspace = join(projectsRoot, 'users', ownerId, projectId)
    await mkdir(workspace, { recursive: true })
    let workflowWorkerStarts = 0
    let workflowControllerResumeCalls = 0
    const createDeliveryController =
      deliveryControllerModule.createDeliveryWorkflowController
    const controllerFactory = spyOn(
      deliveryControllerModule,
      'createDeliveryWorkflowController',
    ).mockImplementation(input => {
      const controller = createDeliveryController(input)
      const resume = controller.resume
      return {
        ...controller,
        resume: run => {
          workflowControllerResumeCalls += 1
          return resume(run)
        },
      }
    })
    const runner: BeeGameSessionRunner = {
      start: async input => {
        if (input.workflowWorker) workflowWorkerStarts += 1
        return {
          submit: async ({ signal }) =>
            new Promise<void>(resolve => {
              signal.addEventListener('abort', () => resolve(), { once: true })
            }),
          stop: () => undefined,
        }
      },
    }
    const cleanups: Array<() => void> = []
    const app = createAgentWorkflowApp({
      currentUser: { id: ownerId, role: 'owner' },
      dashboardDataRoot: join(root, 'dashboard'),
      defaultWorkspacePath: projectsRoot,
      modelConfigStore: false,
      skillsConfig: false,
      sessionRunner: runner,
      registerCleanup: cleanup => cleanups.push(cleanup),
    })

    try {
      const projectResponse = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: projectId,
          name: 'Session continuation fixture',
          root_path: workspace,
          created_at: Date.now(),
        }),
      })
      expect(projectResponse.status).toBe(200)
      const modelConfigResponse = await app.request('/api/model-configs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Session continuation model',
          provider: 'openai-compatible',
          apiKey: 'test-api-key',
          models: { balanced: 'test-model' },
          isDefault: true,
        }),
      })
      expect(modelConfigResponse.status).toBe(200)
      const removedLegacyCreateResponse = await app.request(
        '/api/beegame-sessions',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            projectId,
            workspacePath: join(projectsRoot, 'client-selected-workspace'),
          }),
        },
      )
      expect(removedLegacyCreateResponse.status).toBe(404)
      const sessionResponse = await app.request(
        `/api/projects/${encodeURIComponent(projectId)}/session/ensure`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ language: 'English' }),
        },
      )
      const sessionPayload = (await sessionResponse.clone().json()) as {
        session?: { id: string }
        error?: string
      }
      expect({
        status: sessionResponse.status,
        error: sessionPayload.error,
      }).toEqual({
        status: 200,
        error: undefined,
      })
      const session = (
        (await sessionResponse.json()) as {
          session: { id: string }
        }
      ).session

      const brief = JSON.stringify({
        kind: 'confirmed_build_brief',
        resource_library_usage: 'optional',
        document_language: 'English',
        game_user_visible_language: 'English',
        agent_response_language: 'English',
      })
      const confirmedBriefDigest = createHash('sha256')
        .update(brief)
        .digest('hex')
      const [documentRevision, workspaceRevision] = await Promise.all([
        computeDocumentRevision(workspace, confirmedBriefDigest),
        computeWorkspaceRevision(workspace),
      ])
      const run = createTestDeliveryRun({
        runId: 'session-continue-run',
        projectId,
        ownerId,
        confirmedBriefContext: brief,
        foundationDraftComplete: false,
      })
      const usage = {
        input_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      }
      const store = createRunStore(workspace, ownerId)
      const journalRun = {
        ...run,
        phase: 'DOCUMENT_DRAFTING' as const,
        documentStep: 'FOUNDATION_DRAFTING' as const,
        currentItemId: CANONICAL_FOUNDATION_DOCUMENTS[0],
        status: 'stopped' as const,
        blockedReason: 'Synthetic interrupted turn.',
        usage,
        revision: {
          document: documentRevision,
          workspace: workspaceRevision,
        },
      }
      await store.commit(journalRun, {
        runId: journalRun.runId,
        type: 'run.created',
        phase: journalRun.phase,
        status: journalRun.status,
        revision: journalRun.revision,
        createdAt: journalRun.createdAt,
      })
      await store.commit(journalRun, {
        runId: journalRun.runId,
        type: 'usage.updated',
        phase: journalRun.phase,
        status: journalRun.status,
        revision: journalRun.revision,
        usage,
      })
      const responses = await Promise.all([
        app.request(`/api/beegame-sessions/${session.id}/continue`, {
          method: 'POST',
        }),
        app.request(`/api/beegame-sessions/${session.id}/continue`, {
          method: 'POST',
        }),
      ])
      const responseBodies = await Promise.all(
        responses.map(response => response.clone().json()),
      )

      expect({
        statuses: responses.map(response => response.status),
        responseBodies,
      }).toEqual({
        statuses: [200, 200],
        responseBodies: [
          expect.not.objectContaining({ error: expect.any(String) }),
          expect.not.objectContaining({ error: expect.any(String) }),
        ],
      })
      expect(workflowWorkerStarts).toBe(1)
      expect(await store.load()).toMatchObject({
        schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
        runId: 'session-continue-run',
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        activeDispatch: {
          workerType: 'document-author',
          status: 'running',
        },
      })
      expect(
        (await store.readEvents()).filter(
          event => event.type === 'run.resumed',
        ),
      ).toHaveLength(1)
      expect(controllerFactory).toHaveBeenCalledTimes(1)
      const validProjectBoundaries = await Promise.all([
        app.request(`/api/projects/${projectId}/workflow/resume`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ language: 'en' }),
        }),
        app.request(`/api/projects/${projectId}/workflow/retry`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ language: 'en' }),
        }),
      ])
      expect(validProjectBoundaries.map(response => response.status)).toEqual([
        200, 202,
      ])
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(workflowWorkerStarts).toBe(1)
      expect(workflowControllerResumeCalls).toBe(1)
      expect(controllerFactory).toHaveBeenCalledTimes(1)
      expect(
        (await store.readEvents()).filter(
          event => event.type === 'run.resumed',
        ),
      ).toHaveLength(1)

      const currentSnapshot = JSON.parse(
        await readFile(store.paths.snapshot, 'utf8'),
      ) as Record<string, unknown>
      const firstEvent = (await store.readEvents())[0]!
      await writeFile(
        store.paths.snapshot,
        `${JSON.stringify(
          { ...currentSnapshot, pendingEvents: [firstEvent] },
          null,
          2,
        )}\n`,
      )
      const snapshotBeforeReads = await readFile(store.paths.snapshot, 'utf8')
      const eventsBeforeReads = await readFile(store.paths.events, 'utf8')
      const filesBeforeReads = (
        await readdir(workspace, { recursive: true })
      ).toSorted()
      const startsBeforeReads = workflowWorkerStarts
      const readResponses = await Promise.all([
        app.request(`/api/projects/${projectId}/workflow`),
        app.request(`/api/projects/${projectId}/workflow/events`),
        app.request(`/api/projects/${projectId}/runtime-state`),
      ])
      expect(readResponses.map(response => response.status)).toEqual([
        200, 200, 200,
      ])
      expect(await readFile(store.paths.snapshot, 'utf8')).toBe(
        snapshotBeforeReads,
      )
      expect(await readFile(store.paths.events, 'utf8')).toBe(eventsBeforeReads)
      expect(
        (await readdir(workspace, { recursive: true })).toSorted(),
      ).toEqual(filesBeforeReads)
      expect(workflowWorkerStarts).toBe(startsBeforeReads)

      await writeFile(
        store.paths.snapshot,
        `${JSON.stringify(
          {
            ...journalRun,
            schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
            invalidRecoveryMarker: true,
            phase: 'DOCUMENT_DRAFTING',
            documentStep: 'FOUNDATION_DRAFTING',
            status: 'running',
            currentItemId: undefined,
            activeDispatch: undefined,
          },
          null,
          2,
        )}\n`,
      )
      const startsBeforeHardFail = workflowWorkerStarts
      const hardFailBoundaries = await Promise.all([
        app.request(`/api/projects/${projectId}/workflow/resume`, {
          method: 'POST',
        }),
        app.request(`/api/projects/${projectId}/workflow/retry`, {
          method: 'POST',
        }),
        app.request(`/api/beegame-sessions/${session.id}/continue`, {
          method: 'POST',
        }),
      ])
      expect(hardFailBoundaries.map(response => response.status)).toEqual([
        409, 409, 400,
      ])
      expect(workflowWorkerStarts).toBe(startsBeforeHardFail)

      const acceptedPath = CANONICAL_FOUNDATION_DOCUMENTS[0]
      const acceptedDispatchId = 'accepted-foundation-draft'
      await mkdir(join(workspace, 'docs'), { recursive: true })
      await writeFile(
        join(workspace, acceptedPath),
        withTestDocumentMetadata(
          acceptedPath,
          completeTestFoundationDocument(acceptedPath),
        ),
      )
      await commitAuthoredFoundationDocument({
        workspacePath: workspace,
        dispatchId: acceptedDispatchId,
        targetPath: acceptedPath,
      })
      const recoverableRevision = {
        document: await computeDocumentRevision(
          workspace,
          journalRun.confirmedBriefDigest,
        ),
        workspace: await computeWorkspaceRevision(workspace),
      }
      const recoverablePath = CANONICAL_FOUNDATION_DOCUMENTS[1]
      const recoverableDispatchId = 'recoverable-foundation-draft'
      const recoverableRequest = {
        dispatchId: recoverableDispatchId,
        runId: journalRun.runId,
        ownerId,
        projectId,
        workspacePath: workspace,
        workerType: 'document-author' as const,
        phase: 'DOCUMENT_DRAFTING' as const,
        taskId: recoverablePath,
        revision: recoverableRevision.document,
        allowedPaths: [recoverablePath],
        contract: {
          confirmedBriefDigest: journalRun.confirmedBriefDigest,
          documentSet: 'foundation',
          authoringMode: 'initial',
          foundationDocumentPath: recoverablePath,
          upstreamDocumentPaths: [acceptedPath],
        },
      }
      const recoverableSnapshot = {
        ...journalRun,
        schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
        invalidRecoveryMarker: true,
        phase: 'DOCUMENT_DRAFTING' as const,
        documentStep: 'FOUNDATION_DRAFTING' as const,
        status: 'running' as const,
        currentItemId: recoverablePath,
        activeDispatch: {
          dispatchId: recoverableDispatchId,
          workerType: 'document-author' as const,
          phase: 'DOCUMENT_DRAFTING' as const,
          taskId: recoverablePath,
          revision: recoverableRevision.document,
          status: 'running' as const,
          startedAt: journalRun.updatedAt,
          request: recoverableRequest,
        },
        revision: recoverableRevision,
        foundationDraftState: { completedPaths: [acceptedPath] },
      }
      await writeFile(
        store.paths.snapshot,
        `${JSON.stringify(recoverableSnapshot, null, 2)}\n`,
      )
      await store.appendEvent({
        runId: journalRun.runId,
        type: 'workflow.unit.accepted',
        phase: 'DOCUMENT_DRAFTING',
        status: journalRun.status,
        revision: recoverableRevision,
        createdAt: journalRun.updatedAt,
        projectId,
        ownerId,
        unit: {
          eventSchemaVersion: 1,
          unitId: `document:${acceptedPath}`,
          kind: 'document',
          phase: 'DOCUMENT_DRAFTING',
          predecessorUnitIds: [],
          inputRevision: recoverableRevision.document,
          dependencyDigests: {},
          dispatchId: acceptedDispatchId,
          receiptRef: `.beegame/workflow/document-commits/${acceptedDispatchId}.json`,
          acceptedAt: journalRun.updatedAt,
          payload: {
            path: acceptedPath,
            revision: recoverableRevision.document,
          },
        },
      })
      const snapshotBeforeRecoveryRead = await readFile(
        store.paths.snapshot,
        'utf8',
      )
      const eventsBeforeRecoveryRead = await readFile(
        store.paths.events,
        'utf8',
      )
      const startsBeforeRecoveryRead = workflowWorkerStarts
      const recoveryRead = await app.request(
        `/api/projects/${projectId}/workflow`,
      )
      const recoveryPayload = (await recoveryRead.json()) as {
        workflow?: Record<string, unknown>
      }
      expect(recoveryRead.status).toBe(200)
      expect(recoveryPayload.workflow).toMatchObject({
        recoverable: true,
        lastProvenPhase: 'DOCUMENT_DRAFTING',
        lastProvenUnitId: `document:${acceptedPath}`,
        lastProvenUnitKind: 'document',
        lastProvenItemId: acceptedPath,
        nextAction: 'resume',
      })
      expect(await readFile(store.paths.snapshot, 'utf8')).toBe(
        snapshotBeforeRecoveryRead,
      )
      expect(await readFile(store.paths.events, 'utf8')).toBe(
        eventsBeforeRecoveryRead,
      )
      expect(workflowWorkerStarts).toBe(startsBeforeRecoveryRead)
      await writeFile(store.paths.events, eventsBeforeRecoveryRead)
      const startsBeforeInvalidRecovery = workflowWorkerStarts
      const recoveredInvalid = await app.request(
        `/api/projects/${projectId}/workflow/resume`,
        { method: 'POST' },
      )
      expect({
        status: recoveredInvalid.status,
        body: await recoveredInvalid.clone().json(),
      }).toEqual({
        status: 200,
        body: expect.not.objectContaining({ error: expect.any(String) }),
      })
      expect(workflowWorkerStarts).toBe(startsBeforeInvalidRecovery + 1)
      expect(
        (await store.readEvents()).filter(
          event => event.type === 'workflow.run.reconstructed',
        ),
      ).toHaveLength(1)

      await writeFile(store.paths.events, eventsBeforeRecoveryRead)
      await writeFile(
        store.paths.snapshot,
        `${JSON.stringify(recoverableSnapshot, null, 2)}\n`,
      )
      const startsBeforeRetryRecovery = workflowWorkerStarts
      const resumesBeforeRetryRecovery = workflowControllerResumeCalls
      const recoveredRetry = await app.request(
        `/api/projects/${projectId}/workflow/retry`,
        { method: 'POST' },
      )
      expect(recoveredRetry.status).toBe(202)
      expect(workflowWorkerStarts).toBe(startsBeforeRetryRecovery + 1)
      expect(workflowControllerResumeCalls).toBe(resumesBeforeRetryRecovery + 1)
      expect(
        (await store.readEvents()).filter(
          event => event.type === 'workflow.run.reconstructed',
        ),
      ).toHaveLength(1)
    } finally {
      controllerFactory.mockRestore()
      for (const cleanup of cleanups) cleanup()
    }
  })

  it('reconciles a running workflow whose worker disappeared before rendering it', async () => {
    const root = await mkdtemp(
      join(tmpdir(), 'beegame-orphaned-workflow-read-'),
    )
    temporaryDirectories.push(root)
    const projectsRoot = join(root, 'projects')
    const ownerId = 'orphaned-workflow-owner'
    const projectId = 'orphaned-workflow-project'
    const workspace = join(projectsRoot, 'users', ownerId, projectId)
    await mkdir(workspace, { recursive: true })
    const app = createAgentWorkflowApp({
      currentUser: { id: ownerId, role: 'owner' },
      dashboardDataRoot: join(root, 'dashboard'),
      defaultWorkspacePath: projectsRoot,
      modelConfigStore: false,
      skillsConfig: false,
    })

    const projectResponse = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: 'Orphaned workflow fixture',
        root_path: workspace,
        created_at: Date.now(),
      }),
    })
    expect(projectResponse.status).toBe(200)

    const ownerBrief = JSON.stringify({
      kind: 'confirmed_build_brief',
      resource_library_usage: 'optional',
    })
    const run = createTestDeliveryRun({
      runId: 'orphaned-workflow-run',
      projectId,
      ownerId,
      confirmedBriefContext: ownerBrief,
      foundationDraftComplete: true,
    })
    const store = createRunStore(workspace, ownerId)
    await store.save({
      ...run,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      activeDispatch: {
        dispatchId: 'orphaned-review-dispatch',
        workerType: 'document-reviewer',
        phase: 'DOCUMENT_REVIEW',
        revision: run.revision.document,
        status: 'running',
        startedAt: run.updatedAt,
      },
    })

    const response = await app.request(`/api/projects/${projectId}/workflow`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      workflow: {
        status: 'stopped',
        nextAction: 'resume',
      },
    })
    expect(await store.load()).toMatchObject({
      status: 'stopped',
      thinking: 'idle',
      activeDispatch: { status: 'interrupted' },
    })
  })

  it('serves frozen stage history plus one live current card without writing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-stage-history-route-'))
    temporaryDirectories.push(root)
    const projectsRoot = join(root, 'projects')
    const ownerId = 'stage-history-owner'
    const projectId = 'stage-history-project'
    const workspace = join(projectsRoot, 'users', ownerId, projectId)
    await mkdir(workspace, { recursive: true })
    const app = createAgentWorkflowApp({
      currentUser: { id: ownerId, role: 'owner' },
      dashboardDataRoot: join(root, 'dashboard'),
      defaultWorkspacePath: projectsRoot,
      modelConfigStore: false,
      skillsConfig: false,
    })
    const projectResponse = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: 'Stage history fixture',
        root_path: workspace,
        created_at: Date.now(),
      }),
    })
    expect(projectResponse.status).toBe(200)

    const baseRun = createTestDeliveryRun({
      runId: 'stage-history-route-run',
      projectId,
      ownerId,
    })
    const reviewRevision = 'a'.repeat(64)
    const reportPath = `.beegame/reviews/foundation/${reviewRevision}/review.json`
    const reportJson = `${JSON.stringify({
      version: 2,
      scope: 'foundation',
      revision: reviewRevision,
      verdict: 'NEEDS_REVISION',
      priorConflictStatus: [],
      conflicts: [
        {
          id: 'B1',
          title: 'Economy result is not implementable',
          problem: 'The reward owner and consumer use incompatible units.',
          evidence: [
            {
              path: 'docs/GDD.md',
              location: 'Reward outcome',
              observed: 'Rewards are expressed as a percentage.',
            },
          ],
          requiredOutcome: 'Use one integer reward unit.',
          changes: [
            {
              path: 'docs/GDD.md',
              action: 'Define rewards as integer currency units.',
            },
          ],
          acceptance: ['All reward values use integer currency units.'],
        },
      ],
    })}\n`
    await mkdir(
      join(workspace, '.beegame', 'reviews', 'foundation', reviewRevision),
      { recursive: true },
    )
    await writeFile(join(workspace, reportPath), reportJson)
    const run: DeliveryRun = {
      ...baseRun,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      foundationReviewState: {
          ...createFoundationReviewState({
            revision: reviewRevision,
            attempt: 1,
          }),
          reports: createFoundationReviewState({
            revision: reviewRevision,
            attempt: 1,
          }).reports.map((report, index) =>
            index < 2
              ? {
                  ...report,
                  status: 'completed' as const,
                  durationMs: index === 0 ? 10_000 : 15_000,
                  usage: {
                    input_tokens: index === 0 ? 120 : 100,
                    cache_read_tokens: index === 0 ? 340 : 300,
                    cache_creation_tokens: index === 0 ? 3 : 4,
                    completion_tokens: index === 0 ? 56 : 40,
                    total_tokens: index === 0 ? 519 : 444,
                  },
                  dispatch: {
                    dispatchId: `review-display-${index}`,
                    workerType: 'document-reviewer' as const,
                    phase: 'DOCUMENT_REVIEW' as const,
                    revision: reviewRevision,
                    status: 'completed' as const,
                    startedAt:
                      index === 0
                        ? '2026-08-06T00:00:00.000Z'
                        : '2026-08-06T00:00:05.000Z',
                    finishedAt:
                      index === 0
                        ? '2026-08-06T00:00:10.000Z'
                        : '2026-08-06T00:00:20.000Z',
                  },
                }
              : report,
          ),
          status: 'completed',
          verdict: 'NEEDS_REVISION',
          finalReportPath: reportPath,
          finalReportDigest: createHash('sha256')
            .update(reportJson)
            .digest('hex'),
      },
      foundationRemediationState: {
        reviewPath: reportPath,
        reviewDigest: createHash('sha256').update(reportJson).digest('hex'),
        sourceRevision: reviewRevision,
        lanes: [
          {
            id: 'core-design',
            ownedPaths: [
              'docs/GDD.md',
              'docs/LEVEL_SCENE_DESIGN.md',
              'docs/BALANCE_DESIGN.md',
            ],
            affectedPaths: ['docs/GDD.md'],
            status: 'pending',
          },
          {
            id: 'technical-assets',
            ownedPaths: ['docs/TECHNICAL_DESIGN.md', 'docs/ASSET_PLAN.md'],
            affectedPaths: ['docs/TECHNICAL_DESIGN.md'],
            status: 'failed',
            failureReason: '技术修订写入失败',
            dispatch: {
              dispatchId: 'foundation-remediation-technical-assets',
              taskId: 'foundation-remediation:technical-assets',
              workerType: 'document-author',
              phase: 'DOCUMENT_DRAFTING',
              revision: reviewRevision,
              status: 'failed',
              startedAt: '2026-08-06T00:00:00.000Z',
              finishedAt: '2026-08-06T00:00:12.000Z',
              failureReason: '技术修订写入失败',
            },
          },
          {
            id: 'presentation',
            ownedPaths: [
              'docs/ART_DIRECTION.md',
              'docs/UI_UX_SPEC.md',
              'docs/AUDIO_DESIGN.md',
            ],
            affectedPaths: [],
            status: 'not_required',
          },
        ],
      },
      currentMessage: 'live stage status',
      blockedReason: 'current-only recovery detail',
      usage: {
        input_tokens: 1,
        cache_read_tokens: 2,
        cache_creation_tokens: 3,
        completion_tokens: 4,
        total_tokens: 10,
      },
      createdAt: '2026-08-06T00:00:00.000Z',
      updatedAt: '2026-08-06T00:00:10.000Z',
    }
    const store = createRunStore(workspace, ownerId)
    await store.save(run)
    await store.appendEvent(frozenStageEvent(run, 1, 'BRIEF_CONFIRMED'))
    await store.appendEvent(frozenStageEvent(run, 2, 'DOCUMENT_DRAFTING'))

    const snapshotBeforeRead = await readFile(store.paths.snapshot, 'utf8')
    const eventsBeforeRead = await readFile(store.paths.events, 'utf8')
    const response = await app.request(`/api/projects/${projectId}/workflow`)
    const payload = (await response.json()) as {
      workflow?: Record<string, unknown>
    }
    expect(response.status).toBe(200)
    const workflow = payload.workflow as Record<string, unknown>
    expect(workflow).not.toHaveProperty('foundationReview')
    expect(workflow).not.toHaveProperty('documentReview')
    expect(workflow.tasks).toEqual([
      {
        id: 'foundation-remediation:core-design',
        title: '修订核心设计',
        status: 'pending',
        attempt: 1,
        operation: 'write',
      },
      {
        id: 'foundation-remediation:technical-assets',
        title: '修订技术与资产',
        status: 'failed',
        attempt: 1,
        operation: 'write',
        failureReason: '技术修订写入失败',
      },
      {
        id: 'foundation-remediation:presentation',
        title: '修订表现体验',
        status: 'completed',
        attempt: 1,
        operation: 'write',
      },
      {
        id: 'review:foundation:verification',
        title: '修订结果',
        status: 'pending',
        attempt: 1,
        operation: 'review',
      },
    ])
    const cards = workflow.stageSnapshots as Array<Record<string, unknown>>
    expect(cards.map(card => card.phaseIndex)).toEqual([1, 2, 3])
    expect(cards[0]).toMatchObject({
      stageId: 'BRIEF_CONFIRMED',
      status: 'completed',
      message: 'frozen stage status',
      block: { message: 'frozen recovery detail' },
    })
    expect(cards[0]?.block).not.toHaveProperty('nextAction')
    expect(cards.at(-1)).toMatchObject({
      stageId: 'DOCUMENT_REVIEW',
      status: 'running',
      message: 'live stage status',
      block: {
        message: 'current-only recovery detail',
        nextAction: 'retry',
      },
    })
    expect(cards.at(-1)?.usage).toBeUndefined()
    expect(cards.at(-1)?.evidence).toBeUndefined()
    expect(workflow.nextAction).toBeUndefined()
    expect(await readFile(store.paths.snapshot, 'utf8')).toBe(
      snapshotBeforeRead,
    )
    expect(await readFile(store.paths.events, 'utf8')).toBe(eventsBeforeRead)
    const runtimeResponse = await app.request(
      `/api/projects/${projectId}/runtime-state`,
    )
    const runtimePayload = (await runtimeResponse.json()) as {
      workflow?: Record<string, unknown>
    }
    expect(runtimeResponse.status).toBe(200)
    expect((runtimePayload.workflow?.stageSnapshots as unknown[]).length).toBe(
      3,
    )

    const legacyRun = { ...run, runId: 'legacy-stage-history-run' }
    const legacyWorkspace = join(projectsRoot, 'users', ownerId, 'legacy')
    await mkdir(legacyWorkspace, { recursive: true })
    const legacyStore = createRunStore(legacyWorkspace, ownerId)
    const legacyProjectId = 'legacy-stage-history-project'
    await legacyStore.save({ ...legacyRun, projectId: legacyProjectId })
    const legacyProjectResponse = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: legacyProjectId,
        name: 'Legacy stage history fixture',
        root_path: legacyWorkspace,
        created_at: Date.now(),
      }),
    })
    expect(legacyProjectResponse.status).toBe(200)
    const legacyResponse = await app.request(
      `/api/projects/${legacyProjectId}/workflow`,
    )
    const legacyPayload = (await legacyResponse.json()) as {
      workflow?: Record<string, unknown>
    }
    expect(legacyResponse.status).toBe(200)
    const legacyCards = legacyPayload.workflow?.stageSnapshots as Array<
      Record<string, unknown>
    >
    expect(legacyCards).toHaveLength(1)
    expect(legacyCards[0]?.stageId).toBe('DOCUMENT_REVIEW')
  })
})

function frozenStageEvent(
  run: DeliveryRun,
  phaseIndex: 1 | 2,
  phase: 'BRIEF_CONFIRMED' | 'DOCUMENT_DRAFTING',
): WorkflowEvent {
  const createdAt = `2026-08-06T00:00:0${phaseIndex}.000Z`
  return {
    eventId: `stage-history-event-${phaseIndex}`,
    runId: run.runId,
    type: 'phase.entered',
    phase,
    status: 'running',
    revision: run.revision,
    createdAt,
    stageSnapshot: {
      stageId: phase,
      phaseIndex,
      phaseCount: 9,
      status: 'completed',
      currentPhase: phase,
      message: 'frozen stage status',
      tasks: [],
      completedTaskCount: 0,
      totalTaskCount: 0,
      createdAt,
      updatedAt: createdAt,
      completedAt: createdAt,
      elapsedMs: 1000,
      block: { message: 'frozen recovery detail', nextAction: 'retry' },
    },
  }
}
