import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import {
  appendFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
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
import { BeeGameAuthUnavailableError } from '../auth/user-context'
import type { BeeGamePromptInput, BeeGameSessionRunnerStartInput } from '../beegame/session-manager'
import { recoverLatestProjectSessionFromDisk } from '../beegame/session-manager'
import { beginProjectDelivery, readProjectDelivery } from '../beegame/project-delivery'

const originalFlag = process.env.BEEGAME_HTTPONLY_SESSIONS
const originalKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
const originalDataDir = process.env.AGENT_WORKFLOW_DATA_DIR
const temporaryDirectories: string[] = []

// The original request and host context are distinct native input blocks.
// Platform context precedes the user's text so native Skill discovery reads
// user intent from the final text block. These fixtures have no attachments.
function requestText(prompt: BeeGamePromptInput): string {
  if (typeof prompt === 'string') return prompt
  expect(prompt).toHaveLength(2)
  const [context, request] = prompt
  expect(context?.type).toBe('text')
  if (context?.type === 'text') expect(context.text).toStartWith('BGS project state')
  expect(request?.type).toBe('text')
  return request?.type === 'text' ? request.text : ''
}

it('runtime returns recoverable 503 rather than 401 when token resolution is unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-auth-unavailable-'))
  temporaryDirectories.push(root)
  const cleanups: Array<() => void> = []
  const app = createAgentWorkflowApp({
    dashboardDataRoot: root, modelConfigStore: false, skillsConfig: false,
    currentUserResolver: async () => { throw new BeeGameAuthUnavailableError() },
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  try {
    const response = await app.request('/api/usage-wallet')
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('2')
    expect(await response.json()).toMatchObject({ code: 'authentication_unavailable', recoverable: true })
  } finally { cleanups.forEach(cleanup => cleanup()) }
})

