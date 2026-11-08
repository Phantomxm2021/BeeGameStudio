import { test, expect } from 'bun:test'
import { mkdtemp, rm, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { createRun, type Run } from './state'
import { assertCommit, createLocalWorkflowStore, createRemoteWorkflowStore, previewRunState, runtimeRunState } from './store'

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


test('Preview projects current owner and minimal Run state without reading historical evidence', async () => {
  const current = run(), state = previewRunState(current)
  let result: unknown = [{workflow: state}], status = 200, calls = 0
  const store = createRemoteWorkflowStore({url:'https://db.invalid', serviceKey:'host-only', fetchImpl:async(input, init)=>{
    calls++
    const url = new URL(String(input))
    expect(url.pathname).toBe('/rest/v1/beegame_projects')
    expect(url.searchParams.get('id')).toBe('eq.synthetic')
    expect(url.searchParams.get('owner_id')).toBe('eq.alice')
    expect(url.searchParams.get('select')).toContain('version:state->version')
    expect(url.searchParams.get('select')).not.toMatch(/agentTurns|requirements|state[,)]/)
    expect(init?.method ?? 'GET').toBe('GET')
    return Response.json(result,{status})
  }})
  expect(await store.readPreviewState!('synthetic','alice')).toEqual(state)
  result=[{workflow:{...state,writer:{attemptId:'other',workerId:'w',fence:2}}}]
  expect((await store.readPreviewState!('synthetic','alice'))?.writer?.attemptId).toBe('other')
  result=[{workflow:null}]
  expect(await store.readPreviewState!('synthetic','alice')).toBeUndefined()
  result=[]
  await expect(store.readPreviewState!('synthetic','alice')).rejects.toThrow('Project access denied')
  result=[{workflow:{...state,ownerId:'other'}}]
  await expect(store.readPreviewState!('synthetic','alice')).rejects.toThrow('Invalid Preview Run')
  status=503;result={message:'private database detail'}
  await expect(store.readPreviewState!('synthetic','alice')).rejects.toThrow('Preview state could not be read (503)')
  expect(calls).toBe(6)
})

