import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRun, publishPlan, claimTask, finishTask, V3_PROTOCOL, type Run, type Plan } from './state'
import { runChecks, staleTaskIds, bindInputs, settlementInputs, readVersion } from './checks'
import { createLocalWorkflowStore } from './store'

function fixture(root: string) {
  const run = createRun({ projectId: 'revision', ownerId: 'owner', workspacePath: root, chatSessionId: 'chat', requestKey: 'run',
    text: 'Synthetic independent rule and UI modules', constraints: {}, ids: ['req.loop'] })
  const task = { id: 'rules', kind: 'game.develop' as const, goal: 'Produce rules', requirementIds: ['req.loop'], dependsOn: [], inputs: [],
    writablePaths: ['rules.json'], expectedOutputs: ['rules.json'], checks: ['artifact-json' as const] }
  const plan: Plan = { protocol: V3_PROTOCOL, baseRevision: 0, requirementsRevision: run.requirements.revision, tasks: [task,
    { ...task, id: 'ui', goal: 'Produce independent UI', writablePaths: ['ui.json'], expectedOutputs: ['ui.json'] },
    { ...task, id: 'consumer', goal: 'Consume rules', dependsOn: ['rules'], inputs: ['output:rules/rules.json'], writablePaths: ['consumer.json'], expectedOutputs: ['consumer.json'] },
    { ...task, id: 'raw-reader', goal: 'Inspect rules directly', inputs: ['rules.json'], writablePaths: ['inspection.json'], expectedOutputs: ['inspection.json'] },
  ] }
  return publishPlan(run, plan)
}
async function finish(run: Run, id: string) {
  const task = run.tasks[id]!.spec
  const started = claimTask(run, { taskId: id, requestKey: id+'-'+run.planRevision, workerId: 'worker', sessionId: id+'-'+run.planRevision,
    inputVersions: await bindInputs(run, task) })
  const checked = await runChecks(run.workspacePath, task, started.attempts.at(-1)!.inputVersions)
  return finishTask(started, started.attempts.at(-1)!.attemptId, started.fence, checked, true)
}
function revised(run: Run): Plan { return { ...structuredClone(run.plans.at(-1)!.plan), baseRevision: run.planRevision } }

