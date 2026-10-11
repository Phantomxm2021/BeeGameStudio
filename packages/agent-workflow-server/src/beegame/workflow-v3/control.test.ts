import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRun, publishPlan, claimTask, finishTask, pauseRun, resumeRun, V3_PROTOCOL, type Run } from './state'
import { createLocalWorkflowStore, type WorkflowStore } from './store'
import { bindInputs, runChecks, settlementInputs, staleTaskIds, assertFreshDependencies } from './checks'
import { createV3Executor } from './execution'
import { BeeGameSessionManager } from '../session-manager'

function fixture(root: string): Run {
  const run = createRun({ projectId: 'control', ownerId: 'owner', workspacePath: root, chatSessionId: 'chat', requestKey: 'run',
    text: 'Synthetic independent rule and presentation branches', constraints: {}, ids: ['req.loop'] })
  const task = { id: 'rules', kind: 'game.develop' as const, goal: 'Produce rules', dependsOn: [], requirementIds: ['req.loop'], inputs: [],
    writablePaths: ['rules.json'], expectedOutputs: ['rules.json'], checks: ['artifact-json' as const] }
  return publishPlan(run, { protocol: V3_PROTOCOL, baseRevision: 0, requirementsRevision: run.requirements.revision, tasks: [task,
    { ...task, id: 'ui', writablePaths: ['ui.json'], expectedOutputs: ['ui.json'] },
    { ...task, id: 'consumer', dependsOn: ['rules'], writablePaths: ['consumer.json'], expectedOutputs: ['consumer.json'] },
    { ...task, id: 'transitive', dependsOn: ['consumer'], writablePaths: ['transitive.json'], expectedOutputs: ['transitive.json'] },
  ] })
}
async function persist(store: WorkflowStore, planned: Run) {
  const original = { ...structuredClone(planned), version: 1, planRevision: 0, plans: [], tasks: {}, status: 'planning' as const }
  await store.commit(planned.projectId, planned.ownerId, 0, original, 'created')
  await store.commit(planned.projectId, planned.ownerId, original.version, planned, 'planned')
}
async function complete(run: Run, id: string): Promise<Run> {
  const task = run.tasks[id]!.spec
  const next = claimTask(run, { taskId: id, requestKey: id, workerId: 'worker', sessionId: id, inputVersions: await bindInputs(run, task) })
  return finishTask(next, next.attempts.at(-1)!.attemptId, next.fence, await runChecks(run.workspacePath, task, next.attempts.at(-1)!.inputVersions), true)
}