it('project chat handles the user request while paused; only explicit Continue resumes delivery', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-project-chat-route-')))
  temporaryDirectories.push(root)
  const ownerId = 'conversation-owner'
  const projectId = 'conversation-project'
  const projectsRoot = join(root, 'projects')
  const workspace = join(projectsRoot, 'users', ownerId, projectId)
  await mkdir(workspace, { recursive: true })
  const prompts: BeeGamePromptInput[] = []
  let starts = 0
  let release: (() => void) | undefined
  const cleanups: Array<() => void> = []
  const app = createAgentWorkflowApp({
    currentUser: { id: ownerId, role: 'owner' }, dashboardDataRoot: join(root, 'dashboard'),
    defaultWorkspacePath: projectsRoot, modelConfigStore: false, skillsConfig: false,
    registerCleanup: cleanup => cleanups.push(cleanup),
    sessionRunner: { start: async input => {
      starts++
      expect(input.cwd).toBe(workspace)
      return { stop() { release?.() }, submit: async turn => {
        prompts.push(turn.prompt)
        await new Promise<void>(resolve => { release = resolve; turn.signal.addEventListener('abort', () => resolve(), { once: true }) })
        await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
      } }
    } },
  })
  const post = (url: string, body: unknown) => app.request(url, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    expect((await post('/api/projects', { id: projectId, name: 'Conversation test', root_path: workspace, created_at: Date.now() })).status).toBe(200)
    expect((await post('/api/model-configs', { name: 'Mock runtime', provider: 'openai-compatible', apiKey: 'fake', models: { balanced: 'fake' }, isDefault: true })).status).toBe(200)
    const ensured = await post(`/api/projects/${projectId}/session/ensure`, { language: 'zh' })
    expect(ensured.status).toBe(200)
    const { session } = await ensured.json() as { session: { id: string } }
    await beginProjectDelivery(workspace, join(root, 'dashboard'), 'Build the original game')
    expect((await post(`/api/projects/${projectId}/stop`, {})).status).toBe(200)
    expect((await readProjectDelivery(workspace, join(root, 'dashboard')))?.status).toBe('paused')
    const recovered = await post(`/api/projects/${projectId}/session/ensure`, { language: 'zh' })
    expect((await recovered.json() as { session: { id: string } }).session.id).toBe(session.id)
    const sent = await post(`/api/beegame-sessions/${session.id}/input`, { text: '按钮没字，请修复', clientMessageId: 'request-one', language: 'zh' })
    expect({ httpStatus: sent.status, ...(await sent.json() as object) }).toMatchObject({ httpStatus: 202, status: 'running', turnStatus: 'running' })
    expect((await readProjectDelivery(workspace, join(root, 'dashboard')))?.status).toBe('paused')
    for (let i = 0; i < 200 && prompts.length === 0; i++) await Bun.sleep(5)
    if (!prompts.length) {
      const transcript = await (await app.request(`/api/beegame-sessions/${session.id}/transcript`)).json() as Array<{ type: string; text: string }>
      expect(transcript.filter(e => e.type === 'turn.failed').map(e => e.text)).toEqual([])
    }
    expect(prompts.map(requestText)).toEqual(['按钮没字，请修复'])
    expect(JSON.stringify(prompts[0])).toContain('BGS project state')
    const state = await (await app.request(`/api/projects/${projectId}/runtime-state`)).json() as Record<string, unknown>
    expect(state.phase).toBe('running')
    expect(state.blocked).toBe(false)
    // Transport retries are keyed by request ID, never by matching text.
    expect((await post(`/api/beegame-sessions/${session.id}/input`, { text: '按钮没字，请修复', clientMessageId: 'request-one', language: 'zh' })).status).toBe(202)
    expect(prompts).toHaveLength(1)
    release?.()
    for (let i = 0; i < 200; i++) {
      const current = await (await app.request(`/api/beegame-sessions/${session.id}`)).json() as { turnStatus: string }
      const queue = await (await app.request(`/api/projects/${projectId}/queued-messages`)).json() as { messages: unknown[] }
      if (current.turnStatus === 'idle' && queue.messages.length === 0) break
      await Bun.sleep(5)
    }
    expect((await (await app.request(`/api/beegame-sessions/${session.id}`)).json() as { turnStatus: string }).turnStatus).toBe('idle')
    expect((await readProjectDelivery(workspace, join(root, 'dashboard')))?.status).toBe('paused')
    expect(prompts).toHaveLength(1)
    // A normal chat reply is not authorization to resume paused production.
    const continuation = await post(`/api/beegame-sessions/${session.id}/continue`, { language: 'zh' })
    expect(continuation.status).toBe(202)
    for (let i = 0; i < 200 && prompts.length < 2; i++) await Bun.sleep(5)
    expect(prompts).toHaveLength(2)
    expect((await readProjectDelivery(workspace, join(root, 'dashboard')))?.status).toBe('active')
    expect(requestText(prompts[0]!)).toBe('按钮没字，请修复')
    // The explicit continuation supplies the actual production assignment.
    expect(JSON.stringify(prompts[1])).toContain('milestone: author')
    expect(JSON.stringify(prompts[1])).toContain('Current delivery milestone: author.')
    // Repeated Continue during the active turn must not start a third turn.
    expect((await post(`/api/beegame-sessions/${session.id}/continue`, { language: 'zh' })).status).toBe(202)
    expect(prompts).toHaveLength(2)
    // A second turn reuses the same native process/session.
    expect(starts).toBe(1)
    release?.()
  } finally { release?.(); for (const cleanup of cleanups) await cleanup() }
})