test('local writer status counts persisted unresolved writers and reports corrupt storage as unknown', async () => {
  const root = await mkdtemp('/private/tmp/bgs-workflow-writer-status-')
  try {
    const store = createLocalWorkflowStore(root)
    expect(await store.writerStatus!()).toEqual({ writers: 0, state: 'idle', scope: 'configured-store' })
    const current = run()
    current.writer = { attemptId: 'attempt', fence: 1, workerId: 'worker' }
    await store.commit('synthetic', 'alice', 0, current, 'created')
    expect(await store.writerStatus!()).toEqual({ writers: 1, state: 'active', scope: 'configured-store' })
    await writeFile(join(root, 'workflow-v3', 'corrupt.json'), '{not-json')
    expect(await store.writerStatus!()).toEqual({ writers: null, state: 'unknown', scope: 'configured-store' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('remote writer status uses a host-only HEAD count and treats missing counts as unknown', async () => {
  let mode: 'count' | 'missing' | 'failure' = 'count'
  const store = createRemoteWorkflowStore({ url: 'https://db.invalid', serviceKey: 'host-only', fetchImpl: async (input, init) => {
    const url = new URL(String(input))
    expect(url.pathname).toBe('/rest/v1/beegame_workflow_v3')
    expect(url.searchParams.get('select')).toBe('project_id')
    expect(url.searchParams.get('state->>writer')).toBe('not.is.null')
    expect(init?.method).toBe('HEAD')
    expect(new Headers(init?.headers).get('prefer')).toBe('count=exact')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer host-only')
    if (mode === 'failure') return new Response(null, { status: 503 })
    return new Response(null, { status: 200, headers: mode === 'count' ? { 'content-range': '0-0/2' } : {} })
  } })
  expect(await store.writerStatus!()).toEqual({ writers: 2, state: 'active', scope: 'configured-store' })
  mode = 'missing'
  expect(await store.writerStatus!()).toEqual({ writers: null, state: 'unknown', scope: 'configured-store' })
  mode = 'failure'
  expect(await store.writerStatus!()).toEqual({ writers: null, state: 'unknown', scope: 'configured-store' })
})


test('visual source records require the active writer and cannot rewrite already selected bytes', () => {
  const prior = run()
  prior.status='running';prior.fence=1
  prior.writer={attemptId:'author',workerId:'host',fence:1}
  prior.agentTurns=[{attemptId:'author',workerId:'host',fence:1,sessionId:'chat',requestKey:'create',
    requirementsRevision:prior.requirements.revision,status:'running',startedAt:'2026-01-01T00:00:00Z',
    production:{stage:'implementation',originRequestKey:'create'}}]
  const selected=structuredClone(prior);selected.version++
  selected.agentTurns![0]!.visualSelection={request:{action:'select-visual',summary:'Reference',sections:[],files:['look.png']},sources:[{path:'look.png',sha256:'a'.repeat(64)}]}
  expect(() => assertCommit('synthetic','alice',prior.version,selected,prior,'agent.visual-sources-selected')).not.toThrow()
  const replaced=structuredClone(selected);replaced.version++
  replaced.agentTurns![0]!.visualSelection!.sources[0]!.sha256='b'.repeat(64)
  expect(() => assertCommit('synthetic','alice',selected.version,replaced,selected,'agent.visual-sources-selected')).toThrow('cannot be removed or replaced')
  const stopped=structuredClone(selected);stopped.agentTurns![0]!.quiescedAt='2026-01-01T00:00:01Z'
  const late=structuredClone(stopped);late.version++
  late.agentTurns![0]!.visualSelection!.sources.push({path:'late.png',sha256:'c'.repeat(64)})
  expect(() => assertCommit('synthetic','alice',stopped.version,late,stopped,'agent.visual-sources-selected')).toThrow('active writer')
})


test('remote runtime state shares only a current-version projection and always checks live ownership', async () => {
  let current = run(), headerFailure = false, denied = false, absent = false, rpcFailure = false, rpcAbsent = false
  current.agentTurns = [{attemptId:'saved',requestKey:'saved',sessionId:'saved',workerId:'worker',fence:1,
    status:'ended',startedAt:'2026-11-07T00:00:00Z',finishedAt:'2026-11-07T00:01:00Z',
    error:'private historical detail',usage:{heavy:'private usage'},projectInputs:{error:'private source detail'}}]
  let headers = 0, full = 0
  const store = createRemoteWorkflowStore({url:'https://db.invalid',serviceKey:'host-only',fetchImpl:async input => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/beegame_projects')) {
      headers++
      expect(url.searchParams.get('owner_id')).toBe('eq.alice')
      expect(url.searchParams.get('select')).not.toContain('agentTurns')
      return headerFailure ? Response.json({}, {status:503}) : Response.json(denied ? [] : [{workflow:absent ? null : previewRunState(current)}])
    }
    full++
    expect(url.pathname).toBe('/rest/v1/rpc/beegame_workflow_v3_read')
    return rpcFailure ? Response.json({}, {status:503}) : Response.json(rpcAbsent ? null : current)
  }})
  const values = await Promise.all(Array.from({length:5}, () => store.readRuntimeState!('synthetic','alice')))
  expect(full).toBe(1); expect(headers).toBe(5)
  expect(values[0]).toEqual(runtimeRunState(current))
  expect(values[0]).not.toHaveProperty('requirements')
  expect(JSON.stringify(values[0])).not.toContain('private')
  expect(values[0]?.agentTurns?.[0]).toMatchObject({attemptId:'saved',status:'ended',finishedAt:'2026-11-07T00:01:00Z'})
  values[0]!.workspacePath = 'caller mutation'
  expect((await store.readRuntimeState!('synthetic','alice'))?.workspacePath).toBe(current.workspacePath)
  expect(full).toBe(1)
  current = {...current,version:current.version+1,paused:{at:'2026-11-07T00:00:00Z'}}
  expect((await store.readRuntimeState!('synthetic','alice'))?.paused).toEqual(current.paused)
  expect(full).toBe(2)
  current.version++;rpcFailure=true
  await expect(store.readRuntimeState!('synthetic','alice')).rejects.toThrow('database operation failed')
  rpcFailure=false
  expect((await store.readRuntimeState!('synthetic','alice'))?.version).toBe(current.version)
  expect(full).toBe(4)
  headerFailure=true
  await expect(store.readRuntimeState!('synthetic','alice')).rejects.toThrow('state could not be read')
  headerFailure=false;denied=true
  await expect(store.readRuntimeState!('synthetic','alice')).rejects.toThrow('Project access denied')
  denied=false;absent=true
  expect(await store.readRuntimeState!('synthetic','alice')).toBeUndefined()
  absent=false
  expect(await store.readRuntimeState!('synthetic','alice')).toEqual(runtimeRunState(current))
  expect(full).toBe(5)
  current.version++;rpcAbsent=true
  expect(await store.readRuntimeState!('synthetic','alice')).toBeUndefined()
  rpcAbsent=false
  expect(await store.readRuntimeState!('synthetic','alice')).toEqual(runtimeRunState(current))
  expect(full).toBe(7)
})

test('local runtime projection tracks replaced state files and never reuses another owner or corrupt history', async () => {
  const root = await mkdtemp('/private/tmp/bgs-runtime-projection-')
  try {
    const store = createLocalWorkflowStore(root), current = run()
    await store.commit('synthetic','alice',0,current,'created')
    const snapshot = await store.readRuntimeState!('synthetic','alice')
    expect(snapshot).toEqual(runtimeRunState(current))
    snapshot!.workspacePath='caller mutation'
    expect((await store.readRuntimeState!('synthetic','alice'))?.workspacePath).toBe(current.workspacePath)
    await expect(store.readRuntimeState!('synthetic','other')).rejects.toThrow('another project owner')
    const next={...current,version:current.version+1,paused:{at:'2026-11-07T00:00:00Z'}}
    await store.commit('synthetic','alice',current.version,next,'paused')
    expect(await store.readRuntimeState!('synthetic','alice')).toEqual(runtimeRunState(next))
    const {digest} = await import('./state')
    const file=join(root,'workflow-v3',digest('synthetic')+'.json')
    // Same revision, different file identity: no version-only reuse.
    const changed={...next,ownerId:'bobby'}
    await writeFile(file+'.next',JSON.stringify({run:changed,events:[]}));await rename(file+'.next',file)
    await expect(store.readRuntimeState!('synthetic','alice')).rejects.toThrow('another project owner')
    await writeFile(file,'{broken')
    await expect(store.readRuntimeState!('synthetic','alice')).rejects.toThrow()
    await rm(file)
    expect(await store.readRuntimeState!('synthetic','alice')).toBeUndefined()
  } finally { await rm(root,{recursive:true,force:true}) }
})
