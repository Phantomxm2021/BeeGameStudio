import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAgentWorkflowApp } from '../app'

test('real purge route reuses owned project deletion, workspace guards and audit without touching another account', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beegame-dev-purge-route-'))
  const dataRoot = join(root, 'data')
  const cleanups: Array<() => void | Promise<void>> = []
  const oldMode = process.env.NODE_ENV
  const oldFlag = process.env.BEEGAME_ENABLE_DEV_PROJECT_PURGE
  process.env.NODE_ENV = 'test'
  process.env.BEEGAME_ENABLE_DEV_PROJECT_PURGE = '1'
  try {
    const app = createAgentWorkflowApp({
      currentUserResolver: request => {
        const id = request.headers.get('x-test-user')
        return id === 'alice' || id === 'bob' ? { id, role: 'owner' } : undefined
      },
      dashboardDataRoot: dataRoot, defaultWorkspacePath: dataRoot, modelConfigStore: false, skillsConfig: false,
      registerCleanup: cleanup => cleanups.push(cleanup),
    })
    const request = (path: string, user: string, body?: unknown) => app.request(path, {
      method: body ? 'POST' : 'GET', headers: { 'x-test-user': user, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    for (const [user, id] of [['alice', 'a'], ['bob', 'b']]) {
      const workspace = join(dataRoot, 'users', user!, id!)
      await mkdir(workspace, { recursive: true })
      await writeFile(join(workspace, 'keep.txt'), id!)
      const created = await request('/api/projects', user!, { id, name: id, root_path: workspace, created_at: Date.now() })
      expect(created.status).toBe(200)
    }
    expect((await app.request('/api/dev/projects/purge')).status).toBe(401)
    const preview = await (await request('/api/dev/projects/purge', 'alice')).json()
    expect(preview.projects.map((project: { id: string }) => project.id)).toEqual(['a'])
    const result = await request('/api/dev/projects/purge', 'alice', { confirmation: 'DELETE_ALL_MY_PROJECTS', projectIds: ['a'] })
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ deleted: 1, failed: 0 })
    expect(await (await request('/api/projects', 'alice')).json()).toEqual([])
    expect((await (await request('/api/projects', 'bob')).json()).map((project: { id: string }) => project.id)).toEqual(['b'])
    await expect(readFile(join(dataRoot, 'users/alice/a/keep.txt'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(dataRoot, 'users/bob/b/keep.txt'), 'utf8')).toBe('b')
    const audit = (await readFile(join(dataRoot, 'users/alice/audit-events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(audit).toContainEqual(expect.objectContaining({ action: 'project.deleted', actorId: 'alice', targetId: 'a',
      metadata: expect.objectContaining({ cleanupOutcome: 'workspace_deleted' }) }))
    process.env.NODE_ENV = 'production'
    expect((await request('/api/dev/projects/purge', 'alice')).status).toBe(404)
    expect((await request('/api/dev/projects/purge', 'alice', { confirmation: 'DELETE_ALL_MY_PROJECTS', projectIds: [] })).status).toBe(404)
  } finally {
    if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode
    if (oldFlag === undefined) delete process.env.BEEGAME_ENABLE_DEV_PROJECT_PURGE; else process.env.BEEGAME_ENABLE_DEV_PROJECT_PURGE = oldFlag
    for (const cleanup of cleanups) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
