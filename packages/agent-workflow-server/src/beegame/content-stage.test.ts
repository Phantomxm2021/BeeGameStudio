import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { writeDesignDocumentsFixture, designBaselineFixture } from './fixtures/layout-fixture'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { beginProjectDelivery, projectDeliveryStatePath, advanceProjectDeliveryAfterTurn, projectContentAuthority } from './project-delivery'
import { checkContentHandoff, checkContentResult } from './delivery/stages/content'
import type { DesignFinding } from '@bee-game-studio/agent-workflow/design-review-result'
import { runGameContentCommand } from './game-content-validation-cli'
import { inspectContentBindings, bindContent } from './content-binding'
import { sharedContentChecker } from './content-checker-runtime'
import { checkSavedMilestoneResult } from './milestone-handoff-check'

test('Content source verdict is shared across preflight, BGS handoff and advancement; binding survives correction', async () => {
  const root = await mkdtemp('/private/tmp/bgs-content-module-'), workspace = join(root, 'game')
  try {
    await mkdir(workspace)
    const objective = JSON.stringify({ settings: { orientation: 'Landscape', dimension: '2D' } })
    const state = await beginProjectDelivery(workspace, root, objective)
    await writeDesignDocumentsFixture(workspace)
    await writeBeeGameAssetManifest(workspace, { ...assetManifestAuthoringExamples().canonical, resources: [], requirements: [] })
    const baseline = designBaselineFixture(workspace), authority = projectContentAuthority(workspace)
    const input = { objective, baseline: { ...baseline, digestVersion: baseline.digestVersion! } }
    const statePath = projectDeliveryStatePath(workspace, root)
    const resetPhase = () => writeFile(statePath, JSON.stringify({ ...state, phase: 'content', designBaseline: baseline }))
    const indexPath = join(workspace, 'content/index.json')
    const index = JSON.stringify({ schema: 'beegame-content-package.v2', id: 'game', dimension: '2d',
      documentRevision: authority.documentRevision, assetManifestRevision: authority.assetManifestRevision,
      entryScene: 'level', sceneModel: 'game-object-v2', files: ['scenes/level.json', 'ui/menu.json'] })
    await writeFile(indexPath, index)
    const directory = join(workspace, '.beegame/tmp/current')
    await mkdir(directory, { recursive: true })
    const receipt = join(directory, 'milestone-test.txt'), preflight = join(directory, 'check-input.json')
    await writeFile(receipt, 'complete\nSaved synthetic binding.\n')
    await writeFile(preflight, JSON.stringify(input))
    const assignment = { phase: 'content' as const, path: receipt, objective, designBaseline: input.baseline }
    const uiPath = join(workspace, 'content/ui/menu.json'), scenePath = join(workspace, 'content/scenes/level.json')
    const scene = await readFile(scenePath, 'utf8')
    const beforeBinding = checkContentHandoff(workspace, input).sourceRevision
    const inspected = await inspectContentBindings(workspace, ['content/ui/menu.json'])
    expect((await bindContent(workspace, [{ file: 'content/ui/menu.json', sha256: inspected.files[0]!.sha256,
      nodes: [{ id: 'play', set: { actions: { click: 'game.start' } } }] }])).issues).toEqual([])
    const boundUi = await readFile(uiPath, 'utf8')
    expect(checkContentHandoff(workspace, input).issues).toEqual([])
    expect(checkContentHandoff(workspace, input).sourceRevision).not.toBe(beforeBinding)
    for (const defect of ['missing-index', 'protected-layout', 'unknown-resource', 'none'] as const) {
      await resetPhase(); await writeFile(indexPath, index); await writeFile(uiPath, boundUi)
      if (defect === 'missing-index') await unlink(indexPath)
      if (defect === 'protected-layout') {
        const ui = JSON.parse(boundUi); ui.data.nodes[1].layout.size = [200, 20]
        await writeFile(uiPath, JSON.stringify(ui))
      }
      if (defect === 'unknown-resource') {
        const ui = JSON.parse(boundUi); ui.assetRefs = ['does-not-exist']
        await writeFile(uiPath, JSON.stringify(ui))
      }
      const direct = checkContentHandoff(workspace, input)
      await writeFile(join(workspace, 'unrelated-notes.txt'), 'This is not Content progress: ' + defect)
      expect(checkContentHandoff(workspace, input).sourceRevision).toBe(direct.sourceRevision)
      expect(runGameContentCommand(workspace, ['--content-handoff', '.beegame/tmp/current/check-input.json'])).toEqual(direct)
      expect((await checkSavedMilestoneResult(workspace, assignment))?.issues).toEqual(direct.issues)
      const host = await advanceProjectDeliveryAfterTurn(workspace, root, { phase: 'content', status: 'complete', summary: 'Synthetic' })
      if (defect === 'none') {
        expect(host).toMatchObject({ phase: 'implementation', shouldContinue: true, issues: [] })
        expect(await readFile(uiPath, 'utf8')).toBe(boundUi)
      } else {
        expect(direct.valid).toBe(false)
        expect(host?.phase).toBe('content')
        for (const issue of direct.protectionIssues.length ? direct.protectionIssues : direct.issues)
          expect(host?.issues.join(' ')).toContain(issue)
      }
      expect(await readFile(scenePath, 'utf8')).toBe(scene)
    }
    const checker = await sharedContentChecker()
    const child = Bun.spawn([process.execPath, '.beegame/delivery/check-content.mjs',
      '--content-handoff', '.beegame/tmp/current/check-input.json'], { cwd: workspace,
      env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: checker.moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' })
    expect(JSON.parse(stdout)).toEqual(checkContentHandoff(workspace, input))
    const recorded: DesignFinding = { id: 'later', owner: 'UI_UX_SPEC.md', documents: ['UI_UX_SPEC.md'],
      sources: [{ document: 'UI_UX_SPEC.md', section: 'Design' }], severity: 'follow-up', action: 'correct',
      impact: 'Synthetic later runtime wiring', closeWhen: 'Verify runtime wiring', neededBefore: 'implementation' }
    for (const variant of ['invalid-source', 'changed-deadline', 'due', 'future'] as const) {
      const boundBaseline = { ...input.baseline, followUps: [recorded] }
      const finding: DesignFinding = variant === 'invalid-source'
        ? { ...recorded, id: 'unknown', sources: [{ document: 'UI_UX_SPEC.md', section: 'Not a saved section' }] }
        : variant === 'changed-deadline' ? { ...recorded, neededBefore: null }
        : variant === 'due' ? { ...recorded, id: 'required-now', neededBefore: 'content' }
        : { ...recorded, id: 'future-task' }
      const result = { phase: 'content' as const, status: 'complete' as const, summary: 'Synthetic report', designIssues: [finding] }
      await writeFile(statePath, JSON.stringify({ ...state, phase: 'content', designBaseline: boundBaseline }))
      const variantReceipt = join(directory, 'milestone-' + variant + '.txt')
      await writeFile(variantReceipt, 'complete\n' + JSON.stringify({ summary: result.summary, designIssues: result.designIssues }))
      const checked = checkContentResult(workspace, { objective, baseline: boundBaseline }, result)
      const native = await checkSavedMilestoneResult(workspace, { ...assignment, path: variantReceipt, designBaseline: boundBaseline })
      expect(native?.issues).toEqual(checked.issues)
      const host = await advanceProjectDeliveryAfterTurn(workspace, root, result)
      if (variant === 'future') expect(host).toMatchObject({ phase: 'implementation', issues: [] })
      else {
        expect(checked.valid).toBe(false)
        expect(host?.phase).toBe('content')
        for (const issue of checked.blockingIssues) expect(host?.issues.join(' ')).toContain(issue)
      }
    }
    await resetPhase()
    expect(await advanceProjectDeliveryAfterTurn(workspace, root)).toMatchObject({
      phase: 'content', shouldContinue: false,
      issues: ['The content milestone has no explicit completion result from this turn.'],
    })
    // A missing host baseline cannot be silently manufactured by a local check.
    await writeFile(statePath, JSON.stringify({ ...state, phase: 'content' }))
    expect((await checkSavedMilestoneResult(workspace, { ...assignment, designBaseline: undefined }))?.issues).toEqual(['Content handoff requires a reviewed design baseline.'])
    expect(await advanceProjectDeliveryAfterTurn(workspace, root)).toMatchObject({
      phase: 'content', shouldContinue: false, issues: ['Content handoff requires a reviewed design baseline.'],
    })
  } finally { await rm(root, { recursive: true, force: true }) }
})