test('unchanged bytes do not make an obsolete checker current; dispatch refuses it before any native call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-check-version-'))
  let starts = 0
  const sessions = new BeeGameSessionManager({ async start() { starts++; throw new Error('Obsolete evidence must not start a native call') } }, join(root, 'native'), async () => ({}), {}, true)
  const executor = createV3Executor({ store: createLocalWorkflowStore(join(root, 'host')), sessions })
  try {
    for (const path of ['rules.json', 'ui.json', 'consumer.json']) await writeFile(join(root, path), '{}')
    let run = fixture(root)
    for (const id of ['rules', 'ui', 'consumer']) run = await complete(run, id)
    run.attempts.find(a => a.taskId === 'rules')!.checks![0]!.version = 'obsolete-checker.0'
    const before = structuredClone(run)
    await expect(assertFreshDependencies(run, run.tasks.transitive!.spec)).rejects.toThrow('rules')
    await expect(executor.start(run, 'transitive', 'no-paid-retry', {})).rejects.toThrow('rules')
    expect(starts).toBe(0)
    expect(run).toEqual(before)
    expect(await staleTaskIds(run)).toEqual(['rules'])
    const next = publishPlan(run, { ...structuredClone(run.plans.at(-1)!.plan), baseRevision: run.planRevision }, await staleTaskIds(run))
    expect(next.tasks.rules!.status).toBe('pending')
    expect(next.tasks.consumer!.status).toBe('pending')
    expect(next.tasks.transitive!.status).toBe('pending')
    expect(next.tasks.ui).toEqual(run.tasks.ui)
    expect(next.attempts).toEqual(before.attempts)
    expect(await Bun.file(join(root, 'ui.json')).text()).toBe('{}')
  } finally { await executor.dispose(); await sessions.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('pause survives restart/replanning/settlement; explicit resume preserves history and never retries partial work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-pause-state-'))
  try {
    const store = createLocalWorkflowStore(join(root, 'host')), run = fixture(root)
    await persist(store, run)
    const started = claimTask(run, { taskId: 'rules', requestKey: 'start', workerId: 'lost', sessionId: 'old', inputVersions: [] })
    await store.commit(run.projectId, run.ownerId, run.version, started, 'claimed')
    const paused = pauseRun(started)
    await store.commit(run.projectId, run.ownerId, started.version, paused, 'paused')
    const restored = (await createLocalWorkflowStore(join(root, 'host')).read(run.projectId, run.ownerId))!
    expect(restored.paused).toEqual(paused.paused); expect(restored.writer).toEqual(started.writer)
    expect(pauseRun(restored)).toBe(restored)
    expect(() => resumeRun(restored)).toThrow('previous writer')
    expect(() => claimTask(restored, { taskId: 'ui', requestKey: 'blocked', workerId: 'new', sessionId: 'new', inputVersions: [] })).toThrow('user-paused')
    const stopped = finishTask(restored, started.writer!.attemptId, started.fence, { error: 'Cancelled; partial bytes retained' }, true)
    expect(stopped.paused).toEqual(paused.paused); expect(stopped.status).toBe('blocked')
    const plan = { ...structuredClone(run.plans[0]!.plan), baseRevision: stopped.planRevision }
    const revised = publishPlan(stopped, plan)
    expect(revised.status).toBe('blocked'); expect(revised.paused).toEqual(paused.paused)
    expect(revised.tasks.rules!.status).toBe('failed')
    const resumed = resumeRun(revised)
    expect(resumed.paused).toBeUndefined(); expect(resumed.status).toBe('running')
    expect(resumed.tasks.rules!.status).toBe('failed'); expect(resumed.tasks.ui!.status).toBe('pending')
    expect(resumed.attempts).toEqual(stopped.attempts)
    expect(resumeRun(resumed)).toBe(resumed)
    expect(() => claimTask(resumed, { taskId: 'consumer', requestKey: 'dependent', workerId: 'new', sessionId: 'new', inputVersions: [] })).toThrow('Dependency')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('consumer dispatch validates upstream check sources and transitive dependencies without spending or touching unrelated work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-fresh-dependencies-'))
  let starts = 0
  const sessions = new BeeGameSessionManager({ async start() { starts++; throw new Error('Stale work must not start') } }, join(root, 'native'), async () => ({}), {}, true)
  const store = createLocalWorkflowStore(join(root, 'host')), executor = createV3Executor({ store, sessions })
  try {
    for (const path of ['rules.json', 'consumer.json', 'resource.json']) await writeFile(join(root, path), '{}')
    let run = fixture(root)
    // A checked source can change even when the requested output bytes do not.
    run.tasks.rules!.spec.inputs = ['resource.json']; run.plans[0]!.plan.tasks[0]!.inputs = ['resource.json']
    run = await complete(run, 'rules'); run = await complete(run, 'consumer')
    await assertFreshDependencies(run, run.tasks.transitive!.spec)
    await writeFile(join(root, 'resource.json'), '{"updated":true}')
    const before = structuredClone(run)
    await expect(assertFreshDependencies(run, run.tasks.consumer!.spec)).rejects.toThrow('rules')
    await expect(executor.start(run, 'transitive', 'no-charge', {})).rejects.toThrow('rules')
    await assertFreshDependencies(run, run.tasks.ui!.spec)
    expect(starts).toBe(0); expect(run).toEqual(before)
    expect(await Bun.file(join(root, 'rules.json')).text()).toBe('{}')
  } finally { await executor.dispose(); await sessions.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('accepted self-revision pins checked output bytes, not the pre-repair input snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-self-repair-current-'))
  try {
    await writeFile(join(root, 'rules.json'), '{"old":true}')
    const run = fixture(root); run.tasks.rules!.spec.inputs = ['rules.json']
    const started = claimTask(run, { taskId: 'rules', requestKey: 'repair', workerId: 'worker', sessionId: 'repair', inputVersions: await bindInputs(run, run.tasks.rules!.spec) })
    const original = structuredClone(started.attempts[0]!.inputVersions)
    await writeFile(join(root, 'rules.json'), '{"repaired":true}')
    const current = await settlementInputs(root, run.tasks.rules!.spec, original)
    const checked = await runChecks(root, run.tasks.rules!.spec, current)
    const saved = finishTask(started, started.writer!.attemptId, started.fence, checked, true)
    expect(saved.attempts[0]!.inputVersions).toEqual(original)
    expect(await staleTaskIds(saved)).not.toContain('rules')
    await assertFreshDependencies(saved, run.tasks.consumer!.spec)
    await writeFile(join(root, 'rules.json'), '{"unreviewed":true}')
    expect(await staleTaskIds(saved)).toContain('rules')
    await expect(assertFreshDependencies(saved, run.tasks.consumer!.spec)).rejects.toThrow('rules')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('idle stop persists pause without a native call; unknown writer stays owned and explicit resume cannot unlock it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-idle-stop-'))
  let starts = 0
  const sessions = new BeeGameSessionManager({ async start() { starts++; throw new Error('No native call expected') } }, join(root, 'native'), async () => ({}), {}, true)
  const store = createLocalWorkflowStore(join(root, 'host')), executor = createV3Executor({ store, sessions })
  try {
    const run = fixture(root); await persist(store, run)
    const paused = await executor.stop(run)
    expect(paused.paused).toBeDefined(); expect(paused.writer).toBeUndefined()
    await expect(executor.start(paused, 'ui', 'paused', {})).rejects.toThrow('user-paused')
    const resumed = await executor.resume(paused)
    expect(resumed.status).toBe('running'); expect(starts).toBe(0)
    const claimed = claimTask(resumed, { taskId: 'rules', requestKey: 'lost', workerId: 'other-worker', sessionId: 'lost', inputVersions: [] })
    await store.commit(run.projectId, run.ownerId, resumed.version, claimed, 'claimed')
    await expect(executor.stop(claimed)).rejects.toThrow('Run is paused')
    const stopped = (await store.read(run.projectId, run.ownerId))!
    expect(stopped.writer).toEqual(claimed.writer); expect(stopped.paused).toBeDefined()
    await expect(executor.resume(stopped)).rejects.toThrow('unknown writer')
    expect(starts).toBe(0)
  } finally { await executor.dispose(); await sessions.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('pause/settlement CAS race rebases records only; does not rerun native work, checks or release an unknown writer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-pause-race-'))
  let submits = 0, injected = 0
  const base = createLocalWorkflowStore(join(root, 'host'))
  const store: WorkflowStore = { read: base.read, async commit(project, actor, version, next, event) {
    if (event === 'attempt.settled' && !injected++) {
      const current = (await base.read(project, actor))!
      await base.commit(project, actor, current.version, pauseRun(current), 'race.user-pause')
    }
    await base.commit(project, actor, version, next, event)
  } }
  const sessions = new BeeGameSessionManager({ async start(start) { return { stop() {}, async submit(turn) {
    submits++; await writeFile(join(start.cwd, 'rules.json'), '{}')
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Saved' })
  } } } }, join(root, 'native'), async () => ({}), {}, true)
  const executor = createV3Executor({ store, sessions })
  try {
    const run = fixture(root); await persist(store, run)
    await executor.start(run, 'rules', 'one', {})
    for (let i = 0; i < 150 && (await store.read(run.projectId, run.ownerId))?.writer; i++) await Bun.sleep(10)
    const saved = (await store.read(run.projectId, run.ownerId))!
    expect(saved.writer).toBeUndefined(); expect(saved.paused).toBeDefined(); expect(saved.status).toBe('blocked')
    expect(saved.tasks.rules!.status).toBe('succeeded'); expect(saved.tasks.ui!.status).toBe('pending')
    expect(submits).toBe(1); expect(saved.attempts).toHaveLength(1)
    expect(saved.attempts[0]!.checks).toHaveLength(1)
    await expect(executor.start(saved, 'ui', 'no', {})).rejects.toThrow('user-paused')
  } finally { await executor.dispose(); await sessions.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('settlement winning the pause CAS still persists user intent and preserves the recorded result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-stop-after-settle-'))
  const base = createLocalWorkflowStore(join(root, 'host'))
  let settledOnce = false, starts = 0
  const store: WorkflowStore = { read: base.read, async commit(project, actor, version, next, event) {
    if (event === 'run.paused' && !settledOnce) {
      settledOnce = true
      const current = (await base.read(project, actor))!
      // Synthetic confirmed-exit event wins this CAS, not an elapsed-time unlock.
      const stopped = finishTask(current, current.writer!.attemptId, current.fence, { error: 'Synthetic writer exit confirmed' }, true)
      await base.commit(project, actor, current.version, stopped, 'attempt.settled')
    }
    await base.commit(project, actor, version, next, event)
  } }
  const sessions = new BeeGameSessionManager({ async start() { starts++; throw new Error('No second execution expected') } }, join(root, 'native'), async () => ({}), {}, true)
  const executor = createV3Executor({ store, sessions })
  try {
    const planned = fixture(root); await persist(store, planned)
    const claimed = claimTask(planned, { taskId: 'rules', requestKey: 'old', workerId: 'other', sessionId: 'old', inputVersions: [] })
    await store.commit(planned.projectId, planned.ownerId, planned.version, claimed, 'claimed')
    const paused = await executor.stop(claimed)
    expect(paused.paused).toBeDefined(); expect(paused.writer).toBeUndefined()
    expect(paused.tasks.rules!.status).toBe('failed'); expect(paused.tasks.ui!.status).toBe('pending')
    expect(paused.attempts[0]!.error).toBe('Synthetic writer exit confirmed')
    expect(starts).toBe(0)
  } finally { await executor.dispose(); await sessions.dispose(); await rm(root, { recursive: true, force: true }) }
})