test('local contract revision invalidates declared/observed consumers, preserves unrelated success and immutable attempt history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-local-revision-'))
  try {
    for (const file of ['rules.json', 'ui.json', 'consumer.json', 'inspection.json']) await writeFile(join(root, file), '{}')
    let run = fixture(root)
    for (const id of ['rules', 'ui', 'consumer', 'raw-reader']) run = await finish(run, id)
    const plan = revised(run); plan.tasks[0]!.goal = 'Repair confirmed rule mismatch with actual failure evidence'
    const next = publishPlan(run, plan, await staleTaskIds(run))
    expect(next.tasks.rules!.status).toBe('pending'); expect(next.tasks.consumer!.status).toBe('pending'); expect(next.tasks['raw-reader']!.status).toBe('pending')
    expect(next.tasks.ui).toEqual(run.tasks.ui); expect(next.attempts).toEqual(run.attempts)
    expect(next.plans.at(-1)!.impact?.consumer).toContain('rules')
    expect(next.plans.at(-1)!.impact?.['raw-reader']).toContain('rules')
    expect(await Bun.file(join(root, 'ui.json')).text()).toBe('{}')
    expect(() => finishTask(next, run.attempts[0]!.attemptId, run.attempts[0]!.fence, {}, true)).toThrow('current writer')
    const repaired = await finish(next, 'rules')
    expect(repaired.tasks.rules!.status).toBe('succeeded'); expect(repaired.tasks.ui!.attemptId).toBe(run.tasks.ui!.attemptId)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('actual source drift can authorize rechecking that branch; identical plan and failed bytes cannot silently reset failed work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-source-revision-'))
  try {
    await writeFile(join(root, 'rules.json'), '{}'); await writeFile(join(root, 'ui.json'), 'bad JSON')
    let run = await finish(fixture(root), 'rules'); run = await finish(run, 'ui')
    const unchanged = publishPlan(run, revised(run), await staleTaskIds(run))
    expect(unchanged.tasks.rules!.status).toBe('succeeded'); expect(unchanged.tasks.ui!.status).toBe('failed')
    expect(unchanged.attempts).toEqual(run.attempts)
    await writeFile(join(root, 'rules.json'), '{"new":true}')
    const stale = await staleTaskIds(run); expect(stale).toContain('rules'); expect(stale).not.toContain('ui')
    const changed = publishPlan(run, revised(run), stale)
    expect(changed.tasks.rules!.status).toBe('pending'); expect(changed.tasks.ui!.status).toBe('failed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('reconstruction preserves current successes; unresolved writer is never released by plan edits or elapsed time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-revision-restore-'))
  try {
    const store = createLocalWorkflowStore(join(root, 'host')), run = fixture(root)
    const original = createRun({ projectId: run.projectId, ownerId: run.ownerId, workspacePath: root, chatSessionId: 'chat', requestKey: 'fixture', text: 'fixture', constraints: {}, ids: ['req.loop'] })
    // Separate independent persistent fixture; never overwrite original requirements.
    await store.commit(run.projectId, run.ownerId, 0, original, 'created')
    const planned = publishPlan(original, { ...run.plans[0]!.plan, requirementsRevision: original.requirements.revision })
    await store.commit(run.projectId, run.ownerId, original.version, planned, 'planned')
    await writeFile(join(root, 'ui.json'), '{}')
    const ui = claimTask(planned, { taskId: 'ui', requestKey: 'ui', workerId: 'worker', sessionId: 'ui-native', inputVersions: [] })
    await store.commit(run.projectId, run.ownerId, planned.version, ui, 'claimed')
    const uiResult = finishTask(ui, ui.attempts.at(-1)!.attemptId, ui.fence, await runChecks(root, ui.tasks.ui!.spec, []), true)
    await store.commit(run.projectId, run.ownerId, ui.version, uiResult, 'settled')
    const claimed = claimTask(uiResult, { taskId: 'rules', requestKey: 'claim', workerId: 'lost-worker', sessionId: 'old-native', inputVersions: [] })
    await store.commit(run.projectId, run.ownerId, uiResult.version, claimed, 'claimed')
    const recovered = (await createLocalWorkflowStore(join(root, 'host')).read(run.projectId, run.ownerId))!
    expect(recovered.writer).toEqual(claimed.writer)
    expect(recovered.tasks.ui).toEqual(uiResult.tasks.ui)
    expect(() => publishPlan(recovered, revised(recovered))).toThrow('confirmed stopped')
    expect(() => claimTask(recovered, { taskId: 'ui', requestKey: 'new', workerId: 'new-worker', sessionId: 'new-native', inputVersions: [] })).toThrow('Previous writer')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('authorized self-revision consumes new bytes but does not waive read-only inputs or binding protection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-self-revision-'))
  try {
    await writeFile(join(root, 'rules.json'), '{}'); await writeFile(join(root, 'policy.json'), '{}')
    const task = fixture(root).tasks.rules!.spec
    const original = [await readVersion(root, 'rules.json'), await readVersion(root, 'policy.json')]
    await writeFile(join(root, 'rules.json'), '{"fixed":true}')
    const saved = await settlementInputs(root, task, original)
    expect(saved[0]!.sha256).not.toBe(original[0]!.sha256)
    expect(original[0]!.sha256).toBe((await import('./state')).digest('{}'))
    await expect(settlementInputs(root, { ...task, bindingPlan: 'map.json' }, original)).rejects.toThrow('Read-only')
    await expect(settlementInputs(root, { ...task, kind: 'game.verify' }, original)).rejects.toThrow('Read-only')
    await expect(settlementInputs(root, { ...task, expectedOutputs: ['other.json'] }, original)).rejects.toThrow('Read-only')
    await writeFile(join(root, 'policy.json'), '{"changed":true}')
    await expect(settlementInputs(root, task, original)).rejects.toThrow('policy.json')
  } finally { await rm(root, { recursive: true, force: true }) }
})
