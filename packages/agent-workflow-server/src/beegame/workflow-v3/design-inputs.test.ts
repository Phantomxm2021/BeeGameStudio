import { test, expect } from 'bun:test'
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeDesignDocumentsFixture, uiLayoutFixture } from '../fixtures/layout-fixture'
import { createRun, type AgentTurn } from './state'
import { createLocalWorkflowStore, assertCommit } from './store'
import { createAgentMeasurement } from './agent-measurement'
import { openDesignActions } from './agent-tools'
import { designInputRevision, designHandoffPath } from '../design-handoff'

test.each([false, true])('implementation reads current inputs and allows continued refinement; indexed=%s', async indexed => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-design-inputs-')))
  try {
    await writeDesignDocumentsFixture(root)
    if (!indexed) await rm(join(root, '.beegame/design-handoffs'), { recursive: true })
    const action = openDesignActions(root), before = designInputRevision(root)
    expect(await action('implementation')).toMatchObject({ valid: true })
    expect(designInputRevision(root)).toBe(before)
    const path = join(root, 'docs/TECHNICAL_DESIGN.md')
    await writeFile(path, (await readFile(path, 'utf8')) + '\nImplementation detail refined within the current assignment.\n')
    expect(designInputRevision(root)).not.toBe(before)
    expect(await action('finalize', ['TECHNICAL_DESIGN.md'])).toMatchObject({ valid: true })
    expect(await action('implementation')).toMatchObject({ valid: true })
    const ready = designInputRevision(root)
    await action('implementation')
    expect(designInputRevision(root)).toBe(ready)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('historical design snapshots remain immutable data without controlling writes or requirements', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-legacy-design-'))), workspace = join(root, 'project')
  await mkdir(workspace); await writeDesignDocumentsFixture(workspace)
  const store = createLocalWorkflowStore(join(root, 'store'))
  const run = createRun({ projectId: 'project', ownerId: 'owner', workspacePath: workspace, chatSessionId: 'chat', requestKey: 'goal', text: 'Fixture', constraints: {}, ids: ['goal'] })
  const turn: AgentTurn = { attemptId: 'attempt', requestKey: 'goal', sessionId: 'chat', workerId: 'worker', fence: 1, status: 'running', startedAt: new Date().toISOString() }
  run.agentTurns = [turn]; run.writer = { attemptId: turn.attemptId, workerId: turn.workerId, fence: 1 }; run.fence = 1
  run.designBaseline = { revision: '0'.repeat(64), digestVersion: 2, capturedAt: turn.startedAt, attemptId: turn.attemptId,
    requirementsRevision: run.requirements.revision, protectedFiles: [], supportingFiles: {} }
  await store.commit(run.projectId, run.ownerId, 0, run, 'fixture')
  const measurement = createAgentMeasurement({ run, turn, store })
  try {
    const before = (await store.read('project', 'owner'))!
    await writeFile(join(workspace, 'docs/GDD.md'), (await readFile(join(workspace, 'docs/GDD.md'), 'utf8')) + '\nRefined detail.\n')
    await measurement.assertActive(true)
    expect(await openDesignActions(workspace)('implementation')).toMatchObject({ valid: true })
    expect(await store.read('project', 'owner')).toEqual(before)
    for (const remove of [false, true]) {
      const forged = structuredClone(before); forged.version++
      if (remove) delete forged.designBaseline
      else forged.designBaseline!.revision = '1'.repeat(64)
      expect(() => assertCommit('project', 'owner', before.version, forged, before)).toThrow('Historical design snapshots')
    }
    const paused = structuredClone(before); paused.version++; paused.paused = { at: turn.startedAt }
    await store.commit('project', 'owner', before.version, paused, 'fixture.pause')
    await expect(measurement.assertActive(true)).rejects.toThrow('paused')
    expect((await store.read('project', 'owner'))?.requirements).toEqual(before.requirements)
  } finally { await measurement.close(); await rm(root, { recursive: true, force: true }) }
})

test('design identity covers optional index lifecycle and unregistered saved content drafts', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-design-identity-')))
  try {
    await writeDesignDocumentsFixture(root)
    const path = join(root, designHandoffPath('GDD.md')), content = await readFile(path, 'utf8')
    const original = designInputRevision(root)
    await rm(path)
    const absent = designInputRevision(root)
    expect(absent).not.toBe(original)
    await writeFile(path, content)
    expect(designInputRevision(root)).toBe(original)
    await writeFile(path, content + '\n ')
    expect(designInputRevision(root)).not.toBe(original)
    const indexed = designInputRevision(root), ui = uiLayoutFixture(); ui.id = 'settings'
    await writeFile(join(root, 'content/ui/settings.json'), JSON.stringify(ui))
    const added = designInputRevision(root)
    expect(added).not.toBe(indexed)
    ui.data.nodes[1]!.layout!.size![0] += 10
    await writeFile(join(root, 'content/ui/settings.json'), JSON.stringify(ui))
    expect(designInputRevision(root)).not.toBe(added)
    await rm(join(root, 'content/ui/settings.json'))
    expect(designInputRevision(root)).toBe(indexed)
  } finally { await rm(root, { recursive: true, force: true }) }
})