it('does not offer a stopped native permission as actionable after service restart', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-stale-permission-')))
  temporaryDirectories.push(root)
  const ownerId = 'permission-owner'
  const projectId = 'permission-project'
  const projectsRoot = join(root, 'projects')
  const workspace = join(projectsRoot, 'users', ownerId, projectId)
  await mkdir(workspace, { recursive: true })
  const cleanups: Array<() => void | Promise<void>> = []
  const options = { currentUser: { id: ownerId, role: 'owner' as const },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: projectsRoot,
    modelConfigStore: false as const, skillsConfig: false as const }
  const app = createAgentWorkflowApp({ ...options,
    registerCleanup: cleanup => cleanups.push(cleanup),
    sessionRunner: { start: async () => ({ stop() {}, submit: async turn => {
      await turn.requestPermission({ toolUseID: 'native-permission', toolName: 'SandboxNetworkAccess',
        input: { host: 'registry.npmjs.org' }, message: 'Network access requires permission.' })
    } }) },
  })
  const post = (target: typeof app, url: string, body: unknown) => target.request(url, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    expect((await post(app, '/api/projects', { id: projectId, name: 'Permission test',
      root_path: workspace, created_at: Date.now() })).status).toBe(200)
    expect((await post(app, '/api/model-configs', { name: 'Offline', provider: 'openai-compatible',
      apiKey: 'fake', models: { balanced: 'fake' }, isDefault: true })).status).toBe(200)
    const ensured = await post(app, `/api/projects/${projectId}/session/ensure`, {})
    const { session } = await ensured.json() as { session: { id: string } }
    expect((await post(app, `/api/beegame-sessions/${session.id}/input`, {
      text: 'Offline permission fixture', clientMessageId: 'permission-fixture',
    })).status).toBe(202)
    for (let i = 0; i < 200; i++) {
      const state = await (await app.request(`/api/projects/${projectId}/runtime-state`)).json() as {
        pending_permissions: unknown[]
      }
      if (state.pending_permissions.length) break
      await Bun.sleep(5)
    }
    const waiting = await (await app.request(`/api/projects/${projectId}/runtime-state`)).json() as {
      phase: string; pending_permissions: unknown[]
    }
    expect(waiting.phase).toBe('waiting_approval')
    expect(waiting.pending_permissions).toHaveLength(1)
    expect((await post(app, `/api/projects/${projectId}/stop`, {})).status).toBe(200)
    for (const cleanup of cleanups.splice(0)) await cleanup()

    // The native callback is gone. A late duplicate with no turn ID is still
    // part of the transcript, but can never be answered by the new process.
    const recovered = await recoverLatestProjectSessionFromDisk(workspace)
    expect(recovered?.transcriptPath).toBeTruthy()
    await appendFile(join(workspace, recovered!.transcriptPath), `${JSON.stringify({ id: 999_998, sessionId: session.id, type: 'system.status',
      text: 'task_started', createdAt: new Date().toISOString(),
      payload: { type: 'system', subtype: 'task_started', task_id: 'orphaned-child',
        tool_use_id: 'orphaned-child-use' },
    })}\n${JSON.stringify({ id: 999_999,
      sessionId: session.id, type: 'permission.requested',
      text: 'Network access requires permission.', createdAt: new Date().toISOString(),
      payload: { type: 'permission.requested', toolUseID: 'late-permission',
        toolName: 'SandboxNetworkAccess', input: { host: 'registry.npmjs.org' } },
    })}\n${JSON.stringify({ id: 1_000_000, sessionId: session.id, turnId: 'crashed-turn',
      type: 'turn.started', text: 'Turn started before service crash', createdAt: new Date().toISOString(),
      payload: { type: 'turn.started' },
    })}\n`)

    let runnerStarts = 0
    let receivedPrompt = ''
    let releaseTurn: (() => void) | undefined
    const restarted = createAgentWorkflowApp({ ...options, registerCleanup: cleanup => cleanups.push(cleanup),
      sessionRunner: { start: async () => {
        runnerStarts++
        return { stop() { releaseTurn?.() }, submit: async turn => {
          receivedPrompt = requestText(turn.prompt)
          await new Promise<void>(resolve => {
            releaseTurn = resolve
            turn.signal.addEventListener('abort', () => resolve(), { once: true })
          })
        } }
      } },
    })
    const state = await (await restarted.request(`/api/projects/${projectId}/runtime-state`)).json() as {
      phase: string; blocked: boolean; pending_permissions: unknown[]; active_subagents: string[]
    }
    // The recovered open turn is closed as paused, never mistaken for a live turn.
    expect(state).toMatchObject({ phase: 'paused', blocked: true, pending_permissions: [], active_subagents: [] })
    expect(runnerStarts).toBe(0)
    const stale = await post(restarted, `/api/projects/${projectId}/permissions/late-permission`, { decision: 'allow' })
    expect(await stale.json()).toMatchObject({ resolved: false, stale: true })
    const recoveredSession = await post(restarted, `/api/projects/${projectId}/session/ensure`, {})
    expect((await recoveredSession.json() as { session: { id: string } }).session.id).toBe(session.id)
    const sent = await post(restarted, `/api/beegame-sessions/${session.id}/input`, {
      text: 'Continue my project', clientMessageId: 'recovery-turn',
    })
    expect(sent.status).toBe(202)
    for (let i = 0; i < 200 && !receivedPrompt; i++) await Bun.sleep(5)
    expect(receivedPrompt).toBe('Continue my project')
    expect(runnerStarts).toBe(1)
    releaseTurn?.()
  } finally { for (const cleanup of cleanups.splice(0)) await cleanup() }
})

