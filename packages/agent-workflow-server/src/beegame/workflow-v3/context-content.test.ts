import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRun, publishPlan, claimTask, finishTask, V3_PROTOCOL, type TaskSpec } from './state'
import { taskContext, sourceIndex, skillEvidence, skillUseCheck } from './context'
import { runChecks, versionsMatch } from './checks'
import { uiLayoutFixture, sceneLayoutFixture } from '../fixtures/layout-fixture'
import { auditAssetContract } from '../asset-contract-audit'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from '../asset-contracts'

const task: TaskSpec = { id: 'ui', kind: 'game.develop', goal: 'Deliver the confirmed UI', dependsOn: [], requirementIds: ['req.loop'], inputs: [],
  writablePaths: ['content/**'], expectedOutputs: ['content/ui/menu.json'], checks: ['content-structure', 'content-layout', 'content-resources'] }

test('task context is local, pointers are derived and native successful loads are required when requested', () => {
  const original = createRun({ projectId: 'fixture', ownerId: 'owner', workspacePath: '/tmp/fixture', chatSessionId: 'chat', requestKey: 'create',
    text: 'UNIQUE_ORIGINAL_REQUEST', constraints: {}, ids: ['req.loop'] })
  const planned = publishPlan(original, { protocol: V3_PROTOCOL, baseRevision: 0, requirementsRevision: original.requirements.revision,
    tasks: [{ ...task, skills: ['bgs-builtins:game-ui-ux-designer'] }, { ...task, id: 'audio', goal: 'UNRELATED_AUDIO_GOAL', expectedOutputs: ['content/audio.json'] }] })
  const claimed = claimTask(planned, { taskId: 'ui', requestKey: 'start', workerId: 'worker', sessionId: 'native-task', inputVersions: [] })
  const attempt = claimed.attempts[0]!, text = taskContext(claimed, attempt)
  expect(text.match(/UNIQUE_ORIGINAL_REQUEST/g)).toHaveLength(1)
  expect(text).not.toContain('UNRELATED_AUDIO_GOAL')
  expect(text).not.toContain('authorDocument'); expect(text).not.toContain('production')
  expect(sourceIndex(claimed, 'ui')).toHaveLength(1)
  const started = { id: 1, type: 'tool.started', payload: { toolName: 'Skill', toolUseID: 'skill-1', parentToolUseID: 'child', input: { skill: 'bgs-builtins:game-ui-ux-designer' } } }
  const failed = skillEvidence([started, { id: 2, type: 'tool.failed', payload: { toolUseID: 'skill-1' } }])
  expect(failed[0]?.status).toBe('failed')
  expect(skillUseCheck(attempt, claimed.tasks.ui!.spec.skills!, failed).status).toBe('unverified')
  const loaded = skillEvidence([started, { id: 3, type: 'tool.completed', payload: { toolUseID: 'skill-1' } }])
  expect(loaded[0]).toMatchObject({ status: 'loaded', parentToolUseID: 'child', eventId: 3 })
  expect(skillUseCheck(attempt, claimed.tasks.ui!.spec.skills!, loaded).status).toBe('passed')
  const checks = task.checks.map(id => ({ id, version: 'fixture', status: 'passed' as const, inputs: [], observation: 'fixture', createdAt: 'fixture' }))
  expect(finishTask(claimed, attempt.attemptId, attempt.fence, { checks, skillUses: loaded }, true).tasks.ui?.status).toBe('blocked')
})

