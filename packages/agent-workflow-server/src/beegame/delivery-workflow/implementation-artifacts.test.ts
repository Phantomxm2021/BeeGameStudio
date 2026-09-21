import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { writeBeeGameAssetManifest } from '../asset-contracts'
import { acceptBeeGameContentPackage } from '../game-content-package'
import { readBeeGameAssetManifestSync } from '../asset-contracts'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { refreshResourceDelivery } from './resource-stage'
import { refreshImplementationArtifacts, startNextImplementationTask } from './implementation-stage'
import { createDeliveryWorkflowController } from './controller'

test('coordinated repair rejects stale hashes, reports them on resume and accepts synchronized assets without upstream restart', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-implementation-artifacts-'))
  try {
    await mkdir(join(workspacePath, 'assets/runtime'), { recursive: true })
    await mkdir(join(workspacePath, 'content/scenes'), { recursive: true })
    await writeFile(join(workspacePath, 'assets/runtime/player.json'), '{}')
    await writeBeeGameAssetManifest(workspacePath, {
      version: 9,
      project_target: { asset_format_capabilities: ['json'], resource_library_usage: 'optional',
        runtime_asset_root: 'assets/runtime', generated_asset_root: 'assets/generated' },
      requirements: [{ id: 'visual', required: true, acquisition_profile: {
        dimensions: ['agnostic'], asset_kinds: ['data'], usage_tags: [], capabilities: [], styles: [],
      } }],
      resources: [{ id: 'player', fulfills: ['visual'],
        source: { type: 'agent-authored', created_at: new Date().toISOString(), reason: 'test' },
        root_path: 'assets/runtime/player.json', file_paths: ['assets/runtime/player.json'],
        local_file_hashes: { 'assets/runtime/player.json': createHash('sha256').update('{}').digest('hex') },
        provisional: false, status: 'verified', selected_at: new Date().toISOString(),
        selection_reason: ['matches'], dimension: 'agnostic', asset_kind: 'data' }],
    })
    const base = createTestDeliveryRun({ ownerId: 'owner', projectId: 'project', documentRevision: 'a'.repeat(64) })
    const prepared = await refreshResourceDelivery({ run: { ...base, phase: 'IMPLEMENTATION' }, workspacePath })
    expect(prepared.status).toBe('running')
    const index = { schema: 'beegame-content-package.v2', id: 'package', dimension: '2d',
      documentRevision: prepared.revision.document, assetManifestRevision: prepared.revision.resource,
      sceneModel: 'game-object-v2', entryScene: 'scene.main', files: ['scenes/main.json'] }
    const scene = { schema: 'beegame-content.v1', id: 'scene.main', kind: 'scene-2d',
      assetRefs: [], data: { settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels',
        width: 960, height: 540, pixelsPerUnit: 100 } },
        nodes: [{ id: 'root', transform: { position: [10, 20, 0] } }] } }
    await writeFile(join(workspacePath, 'content/index.json'), JSON.stringify(index))
    await writeFile(join(workspacePath, 'content/scenes/main.json'), JSON.stringify(scene))
    const receipt = acceptBeeGameContentPackage(workspacePath, {
      documentRevision: prepared.revision.document, assetManifestRevision: prepared.revision.resource!,
      manifest: readBeeGameAssetManifestSync(workspacePath),
    })
    const run = { ...prepared, phase: 'IMPLEMENTATION' as const,
      revision: { ...prepared.revision, content: receipt.contentRevision }, gameContentReceipt: receipt,
      tasks: [{ id: 'DIRECT_IMPLEMENTATION', title: 'Implement', checklistIds: [], resourceIds: ['player'],
        contentIds: ['scene.main'], allowedPaths: ['./'], status: 'running' as const, attempt: 1, evidenceRefs: [] }],
    }
    scene.data.nodes[0]!.transform.position = [30, 40, 0]
    await writeFile(join(workspacePath, 'content/scenes/main.json'), JSON.stringify(scene))
    const contentEdit = await refreshImplementationArtifacts({ run, workspacePath })
    expect(contentEdit.phase).toBe('IMPLEMENTATION')
    expect(contentEdit.tasks[0]!.attempt).toBe(1)
    expect(contentEdit.revision.content).not.toBe(run.revision.content)
    expect(contentEdit.revision.resource).toBe(run.revision.resource)
    await writeFile(join(workspacePath, 'assets/runtime/player.json'), '{"color":"green"}')
    await expect(refreshImplementationArtifacts({ run: contentEdit, workspacePath })).rejects.toThrow('hash')
    const dispatched: import('./types').WorkerDispatchRequest[] = []
    await startNextImplementationTask({
      run: { ...contentEdit, activeTaskId: undefined,
        tasks: contentEdit.tasks.map(task => ({ ...task, status: 'pending' })) },
      workspacePath, revision: contentEdit.revision.workspace,
      dispatcher: { async dispatch(request) { dispatched.push(request) } },
    })
    expect(dispatched[0]?.contract.resourceValidationCommand).toBe('bun assets/manifest/check.mjs')
    expect(JSON.stringify(dispatched[0]?.contract.currentImplementationIssues)).toContain('hash')
    const repaired = readBeeGameAssetManifestSync(workspacePath)
    expect(repaired.resources[0]!.local_file_hashes!['assets/runtime/player.json'])
      .toBe(createHash('sha256').update('{}').digest('hex'))
    // The resource repair owner confirms the changed asset and updates its record.
    repaired.resources[0]!.local_file_hashes = { 'assets/runtime/player.json':
      createHash('sha256').update('{"color":"green"}').digest('hex') }
    await writeBeeGameAssetManifest(workspacePath, repaired)
    const assetEdit = await refreshImplementationArtifacts({ run: contentEdit, workspacePath })
    expect(assetEdit.revision.resource).not.toBe(contentEdit.revision.resource)
    expect(assetEdit.gameContentReceipt?.assetManifestRevision).toBe(assetEdit.revision.resource)
    const savedIndex = JSON.parse(await readFile(join(workspacePath, 'content/index.json'), 'utf8'))
    expect(savedIndex.assetManifestRevision).toBe(assetEdit.revision.resource)
    expect(assetEdit.evidence.acceptance).toBeUndefined()
    const noWorker = async (): Promise<never> => { throw new Error('Editing must not dispatch an Agent') }
    const controller = createDeliveryWorkflowController({ workspacePath, ownerId:'owner',
      workerPort:{start:noWorker,submit:noWorker,stop:noWorker,status:noWorker} })
    const interrupted = {...assetEdit,status:'stopped' as const,
      tasks:assetEdit.tasks.map(task=>({...task,status:'pending' as const})),
      activeDispatch:{dispatchId:'stopped-dispatch',workerType:'implementation-worker' as const,phase:'IMPLEMENTATION' as const,
        revision:assetEdit.revision.workspace,status:'interrupted' as const,startedAt:new Date().toISOString()}}
    await controller.store.save(interrupted)
    try {
      const snapshot = await controller.loadGameContentForEditing()
      const doc = snapshot.documents[0]!
      const edited = structuredClone(doc.document)
      ;(edited.data.nodes as Array<{transform:{position:number[]}}>)[0]!.transform.position = [50,60,0]
      const saved = await controller.saveGameContentEdit({path:doc.path,expectedRevision:doc.revision,document:edited})
      expect(saved.revision).not.toBe(doc.revision)
      expect((await controller.store.load())!.status).toBe('stopped')
      await controller.store.save({...interrupted,activeDispatch:{...interrupted.activeDispatch,status:'running'}})
      await expect(controller.saveGameContentEdit({path:saved.path,expectedRevision:saved.revision,document:saved.document}))
        .rejects.toThrow('while workflow work is active')
      await controller.store.save(interrupted)
    } finally { await controller.dispose() }
    await writeFile(join(workspacePath, 'content/scenes/main.json'), '{broken')
    await expect(refreshImplementationArtifacts({ run: assetEdit, workspacePath })).rejects.toThrow()
    await writeFile(join(workspacePath, 'content/scenes/main.json'), JSON.stringify(scene))
    await writeFile(join(workspacePath, 'content/index.json'), JSON.stringify({ ...savedIndex, assetManifestRevision: 'f'.repeat(64) }))
    await expect(refreshImplementationArtifacts({ run: assetEdit, workspacePath })).rejects.toThrow('unrelated')
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})
