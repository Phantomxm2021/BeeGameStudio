import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import { BeeGameSessionManager } from './session-manager'
import { registerModelConnectionRoutes } from '../model-connection-routes'
import { bgsHome } from '../bgs/auth'
import { createAgentWorkflowApp } from '../app'
import { createModelConfig, exportModelConfigSnapshot, importModelConfigSnapshot } from '@bee-game-studio/agent-workflow'
import { getUserDashboardDataRoot } from '../local-runtime-service'
import { loadBeeGameIntakeJob } from './intake-job-store'

function gate() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve }), release: () => release() } }

test('logout stays blocked during native cleanup after stop or interruption, without blocking another owner', async () => {
  for (const interrupt of [false, true]) {
    const root = await mkdtemp('/private/tmp/bgs-owner-cleanup-'), entered = gate(), exiting = gate(), exit = gate()
    const manager = new BeeGameSessionManager({ async start() { return { stop() {}, async submit() { entered.release(); await exit.promise },
      async dispose() { exiting.release(); await exit.promise } } } }, root, () => ({}))
    try {
      await mkdir(bgsHome(root), { recursive: true })
      await writeFile(join(bgsHome(root), 'auth.json'), '{"tokens":{"access_token":"synthetic","refresh_token":"synthetic"}}')
      const session = manager.start({ workspacePath: join(root, 'game'), projectId: 'fixture', userId: 'owner' })
      await manager.sendWithDisplay(session.id, 'Offline'); await entered.promise
      if (interrupt) manager.interruptTurn(session.id); else manager.stop(session.id)
      await exiting.promise
      expect(manager.get(session.id)?.turnStatus).toBe('idle')
      expect(manager.hasActiveOwnerRuntime('owner')).toBe(true)
      expect(manager.hasActiveOwnerRuntime('other')).toBe(false)
      const app = new Hono()
      registerModelConnectionRoutes(app, { repository: {} as any, getUser: () => ({ id: 'owner', role: 'owner' }), getRoot: () => root,
        changed() {}, isBusy: owner => manager.hasActiveOwnerRuntime(owner) })
      expect((await app.request('/api/model-accounts/chatgpt', { method: 'DELETE' })).status).toBe(409)
      exit.release(); await manager.waitForSessionIdle(session.id)
      expect(manager.hasActiveOwnerRuntime('owner')).toBe(false)
      expect((await app.request('/api/model-accounts/chatgpt', { method: 'DELETE' })).status).toBe(200)
    } finally { exit.release(); await manager.dispose(); await rm(root, { recursive: true, force: true }) }
  }
})

test('shutdown closes admission before draining and cannot leave a newly admitted native writer', async () => {
  const root = await mkdtemp('/private/tmp/bgs-shutdown-admission-'), entered = gate(), exiting = gate(), exit = gate()
  let starts = 0
  const manager = new BeeGameSessionManager({ async start() { starts++; return { stop() {}, async submit() { entered.release(); await exit.promise },
    async dispose() { exiting.release(); await exit.promise } } } }, root, () => ({}))
  try {
    const session = manager.start({ workspacePath: join(root, 'game'), userId: 'owner' })
    await manager.sendWithDisplay(session.id, 'Offline'); await entered.promise
    const shutdown = manager.dispose()
    expect(manager.dispose()).toBe(shutdown)
    expect(() => manager.start({ workspacePath: join(root, 'second'), userId: 'owner' })).toThrow('shutting down')
    await expect(manager.sendWithDisplay(session.id, 'Another request')).rejects.toThrow('shutting down')
    await expect(manager.assertModelRequestAllowed('owner')).rejects.toThrow('shutting down')
    await exiting.promise; exit.release(); await shutdown
    expect(starts).toBe(1)
  } finally { exit.release(); await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('usage admission refusal prevents starting a native runner', async () => {
  const root = await mkdtemp('/private/tmp/bgs-native-credit-')
  let starts = 0
  const manager = new BeeGameSessionManager({ async start() { starts++; throw Error('Unexpected native start') } }, root, () => ({}),
    { async assertUsageAvailable() { throw Error('Insufficient realtime usage credits') } })
  try {
    const session = manager.start({ workspacePath: join(root, 'game'), userId: 'owner' })
    await manager.sendWithDisplay(session.id, 'Offline'); await manager.waitForSessionIdle(session.id)
    expect(starts).toBe(0)
    expect(manager.transcriptFacts(session.id).some(event => event.type === 'turn.failed')).toBe(true)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('app shutdown rejects new HTTP requests and waits for an already accepted request', async () => {
  const root = await mkdtemp('/private/tmp/bgs-http-drain-'), entered = gate(), exit = gate()
  const cleanups: Array<() => void | Promise<void>> = []
  const app = createAgentWorkflowApp({ dashboardDataRoot: root, defaultWorkspacePath: root, skillsConfig: false,
    workflowV3Store: false, currentUser: { id: 'owner', role: 'owner' }, registerCleanup: fn => cleanups.push(fn) })
  app.get('/offline-hold', async c => { entered.release(); await exit.promise; return c.text('done') })
  try {
    const response = app.request('/offline-hold'); await entered.promise
    let drained = false
    const shutdown = Promise.resolve(cleanups[0]!()).then(() => { drained = true })
    expect((await app.request('/health')).status).toBe(503)
    expect(drained).toBe(false)
    exit.release(); expect((await response).status).toBe(200); await shutdown
    expect(drained).toBe(true)
  } finally { exit.release(); for (const cleanup of cleanups) await cleanup(); await rm(root, { recursive: true, force: true }) }
})

test('shutdown drains detached intake jobs through final persistence before closing the usage outbox', async () => {
  const root = await mkdtemp('/private/tmp/bgs-intake-drain-'), entered = gate(), exit = gate()
  const snapshot = exportModelConfigSnapshot()
  const cleanups: Array<() => void | Promise<void>> = []
  try {
    const model = createModelConfig('owner', { name: 'Offline fixture', provider: 'openai-compatible', apiKey: 'synthetic', models: { balanced: 'fixture' } })
    const app = createAgentWorkflowApp({ dashboardDataRoot: root, defaultWorkspacePath: root, modelConfigStore: false,
      skillsConfig: false, workflowV3Store: false, currentUser: { id: 'owner', role: 'owner' }, registerCleanup: fn => cleanups.push(fn),
      modelRuntimeHost: { async generate() { throw Error('Unexpected legacy call') }, async generateWithUsage() {
        entered.release(); await exit.promise
        return { content: '{"request_scope":"out_of_scope"}', usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 2 } }
      } } })
    const response = await app.request('/api/beegame-intake/jobs', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idea: 'Offline fixture', modelConfigId: model.id }) })
    expect(response.status).toBe(202)
    const { jobId } = await response.json() as { jobId: string }
    await entered.promise
    let drained = false
    const shutdown = Promise.resolve(cleanups[0]!()).then(() => { drained = true })
    expect((await app.request('/health')).status).toBe(503)
    expect(drained).toBe(false)
    exit.release(); await shutdown
    const job = await loadBeeGameIntakeJob(getUserDashboardDataRoot(root, 'owner'), jobId)
    expect(job?.status).toBe('failed') // Complete provider receipt, explicit out-of-scope input.
    expect(drained).toBe(true)
  } finally { exit.release(); for (const cleanup of cleanups) await cleanup(); importModelConfigSnapshot(snapshot); await rm(root, { recursive: true, force: true }) }
})
