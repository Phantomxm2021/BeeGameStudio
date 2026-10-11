import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRun, publishPlan, claimTask, finishTask, V3_PROTOCOL, type Run, type Plan } from './state'
import { createLocalWorkflowStore, createRemoteWorkflowStore } from './store'
import { runChecks, bindInputs } from './checks'
import { createAgentWorkflowApp } from '../../app'
import { BeeGameSessionManager, type BeeGameSessionRunnerStartInput, type BeeGameSessionSubmitInput } from '../session-manager'
import { createV3Executor } from './execution'
import { readProjectDelivery } from '../project-delivery'
import { uiLayoutFixture, sceneLayoutFixture } from '../fixtures/layout-fixture'

function run(root = '/tmp/synthetic-game'): Run {
  return createRun({ projectId: 'synthetic', ownerId: 'alice', workspacePath: root, chatSessionId: 'chat',
    requestKey: 'create', text: 'A playable game with restart.', constraints: { orientation: 'Landscape' }, ids: ['req.loop'] })
}
function plan(value: Run): Plan {
  return { protocol: V3_PROTOCOL, baseRevision: value.planRevision, requirementsRevision: value.requirements.revision,
    tasks: [{ id: 'build', kind: 'game.develop', goal: 'Implement the confirmed loop', dependsOn: [], requirementIds: ['req.loop'],
      inputs: [`requirement:req.loop@${value.requirements.revision}`], writablePaths: ['game/**'], expectedOutputs: ['game/rules.json'], checks: ['artifact-json'] }] }
}
test('plan validator aggregates structural errors, rejects missing requirements and cycles', () => {
  const value = run(), invalid = plan(value)
  invalid.baseRevision = 9; invalid.tasks[0]!.dependsOn = ['missing']; invalid.tasks[0]!.requirementIds = ['invented']
  expect(() => publishPlan(value, invalid)).toThrow('baseRevision')
  expect(() => publishPlan(value, invalid)).toThrow('missing dependency')
  expect(() => publishPlan(value, invalid)).toThrow('Missing registered requirement')
  const cycle = plan(value); cycle.tasks[0]!.dependsOn = ['build']
  expect(() => publishPlan(value, cycle)).toThrow('Dependency cycle')
  expect(() => publishPlan(value, { ...plan(value), tasks: [] })).toThrow()
  const scope = plan(value); scope.tasks[0]!.expectedOutputs = ['../outside.json']
  expect(() => publishPlan(value, scope)).toThrow()
})
test('state history and writer ownership are explicit, not inferred from a model reply', () => {
  const original = run(), planned = publishPlan(original, plan(original)), claimed = claimTask(planned, {
    taskId: 'build', requestKey: 'one', workerId: 'worker', sessionId: 'task-session', inputVersions: [] })
  expect(original.planRevision).toBe(0)
  expect(() => claimTask(claimed, { taskId: 'build', requestKey: 'two', workerId: 'other', sessionId: 'other', inputVersions: [] })).toThrow('Previous writer')
  const a = claimed.attempts[0]!
  expect(() => finishTask(claimed, a.attemptId, a.fence+1, {}, true)).toThrow('current writer')
  expect(() => finishTask(claimed, a.attemptId, a.fence, {}, false)).toThrow('exit')
  const completed = finishTask(claimed, a.attemptId, a.fence, {}, true)
  expect(completed.status).toBe('blocked'); expect(completed.deliveryEligible).toBe(false)
  expect(claimed.attempts[0]!.status).toBe('running')
})
test('UI consumption and directed review/repair require real declared operands before dispatch',()=>{
  const original=run(),base=plan(original),task=base.tasks[0]!
  const invalid=[
    {...task,checks:['ui-data-consumption']},
    {...task,checks:['pixel-data-consumption']},
    {...task,runtimeArtifact:'game/dist',pixelProbes:[{document:'content/scenes/level.json',nodeId:'board',componentId:'sprite',selector:'canvas',viewport:[960,540]}]},
    {...task,runtimeArtifact:'game/dist',uiProbes:[{document:'content/ui/menu.json',nodeId:'play',selector:'#play',viewport:[1280,720]}]},
    {...task,reviewReport:'game/review.json',checks:['review-findings'],expectedOutputs:['game/review.json']},
    {...task,kind:'game.verify',checks:['review-findings']},
    {...task,checks:['repair-verification']},
    {...task,repairOf:{attemptId:'11111111-1111-4111-8111-111111111111',findingIds:['F1']},checks:['repair-verification']},
    {...task,kind:'game.verify',reviewReport:'game/review.json',expectedOutputs:['game/review.json'],checks:['review-findings'],reviewOf:'11111111-1111-4111-8111-111111111111'},
  ]
  for(const spec of invalid)expect(()=>publishPlan(original,{...base,tasks:[spec]})).toThrow()
})
test('a failed branch blocks its consumers, not independently authorized work or preserved results', () => {
  const original = run(), proposed = plan(original), first = proposed.tasks[0]!
  proposed.tasks.push({ ...first, id: 'audio', dependsOn: [], expectedOutputs: ['audio/result.json'], writablePaths: ['audio/**'] },
    { ...first, id: 'consumer', dependsOn: ['build'], expectedOutputs: ['consumer/result.json'], writablePaths: ['consumer/**'] })
  const started = claimTask(publishPlan(original, proposed), { taskId: 'build', requestKey: 'failed-branch', workerId: 'worker', sessionId: 'first', inputVersions: [] })
  const failed = finishTask(started, started.attempts[0]!.attemptId, started.fence, { checks: [{ id: 'artifact-json', version: 'fixture', status: 'failed', inputs: [], observation: 'Actual failure', createdAt: new Date().toISOString() }] }, true)
  expect(failed.status).toBe('running'); expect(failed.tasks.build!.status).toBe('failed')
  expect(() => claimTask(failed, { taskId: 'consumer', requestKey: 'blocked-consumer', workerId: 'worker', sessionId: 'consumer', inputVersions: [] })).toThrow('Dependency')
  const independent = claimTask(failed, { taskId: 'audio', requestKey: 'independent', workerId: 'worker', sessionId: 'audio', inputVersions: [] })
  const succeeded = finishTask(independent, independent.attempts[1]!.attemptId, independent.fence, { checks: [{ id: 'artifact-json', version: 'fixture', status: 'passed', inputs: [], observation: 'Actual independent result', createdAt: new Date().toISOString() }] }, true)
  expect(succeeded.tasks.audio!.status).toBe('succeeded'); expect(succeeded.tasks.consumer!.status).toBe('pending')
  expect(succeeded.attempts[0]).toEqual(failed.attempts[0])
  expect(succeeded.status).toBe('blocked'); expect(succeeded.deliveryEligible).toBe(false)
})
test('single-process persistent CAS rejects simultaneous claims, survives reconstruction and protects source ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-cas-'))
  try {
    const store = createLocalWorkflowStore(root), original = run(), planned = publishPlan(original, plan(original))
    await store.commit('synthetic', 'alice', 0, original, 'created')
    await store.commit('synthetic', 'alice', 1, planned, 'planned')
    const first = claimTask(planned, { taskId: 'build', requestKey: 'one', workerId: 'a', sessionId: 'a', inputVersions: [] })
    const second = claimTask(planned, { taskId: 'build', requestKey: 'two', workerId: 'b', sessionId: 'b', inputVersions: [] })
    const results = await Promise.allSettled([store.commit('synthetic', 'alice', 2, first, 'claimed'), createLocalWorkflowStore(root).commit('synthetic', 'alice', 2, second, 'claimed')])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const recovered = await createLocalWorkflowStore(root).read('synthetic', 'alice')
    expect(recovered?.writer).toBeDefined()
    expect(() => claimTask(recovered!, { taskId: 'build', requestKey: 'later', workerId: 'new', sessionId: 'new', inputVersions: [] })).toThrow('Previous writer')
    await expect(store.read('synthetic', 'bob')).rejects.toThrow('another project owner')
    const changed = structuredClone(recovered!); changed.version++; changed.requirements.text = 'Silently change scope'
    await expect(store.commit('synthetic', 'alice', recovered!.version, changed, 'edited')).rejects.toThrow('cannot be overwritten')
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('real checker rejects bad/missing JSON, unknown runtime checks, escaped symlinks and stale dependency files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-check-'))
  try {
    await mkdir(join(root, 'game')); await writeFile(join(root, 'game/rules.json'), '{}')
    const original = run(root), task = plan(original).tasks[0]!
    expect((await runChecks(root, task, [])).checks[0]!.status).toBe('passed')
    await writeFile(join(root, 'game/rules.json'), '{')
    expect((await runChecks(root, task, [])).checks[0]!.status).toBe('failed')
    await rm(join(root, 'game/rules.json'))
    expect((await runChecks(root, task, [])).checks[0]!.status).toBe('unverified')
    await symlink('/etc/hosts', join(root, 'game/rules.json'))
    expect((await runChecks(root, task, [])).checks[0]!.status).toBe('unverified')
    await rm(join(root, 'game/rules.json')); await writeFile(join(root, 'game/rules.json'), '{}')
    expect((await runChecks(root, { ...task, checks: ['runtime-smoke'] }, [])).checks[0]!.status).toBe('unverified')
    const claimed = claimTask(publishPlan(original, plan(original)), { taskId: 'build', requestKey: 'one', workerId: 'a', sessionId: 'a', inputVersions: [] })
    const a = claimed.attempts[0]!, checked = await runChecks(root, task, [])
    const complete = finishTask(claimed, a.attemptId, a.fence, checked, true)
    await writeFile(join(root, 'game/rules.json'), '{"changed":true}')
    await expect(bindInputs(complete, { ...task, id: 'consumer', dependsOn: ['build'], inputs: ['output:build/game/rules.json'] })).rejects.toThrow('changed')
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('actual rule command is run by the host and nonzero exit cannot become passed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-command-'))
  try {
    await mkdir(join(root, 'game')); await writeFile(join(root, 'game/rules.json'), '{}')
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { 'test:rules': 'bun -e "process.exit(3)"' } }))
    const checked = await runChecks(root, { ...plan(run(root)).tasks[0]!, checks: ['rule-tests'] }, [])
    expect(checked.checks[0]!.status).toBe('failed'); expect(checked.checks[0]!.observation).toContain('exit 3')
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('two project IDs cannot claim the same canonical workspace in local development', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-alias-'))
  try {
    const store = createLocalWorkflowStore(root), first = run(root), second = { ...run(root), projectId: 'alias' }
    for (const value of [first, second]) {
      await store.commit(value.projectId, 'alice', 0, value, 'created')
      const planned = publishPlan(value, plan(value)); await store.commit(value.projectId, 'alice', 1, planned, 'planned')
    }
    const proposals = [first, second].map(value => publishPlan(value, plan(value))).map(value => claimTask(value,
      { taskId: 'build', requestKey: 'execute', workerId: 'worker', sessionId: value.projectId, inputVersions: [] }))
    const results = await Promise.allSettled(proposals.map(value => store.commit(value.projectId, 'alice', 2, value, 'claimed')))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('native completion without artifacts is blocked; cancellation keeps partial work without automatic retry', async () => {
  for (const cancel of [false, true]) {
    const root = await mkdtemp(join(tmpdir(), 'bgs-v3-stop-')), store = createLocalWorkflowStore(join(root, 'host'))
    let submits = 0, disposed = 0
    const sessions = new BeeGameSessionManager({ async start() { return { stop() {}, async dispose() { disposed++ }, async submit(turn) {
      submits++
      if (cancel) {
        await mkdir(join(root, 'game')); await writeFile(join(root, 'game/rules.json'), '{"partial":true}')
        await new Promise<void>(resolve => { if (turn.signal.aborted) resolve(); else turn.signal.addEventListener('abort', () => resolve(), { once: true }) })
      } else await turn.onMessage({ type: 'result', subtype: 'success', result: 'PASS, everything delivered.' })
    } } } }, join(root, 'host'), async () => ({}), {}, true)
    const executor = createV3Executor({ store, sessions })
    try {
      const original = run(root), planned = publishPlan(original, plan(original))
      await store.commit('synthetic', 'alice', 0, original, 'created'); await store.commit('synthetic', 'alice', 1, planned, 'planned')
      await executor.start(planned, 'build', 'execute', {})
      for (let i = 0; i < 100 && submits === 0; i++) await Bun.sleep(5)
      if (cancel) await executor.stop((await store.read('synthetic', 'alice'))!)
      else for (let i = 0; i < 100 && (await store.read('synthetic', 'alice'))?.writer; i++) await Bun.sleep(5)
      await executor.dispose()
      const settled = (await store.read('synthetic', 'alice'))!
      expect(settled.writer).toBeUndefined(); expect(settled.status).toBe('blocked'); expect(settled.deliveryEligible).toBe(false)
      expect(submits).toBe(1); expect(disposed).toBeGreaterThan(0)
      if (cancel) expect(await readFile(join(root, 'game/rules.json'), 'utf8')).toContain('partial')
      else expect(settled.attempts[0]!.checks?.[0]!.status).toBe('unverified')
    } finally { await executor.dispose(); await sessions.dispose(); await rm(root, { recursive: true, force: true }) }
  }
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

test('HTTP vertical slice uses distinct native contexts, real files/checks, idempotency and original Chat mapping without legacy flags', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-http-')), cleanups: Array<() => unknown> = []
  const starts: BeeGameSessionRunnerStartInput[] = [], submissions: BeeGameSessionSubmitInput[] = []
  const store = createLocalWorkflowStore(join(root, 'dashboard'))
  const app = createAgentWorkflowApp({ currentUser: { id: 'v3-owner', role: 'owner' }, dashboardDataRoot: join(root, 'dashboard'),
    defaultWorkspacePath: join(root, 'projects'), workflowV3Store: store, modelConfigStore: false, skillsConfig: false,
    sessionRunner: { async start(start) { starts.push(start); start.onNativeSessionId?.(starts.length === 1 ? '11111111-2222-4333-8444-555555555555' : '99999999-2222-4333-8444-555555555555'); return { stop() {}, async submit(turn) {
      submissions.push(turn)
      if (submissions.length === 1) {
        const decision = await turn.requestPermission({ toolUseID: 'v3-question', toolName: 'AskUserQuestion', message: 'Need a preference',
          input: { questions: [{ question: 'Choose feedback style?', header: 'Feedback', options: [{ label: 'Bright' }, { label: 'Soft' }] }] } })
        expect(decision.behavior).toBe('allow')
      }
      const task = submissions.length === 1 ? 'rules' : 'second'
      await mkdir(join(start.cwd, 'game'), { recursive: true }); await writeFile(join(start.cwd, 'game/'+task+'.json'), '{"actual":true}')
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'All done.', usage: { input_tokens: 10, output_tokens: 5 } })
    } } } }, registerCleanup: fn => cleanups.push(fn) })
  const send = (url: string, method: string, body?: unknown) => app.request(url, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  try {
    await send('/api/model-configs', 'POST', { name: 'Offline', provider: 'openai-compatible', apiKey: 'fake', models: { balanced: 'fake' }, isDefault: true })
    const workspace = join(root, 'projects/users/v3-owner/synthetic'); await mkdir(workspace, { recursive: true })
    expect((await send('/api/projects', 'POST', { id: 'synthetic', name: 'Synthetic', root_path: workspace, created_at: Date.now() })).status).toBe(200)
    const ensured = await send('/api/projects/synthetic/session/ensure', 'POST', {})
    expect(ensured.status).toBe(200)
    const chatId = (await ensured.json()).session.id as string
    const prefix = '/api/projects/synthetic/workflow-v3'
    const payload = { requestKey: 'create', chatSessionId: chatId, requirements: { text: 'Synthetic rules and restart.', constraints: { orientation: 'Landscape' }, ids: ['req.loop'] } }
    const created = await send(prefix+'/runs', 'POST', payload); expect(created.status).toBe(201)
    const original = (await created.json()).run as Run
    expect((await send(prefix+'/runs', 'POST', payload)).status).toBe(200)
    // The real public read route must not fall back to legacy delivery gates.
    expect((await (await app.request('/api/projects/synthetic/game-content')).json()).state).toBe('awaiting_content')
    await mkdir(join(workspace, 'content/scenes'), { recursive: true }); await mkdir(join(workspace, 'content/ui'), { recursive: true })
    const scene = sceneLayoutFixture(), ui = uiLayoutFixture()
    await writeFile(join(workspace, 'content/index.json'), JSON.stringify({ schema: 'beegame-content-package.v2', id: 'fixture', dimension: '2d',
      documentRevision: 'a'.repeat(64), assetManifestRevision: 'b'.repeat(64), sceneModel: 'game-object-v2', entryScene: scene.id,
      files: ['scenes/level.json', 'ui/menu.json'], documents: [
        { path: 'scenes/level.json', id: scene.id, kind: scene.kind, loadPhase: 'startup' },
        { path: 'ui/menu.json', id: ui.id, kind: ui.kind, loadPhase: 'on-demand' },
      ] }))
    await writeFile(join(workspace, 'content/scenes/level.json'), JSON.stringify(scene))
    await writeFile(join(workspace, 'content/ui/menu.json'), JSON.stringify(ui))
    const viewResponse = await app.request('/api/projects/synthetic/game-content')
    expect(viewResponse.status).toBe(200); expect(viewResponse.headers.get('cache-control')).toBe('private, no-store')
    const view = await viewResponse.json()
    expect(view).toMatchObject({ protocol: 'bgs.workflow.v3', readOnly: true, state: 'draft' })
    expect(view.documents[0].document).toEqual(scene)
    const metadata = await (await app.request('/api/projects/synthetic/game-content?metadata=1')).json()
    expect(metadata.documents[0]).not.toHaveProperty('document')
    expect(metadata.contentRevision).toBe(view.contentRevision)
    const beforeSource = await readFile(join(workspace, 'content/ui/menu.json'), 'utf8')
    for (const path of ['game-content/document', 'game-content/publish']) {
      expect((await send('/api/projects/synthetic/'+path, path.endsWith('document') ? 'PUT' : 'POST', {})).status).toBe(409)
    }
    expect(await readFile(join(workspace, 'content/ui/menu.json'), 'utf8')).toBe(beforeSource)
    expect(submissions).toHaveLength(0)
    const proposed = plan(original)
    proposed.tasks.push({ ...proposed.tasks[0]!, id: 'second', dependsOn: ['build'], inputs: ['output:build/game/rules.json'], expectedOutputs: ['game/second.json'] })
    expect((await send(prefix+'/plan', 'PUT', proposed)).status).toBe(200)
    const execute = { requestKey: 'exec-one', planRevision: 1 }
    const started = await send(prefix+'/tasks/build/execute', 'POST', execute); expect(started.status).toBe(202)
    const first = (await started.json()).attempt
    expect(first.sessionId).not.toBe(chatId)
    for (let i = 0; i < 100; i++) {
      const events = await (await app.request(prefix+'/events')).json()
      if (events.events.some((event: any) => event.type === 'permission.requested')) break
      await Bun.sleep(5)
    }
    expect((await send('/api/projects/synthetic/permissions/v3-question', 'POST', { decision: 'allow', answers: {} })).status).toBe(400)
    const liveRuntime = await (await app.request('/api/projects/synthetic/runtime-state')).json()
    expect(liveRuntime.pending_permissions.some((p: any) => p.id === 'v3-question' && p.session_id === first.sessionId)).toBe(true)
    const duringWriter = await app.request('/api/projects/synthetic/game-content')
    expect(duringWriter.status).toBe(409); expect((await duringWriter.json()).code).toBe('workspace-busy')
    expect((await send('/api/projects/synthetic/permissions/v3-question', 'POST', { decision: 'allow', answers: { 'Choose feedback style?': 'Bright' } })).status).toBe(200)
    const wait = async () => {
      for (let i = 0; i < 150; i++) { const current = await store.read('synthetic', 'v3-owner'); if (!current?.writer) return current!; await Bun.sleep(10) }
      throw new Error('Synthetic execution did not settle')
    }
    const after = await wait(); expect(after.tasks.build!.status).toBe('succeeded'); expect(after.deliveryEligible).toBe(false)
    const sources = await (await app.request(prefix+'/sources')).json()
    expect(sources.sources[0].outputs[0].sha256).toBe(after.attempts[0]!.outputs?.[0]!.sha256)
    expect(sources.sources[0].outputs[0].recordedChecks[0].id).toBe('artifact-json')
    expect(sources.note).toContain('not a new current-file')
    expect(after.attempts[0]!.nativeSessionId).toBe('11111111-2222-4333-8444-555555555555')
    expect(after.attempts[0]!.turnId).toBeDefined(); expect(after.attempts[0]!.usage).toBeDefined()
    expect((await send(prefix+'/tasks/build/execute', 'POST', execute)).status).toBe(202)
    expect(submissions).toHaveLength(1)
    const pausedResponse = await send(prefix+'/stop', 'POST', {})
    expect(pausedResponse.status).toBe(202)
    expect((await pausedResponse.json()).paused).toBe(true)
    const paused = (await createLocalWorkflowStore(join(root, 'dashboard')).read('synthetic', 'v3-owner'))!
    expect(paused.paused).toBeDefined(); expect(paused.tasks.build).toEqual(after.tasks.build)
    expect((await send(prefix+'/tasks/second/execute', 'POST', { requestKey: 'paused-exec', planRevision: 1 })).status).toBe(409)
    expect((await send(prefix+'/resume', 'POST', { planRevision: 2 })).status).toBe(409)
    expect(submissions).toHaveLength(1)
    const resumedResponse = await send(prefix+'/resume', 'POST', { planRevision: 1 })
    expect(resumedResponse.status).toBe(200)
    expect((await resumedResponse.json()).dispatched).toBe(false)
    expect(submissions).toHaveLength(1)
    expect((await send(prefix+'/tasks/second/execute', 'POST', { requestKey: 'exec-two', planRevision: 1 })).status).toBe(202)
    const final = await wait(); expect(final.status).toBe('blocked'); expect(final.blockedReason).toContain('formal content consumption')
    expect(starts).toHaveLength(2); expect(starts[1]!.sessionId).not.toBe(starts[0]!.sessionId)
    expect(starts[0]!.resumeSessionId).toBeUndefined(); expect(starts[1]!.resumeSessionId).toBeUndefined()
    expect(starts[0]!.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    for (const request of submissions) { expect(request.directionAuthors).toBeUndefined(); expect(request.projectTurn).toBeUndefined(); expect(request.confirmedBriefContext).toBeUndefined() }
    const events = await (await app.request(prefix+'/events')).json()
    expect(events.events.some((e: any) => e.workflowExecution?.attemptId === first.attemptId)).toBe(true)
    const ensuredAgain = await send('/api/projects/synthetic/session/ensure', 'POST', {})
    expect((await ensuredAgain.json()).session.id).toBe(chatId)
    await expect(readFile(join(workspace, 'docs/GDD.md'))).rejects.toThrow()
    const legacy = await send('/api/beegame-sessions/'+chatId+'/confirmed-brief', 'POST', { brief: {
      idea: 'Accidental legacy flow', creationMode: 'blueprint', orientation: 'Landscape', resourceLibraryUsage: 'optional',
      document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en' } })
    expect(legacy.status).not.toBe(200); expect(submissions).toHaveLength(2)
    expect(await readProjectDelivery(workspace, join(root, 'dashboard'))).toBeUndefined()
    const revision = structuredClone(proposed); revision.baseRevision = 1; revision.tasks[0]!.goal = 'Authorized targeted repair after observed defect'
    const revisedResponse = await send(prefix+'/plan', 'PUT', revision)
    expect(revisedResponse.status).toBe(200)
    const revised = (await revisedResponse.json()).run as Run
    expect(revised.planRevision).toBe(2); expect(revised.tasks.build!.status).toBe('pending')
    expect(revised.tasks.second!.status).toBe('pending'); expect(revised.attempts).toEqual(final.attempts)
    expect(revised.plans.at(-1)!.impact?.second).toContain('build')
    expect(submissions).toHaveLength(2)
    expect((await send(prefix+'/tasks/build/execute', 'POST', { requestKey: 'obsolete-plan', planRevision: 1 })).status).toBe(409)
    expect((await send(prefix+'/tasks/build/execute', 'POST', { requestKey: 'exec-one', planRevision: 2 })).status).toBe(409)
    expect(submissions).toHaveLength(2)
    const restarted = createAgentWorkflowApp({ currentUser: { id: 'v3-owner', role: 'owner' }, dashboardDataRoot: join(root, 'dashboard'),
      defaultWorkspacePath: join(root, 'projects'), workflowV3Store: false, modelConfigStore: false, skillsConfig: false,
      registerCleanup: fn => cleanups.push(fn), sessionRunner: { async start() { throw new Error('Disabled V3 must not launch any native work') } } })
    const disabledLegacy = await restarted.request('/api/projects/synthetic/bootstrap-unused', { method: 'POST' })
    expect(disabledLegacy.status).toBe(409)
    expect((await restarted.request('/api/projects/synthetic/workflow-v3')).status).toBe(503)
    expect((await restarted.request('/api/projects/synthetic/game-content')).status).toBe(503)
    const reset = await restarted.request('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'synthetic', name: 'Overwrite mode', root_path: workspace, created_at: Date.now() }) })
    expect(reset.status).not.toBe(200)
  } finally { for (const fn of cleanups.reverse()) await fn(); await rm(root, { recursive: true, force: true }) }
})
