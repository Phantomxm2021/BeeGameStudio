import { WritingWorkflowRuntime } from './writing-workflow-runtime'
import { sanitizePath } from '../../../../src/utils/sessionStoragePortable'
import type { BeeGameSessionSubmitInput } from './session-manager'
import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeDesignDocumentsFixture, designBaselineFixture } from './fixtures/layout-fixture'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { beginProjectDelivery, projectDeliveryStatePath, readProjectDelivery } from './project-delivery'
import { BeeGameSessionManager, type BeeGameSessionRunner } from './session-manager'
import { sendProjectConversation } from './project-conversation'
import { checkSavedMilestoneResult } from './milestone-handoff-check'

test.each([false, true])('resource preparation/restart keeps completed files and checks saved registration; changed design=%s', async changed => {
  const root = await mkdtemp('/private/tmp/bgs-resource-recovery-'), workspace = join(root, 'game')
  let manager: BeeGameSessionManager | undefined
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, '{"resource_library_usage":"optional"}')
    await writeDesignDocumentsFixture(workspace)
    const baseline = designBaselineFixture(workspace)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase: 'resources', designBaseline: baseline }))
    const asset = join(workspace, 'assets/runtime/example/resource.json')
    const scene = await readFile(join(workspace, 'content/scenes/level.json'), 'utf8')
    let attempts = 0, identity = ''
    const calls: string[] = []
    let generations = 0
    const runner: BeeGameSessionRunner = { async start(start) {
      let business: BeeGameSessionSubmitInput['projectTurn']
      const config = join(root, 'config')
      const workflow = new WritingWorkflowRuntime({ ...start, deliveryEvidenceDataRoot: root,
        env: { ...start.env, BEEGAME_CONFIG_DIR: config } }, async child => {
        const nativeSession = child.nativeSessionId ?? child.resumeSessionId!
        await mkdir(join(config, 'projects', sanitizePath(workspace)), { recursive: true })
        await writeFile(join(config, 'projects', sanitizePath(workspace), nativeSession + '.jsonl'), 'Synthetic native transcript')
        return { stop() {}, async dispose() {}, async submit(turn) {
          attempts++
          expect(turn.projectTurn).toBeUndefined()
          const input = business!, production = input.production!
          expect(production.phase).toBe('resources')
          if (!identity) identity = production.inputRevision
          expect(production.inputRevision).toBe(identity)
          const task = await readFile(production.contextPath, 'utf8')
          expect(task).toContain('--resources-handoff')
          const preflight = task.match(/--resources-handoff (\S+\.json)/)![1]!
          expect(JSON.parse(await readFile(join(workspace, preflight), 'utf8')).baseline.snapshots).toEqual(baseline.snapshots)
          calls.push(child.resumeSessionId ? 'resume' : 'new')
          if (!child.resumeSessionId) {
            generations++
            await mkdir(join(workspace, 'assets/runtime/example'), { recursive: true })
            await writeFile(asset, '{"saved":"visual group fixture"}')
            throw Error('Synthetic audio interruption')
          }
          expect(await readFile(asset, 'utf8')).toBe('{"saved":"visual group fixture"}')
          await writeBeeGameAssetManifest(workspace, assetManifestAuthoringExamples().canonical)
          await writeFile(input.milestoneResult!.path, 'complete\nSynthetic saved resource registration\n')
          expect(await checkSavedMilestoneResult(workspace, input.milestoneResult)).toMatchObject({ status: 'complete', issues: [] })
          await turn.onMessage({ type: 'result', subtype: 'success', result: 'Saved resources' })
        } }
      })
      return { stop: () => workflow.stop(), dispose: () => workflow.dispose(),
        async submit(turn) { business = turn.projectTurn; await workflow.submit(turn) } }
    } }
    manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'fixture' })
    const dispatch = () => sendProjectConversation({ sessions: manager!, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'Continue authorized resources', autoContinuation: true })
    await dispatch(); await manager.waitForSessionIdle(session.id)
    expect(manager.transcript(session.id).some(event => event.type === 'turn.failed')).toBe(true)
    expect(JSON.stringify(manager.transcript(session.id))).toContain('Synthetic audio interruption')
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('resources')
    await manager.dispose()
    manager = new BeeGameSessionManager(runner, root)
    manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'fixture', transcriptSessionId: session.id })
    if (changed) {
      const path = join(workspace, 'docs/ART_DIRECTION.md')
      await writeFile(path, (await readFile(path, 'utf8')) + '\nNew unreviewed palette.\n')
      await expect(dispatch()).rejects.toThrow('design-resolution')
      expect(attempts).toBe(1)
      expect((await readProjectDelivery(workspace, root))?.designBaseline).toEqual(baseline)
    } else {
      await dispatch(); await manager.waitForSessionIdle(session.id)
      expect(calls).toEqual(['new', 'resume'])
      expect((await readProjectDelivery(workspace, root))?.phase).toBe('content')
      expect(attempts).toBe(2)
    }
    expect(generations).toBe(1)
    expect(await readFile(asset, 'utf8')).toBe('{"saved":"visual group fixture"}')
    expect(await readFile(join(workspace, 'content/scenes/level.json'), 'utf8')).toBe(scene)
  } finally { await manager?.dispose(); await rm(root, { recursive: true, force: true }) }
})