it('reports only live native child tasks as runtime activity', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-live-subagent-status-')))
  temporaryDirectories.push(root)
  const ownerId = 'subagent-status-owner'
  const projectId = 'subagent-status-project'
  const projectsRoot = join(root, 'projects')
  const workspace = join(projectsRoot, 'users', ownerId, projectId)
  await mkdir(workspace, { recursive: true })
  const cleanups: Array<() => void | Promise<void>> = []
  let nativeTaskNotification: BeeGameSessionRunnerStartInput['onNativeTaskNotification']
  const app = createAgentWorkflowApp({ currentUser: { id: ownerId, role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: projectsRoot,
    modelConfigStore: false, skillsConfig: false, registerCleanup: cleanup => cleanups.push(cleanup),
    sessionRunner: { start: async input => {
      nativeTaskNotification = input.onNativeTaskNotification
      return { stop() {}, submit: async turn => {
        nativeTaskNotification?.({ value: '', message: { type: 'system', subtype: 'task_started',
          task_id: 'native-child', tool_use_id: 'agent-use-1' } })
        await turn.onMessage({ type: 'result', subtype: 'success', result: 'Parent turn finished' })
      } }
    } },
  })
  const post = (url: string, body: unknown) => app.request(url, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    expect((await post('/api/projects', { id: projectId, name: 'Subagent status test', root_path: workspace,
      created_at: Date.now() })).status).toBe(200)
    expect((await post('/api/model-configs', { name: 'Offline', provider: 'openai-compatible', apiKey: 'fake',
      models: { balanced: 'fake' }, isDefault: true })).status).toBe(200)
    const ensured = await post(`/api/projects/${projectId}/session/ensure`, {})
    const { session } = await ensured.json() as { session: { id: string } }
    expect((await post(`/api/beegame-sessions/${session.id}/input`, {
      text: 'Run one child task', clientMessageId: 'subagent-status-request',
    })).status).toBe(202)
    let state: Record<string, unknown> = {}
    for (let i = 0; i < 200; i++) {
      state = await (await app.request(`/api/projects/${projectId}/runtime-state`)).json() as Record<string, unknown>
      if (Array.isArray(state.active_subagents) && state.active_subagents.length > 0) break
      await Bun.sleep(5)
    }
    expect(state).toMatchObject({ phase: 'running', active_subagents: ['agent-use-1'] })
    nativeTaskNotification?.({ value: '', message: { type: 'system', subtype: 'task_notification',
      task_id: 'native-child', tool_use_id: 'agent-use-1', status: 'completed' } })
    for (let i = 0; i < 200; i++) {
      state = await (await app.request(`/api/projects/${projectId}/runtime-state`)).json() as Record<string, unknown>
      if (state.phase === 'idle') break
      await Bun.sleep(5)
    }
    expect(state).toMatchObject({ phase: 'idle', active_subagents: [] })
  } finally { for (const cleanup of cleanups) await cleanup() }
})

