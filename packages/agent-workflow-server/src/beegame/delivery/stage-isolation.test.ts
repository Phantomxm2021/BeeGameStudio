import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beginProjectDelivery, advanceProjectDeliveryAfterTurn, readProjectDelivery, projectDeliveryStatePath,
  refreshProjectContentContract, pauseProjectDelivery, resumeProjectDelivery } from '../project-delivery'
import { writeDesignDocumentsFixture, designBaselineFixture } from '../fixtures/layout-fixture'
import { writeBeeGameAssetManifest } from '../asset-contracts'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { PROJECT_CONTENT_CONTRACT_PATH, PROJECT_DELIVERY_REPORT_PATH } from './paths'
import { PROJECT_DOCUMENTS } from '../project-content-authority'
import { designHandoffPath } from '../design-handoff'

test('Content preparation failure does not undo a completed resources handoff or regenerate saved work on resume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-stage-isolation-')), workspace = join(root, 'project')
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Synthetic isolation fixture')
    await writeDesignDocumentsFixture(workspace)
    await mkdir(join(workspace, 'assets/runtime/example'), { recursive: true })
    await writeFile(join(workspace, 'assets/runtime/example/resource.json'), '{"original":true}')
    await writeBeeGameAssetManifest(workspace, assetManifestAuthoringExamples().canonical)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state,
      phase: 'resources', designBaseline: designBaselineFixture(workspace) }))
    const files = [...PROJECT_DOCUMENTS.flatMap(name => ['docs/' + name, designHandoffPath(name)]),
      'content/ui/menu.json', 'content/scenes/level.json',
      'assets/asset-manifest.json', 'assets/runtime/example/resource.json']
    const before = await Promise.all(files.map(file => readFile(join(workspace, file), 'utf8')))
    // An unavailable next-stage output, not a faulty resource or design.
    await mkdir(join(workspace, PROJECT_CONTENT_CONTRACT_PATH))
    expect(await advanceProjectDeliveryAfterTurn(workspace, root,
      { phase: 'resources', status: 'complete', summary: 'Saved synthetic resources' }))
      .toMatchObject({ phase: 'content', shouldContinue: true, issues: [] })
    await expect(refreshProjectContentContract(workspace)).rejects.toThrow()
    expect((await readProjectDelivery(workspace, root))!.phase).toBe('content')
    await pauseProjectDelivery(workspace, root)
    expect(await resumeProjectDelivery(workspace, root)).toMatchObject({ phase: 'content', status: 'active' })
    await rm(join(workspace, PROJECT_CONTENT_CONTRACT_PATH), { recursive: true })
    await refreshProjectContentContract(workspace)
    expect(await Promise.all(files.map(file => readFile(join(workspace, file), 'utf8')))).toEqual(before)
    expect((await readProjectDelivery(workspace, root))!.phase).toBe('content')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('an old failure report cannot schedule repair again merely because implementation artifacts changed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-failure-isolation-')), workspace = join(root, 'project')
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, root, 'Synthetic isolation fixture')
    await writeDesignDocumentsFixture(workspace)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state,
      phase: 'acceptance', designBaseline: designBaselineFixture(workspace) }))
    await mkdir(join(workspace, 'dist'))
    await writeFile(join(workspace, 'dist/game.js'), 'version 1')
    await writeFile(join(workspace, 'failure.txt'), 'Observed failure in version 1')
    await writeFile(join(workspace, PROJECT_DELIVERY_REPORT_PATH), JSON.stringify({
      scope: 'delivery', status: 'failed', summary: 'Synthetic assertion failed',
      environment: 'Synthetic test adapter', evidencePaths: ['failure.txt'], artifactPaths: ['dist'],
    }))
    expect(await advanceProjectDeliveryAfterTurn(workspace, root)).toMatchObject({ phase: 'implementation', shouldContinue: true })
    await writeFile(join(workspace, 'dist/game.js'), 'version 2: correction')
    expect(await advanceProjectDeliveryAfterTurn(workspace, root,
      { phase: 'implementation', status: 'complete', summary: 'Corrected implementation' }))
      .toMatchObject({ phase: 'acceptance', shouldContinue: true })
    expect(await advanceProjectDeliveryAfterTurn(workspace, root)).toMatchObject({ phase: 'acceptance', shouldContinue: false })
    // An unrelated diagnostic must not erase acceptance's repair identity.
    const saved = (await readProjectDelivery(workspace, root))!
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...saved, lastValidationFailure: 'Unrelated diagnostic' }))
    await pauseProjectDelivery(workspace, root)
    await resumeProjectDelivery(workspace, root)
    expect(await advanceProjectDeliveryAfterTurn(workspace, root)).toMatchObject({ phase: 'acceptance', shouldContinue: false })
    await writeFile(join(workspace, 'failure.txt'), 'New observed failure after rechecking version 2')
    expect(await advanceProjectDeliveryAfterTurn(workspace, root)).toMatchObject({ phase: 'implementation', shouldContinue: true })
  } finally { await rm(root, { recursive: true, force: true }) }
})
