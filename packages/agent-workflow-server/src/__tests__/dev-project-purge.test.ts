import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { DEV_PROJECT_PURGE_PATH as path, isDevProjectPurgeEnabled, registerDevProjectPurgeRoutes } from '../dev-project-purge'

function fixture(options: { enabled?: boolean; deleteProject?: (id: string) => Promise<{ deleted: boolean }> } = {}) {
  const app = new Hono()
  const projects = new Map([['alice', ['a', 'b']], ['bob', ['foreign']]])
  const deleted: string[] = []
  app.use('/api/*', async (c, next) => {
    if (!projects.has(c.req.header('x-test-user') ?? '')) return c.json({ error: 'Unauthorized' }, 401)
    await next()
  })
  registerDevProjectPurgeRoutes(app, {
    enabled: () => options.enabled ?? true,
    getUser: request => ({ id: request.headers.get('x-test-user')!, role: 'developer' }),
    listProjects: async (_request, user) => projects.get(user.id)!.map(id => ({ id, name: id })),
    deleteProject: async (_request, user, id) => {
      expect(projects.get(user.id)).toContain(id)
      const result = options.deleteProject ? await options.deleteProject(id) : { deleted: true }
      if (result.deleted) { deleted.push(id); projects.set(user.id, projects.get(user.id)!.filter(value => value !== id)) }
      return result
    },
  })
  const post = (body: unknown, user = 'alice') => app.request(path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': user }, body: JSON.stringify(body),
  })
  return { app, post, deleted, projects }
}
const confirm = (projectIds: string[]) => ({ confirmation: 'DELETE_ALL_MY_PROJECTS', projectIds })

describe('development-only project purge', () => {
  test('fails closed outside explicitly enabled development/test', () => {
    for (const NODE_ENV of [undefined, '', 'production', 'staging']) {
      expect(isDevProjectPurgeEnabled({ NODE_ENV, BEEGAME_ENABLE_DEV_PROJECT_PURGE: '1' })).toBe(false)
    }
    for (const NODE_ENV of ['development', 'test']) {
      expect(isDevProjectPurgeEnabled({ NODE_ENV })).toBe(false)
      expect(isDevProjectPurgeEnabled({ NODE_ENV, BEEGAME_ENABLE_DEV_PROJECT_PURGE: 'true' })).toBe(false)
      expect(isDevProjectPurgeEnabled({ NODE_ENV, BEEGAME_ENABLE_DEV_PROJECT_PURGE: '1' })).toBe(true)
    }
  })
  test('disabled routes do not list or delete projects', async () => {
    const f = fixture({ enabled: false })
    expect((await f.app.request(path, { headers: { 'x-test-user': 'alice' } })).status).toBe(404)
    expect((await f.post(confirm(['a', 'b']))).status).toBe(404)
    expect(f.deleted).toEqual([])
  })
  test('requires authentication and never accepts a caller-selected owner', async () => {
    const f = fixture()
    expect((await f.post(confirm(['a', 'b']), '')).status).toBe(401)
    expect((await f.post({ ...confirm(['a', 'b']), ownerId: 'bob' })).status).toBe(400)
    expect(f.deleted).toEqual([])
  })
  test('preview is read-only; execution deletes only the current owner snapshot', async () => {
    const f = fixture()
    const preview = await (await f.app.request(path, { headers: { 'x-test-user': 'alice' } })).json()
    expect(preview).toEqual({ projectCount: 2, projects: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }] })
    expect(f.deleted).toEqual([])
    const result = await (await f.post(confirm(['b', 'a']))).json()
    expect(result).toMatchObject({ requested: 2, deleted: 2, failed: 0 })
    expect(f.projects.get('alice')).toEqual([])
    expect(f.projects.get('bob')).toEqual(['foreign'])
    expect((await f.post(confirm(['a', 'b']))).status).toBe(409)
    expect(await (await f.post(confirm([]))).json()).toMatchObject({ requested: 0, deleted: 0, failed: 0 })
  })
  test('rejects missing confirmation, duplicate IDs, foreign IDs and stale snapshots before mutation', async () => {
    const f = fixture()
    for (const body of [null, {}, { projectIds: ['a', 'b'] }, { confirmation: 'yes', projectIds: ['a', 'b'] }, confirm(['a', 'a']), confirm(['a']), confirm(['a', 'b', 'foreign'])]) {
      expect((await f.post(body)).status).toBeGreaterThanOrEqual(400)
    }
    f.projects.get('alice')!.push('new')
    expect((await f.post(confirm(['a', 'b']))).status).toBe(409)
    expect(f.deleted).toEqual([])
  })
  test('rejects form submissions and invalid JSON', async () => {
    const f = fixture()
    for (const type of ['text/plain', 'application/x-www-form-urlencoded']) {
      expect((await f.app.request(path, { method: 'POST', headers: { 'x-test-user': 'alice', 'content-type': type }, body: JSON.stringify(confirm(['a', 'b'])) })).status).toBe(400)
    }
    expect((await f.app.request(path, { method: 'POST', headers: { 'x-test-user': 'alice', 'content-type': 'application/json' }, body: '{' })).status).toBe(400)
    expect(f.deleted).toEqual([])
  })
  test('reports partial failures without leaking provider error text and allows a fresh retry', async () => {
    let fail = true
    const f = fixture({ deleteProject: async id => {
      if (id === 'b' && fail) throw new Error('sensitive provider details')
      return { deleted: true }
    } })
    const result = await (await f.post(confirm(['a', 'b']))).json()
    expect(result).toMatchObject({ requested: 2, deleted: 1, failed: 1 })
    expect(JSON.stringify(result)).not.toContain('sensitive')
    expect(f.projects.get('alice')).toEqual(['b'])
    fail = false
    expect(await (await f.post(confirm(['b']))).json()).toMatchObject({ deleted: 1, failed: 0 })
  })
  test('serializes same-account purges and does not consume projects created during deletion', async () => {
    let release!: () => void
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const f = fixture({ deleteProject: async () => { started(); await gate; return { deleted: true } } })
    const first = f.post(confirm(['a', 'b']))
    await ready
    expect((await f.post(confirm(['a', 'b']))).status).toBe(409)
    f.projects.get('alice')!.push('new')
    release()
    expect((await first).status).toBe(200)
    expect(f.projects.get('alice')).toEqual(['new'])
  })
})