it('running project input queues in order; only Steer interrupts the active turn in the same session', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-project-input-queue-')))
  temporaryDirectories.push(root)
  const ownerId = 'queue-owner'
  const projectId = 'queue-project'
  const workspace = join(root, 'projects', 'users', ownerId, projectId)
  await mkdir(workspace, { recursive: true })
  const prompts: string[] = []
  const starts: BeeGameSessionRunnerStartInput[] = []
  const releases: Array<() => void> = []
  const cleanups: Array<() => void | Promise<void>> = []
  const app = createAgentWorkflowApp({ currentUser: { id: ownerId, role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    modelConfigStore: false, skillsConfig: false, registerCleanup: cleanup => cleanups.push(cleanup),
    sessionRunner: { async start(input) {
      starts.push(input)
      input.onNativeSessionId?.('a28f9e61-96d5-4e38-981b-5acd25076508')
      return { stop() { releases.shift()?.() }, async submit(turn) {
        prompts.push(requestText(turn.prompt))
        await new Promise<void>(resolve => { releases.push(resolve); turn.signal.addEventListener('abort', () => resolve(), { once: true }) })
        if (!turn.signal.aborted) await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
      } }
    } },
  })
  const post = (url: string, body: unknown) => app.request(url, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const list = async () => (await (await app.request(`/api/projects/${projectId}/queued-messages`)).json()) as {
    messages: Array<{ id: string; text: string }>
  }
  try {
    expect((await post('/api/projects', { id: projectId, name: 'Queue', root_path: workspace, created_at: Date.now() })).status).toBe(200)
    expect((await post('/api/model-configs', { name: 'Offline', provider: 'openai-compatible', apiKey: 'fake',
      models: { balanced: 'fake' }, isDefault: true })).status).toBe(200)
    const ensured = await post(`/api/projects/${projectId}/session/ensure`, {})
    const { session } = await ensured.json() as { session: { id: string } }
    expect((await (await app.request(`/api/projects/${projectId}/runtime-state`)).json() as { phase: string }).phase).toBe('idle')
    expect((await post(`/api/beegame-sessions/${session.id}/input`, { text: 'First', clientMessageId: 'first' })).status).toBe(202)
    for (let i = 0; i < 100 && prompts.length < 1; i++) await Bun.sleep(5)
    const second = await post(`/api/beegame-sessions/${session.id}/input`, { text: 'Second', clientMessageId: 'second' })
    expect(await second.json()).toMatchObject({ queued: true })
    const deleted = await post(`/api/beegame-sessions/${session.id}/input`, { text: 'Delete me', clientMessageId: 'delete-me' })
    expect(await deleted.json()).toMatchObject({ queued: true })
    expect((await list()).messages.map(item => item.text)).toEqual(['Second', 'Delete me'])
    expect((await list()).messages[0]).not.toHaveProperty('attachments')
    expect(prompts).toEqual(['First'])
    const deleteId = (await list()).messages[1]!.id
    expect((await app.request(`/api/projects/${projectId}/queued-messages/${deleteId}`, { method: 'DELETE' })).status).toBe(200)
    releases.shift()?.()
    for (let i = 0; i < 100 && prompts.length < 2; i++) await Bun.sleep(5)
    expect(prompts).toEqual(['First', 'Second'])
    const normal = await post(`/api/beegame-sessions/${session.id}/input`, { text: 'Normal', clientMessageId: 'normal' })
    expect(await normal.json()).toMatchObject({ queued: true })
    const fourth = await post(`/api/beegame-sessions/${session.id}/input`, { text: 'Urgent', clientMessageId: 'urgent' })
    expect(await fourth.json()).toMatchObject({ queued: true })
    const urgentId = (await list()).messages.find(item => item.text === 'Urgent')!.id
    const steered = await post(`/api/projects/${projectId}/queued-messages/${urgentId}/steer`, {})
    expect(steered.status).toBe(202)
    expect(await steered.json()).toMatchObject({ sessionId: session.id, steered: true })
    for (let i = 0; i < 100 && prompts.length < 3; i++) await Bun.sleep(5)
    expect(prompts).toEqual(['First', 'Second', 'Urgent'])
    expect(starts.at(-1)?.sessionId).toBe(session.id)
    expect(starts.at(-1)?.resumeSessionId).toBe('a28f9e61-96d5-4e38-981b-5acd25076508')
    expect((await list()).messages.map(item => item.text)).toEqual(['Normal'])
    releases.shift()?.()
    for (let i = 0; i < 100 && prompts.length < 4; i++) await Bun.sleep(5)
    expect(prompts).toEqual(['First', 'Second', 'Urgent', 'Normal'])
    expect((await post(`/api/beegame-sessions/${session.id}/input`, {
      text: 'After stop', clientMessageId: 'after-stop',
    })).status).toBe(202)
    expect((await post(`/api/beegame-sessions/${session.id}/input`, {
      text: 'After stop two', clientMessageId: 'after-stop-two',
    })).status).toBe(202)
    expect((await app.request(`/api/projects/${projectId}/stop`, { method: 'POST' })).status).toBe(200)
    const stoppedState = await (await app.request(`/api/projects/${projectId}/runtime-state`)).json() as { phase: string }
    expect(stoppedState.phase).toBe('idle')
    expect((await (await app.request(`/api/projects/${projectId}/runtime-state`)).json() as { phase: string }).phase).toBe('idle')
    expect((await post(`/api/projects/${projectId}/session/ensure`, {})).status).toBe(200)
    await Bun.sleep(30)
    expect(prompts).toEqual(['First', 'Second', 'Urgent', 'Normal'])
    expect((await list()).messages.map(item => item.text)).toEqual(['After stop', 'After stop two'])
    expect((await post(`/api/beegame-sessions/${session.id}/continue`, {})).status).toBe(202)
    for (let i = 0; i < 100 && prompts.length < 5; i++) await Bun.sleep(5)
    expect(prompts).toEqual(['First', 'Second', 'Urgent', 'Normal', 'After stop'])
    for (let i = 0; i < 100 && releases.length === 0; i++) await Bun.sleep(5)
    expect(releases.length).toBeGreaterThan(0)
    releases.shift()?.()
    for (let i = 0; i < 100 && prompts.length < 6; i++) await Bun.sleep(5)
    expect(prompts).toEqual(['First', 'Second', 'Urgent', 'Normal', 'After stop', 'After stop two'])
  } finally {
    for (const release of releases) release()
    for (const cleanup of cleanups.reverse()) await cleanup()
  }
}, 10_000)

it('question answers cross both HTTP permission routes without replacing native input', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-question-route-')))
  temporaryDirectories.push(root)
  const ownerId = 'question-owner'
  const projectId = 'question-project'
  const workspace = join(root, 'projects', 'users', ownerId, projectId)
  await mkdir(workspace, { recursive: true })
  const cleanups: Array<() => void> = []
  const received: unknown[] = []
  let requested = 0
  const nativeInput = { questions: [{ question: 'Which style?', header: 'Style', options: [{ label: 'Pixel' }, { label: 'Vector' }] }] }
  const app = createAgentWorkflowApp({
    currentUser: { id: ownerId, role: 'owner' }, dashboardDataRoot: join(root, 'dashboard'),
    defaultWorkspacePath: join(root, 'projects'), modelConfigStore: false, skillsConfig: false,
    registerCleanup: cleanup => cleanups.push(cleanup),
    sessionRunner: { start: async () => ({ stop() {}, submit: async turn => {
      for (let i = 0; i < 2; i++) {
        requested++
        received.push(await turn.requestPermission({ toolUseID: `question-${i}`, toolName: 'AskUserQuestion',
          input: nativeInput, message: 'AskUserQuestion requires permission.' }))
      }
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }) },
  })
  const post = (url: string, body: unknown) => app.request(url, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    expect((await post('/api/projects', { id: projectId, name: 'Question test', root_path: workspace, created_at: Date.now() })).status).toBe(200)
    expect((await post('/api/model-configs', { name: 'Offline', provider: 'openai-compatible', apiKey: 'fake', models: { balanced: 'fake' }, isDefault: true })).status).toBe(200)
    const ensured = await post(`/api/projects/${projectId}/session/ensure`, {})
    const { session } = await ensured.json() as { session: { id: string } }
    const sent = await post(`/api/beegame-sessions/${session.id}/input`, { text: 'Offline fixture', clientMessageId: 'offline-question', language: 'en' })
    expect({ status: sent.status, body: await sent.json() }).toMatchObject({ status: 202 })
    for (let i = 0; i < 2; i++) {
      for (let n = 0; n < 200 && requested <= i; n++) await Bun.sleep(5)
      const route = i === 0 ? `/api/projects/${projectId}` : `/api/beegame-sessions/${session.id}`
      expect((await post(`${route}/permissions/question-${i}`, { decision: 'allow', answers: {} })).status).toBe(400)
      expect((await post(`${route}/permissions/question-${i}`, {
        decision: 'allow', answers: { 'Which style?': 'Pixel' },
        updatedInput: { questions: [] }, // Clients cannot replace the agent's question.
      })).status).toBe(200)
    }
    for (let n = 0; n < 200 && received.length < 2; n++) await Bun.sleep(5)
    expect(received).toHaveLength(2)
    for (const decision of received) expect(decision).toMatchObject({
      behavior: 'allow', updatedInput: { ...nativeInput, answers: { 'Which style?': 'Pixel' } },
    })
  } finally { for (const cleanup of cleanups) await cleanup() }
})

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
  refreshTimeoutMs?: number,
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
    refreshTimeoutMs,
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

  it.each(['503', 'network', 'malformed', '401'])('token resolution preserves the distinction for refresh %s', async failure => {
    const storePath = await createSessionStorePath()
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64')
    process.env.BEEGAME_HTTPONLY_SESSIONS = '1'
    const record = { accessToken: 'expired', refreshToken: 'refresh', expiresAt: Date.now() - 1000,
      sessionExpiresAt: Date.now() + 60000, user: { id: 'user-1', role: 'viewer' } }
    await Bun.write(storePath, JSON.stringify({ scoped: encryptSecret(JSON.stringify(record), 'auth:session') }))
    const app = new Hono()
    let recovering = false
    const auth = registerBeeGameSessionRoutes(app, {
      supabaseUrl: 'https://project.supabase.co', supabaseAnonKey: 'anon-key', sessionStorePath: storePath,
      fetchImpl: async () => {
        if (recovering) return Response.json({ access_token: 'fresh', expires_in: 3600 })
        if (failure === 'network') throw new TypeError('Failed to fetch')
        if (failure === 'malformed') return Response.json({})
        return new Response('', { status: Number(failure) })
      },
    })!
    const request = new Request('http://localhost/api/usage-wallet', { headers: { cookie: `${SESSION_COOKIE_NAME}=scoped` } })
    const credential = auth.getCredential!(request)!
    if (failure === '401') {
      expect(await auth.getValidAccessToken(request)).toBeUndefined()
      expect((await app.request('/api/auth/session', { headers: request.headers })).status).toBe(401)
    } else {
      await expect(auth.getValidAccessToken(request)).rejects.toMatchObject({ name: 'BeeGameAuthUnavailableError' })
      await expect(credential.getValidAccessToken()).rejects.toMatchObject({ name: 'BeeGameAuthUnavailableError' })
      expect((await app.request('/api/auth/session', { headers: request.headers })).status).toBe(200)
      recovering = true
      // Repeated callers must respect the failure cooldown, then recover.
      await expect(auth.getValidAccessToken(request)).rejects.toMatchObject({ name: 'BeeGameAuthUnavailableError' })
      const clock = spyOn(Date, 'now').mockReturnValue(Date.now() + 2_001)
      try { expect(await auth.getValidAccessToken(request)).toBe('fresh') }
      finally { clock.mockRestore() }
    }
  })

  it('aborts stalled shared refreshes, cools down, and recovers the preserved session', async () => {
    let calls = 0
    let signal: AbortSignal | undefined
    let recovering = false
    const app = createApp(async (input, init) => {
      if (!String(input).includes('/token?')) return Response.json({ id: 'user-1' })
      calls++
      if (recovering) return Response.json({ access_token: 'fresh', expires_in: 3600 })
      signal = init?.signal ?? undefined
      return new Promise<Response>((_, reject) => signal!.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), { once: true }))
    }, await createSessionStorePath(), 10)
    const login = await app.request('/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }) })
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    const refresh = () => app.request('/api/auth/session/refresh', { method: 'POST', headers: { cookie, origin: 'http://localhost' } })
    const results = await Promise.all([refresh(), refresh()])
    expect(results.map(response => response.status)).toEqual([503, 503])
    expect(signal?.aborted).toBe(true)
    expect(calls).toBe(1)
    expect((await refresh()).status).toBe(503)
    expect(calls).toBe(1)
    expect((await app.request('/api/auth/session', { headers: { cookie } })).status).toBe(200)
    recovering = true
    const clock = spyOn(Date, 'now').mockReturnValue(Date.now() + 2001)
    try { expect((await refresh()).status).toBe(200); expect(calls).toBe(2) }
    finally { clock.mockRestore() }
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

  it('logs refresh rejection, service and transport failures without session secrets', async () => {
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const status of [401, 503, 0]) {
        const app = createApp(async input => {
          if (String(input).includes('/token?grant_type=refresh_token')) {
            if (status === 0) throw new Error('secret-response', { cause: { code: 'ECONNRESET' } })
            return new Response('secret-response', { status })
          }
          return Response.json({ id: 'user-1', email: 'user@example.com' })
        })
        const session = await app.request('/api/auth/session', {
          method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' },
          body: JSON.stringify({ access_token: 'secret-access-token', refresh_token: 'secret-refresh-token' }),
        })
        const cookie = (session.headers.get('set-cookie') ?? '').split(';', 1)[0]
        const response = await app.request('/api/auth/session/refresh', {
          method: 'POST', headers: { origin: 'http://localhost', cookie },
        })
        expect(response.status).toBe(status === 401 ? 401 : 503)
        expect(JSON.parse(log.mock.calls.at(-1)![1] as string)).toMatchObject(status === 0
          ? { code: 'refresh_request_failed', networkCode: 'ECONNRESET' }
          : { code: status === 401 ? 'refresh_rejected' : 'refresh_service_unavailable', httpStatus: status })
      }
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
    } finally { log.mockRestore() }
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

it('retired workflow URLs return 404 without starting a worker', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-removed-workflow-routes-')))
  temporaryDirectories.push(root)
  let starts = 0
  const cleanups: Array<() => void | Promise<void>> = []
  const app = createAgentWorkflowApp({
    currentUser: { id: 'owner', role: 'owner' }, dashboardDataRoot: join(root, 'dashboard'),
    defaultWorkspacePath: join(root, 'projects'), modelConfigStore: false, skillsConfig: false,
    registerCleanup: cleanup => cleanups.push(cleanup),
    sessionRunner: { start: async () => { starts++; throw new Error('must not start') } },
  })
  try {
    const workspace = join(root, 'projects/users/owner/project')
    await mkdir(workspace, { recursive: true })
    expect((await app.request('/api/projects', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'project', name: 'Test', root_path: workspace, created_at: Date.now() }),
    })).status).toBe(200)
    for (const path of ['/workflow', '/workflow/resume', '/workflow/retry']) {
      const response = await app.request(`/api/projects/project${path}`, { method: 'POST' })
      expect(response.status).toBe(404)
    }
    expect(starts).toBe(0)
  } finally { for (const cleanup of cleanups) await cleanup() }
})
