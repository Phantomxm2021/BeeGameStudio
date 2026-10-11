import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { writeDesignDocumentsFixture, designBaselineFixture } from './fixtures/layout-fixture'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { beginProjectDelivery, projectDeliveryStatePath, advanceProjectDeliveryAfterTurn } from './project-delivery'
import { checkResourceHandoff, checkResourceResult, prepareResources } from './delivery/stages/resources'
import { runGameContentCommand } from './game-content-validation-cli'
import { sharedContentChecker } from './content-checker-runtime'
import { checkSavedMilestoneResult } from './milestone-handoff-check'
import type { DesignFinding } from '@bee-game-studio/agent-workflow/design-review-result'

test('resources share policy, files, receipt and source checks across preflight/handoff/advancement without requiring Content', async () => {
  const root = await mkdtemp('/private/tmp/bgs-resource-stage-'), workspace = join(root, 'game')
  try {
    await mkdir(workspace)
    const objective = JSON.stringify({ resource_library_usage: 'optional' })
    const state = await beginProjectDelivery(workspace, root, objective)
    await writeDesignDocumentsFixture(workspace)
    const baseline = designBaselineFixture(workspace), statePath = projectDeliveryStatePath(workspace, root)
    const input = { objective, baseline: { ...baseline, digestVersion: baseline.digestVersion! } }
    const manifest = assetManifestAuthoringExamples().canonical
    const asset = join(workspace, 'assets/runtime/example/resource.json')
    await mkdir(join(workspace, 'assets/runtime/example'), { recursive: true })
    const receipt = join(workspace, '.beegame/resource-result.txt'), inputPath = join(workspace, '.beegame/resource-input.json')
    await writeFile(inputPath, JSON.stringify(input))
    await writeFile(receipt, 'complete\nSynthetic resource registration\n')
    const assignment = { phase: 'resources' as const, path: receipt, objective, designBaseline: input.baseline }
    const reset = () => writeFile(statePath, JSON.stringify({ ...state, phase: 'resources', designBaseline: baseline }))
    const checkNative = () => checkSavedMilestoneResult(workspace, assignment)
    for (const defect of ['missing-file', 'failed', 'policy', 'none'] as const) {
      await reset(); await writeFile(asset, '{}')
      const current = structuredClone(manifest)
      if (defect === 'failed') { current.resources[0]!.status = 'failed'; current.resources[0]!.error = 'Synthetic failed production' }
      if (defect === 'policy') current.project_target!.resource_library_usage = 'required'
      await writeBeeGameAssetManifest(workspace, current)
      if (defect === 'missing-file') await unlink(asset)
      expect(prepareResources(workspace, input).ready).toBe(true) // Preparation permits unfinished work.
      const direct = checkResourceHandoff(workspace, input)
      expect(runGameContentCommand(workspace, ['--resources-handoff', '.beegame/resource-input.json'])).toEqual(direct)
      expect((await checkNative())?.issues).toEqual(direct.issues)
      const host = await advanceProjectDeliveryAfterTurn(workspace, root, { phase: 'resources', status: 'complete', summary: 'Saved' })
      if (defect === 'none') {
        expect(direct).toMatchObject({ valid: true, bindingVerified: false, runtimeVerified: false })
        expect(host).toMatchObject({ phase: 'content', issues: [] })
        await expect(readFile(join(workspace, 'content/index.json'))).rejects.toThrow()
      } else {
        expect(direct.valid).toBe(false)
        expect(host?.phase).toBe('resources')
        for (const issue of direct.issues) expect(host?.issues.join(' ')).toContain(issue)
      }
    }
    const before = checkResourceHandoff(workspace, input).sourceRevision
    await writeFile(join(workspace, 'notes.md'), 'Not resource work')
    expect(checkResourceHandoff(workspace, input).sourceRevision).toBe(before)
    await writeFile(asset, '{"updated":true}')
    expect(checkResourceHandoff(workspace, input).sourceRevision).not.toBe(before)
    const checker = await sharedContentChecker()
    const child = Bun.spawn([process.execPath, '.beegame/delivery/check-content.mjs', '--resources-handoff', '.beegame/resource-input.json'],
      { cwd: workspace, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: checker.moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' })
    expect(JSON.parse(stdout)).toEqual(checkResourceHandoff(workspace, input))
    const finding: DesignFinding = { id: 'required-now', owner: 'ART_DIRECTION.md', documents: ['ART_DIRECTION.md'],
      sources: [{ document: 'ART_DIRECTION.md', section: 'Design' }], severity: 'follow-up', action: 'correct',
      impact: 'Required palette unresolved', closeWhen: 'Owner confirms palette', neededBefore: 'resources' }
    await reset()
    const result = { phase: 'resources' as const, status: 'complete' as const, summary: 'Saved', designIssues: [finding] }
    await writeFile(receipt, 'complete\n' + JSON.stringify({ summary: result.summary, designIssues: result.designIssues }))
    expect((await checkNative())?.issues).toEqual(checkResourceResult(workspace, input, result).issues)
    expect(await advanceProjectDeliveryAfterTurn(workspace, root, result)).toMatchObject({ phase: 'resources', shouldContinue: false })
    await reset()
    expect(await advanceProjectDeliveryAfterTurn(workspace, root)).toMatchObject({ phase: 'resources', shouldContinue: false,
      issues: ['The resources milestone has no explicit completion result from this turn.'] })
    const art = join(workspace, 'docs/ART_DIRECTION.md')
    await writeFile(art, (await readFile(art, 'utf8')) + '\nChanged owner requirement.\n')
    expect(prepareResources(workspace, input)).toMatchObject({ ready: false })
    expect(prepareResources(workspace, input).recovery).toContain('design-resolution')
  } finally { await rm(root, { recursive: true, force: true }) }
})

