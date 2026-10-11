import { WritingWorkflowRuntime } from './writing-workflow-runtime'
import { sanitizePath } from '../../../../src/utils/sessionStoragePortable'
import type { BeeGameSessionSubmitInput } from './session-manager'
import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeDesignDocumentsFixture, designBaselineFixture } from './fixtures/layout-fixture'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { materializeBalanceCalculator } from './balance-calculation'
import { beginProjectDelivery, projectDeliveryStatePath, projectContentAuthority, readProjectDelivery, requestProjectDesignResolution } from './project-delivery'
import { BeeGameSessionManager, type BeeGameSessionRunner } from './session-manager'
import { sendProjectConversation } from './project-conversation'
import { inspectContentBindings, bindContent } from './content-binding'
import { checkContentHandoff } from './delivery/stages/content'
import { checkSavedMilestoneResult } from './milestone-handoff-check'

test.each(['unchanged', 'scene-drift', 'stale-calculation'] as const)(
  'Content preparation, primary CLI interruption and restart preserve binding and design authority: %s', async mode => {
  const root = await mkdtemp('/private/tmp/bgs-content-recovery-'), workspace = join(root, 'game')
  let manager: BeeGameSessionManager | undefined
  try {
    await mkdir(workspace)
    const objective = JSON.stringify({ settings: { orientation: 'Landscape', dimension: '2D' } })
    const initial = await beginProjectDelivery(workspace, root, objective)
    await writeDesignDocumentsFixture(workspace)
    await writeBeeGameAssetManifest(workspace, { ...assetManifestAuthoringExamples().canonical, resources: [], requirements: [] })
    await mkdir(join(workspace, 'docs/calc'), { recursive: true })
    const modelPath = join(workspace, 'docs/calc/count.mjs')
    const model = "export async function calculate({readJson}) { const scene = await readJson('content/scenes/level.json'); return {tables:[{title:'Fixture nodes',columns:['count'],rows:[[scene.data.nodes.length]]}],checks:[{name:'Fixture camera',passed:scene.data.nodes.some(n=>n.id===scene.data.cameraNodeId),details:'Saved camera resolves'}],limitations:['Synthetic dependency check, not game feasibility']}; }"
    await writeFile(modelPath, model)
    const balancePath = join(workspace, 'docs/BALANCE_DESIGN.md')
    await writeFile(balancePath, (await readFile(balancePath, 'utf8')) + '\n[Calculation](calc/count.md)\n')
    await materializeBalanceCalculator(workspace)
    const calculation = Bun.spawn([process.execPath, '.beegame/delivery/calculate-balance.mjs',
      'docs/calc/count.mjs', 'docs/calc/count.md', '--scenes'], { cwd: workspace, stdout: 'pipe', stderr: 'pipe' })
    const [code, output, error] = await Promise.all([calculation.exited, new Response(calculation.stdout).text(), new Response(calculation.stderr).text()])
    expect({ code, error }).toEqual({ code: 0, error: '' }); expect(JSON.parse(output).output).toBe('docs/calc/count.md')
    const baseline = designBaselineFixture(workspace), authority = projectContentAuthority(workspace)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...initial, phase: 'content', designBaseline: baseline }))
    await writeFile(join(workspace, 'content/index.json'), JSON.stringify({ schema: 'beegame-content-package.v2',
      id: 'game', dimension: '2d', documentRevision: authority.documentRevision, assetManifestRevision: authority.assetManifestRevision,
      entryScene: 'level', sceneModel: 'game-object-v2', files: ['scenes/level.json', 'ui/menu.json'] }))
    const scenePath = join(workspace, 'content/scenes/level.json'), scene = await readFile(scenePath, 'utf8')
    const uiPath = join(workspace, 'content/ui/menu.json')
    const appendix = await readFile(join(workspace, 'docs/calc/count.md'), 'utf8')
    let savedUi = '', inputRevision = '', submissions = 0, bindings = 0
    const calls: string[] = []
    const runner: BeeGameSessionRunner = { async start(start) {
      let business: BeeGameSessionSubmitInput['projectTurn']
      const config = join(root, 'config')
      const workflow = new WritingWorkflowRuntime({ ...start, deliveryEvidenceDataRoot: root,
        env: { ...start.env, BEEGAME_CONFIG_DIR: config } }, async child => {
        const nativeSession = child.nativeSessionId ?? child.resumeSessionId!
        const transcript = join(config, 'projects', sanitizePath(workspace), nativeSession + '.jsonl')
        await mkdir(join(config, 'projects', sanitizePath(workspace)), { recursive: true })
        await writeFile(transcript, 'Synthetic native transcript')
        return { stop() {}, async dispose() {}, async submit(turn) {
          submissions++
          expect(turn.projectTurn).toBeUndefined()
          const input = business!
          expect(input.production?.phase).toBe('content')
          if (!inputRevision) inputRevision = input.production!.inputRevision
          else expect(input.production!.inputRevision).toBe(inputRevision)
          calls.push(child.resumeSessionId ? 'resume' : 'new')
          if (!child.resumeSessionId) {
            const inspected = await inspectContentBindings(workspace, ['content/ui/menu.json'])
            expect((await bindContent(workspace, [{ file: 'content/ui/menu.json', sha256: inspected.files[0]!.sha256,
              nodes: [{ id: 'play', set: { actions: { click: 'game.start' } } }] }])).issues).toEqual([])
            savedUi = await readFile(uiPath, 'utf8'); bindings++
            throw Error('Synthetic transport interruption after binding')
          }
          expect(await readFile(uiPath, 'utf8')).toBe(savedUi)
          expect(await readFile(scenePath, 'utf8')).toBe(scene)
          expect(await readFile(join(workspace, 'docs/calc/count.md'), 'utf8')).toBe(appendix)
          await writeFile(input.milestoneResult!.path, 'complete\nSynthetic saved binding resumed without regeneration\n')
          expect(await checkSavedMilestoneResult(workspace, input.milestoneResult)).toMatchObject({ status: 'complete', issues: [] })
          await turn.onMessage({ type: 'result', subtype: 'success', result: 'Saved binding reused and checked' })
        } }
      })
      return { stop: () => workflow.stop(), dispose: () => workflow.dispose(),
        async submit(turn) { business = turn.projectTurn; await workflow.submit(turn) } }
    } }
    manager = new BeeGameSessionManager(runner, root)
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'fixture' })
    const dispatch = () => sendProjectConversation({ sessions: manager!, deliveryDataRoot: root,
      sessionId: session.id, ownerId: 'owner', message: 'Continue authorized Content', autoContinuation: true })
    await dispatch(); await manager.waitForSessionIdle(session.id)
    expect(manager.transcript(session.id).some(e => e.type === 'turn.failed')).toBe(true)
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('content')
    expect(checkContentHandoff(workspace, { objective, baseline }).issues).toEqual([])
    await manager.dispose()
    manager = new BeeGameSessionManager(runner, root)
    manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'fixture', transcriptSessionId: session.id })
    if (mode === 'scene-drift') {
      const changed = JSON.parse(scene); changed.data.nodes[1].transform.position[0] = 20
      await writeFile(scenePath, JSON.stringify(changed))
    } else if (mode === 'stale-calculation') await writeFile(modelPath, model + '\n// model changed without recomputing evidence')
    if (mode === 'unchanged') {
      await dispatch(); await manager.waitForSessionIdle(session.id)
      expect((await readProjectDelivery(workspace, root))?.phase).toBe('implementation')
      expect(calls).toEqual(['new', 'resume'])
      expect(submissions).toBe(2)
    } else {
      await expect(dispatch()).rejects.toThrow('design-resolution')
      expect(submissions).toBe(1)
      expect((await readProjectDelivery(workspace, root))?.designBaseline).toEqual(baseline)
      const prepared = await requestProjectDesignResolution(workspace, root, {
        mode: 'inspect', findings: [], instruction: 'Inspect the affected sources and evidence; do not approve accidental changes or regenerate unrelated content.',
      })
      expect(prepared.phase).toBe('review')
      expect(prepared.designReview?.returnPhase).toBe('content')
      expect(prepared.designBaseline).toEqual(baseline)
      expect(prepared.designReview?.writableDocuments).not.toContain('AUDIO_DESIGN.md')
    }
    expect(bindings).toBe(1)
    expect(await readFile(uiPath, 'utf8')).toBe(savedUi)
    expect(await readFile(join(workspace, 'docs/calc/count.md'), 'utf8')).toBe(appendix)
    expect(await readdir(join(root, 'production-cli-sessions'))).toHaveLength(1)
  } finally { await manager?.dispose(); await rm(root, { recursive: true, force: true }) }
})

