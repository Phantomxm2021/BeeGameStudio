import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAgentWorkflowApp } from '../app'
import { createRun, type Run } from '../beegame/workflow-v3/state'
import { createLocalWorkflowStore } from '../beegame/workflow-v3/store'

test('V3 projects allow owned single and batch deletion without allowing legacy mutations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beegame-v3-delete-route-'))
  const runs = new Map<string, Run>()
  const cleanups: Array<() => void | Promise<void>> = []
  const app = createAgentWorkflowApp({
    currentUserResolver: request => {
      const id = request.headers.get('x-test-user')
      return id === 'alice' || id === 'bob' ? { id, role: 'developer' } : undefined
    },
    dashboardDataRoot: root, defaultWorkspacePath: root, modelConfigStore: false, skillsConfig: false,
    workflowV3Store: {
      read: async (id, owner) => runs.get(id)?.ownerId === owner ? runs.get(id) : undefined,
      commit: async () => { throw new Error('Deletion must not schedule workflow work') },
    },
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  const request = (path: string, method: string, user = 'alice', body?: unknown) => app.request(path, {
    method, headers: { 'x-test-user': user, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  try {
    for (const [user, id] of [['alice', 'single'], ['alice', 'batch-a'], ['alice', 'batch-b'], ['bob', 'foreign']]) {
      const workspace = join(root, 'users', user!, id!)
      await mkdir(workspace, { recursive: true })
      await writeFile(join(workspace, 'fixture.txt'), id!)
      expect((await request('/api/projects', 'POST', user!, {
        id, name: id, root_path: workspace, created_at: Date.now(),
      })).status).toBe(200)
      runs.set(id!, createRun({ projectId: id!, ownerId: user!, workspacePath: workspace,
        chatSessionId: `chat-${id}`, requestKey: 'create', text: 'Synthetic project', constraints: {}, ids: ['goal'] }))
    }

    const legacy = await request('/api/projects/single/assets/resources/test/upload', 'POST', 'alice', {})
    expect(legacy.status).toBe(409)
    expect((await legacy.json()).code).toBe('v3-route-required')
    // Exempt only the root DELETE, not every DELETE below the project.
    expect((await request('/api/projects/single/legacy-document', 'DELETE')).status).toBe(409)
    expect((await app.request('/api/projects/single', { method: 'DELETE' })).status).toBe(401)
    expect(await (await request('/api/projects/foreign', 'DELETE')).json()).toEqual({ deleted: false })

    // Batch deletion uses the same account-scoped endpoint once per selected ID.
    for (const id of ['single', 'batch-a', 'batch-b']) {
      const response = await request(`/api/projects/${id}`, 'DELETE')
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ deleted: true })
      await expect(readFile(join(root, 'users/alice', id, 'fixture.txt'))).rejects.toThrow()
    }
    expect(await (await request('/api/projects', 'GET')).json()).toEqual([])
    expect(await readFile(join(root, 'users/bob/foreign/fixture.txt'), 'utf8')).toBe('foreign')
    const audit = await readFile(join(root, 'users/alice/audit-events.jsonl'), 'utf8')
    expect(audit.trim().split('\n').map(line => JSON.parse(line).targetId).sort()).toEqual(['batch-a', 'batch-b', 'single'])
  } finally {
    for (const cleanup of cleanups) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('local project deletion removes only the owner-bound workflow snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beegame-v3-delete-local-workflow-'))
  const projectsRoot = join(root, 'projects')
  const store = createLocalWorkflowStore(join(root, 'workflow-store'))
  const cleanups: Array<() => void | Promise<void>> = []
  const app = createAgentWorkflowApp({
    currentUser: { id: 'owner', role: 'owner' }, dashboardDataRoot: root,
    defaultWorkspacePath: projectsRoot, modelConfigStore: false, skillsConfig: false,
    workflowV3Store: store, sessionRunner: { start: async () => ({ stop() {}, async submit() {} }) },
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  const createProject = (id: string, name: string) => app.request('/api/projects', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, name, root_path: join(projectsRoot, 'users', 'owner', id), created_at: Date.now() }),
  })
  try {
    for (const [id, name] of [['remove-me', 'Remove me'], ['keep-me', 'Keep me']]) {
      await mkdir(join(projectsRoot, 'users', 'owner', id), { recursive: true })
      expect((await createProject(id, name)).status).toBe(200)
      const run = createRun({ projectId: id, ownerId: 'owner',
        workspacePath: join(projectsRoot, 'users', 'owner', id), chatSessionId: `chat-${id}`,
        requestKey: 'create', text: JSON.stringify({ project: id }), constraints: {}, ids: ['goal'] })
      await store.commit(id, 'owner', 0, run, 'agent.goal-confirmed')
    }
    const deleted = await app.request('/api/projects/remove-me', { method: 'DELETE' })
    expect(deleted.status, await deleted.clone().text()).toBe(200)
    expect(await store.read('remove-me', 'owner')).toBeUndefined()
    expect((await store.read('keep-me', 'owner'))?.projectId).toBe('keep-me')
    await expect(store.delete!('keep-me', 'other')).rejects.toMatchObject({ code: 'project-forbidden' })
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
