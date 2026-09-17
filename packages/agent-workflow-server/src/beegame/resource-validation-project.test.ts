import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateResourceDelivery } from './resource-validation-cli'
import { foundationPublicDigest } from './foundation-public-result'
import { createGameIrLifecycle } from './stage-modules/game-ir/private/lifecycle'
import { readDownstreamIr } from './delivery-workflow/downstream-ir'
import type { DeliveryRun } from './delivery-workflow/types'

// Opt-in reproduction using real artifacts; all mutations stay in a disposable copy.
const source = process.env.BEEGAME_RESOURCE_REPRO_PROJECT
test.skipIf(!source)('real delivery schema repair exposes the remaining IR coverage mismatch', async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'resource-contract-repro-')))
  try {
    await cp(join(source!, 'assets'), join(workspace, 'assets'), { recursive: true })
    await mkdir(join(workspace, '.beegame/workflow'), { recursive: true })
    await cp(join(source!, '.beegame/workflow/run.json'), join(workspace, '.beegame/workflow/run.json'))
    const before = validateResourceDelivery(workspace)
    expect(before.valid).toBe(false)
    const index = JSON.parse(await readFile(join(workspace, 'assets/asset-manifest.json'), 'utf8'))
    for (const path of index.modules.resources) {
      const resource = JSON.parse(await readFile(join(workspace, path), 'utf8'))
      if (typeof resource.selection_reason === 'string') resource.selection_reason = [resource.selection_reason]
      await writeFile(join(workspace, path), JSON.stringify(resource, null, 2))
    }
    const after = validateResourceDelivery(workspace)
    console.log(JSON.stringify({ resourceRepairReproduction: after }))
    // Do not relabel an audio bank as a clip simply to make acceptance pass.
    expect(after.issues).toEqual(['Bound resources do not satisfy IR acquisition profile for sfx_sprite_main.'])
    expect(after.valid).toBe(false)
    expect(after.resourceCount).toBe(45)
    // The host audit checks every declared runtime file against its original hash.
    expect(after.elapsedMs).toBeLessThan(2000)

    // Use the real public revision operation on copied, immutable publication records.
    const run = JSON.parse(await readFile(join(workspace, '.beegame/workflow/run.json'), 'utf8')) as DeliveryRun
    const link = run.gameIrStage!
    if (link.outcome?.status !== 'completed' || !link.handle) throw new Error('Expected completed IR')
    await cp(join(source!, 'docs'), join(workspace, 'docs'), { recursive: true })
    for (const directory of ['.beegame/ir', '.beegame/.game-ir-private/direct-compiler-v2'])
      await cp(join(source!, directory), join(workspace, directory), { recursive: true })
    const ownerHash = foundationPublicDigest(run.ownerId)
    const journal = `.beegame/workflow/game-ir/native-v1/${ownerHash}/${link.handle.id}/journal`
    await cp(join(source!, journal), join(workspace, journal), { recursive: true })
    const ir = createGameIrLifecycle(workspace, {
      runtimeConfiguration: { protocolVersion: 1, ownerId: run.ownerId, async resolve() { throw new Error('Must not run CLI') } },
      billing: { protocolVersion: 1, ownerId: run.ownerId, async submitUsage() { throw new Error('Must not incur usage') } },
    })
    const original = await ir.readResult({ handle: link.handle, foundationRevision: link.foundationRevision })
    const { taskId: _task, sourceRevision: _source, ...body } = original.candidate
    const draft = structuredClone({ ...body, schemaVersion: 'game-ir-direct-draft.v2' })
    const sound = draft.assets.find(asset => asset.id === 'sfx_sprite_main')!
    Object.assign(sound, { capabilities: ['audio-variants'], coverage: [] })
    const revised = await ir.revise({ handle: link.handle, expectedResultDigest: foundationPublicDigest(original.ready), draft })
    expect(revised.status).toBe('completed')
    run.gameIrStage = { ...link, handle: revised.handle, outcome: revised }
    run.activeDispatch!.request!.contract.gameIr = await readDownstreamIr({ run, workspacePath: workspace, ir })
    await writeFile(join(workspace, '.beegame/workflow/run.json'), JSON.stringify(run))
    for (const path of [index.modules.requirements].flat()) {
      const value = JSON.parse(await readFile(join(workspace, path), 'utf8'))
      // Requirement modules contain arrays; preserve every unrelated requirement.
      for (const requirement of Array.isArray(value) ? value : value.requirements ?? [])
        if (requirement.id === sound.id) {
          requirement.acquisition_profile.capabilities = ['audio-variants']
          delete requirement.acquisition_profile.coverage
        }
      await writeFile(join(workspace, path), JSON.stringify(value, null, 2))
    }
    const soundPath = join(workspace, 'assets/manifest/resources/sfx_sprite_main.json')
    const resource = JSON.parse(await readFile(soundPath, 'utf8'))
    resource.capabilities = ['audio-variants']
    await writeFile(soundPath, JSON.stringify(resource, null, 2))
    const accepted = validateResourceDelivery(workspace)
    console.log(JSON.stringify({ correctedPublicationValidation: accepted }))
    expect(accepted.issues).toEqual([])
    expect(accepted.valid).toBe(true)
    expect(accepted.elapsedMs).toBeLessThan(2000)
    expect((await ir.readResult({ handle: link.handle, foundationRevision: link.foundationRevision })).ready).toEqual(original.ready)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})
