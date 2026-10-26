import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import { createLocalWorkflowStore } from '../beegame/workflow-v3/store'

test('runtime diagnostics require administration, exclude their own request, and remain readable during drain', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-runtime-status-'))
  const cleanups: Array<() => void | Promise<void>> = []
  let release!: () => void
  let entered!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  const app = createAgentWorkflowApp({
    dashboardDataRoot: root, modelConfigStore: false, skillsConfig: false,
    workflowV3Store: createLocalWorkflowStore(root),
    currentUserResolver: request => {
      const role = request.headers.get('x-test-role')
      return role === 'owner' || role === 'viewer' ? { id: 'status-user', role } : undefined
    },
    sessionRunner: { start: async () => { throw Error('Diagnostics must not start a model') } },
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  app.get('/api/test-held-work', async c => { entered(); await held; return c.json({ done: true }) })
  const path = '/api/admin/runtime-status'
  const headers = { 'x-test-role': 'owner' }
  try {
    expect((await app.request(path)).status).toBe(401)
    expect((await app.request(path, { headers: { 'x-test-role': 'viewer' } })).status).toBe(403)
    // Let deployment-history recovery finish without dispatching any work.
    await Bun.sleep(10)
    const response = await app.request(path, { headers })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const idle = await response.json()
    expect(idle).toMatchObject({ scope: 'bgs-runtime-host', state: 'idle',
      app: { activeRequests: 0, intakeJobsRunning: 0 }, workflowV3: { writers: 0 } })
    expect(JSON.stringify(idle)).not.toContain(root)
    expect(JSON.stringify(idle)).not.toContain('status-user')

    const work = app.request('/api/test-held-work', { headers })
    await started
    expect(await (await app.request(path, { headers })).json()).toMatchObject({
      state: 'busy', app: { activeRequests: 1 },
    })
    const draining = Promise.resolve(cleanups.shift()!())
    expect(await (await app.request(path, { headers })).json()).toMatchObject({
      state: 'draining', app: { closing: true, activeRequests: 1 },
    })
    expect((await app.request(path, { headers: { 'x-test-role': 'viewer' } })).status).toBe(403)
    expect((await app.request('/health')).status).toBe(503)
    release(); await work; await draining
  } finally {
    release()
    for (const cleanup of cleanups) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('unavailable writer observations stay unknown and unresolved writers stay busy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-runtime-status-store-'))
  const cleanups: Array<() => void | Promise<void>> = []
  const store = createLocalWorkflowStore(root)
  let fail = true
  store.writerStatus = async () => {
    if (fail) throw Error('Private storage error must not leak')
    return { writers: 2, state: 'active', scope: 'configured-store' }
  }
  const app = createAgentWorkflowApp({ dashboardDataRoot: root, workflowV3Store: store,
    modelConfigStore: false, skillsConfig: false, currentUser: { id: 'status-owner', role: 'owner' },
    registerCleanup: cleanup => cleanups.push(cleanup) })
  try {
    const unknown = await (await app.request('/api/admin/runtime-status')).json()
    expect(unknown).toMatchObject({ state: 'unknown', workflowV3: { writers: null, state: 'unknown' } })
    expect(JSON.stringify(unknown)).not.toContain('Private storage')
    fail = false
    expect(await (await app.request('/api/admin/runtime-status')).json()).toMatchObject({
      state: 'busy', workflowV3: { writers: 2, state: 'active' },
    })
  } finally {
    for (const cleanup of cleanups) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
