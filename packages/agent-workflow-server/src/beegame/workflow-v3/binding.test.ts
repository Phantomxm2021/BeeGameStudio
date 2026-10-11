import { test, expect, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import { mkdtemp, mkdir, realpath, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRun, publishPlan, claimTask, digest, V3_PROTOCOL, type TaskSpec, type Run } from './state'
import { createLocalWorkflowStore, type WorkflowStore } from './store'
import { readVersion, bindInputs, versionsMatch } from './checks'
import { executeTaskBindings } from './binding'
import { createV3Executor } from './execution'
import { BeeGameSessionManager } from '../session-manager'
import { uiLayoutFixture, sceneLayoutFixture } from '../fixtures/layout-fixture'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from '../asset-contracts'

const uiFile = 'content/ui/menu.json', mappingFile = 'binding-map.json'
const bindingTask: TaskSpec = { id: 'bind', kind: 'game.develop', goal: 'Bind existing assets without redesigning the UI', dependsOn: [],
  requirementIds: ['req.loop'], inputs: [uiFile], writablePaths: [uiFile, mappingFile], expectedOutputs: [uiFile, mappingFile],
  checks: ['artifact-json', 'content-schema', 'content-structure', 'content-layout', 'content-resources'], bindingPlan: mappingFile }

test('plan rejects misplaced or undeclared binding data before native execution', () => {
  const run = createRun({ projectId: 'binding-plan', ownerId: 'alice', workspacePath: '/tmp/fixture', chatSessionId: 'chat', requestKey: 'create',
    text: 'Confirmed UI', constraints: {}, ids: ['req.loop'] })
  for (const invalid of [{ ...bindingTask, kind: 'game.verify' }, { ...bindingTask, bindingPlan: uiFile },
    { ...bindingTask, expectedOutputs: [uiFile] }, { ...bindingTask, expectedOutputs: [mappingFile] }])
    expect(() => publishPlan(run, { protocol: V3_PROTOCOL, baseRevision: 0, requirementsRevision: run.requirements.revision, tasks: [invalid] })).toThrow('bindingPlan requires')
})

async function fixture(second = false, claim = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-v3-binding-')))
  await mkdir(join(root, 'content/ui'), { recursive: true }); await mkdir(join(root, 'assets/runtime/example'), { recursive: true })
  await writeFile(join(root, uiFile), JSON.stringify(uiLayoutFixture()))
  if (second) await writeFile(join(root, 'content/ui/second.json'), JSON.stringify({ ...uiLayoutFixture(), id: 'second' }))
  const manifest = assetManifestAuthoringExamples().canonical
  await writeFile(join(root, 'assets/runtime/example/resource.json'), '{}')
  await writeBeeGameAssetManifest(root, manifest)
  const task = second ? { ...bindingTask, inputs: [...bindingTask.inputs, 'content/ui/second.json'], writablePaths: ['content/ui/**', mappingFile],
    expectedOutputs: [...bindingTask.expectedOutputs, 'content/ui/second.json'] } : bindingTask
  const original = createRun({ projectId: 'binding-fixture', ownerId: 'alice', workspacePath: root, chatSessionId: 'chat', requestKey: 'create',
    text: 'A game with confirmed UI and restart.', constraints: { orientation: 'Landscape' }, ids: ['req.loop'] })
  const planned = publishPlan(original, { protocol: V3_PROTOCOL, baseRevision: 0, requirementsRevision: original.requirements.revision, tasks: [task] })
  const store = createLocalWorkflowStore(join(root, 'host'))
  await store.commit(original.projectId, original.ownerId, 0, original, 'created'); await store.commit(original.projectId, original.ownerId, 1, planned, 'planned')
  const claimed = claim ? claimTask(planned, { taskId: 'bind', requestKey: 'execute', workerId: 'worker', sessionId: 'task-session', inputVersions: await bindInputs(planned, task) }) : planned
  if (claim) await store.commit(original.projectId, original.ownerId, 2, claimed, 'claimed')
  const set = { data: { image: { assetRef: manifest.resources[0]!.id } }, actions: { click: 'game.start' } }
  const request = await Promise.all([uiFile, ...(second ? ['content/ui/second.json'] : [])].map(async file => ({ file,
    sha256: (await readVersion(root, file)).sha256, nodes: [{ id: 'play', set }] })))
  const saveRequest = (value = request) => writeFile(join(root, mappingFile), JSON.stringify(value))
  await saveRequest()
  return { root, original, planned, store, claimed, task, request, saveRequest }
}

test('V3 binding applies existing batch core without eight documents and retains before/after source versions', async () => {
  const f = await fixture()
  try {
    const attempt = f.claimed.attempts[0]!, original = await readFile(join(f.root, uiFile), 'utf8')
    const result = await executeTaskBindings(f.claimed, attempt, f.store, new AbortController().signal)
    expect(result.binding.valid).toBe(true); expect(result.check.status).toBe('passed')
    expect(result.binding.written).toHaveLength(1)
    const ui = JSON.parse(await readFile(join(f.root, uiFile), 'utf8'))
    expect(ui.data.nodes[1].layout).toEqual(JSON.parse(original).data.nodes[1].layout)
    expect(ui.data.nodes[1].actions.click).toBe('game.start')
    expect(await versionsMatch(f.root, attempt.inputVersions)).toBe(false)
    expect(await versionsMatch(f.root, result.checkInputs)).toBe(true)
    expect(f.claimed.attempts[0]!.inputVersions).toEqual(attempt.inputVersions)
    expect(result.checkInputs.map(file => file.path)).toContain('assets/runtime/example/resource.json')
    await expect(readFile(join(f.root, 'docs/GDD.md'))).rejects.toThrow()
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test.each([true, false])('Scene binding requires the exact component identity (supplied=%s), not a UI node mapping', async supplied => {
  const f = await fixture(false, false)
  try {
    const sceneFile = 'content/scenes/level.json', scene = sceneLayoutFixture() as any
    scene.data.nodes[1].components = [{ id: 'visual', type: 'sprite-renderer', data: { size: [40, 40], color: '#123456' } }]
    await mkdir(join(f.root, 'content/scenes'), { recursive: true }); await writeFile(join(f.root, sceneFile), JSON.stringify(scene))
    const task = { ...bindingTask, inputs: [sceneFile], writablePaths: [sceneFile, mappingFile], expectedOutputs: [sceneFile, mappingFile] }
    const planned = publishPlan(f.planned, { protocol: V3_PROTOCOL, baseRevision: f.planned.planRevision, requirementsRevision: f.original.requirements.revision, tasks: [task] })
    await f.store.commit(f.original.projectId, 'alice', f.planned.version, planned, 'planned')
    const claimed = claimTask(planned, { taskId: 'bind', requestKey: 'scene', workerId: 'worker', sessionId: 'scene-task', inputVersions: await bindInputs(planned, task) })
    await f.store.commit(f.original.projectId, 'alice', planned.version, claimed, 'claimed')
    const manifest = assetManifestAuthoringExamples().canonical
    await writeFile(join(f.root, mappingFile), JSON.stringify([{ file: sceneFile, sha256: (await readVersion(f.root, sceneFile)).sha256,
      nodes: [{ id: 'board', ...(supplied ? { componentId: 'visual' } : {}), set: { assetRef: manifest.resources[0]!.id } }] }]))
    const unrelated = await readFile(join(f.root, uiFile), 'utf8')
    const result = await executeTaskBindings(claimed, claimed.attempts[0]!, f.store, new AbortController().signal)
    expect(result.binding.valid).toBe(supplied)
    const saved = JSON.parse(await readFile(join(f.root, sceneFile), 'utf8'))
    if (supplied) {
      expect(saved.data.nodes[1].components[0].assetRef).toBe(manifest.resources[0]!.id)
      expect(saved.data.nodes[1].components[0].data).toEqual(scene.data.nodes[1].components[0].data)
    } else expect(result.binding.issues.join(' ')).toContain('requires an exact componentId')
    expect(await readFile(join(f.root, uiFile), 'utf8')).toBe(unrelated)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test.each(['undeclared-target', 'stale-target-hash', 'design-edit'] as const)('V3 rejects %s before any batch write', async fault => {
  const f = await fixture(true)
  try {
    const before = await readFile(join(f.root, uiFile), 'utf8')
    if (fault === 'undeclared-target') f.request.push({ ...f.request[0]!, file: 'content/ui/unrelated.json' })
    if (fault === 'stale-target-hash') f.request[1]!.sha256 = 'a'.repeat(64)
    if (fault === 'design-edit') (f.request[1]!.nodes[0]!.set as any).style = { fontSize: 400 }
    await f.saveRequest()
    if (fault === 'undeclared-target') await expect(executeTaskBindings(f.claimed, f.claimed.attempts[0]!, f.store, new AbortController().signal)).rejects.toThrow('output/write scope')
    else {
      const result = await executeTaskBindings(f.claimed, f.claimed.attempts[0]!, f.store, new AbortController().signal)
      expect(result.binding.valid).toBe(false); expect(result.binding.written).toEqual([])
    }
    expect(await readFile(join(f.root, uiFile), 'utf8')).toBe(before)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('V3 binding rejects lost fences and resource byte drift before commit', async () => {
  const f = await fixture()
  try {
    const before = await readFile(join(f.root, uiFile), 'utf8')
    const stale: WorkflowStore = { ...f.store, async read(project, actor) { const current = (await f.store.read(project, actor))!; current.writer!.fence++; return current } }
    await expect(executeTaskBindings(f.claimed, f.claimed.attempts[0]!, stale, new AbortController().signal)).rejects.toThrow('current writer')
    let reads = 0
    const changed: WorkflowStore = { ...f.store, async read(project, actor) {
      if (++reads === 3) await writeFile(join(f.root, 'assets/runtime/example/resource.json'), '{"changed":true}')
      return f.store.read(project, actor)
    } }
    const result = await executeTaskBindings(f.claimed, f.claimed.attempts[0]!, changed, new AbortController().signal)
    expect(result.binding.valid).toBe(false); expect(result.binding.written).toEqual([])
    expect(result.binding.issues.join(' ')).toContain('resources changed')
    expect(await readFile(join(f.root, uiFile), 'utf8')).toBe(before)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('V3 interrupted binding records actual partial writes without retry or rollback', async () => {
  const f = await fixture(true), controller = new AbortController(), rename = fs.rename
  let injected: ReturnType<typeof spyOn> | undefined
  try {
    const second = await readFile(join(f.root, 'content/ui/second.json'), 'utf8')
    injected = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      await rename(from, to)
      if (to === join(f.root, uiFile)) controller.abort()
    })
    const result = await executeTaskBindings(f.claimed, f.claimed.attempts[0]!, f.store, controller.signal)
    expect(result.binding.valid).toBe(false)
    expect(result.binding.written.map(file => file.file)).toEqual([uiFile])
    expect(result.binding.pending).toEqual(['content/ui/second.json'])
    expect(await readFile(join(f.root, 'content/ui/second.json'), 'utf8')).toBe(second)
    expect(JSON.parse(await readFile(join(f.root, uiFile), 'utf8')).data.nodes[1].actions.click).toBe('game.start')
  } finally { injected?.mockRestore(); await rm(f.root, { recursive: true, force: true }) }
})

test('native mapping completion -> host binding -> current checks -> dependent consumer, no extra native turn or duplicate execution', async () => {
  const f = await fixture(false, false), cleanups: Array<() => Promise<void>> = []
  let submits = 0, nativeStopped = false
  const sessions = new BeeGameSessionManager({ async start(start) { return { stop() { nativeStopped = true }, async submit(turn) {
    submits++; nativeStopped = false
    if (submits === 1) {
      expect(turn.prompt).toContain('Batch binding entry')
      expect(turn.prompt).toContain(f.request[0]!.sha256)
      await f.saveRequest()
    } else {
      expect(JSON.parse(await readFile(join(start.cwd, uiFile), 'utf8')).data.nodes[1].actions.click).toBe('game.start')
      await writeFile(join(start.cwd, 'consumer.json'), '{}')
    }
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Mapping saved.', usage: { input_tokens: 10, output_tokens: 5 } })
  } } } }, join(f.root, 'host-native'), async () => ({}), {}, true)
  const executor = createV3Executor({ store: f.store, sessions })
  cleanups.push(() => executor.dispose(), () => sessions.dispose())
  try {
    const store = f.store
    const nextPlan = publishPlan(f.planned, { protocol: V3_PROTOCOL, baseRevision: f.planned.planRevision, requirementsRevision: f.original.requirements.revision,
      tasks: [f.task, { id: 'consumer', kind: 'game.develop', goal: 'Consume the bound UI', dependsOn: ['bind'], requirementIds: ['req.loop'],
        inputs: ['output:bind/'+uiFile], writablePaths: ['consumer.json'], expectedOutputs: ['consumer.json'], checks: ['artifact-json'] }] })
    const runner = executor
    await store.commit(f.original.projectId, 'alice', f.planned.version, nextPlan, 'planned')
    let renameCalls = 0
    const rename = fs.rename
    const injected = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === join(f.root, uiFile)) { expect(nativeStopped).toBe(true); renameCalls++ }
      await rename(from, to)
    })
    try {
      await runner.start(nextPlan, 'bind', 'execute-bind', {})
      const wait = async (): Promise<Run> => {
        for (let n = 0; n < 250; n++) { const current = (await store.read(f.original.projectId, 'alice'))!; if (!current.writer) return current; await Bun.sleep(5) }
        throw Error('Binding execution did not settle')
      }
      const bound = await wait()
      expect({ status: bound.tasks.bind!.status, error: bound.attempts[0]!.error, issues: bound.attempts[0]!.binding?.issues }).toMatchObject({ status: 'succeeded' })
      expect(bound.attempts[0]!.binding?.valid).toBe(true)
      expect(bound.attempts[0]!.inputVersions.find(file => file.path === uiFile)?.sha256).toBe(digest(JSON.stringify(uiLayoutFixture())))
      expect(bound.attempts[0]!.outputs?.find(file => file.path === uiFile)?.sha256).toBe((await readVersion(f.root, uiFile)).sha256)
      await runner.start(bound, 'bind', 'execute-bind', {})
      expect(submits).toBe(1); expect(renameCalls).toBe(1)
      await runner.start(bound, 'consumer', 'execute-consumer', {})
      const consumed = await wait(); expect(consumed.tasks.consumer!.status).toBe('succeeded')
      expect(submits).toBe(2); expect(consumed.deliveryEligible).toBe(false)
    } finally { injected.mockRestore() }
  } finally { for (const cleanup of cleanups.reverse()) await cleanup(); await rm(f.root, { recursive: true, force: true }) }
})
