import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAgentWorkflowApp } from '../app'
import { createRun } from '../beegame/workflow-v3/state'
import { createLocalWorkflowStore } from '../beegame/workflow-v3/store'

test('V3-bound legacy session stop/delete are rejected while ordinary legacy sessions remain mutable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-legacy-session-mutation-'))
  const projectsRoot = join(root, 'projects')
  const workspace = join(projectsRoot, 'users', 'owner', 'v3-session')
  await mkdir(workspace, { recursive: true })
  const cleanups: Array<() => void | Promise<void>> = []
  const store = createLocalWorkflowStore(join(root, 'workflow-store'))
  const app = createAgentWorkflowApp({
    currentUserResolver: request => {
      const id = request.headers.get('x-test-user')
      return id === 'owner' || id === 'other' ? { id, role: 'owner' } : undefined
    },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: projectsRoot,
    workflowV3Store: store,
    modelConfigStore: false, skillsConfig: false,
    sessionRunner: { start: async () => ({ stop() {}, async submit() {} }) },
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  const request = (path: string, method: string, user = 'owner', body?: unknown) => app.request(path, {
    method, headers: { 'x-test-user': user, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  try {
    expect((await request('/api/projects', 'POST', 'owner', {
      id: 'v3-session', name: 'V3 session', root_path: workspace, created_at: Date.now(),
    })).status).toBe(200)
    await store.commit('v3-session', 'owner', 0, createRun({ projectId: 'v3-session', ownerId: 'owner',
      workspacePath: workspace, chatSessionId: 'v3-chat', requestKey: 'goal', text: 'V3 run', constraints: {}, ids: ['goal'] }),
      'agent.goal-confirmed')
    const ensured = await request('/api/projects/v3-session/session/ensure', 'POST')
    expect(ensured.status, await ensured.clone().text()).toBe(200)
    const sessionId = (await ensured.json() as { session: { id: string } }).session.id

    const foreignStop = await request(`/api/beegame-sessions/${sessionId}/stop`, 'POST', 'other', {})
    expect(foreignStop.status).toBe(404)
    expect(await foreignStop.json()).toEqual({ error: 'Session not found' })

    const stop = await request(`/api/beegame-sessions/${sessionId}/stop`, 'POST', 'owner', {})
    expect(stop.status, await stop.clone().text()).toBe(409)
    expect(await stop.json()).toMatchObject({ code: 'v3-route-required' })

    const deletion = await request(`/api/beegame-sessions/${sessionId}`, 'DELETE', 'owner')
    expect(deletion.status, await deletion.clone().text()).toBe(409)
    expect(await deletion.json()).toMatchObject({ code: 'v3-route-required' })
    expect((await request(`/api/beegame-sessions/${sessionId}`, 'GET', 'owner')).status).toBe(200)

    const legacyWorkspace = join(projectsRoot, 'users', 'owner', 'legacy-session')
    await mkdir(legacyWorkspace, { recursive: true })
    expect((await request('/api/projects', 'POST', 'owner', {
      id: 'legacy-session', name: 'Legacy session', root_path: legacyWorkspace, created_at: Date.now(),
    })).status).toBe(200)
    const legacyEnsured = await request('/api/projects/legacy-session/session/ensure', 'POST')
    const legacySessionId = (await legacyEnsured.json() as { session: { id: string } }).session.id
    expect((await request(`/api/beegame-sessions/${legacySessionId}/stop`, 'POST', 'owner', {})).status).toBe(200)
    expect((await request(`/api/beegame-sessions/${legacySessionId}`, 'DELETE', 'owner')).status).toBe(200)
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
