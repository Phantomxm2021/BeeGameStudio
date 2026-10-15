import { test, expect } from 'bun:test'
import { createRun, type Run } from './state'
import { assertCommit, createRemoteWorkflowStore } from './store'

function run(root = '/tmp/synthetic-game'): Run {
  return createRun({ projectId: 'synthetic', ownerId: 'alice', workspacePath: root, chatSessionId: 'chat',
    requestKey: 'create', text: 'A playable game with restart.', constraints: { orientation: 'Landscape' }, ids: ['req.loop'] })
}
test('new Runs are Agent-only; a persisted Task record cannot become writable by adding Agent history', () => {
  const current = run()
  expect(current.agentTurns).toEqual([])
  expect(['plans','tasks','attempts'].some(key=>key in current)).toBe(false)
  const old = structuredClone(current)
  delete old.agentTurns
  const converted = structuredClone(current)
  converted.version++
  expect(() => assertCommit('synthetic', 'alice', old.version, converted, old)).toThrow('read-only')
  const mixed = run()
  Object.assign(mixed, { tasks: { old: { status: 'pending' } } })
  expect(() => assertCommit('synthetic', 'alice', 0, mixed)).toThrow('Only Agent Runs')
})
test('empty retired Task fields are removed from saved Agent Runs without migrating Task history', async () => {
  const legacy = Object.assign(run(), { plans: [], tasks: {}, attempts: [] })
  const calls: unknown[] = []
  const store = createRemoteWorkflowStore({ url: 'https://db.invalid', serviceKey: 'host-only', fetchImpl: async (url, options) => {
    if (String(url).endsWith('/beegame_workflow_v3_read')) return Response.json(legacy)
    calls.push(JSON.parse(String(options?.body)))
    return Response.json({})
  } })
  const current = (await store.read('synthetic', 'alice'))!
  expect(['plans','tasks','attempts'].some(key=>key in current)).toBe(false)
  await store.commit('synthetic', 'alice', current.version, { ...current, version: current.version + 1 }, 'synthetic.update')
  expect(['plans','tasks','attempts'].some(key=>key in (calls[0] as { p_state: Run }).p_state)).toBe(false)
  const mixed = Object.assign(structuredClone(legacy), { tasks: { old: { status: 'pending' } } })
  expect(() => assertCommit('synthetic', 'alice', mixed.version, { ...current, version: current.version + 1 }, mixed))
    .toThrow('read-only')
})
test('remote store does not fall back locally, maps CAS conflicts and keeps credentials on the host', async () => {
  const calls: Array<{ url: string; body: unknown }> = []
  const store = createRemoteWorkflowStore({ url: 'https://db.invalid', serviceKey: 'host-only', fetchImpl: async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(String(options?.body)) })
    return new Response(JSON.stringify({ code: 'PT409', message: 'workflow_revision_conflict' }), { status: 409 })
  } })
  await expect(store.commit('synthetic', 'alice', 0, run(), 'created')).rejects.toThrow('current revision')
  expect(calls).toHaveLength(1)
  expect(JSON.stringify(calls[0]!.body)).not.toContain('host-only')
})
test('missing database migration gives the exact deployment repair, without retry or local fallback', async () => {
  for (const code of ['PGRST202', 'PGRST205', '42P01']) {
    let requests = 0
    const store = createRemoteWorkflowStore({ url: 'https://db.invalid', serviceKey: 'host-only', fetchImpl: async () => {
      requests++; return Response.json({ code, message: 'secret database detail' }, { status: 404 })
    } })
    try { await store.commit('synthetic', 'alice', 0, run(), 'created'); throw Error('Unexpected success') }
    catch (error) {
      expect(error).toMatchObject({ code: 'workflow-migration-required', status: 503 })
      expect((error as Error).message).toContain('20261010010000_workflow_v3_vertical_slice.sql')
      expect((error as Error).message).toContain('20261010020000_workflow_v3_authorized_changes.sql')
      expect((error as Error).message).toContain('20261010030000_workflow_v3_conflict_http.sql')
      expect((error as Error).message).not.toContain('secret database detail')
    }
    expect(requests).toBe(1)
  }
  const discovery = createRemoteWorkflowStore({ url: 'https://db.invalid', serviceKey: 'host-only',
    fetchImpl: async () => Response.json({ code: 'PGRST202' }, { status: 404 }) })
  // A missing read RPC still discovers an untouched legacy project. Commits fail explicitly.
  expect(await discovery.read('synthetic', 'alice')).toBeUndefined()
})

test('rejected authorized database change explains both migration and invalid-history possibilities', async () => {
  const store = createRemoteWorkflowStore({ url: 'https://db.invalid', serviceKey: 'host-only',
    fetchImpl: async () => Response.json({ message: 'workflow_immutable_source' }, { status: 400 }) })
  await expect(store.commit('synthetic', 'alice', 0, run(), 'requirements.changed'))
    .rejects.toThrow('20261010020000_workflow_v3_authorized_changes.sql')
  await expect(store.commit('synthetic', 'alice', 0, run(), 'created'))
    .rejects.toThrow('Original requirements and Run identity cannot be overwritten')
})