test('scoped content checks need no eight documents, catch overflow, distinguish unbound drafts and preserve unrelated files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-layout-'))
  try {
    await mkdir(join(root, 'content/ui'), { recursive: true })
    const save = async (ui: unknown) => writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    await save(uiLayoutFixture())
    await writeFile(join(root, 'content/ui/unrelated.json'), 'not a document')
    const checked = await runChecks(root, task, [], undefined, { orientation: 'Landscape' })
    expect(checked.checks.map(check => check.status)).toEqual(['passed', 'passed', 'unverified'])
    expect(checked.checks[1]!.coverage?.files).toEqual(['content/ui/menu.json'])
    expect(checked.checks[1]!.inputs.some(file => file.path.includes('unrelated'))).toBe(false)
    await save(uiLayoutFixture(2000))
    expect((await runChecks(root, task, [])).checks[1]!.status).toBe('failed')
    await save(uiLayoutFixture())
    expect((await runChecks(root, task, [], undefined, { orientation: 'Portrait' })).checks[1]!.observation).toContain('orientation differs')
    const wrong = uiLayoutFixture() as any; wrong.data.nodes[1].parentId = 'missing'
    await save(wrong)
    expect((await runChecks(root, task, [])).checks[0]!.status).toBe('failed')
    expect(auditAssetContract(root, []).valid).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('actual linked Scene and underlay versions invalidate results; missing links never receive PASS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-layout-link-'))
  try {
    await mkdir(join(root, 'content/ui'), { recursive: true }); await mkdir(join(root, 'content/scenes'), { recursive: true })
    const ui = uiLayoutFixture() as any
    ui.data.nodes.push({ id: 'game-view', parentId: 'root', role: 'container', layout: { size: [300, 200] } })
    ui.data.nodes[0].data.layoutCamera = { nodeId: 'game-view', path: 'content/scenes/level.json' }
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    const missing = await runChecks(root, { ...task, checks: ['content-layout'] }, [])
    expect(missing.checks[0]!.status).toBe('unverified')
    await writeFile(join(root, 'content/scenes/level.json'), JSON.stringify(sceneLayoutFixture()))
    const checked = await runChecks(root, { ...task, checks: ['content-layout'] }, [])
    expect(checked.checks[0]!.status).toBe('passed')
    expect(checked.checks[0]!.inputs.map(file => file.path)).toContain('content/scenes/level.json')
    await writeFile(join(root, 'content/scenes/level.json'), JSON.stringify({ ...sceneLayoutFixture(), id: 'changed' }))
    expect(await versionsMatch(root, checked.checks[0]!.inputs)).toBe(false)
    ui.data.nodes[0].data.layoutUnderlay = { path: 'content/ui/below.json', clearance: 'allow-cover' }
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    expect((await runChecks(root, { ...task, checks: ['content-layout'] }, [])).checks[0]!.status).toBe('unverified')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('resource checks bind actual manifest modules and members, reject stale resources and do not require unrelated assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-resource-check-'))
  try {
    await mkdir(join(root, 'content/ui'), { recursive: true }); await mkdir(join(root, 'assets/runtime/example'), { recursive: true })
    const manifest = assetManifestAuthoringExamples().canonical
    // A different required resource is not delivered by this local task.
    manifest.requirements.push({ ...structuredClone(manifest.requirements[0]!), id: 'req-unrelated' })
    await writeBeeGameAssetManifest(root, manifest)
    await writeFile(join(root, 'assets/runtime/example/resource.json'), '{}')
    const ui = uiLayoutFixture() as any
    ui.assetRefs = [manifest.resources[0]!.id]
    ui.data.nodes[1].data = { image: { assetRef: manifest.resources[0]!.id } }
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    const scoped = { ...task, checks: ['content-resources'] as const }
    const checked = await runChecks(root, { ...scoped, checks: [...scoped.checks] }, [])
    expect(checked.checks[0]!.status).toBe('passed')
    expect(checked.checks[0]!.inputs.map(file => file.path)).toContain('assets/runtime/example/resource.json')
    expect(checked.checks[0]!.inputs.some(file => file.path.startsWith('assets/manifest/'))).toBe(true)
    expect(auditAssetContract(root).valid).toBe(false)
    await writeFile(join(root, 'assets/runtime/example/resource.json'), 'broken json')
    expect(await versionsMatch(root, checked.checks[0]!.inputs)).toBe(false)
    expect((await runChecks(root, { ...task, checks: ['content-resources'] }, [])).checks[0]!.status).toBe('failed')
    await rm(join(root, 'assets/runtime/example/resource.json'))
    expect((await runChecks(root, { ...task, checks: ['content-resources'] }, [])).checks[0]!.status).toBe('unverified')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('host build creates and checks actual first-build artifacts; zero exit without artifacts is not PASS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-build-artifact-'))
  try {
    await writeFile(join(root, 'build.mjs'), 'await Bun.write("built.json", "{}");')
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'bun build.mjs' } }))
    const buildTask: TaskSpec = { ...task, writablePaths: ['built.json'], expectedOutputs: ['built.json'], checks: ['artifact-json', 'build'] }
    const checked = await runChecks(root, buildTask, [])
    expect(checked.checks.map(check => [check.id, check.status])).toEqual([['build', 'passed'], ['artifact-json', 'passed']])
    expect(checked.outputs[0]?.path).toBe('built.json')
    await rm(join(root, 'built.json')); await writeFile(join(root, 'build.mjs'), 'console.log("no artifact");')
    expect((await runChecks(root, buildTask, [])).checks[0]?.status).toBe('unverified')
  } finally { await rm(root, { recursive: true, force: true }) }
})
