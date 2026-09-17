import { afterEach, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { GameIrOperations, GameIrPublishedView } from '../stage-modules/game-ir/public'
import {
  writeBeeGameAssetManifest,
  type BeeGameAssetManifest,
} from '../asset-contracts'
import { acceptBeeGameContentPackage } from '../game-content-package'
import { foundationPublicDigest } from '../foundation-public-result'
import { createDeliveryWorkflowController } from './controller'
import { acceptedIrInput } from './game-ir-link'
import { assertDispatchedIr, assertResourceIr, downstreamIrForRequest, downstreamIrForWorker, readDownstreamIr } from './downstream-ir'
import { computeDocumentRevision } from './revision'
import type { DeliveryRun, DeliveryWorkerPort, WorkerDispatchRequest } from './types'
import { completedChecklistRun, createAcceptedIrChecklistFixture, disposeAcceptedIrChecklistFixture, fixtureDigest } from './test-fixtures/accepted-ir-checklist'

type MutablePublishedView = { -readonly [K in keyof GameIrPublishedView]: GameIrPublishedView[K] }

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

test('malformed resource delivery becomes needs_action without a content dispatch or accepted receipt', async () => {
  const f = await fixture()
  await f.controller.resume(f.run)
  const request = f.requests[0]!
  await mkdir(join(f.workspace, 'assets'), { recursive: true })
  await writeFile(join(f.workspace, 'assets/asset-manifest.json'), '{invalid')
  await f.controller.dispatcher.completeDispatch(request.dispatchId!, {
    workerType: 'resource-planner', status: 'completed', revision: request.revision, writtenPaths: [],
  })
  const run = (await f.controller.store.load())!
  expect(run.status).toBe('needs_action')
  expect(run.phase).toBe('RESOURCE_PREPARATION')
  expect(run.blockedReason).toContain('valid JSON')
  expect(run.resourceProductionState.deliveryReceipt).toBeUndefined()
  expect(run.evidence.resourcePreparation).toBeUndefined()
  expect(f.requests).toHaveLength(1)
})

test('resource worker receives the complete lightweight IR', () => {
  const ir = {
    resultId: 'result', foundationRevision: 'foundation', publicationId: 'publication',
    parameters: { speed: 4 }, assets: [],
    scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }],
    ui: [], vfx: [], logic: { start: 'scene.main' },
  } as unknown as Parameters<typeof downstreamIrForWorker>[1]

  const projected = downstreamIrForWorker('resource-planner', ir)
  expect(projected).toBe(ir)
  expect(projected.scenes[0]?.id).toBe('scene.main')
})

test('implementation and acceptance receive the same published IR', () => {
  const ir = {
    resultId: 'result', foundationRevision: 'foundation', publicationId: 'publication',
    parameters: {}, assets: [], scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }],
    ui: [], vfx: [], logic: { state: { large: 'payload' } },
  } as unknown as Parameters<typeof downstreamIrForWorker>[1]

  const projected = downstreamIrForWorker('implementation-worker', ir)
  expect(projected.resultId).toBe('result')
  expect(projected.logic).toEqual({ state: { large: 'payload' } })
  expect(downstreamIrForWorker('acceptance-validator', ir)).toEqual(projected)
})

test('resource repair keeps the complete IR publication', () => {
  const ir = {
    resultId: 'result', foundationRevision: 'foundation', publicationId: 'publication',
    parameters: {}, assets: [], scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }],
    ui: [], vfx: [], logic: {},
  } as unknown as Parameters<typeof downstreamIrForRequest>[1]
  const request = {
    runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
    workerType: 'resource-planner',
    phase: 'RESOURCE_PREPARATION', revision: 'revision',
    contract: { currentResourceIssues: ['resource binding is missing'] },
  } as WorkerDispatchRequest

  expect(downstreamIrForRequest(request, ir)).toEqual({
    resultId: 'result', foundationRevision: 'foundation', publicationId: 'publication',
    parameters: {}, assets: [], scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }],
    ui: [], vfx: [], logic: {},
  })
})

// Protocol fixtures only: semantic correctness is independently tested by the IR module.
async function fixture() {
  const f = await createAcceptedIrChecklistFixture()
  cleanups.push(() => disposeAcceptedIrChecklistFixture(f))
  for (const document of f.review.documents) {
    const path = join(f.workspace, document.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, document.content)
  }
  const run: DeliveryRun = { ...completedChecklistRun(f), phase: 'RESOURCE_PREPARATION', documentStep: undefined,
    revision: { ...f.run.revision, document: await computeDocumentRevision(f.workspace, f.run.confirmedBriefDigest) } }
  const outcome = run.gameIrStage!.outcome!
  if (outcome.status !== 'completed') throw new Error('fixture')
  const view: MutablePublishedView = { input: acceptedIrInput(run), ready: outcome.result,
    candidate: { schemaVersion: 'game-ir.v2', taskId: 'game-ir-task', sourceRevision: outcome.result.foundationRevision,
      parameters: {}, assets: [], scenes: [{ id: 'scene.main', name: 'Main', assetIds: [], config: {} }],
      ui: [{ id: 'ui.hud', name: 'HUD', assetIds: [], config: {} }], vfx: [], logic: {} } }
  const ir: GameIrOperations = { async start() { return run.gameIrStage!.handle! }, async getResult() { return outcome },
    async revise() { throw new Error('not used') },
    async resume() { return outcome }, async stop() { return outcome }, async readResult() { return structuredClone(view) } }
  const requests: WorkerDispatchRequest[] = []
  const workerPort: DeliveryWorkerPort = {
    async start(request) { requests.push(request); return { sessionId: `session:${request.dispatchId}`, dispatchId: request.dispatchId! } },
    async submit() {}, async stop() {}, async status() { throw new Error('status is not used by this fixture') },
  }
  const controller = createDeliveryWorkflowController({ workspacePath: f.workspace, ownerId: run.ownerId,
    workerPort, ir, handoffRecoveryGraceMs: -1 })
  cleanups.push(() => controller.dispose())
  const save = async (value: DeliveryRun) => controller.store.commit(value, { runId: value.runId, type: 'fixture',
    phase: value.phase, status: value.status, revision: value.revision })
  await save(run)
  return { ...f, run, view, ir, controller, requests, save }
}

test('IR correction rebinds idle resource preparation and requires explicit continuation', async () => {
  const f = await fixture()
  const old = f.run.gameIrStage!.outcome!
  if (old.status !== 'completed') throw new Error('fixture')
  const expectedResultDigest = foundationPublicDigest(old.result)
  let revisions = 0
  Object.assign(f.ir, { revise: async () => {
    revisions++
    f.view.ready = { ...old.result, publicationId: 'corrected', candidateDigest: 'a'.repeat(64) }
    return { ...old, handle: { ...old.handle, id: 'b'.repeat(64) }, result: f.view.ready }
  } })
  await expect(f.controller.reviseGameIr({ expectedResultDigest, draft: {} })).rejects.toThrow('idle resource preparation')
  await f.save({ ...f.run, status: 'failed' })
  await expect(f.controller.reviseGameIr({ expectedResultDigest: 'c'.repeat(64), draft: {} })).rejects.toThrow('changed before correction')
  const revised = await f.controller.reviseGameIr({ expectedResultDigest, draft: {} })
  expect(revisions).toBe(1)
  expect(revised.status).toBe('needs_action')
  expect(revised.resourceProductionState.deliveryReceipt).toBeUndefined()
  expect(revised.resourceProductionState.irResultId).toBeUndefined()
  expect(revised.activeDispatch).toBeUndefined()
  expect(f.requests).toHaveLength(0)
  expect(revised.gameIrStage!.outcome).toMatchObject({ result: { publicationId: 'corrected' } })
})

test('resource and Scene/UI content receive the same complete IR publication', async () => {
  const f = await fixture()
  await f.controller.resume(f.run)
  const resource = f.requests[0]!
  expect(resource.workerType).toBe('resource-planner')
  const gameIr = resource.contract.gameIr as { resultId: string; scenes: unknown[] }
  expect(gameIr.resultId).toBe(foundationPublicDigest(f.view.ready))
  expect(gameIr.scenes).toHaveLength(1)
  const content: DeliveryRun = { ...f.run, phase: 'GAME_CONTENT',
    revision: { ...f.run.revision, resource: fixtureDigest('resource') },
    resourceProductionState: { currentTask: 'RESOURCE_DELIVERED', irResultId: gameIr.resultId,
      deliveryReceipt: { bindings: [], catalogObserved: false, resourceDigest: fixtureDigest('resource'),
        acceptedAt: new Date().toISOString() } } }
  await f.save(content)
  await f.controller.dispatcher.dispatch({ runId: f.run.runId, ownerId: f.run.ownerId, projectId: f.run.projectId,
    workspacePath: f.workspace, workerType: 'content-author', phase: 'GAME_CONTENT', revision: fixtureDigest('resource'),
    allowedPaths: ['content/'], contract: {} })
  expect((f.requests[1]!.contract.gameIr as { scenes: unknown[] }).scenes).toHaveLength(1)
  expect((f.requests[1]!.contract.gameIr as { resultId: string }).resultId).toBe(gameIr.resultId)
  expect(f.requests[1]!.protectedPaths).toContain('docs/GDD.md')
  expect(f.requests[1]!.protectedPaths).toContain('.beegame/ir/')
  expect(f.requests[1]!.protectedPaths).toContain('.beegame/workflow/game-ir/')
  expect(f.requests[1]!.protectedPaths).toContain('assets/')
})

test('Scene/UI edits stay draft until explicitly published to implementation', async () => {
  const f = await fixture()
  f.view.candidate = {
    ...f.view.candidate,
    scenes: [{ id: 'world.main', name: 'Main', assetIds: [], config: {} }],
  }
  const irRevision = foundationPublicDigest(f.view.ready)
  const resourceRevision = fixtureDigest('editable resources')
  const manifest: BeeGameAssetManifest = {
    version: 9,
    requirements: [],
    resources: [],
  }
  await writeBeeGameAssetManifest(f.workspace, manifest)
  const writeJson = async (path: string, value: unknown) => {
    const absolute = join(f.workspace, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
  }
  await writeJson('content/index.json', {
    schema: 'beegame-content-package.v1',
    id: 'game-content',
    dimension: '2d',
    irRevision,
    assetManifestRevision: resourceRevision,
    entryScene: 'scene.main',
    files: ['scenes/main.scene.json', 'ui/hud.ui.json'],
  })
  await writeJson('content/scenes/main.scene.json', {
    schema: 'beegame-content.v1',
    id: 'scene.main',
    kind: 'scene-2d',
    irRefs: ['world.main'],
    assetRefs: [],
    data: { nodes: [{ id: 'world', kind: 'group' }] },
  })
  await writeJson('content/ui/hud.ui.json', {
    schema: 'beegame-content.v1',
    id: 'ui.hud',
    kind: 'ui-hud',
    irRefs: ['world.main'],
    assetRefs: [],
    data: { rootId: 'hud', nodes: [{ id: 'hud', role: 'hud' }] },
  })
  const authority = {
    irRevision,
    assetManifestRevision: resourceRevision,
    irEntryIds: ['world.main'],
    manifest,
  }
  const receipt = acceptBeeGameContentPackage(f.workspace, authority)
  const observedAt = new Date().toISOString()
  const completed: DeliveryRun = {
    ...f.run,
    phase: 'DELIVERY',
    documentStep: undefined,
    status: 'completed',
    completedAt: observedAt,
    revision: {
      ...f.run.revision,
      resource: resourceRevision,
      content: receipt.contentRevision,
    },
    resourceProductionState: {
      currentTask: 'RESOURCE_DELIVERED',
      irResultId: irRevision,
      deliveryReceipt: {
        bindings: [],
        catalogObserved: false,
        resourceDigest: resourceRevision,
        acceptedAt: observedAt,
      },
    },
    gameContentReceipt: receipt,
    evidence: {
      gameContent: {
        path: receipt.indexPath,
        kind: 'game_content',
        revision: receipt.contentRevision,
        status: 'passed',
        observedAt,
      },
    },
  }
  await f.save(completed)

  const loaded = await f.controller.loadGameContentForEditing()
  const scene = loaded.documents.find(document => document.path.startsWith('scenes/'))!
  const edited = structuredClone(scene.document)
  if (edited.kind !== 'scene-2d') throw new Error('expected scene')
  edited.data.nodes[0]!.transform = { position: [40, 24], scale: [1.2, 1.2] }
  const saved = await f.controller.saveGameContentEdit({
    path: scene.path,
    expectedRevision: scene.revision,
    document: edited,
  })
  expect(saved.contentRevision).not.toBe(receipt.contentRevision)
  expect((await f.controller.store.load())!.revision.content).toBe(receipt.contentRevision)
  expect(f.requests).toHaveLength(0)

  const published = await f.controller.publishGameContentEdits(saved.contentRevision)
  expect(published.phase).toBe('IMPLEMENTATION')
  expect(published.revision.content).toBe(saved.contentRevision)
  expect(published.gameContentReceipt?.contentRevision).toBe(saved.contentRevision)
  expect(f.requests).toHaveLength(0)
})

test('a composite document revision after Checklist does not replace the frozen Foundation IR revision', async () => {
  const f = await fixture()
  const gameIr = await readDownstreamIr({ run: f.run, workspacePath: f.workspace, ir: f.ir })
  expect(f.run.revision.document).not.toBe(gameIr.foundationRevision)
  expect(gameIr.foundationRevision).toBe(f.run.gameIrStage!.foundationRevision)
})

test('pending IR, changed publication, and changed accepted document are rejected', async () => {
  const f = await fixture()
  const pending = structuredClone(f.run)
  pending.gameIrStage!.outcome!.billingStatus = 'pending'
  await expect(readDownstreamIr({ run: pending, workspacePath: f.workspace, ir: f.ir })).rejects.toThrow('completed and settled')
  const publicationId = f.view.ready.publicationId
  f.view.ready = { ...f.view.ready, publicationId: 'different' }
  await expect(readDownstreamIr({ run: f.run, workspacePath: f.workspace, ir: f.ir })).rejects.toThrow('public result binding changed')
  f.view.ready = { ...f.view.ready, publicationId }
  await writeFile(join(f.workspace, f.review.documents[0]!.path), 'edited after publication')
  await f.controller.resume(f.run)
  expect(f.requests).toHaveLength(0)
  expect((await f.controller.store.load())!.blockedReason).toContain('Accepted Foundation document changed')
})

test('unproven existing resource receipts and a different IR binding cannot reach the resource gate', async () => {
  const f = await fixture()
  const gameIr = await readDownstreamIr({ run: f.run, workspacePath: f.workspace, ir: f.ir })
  expect(() => assertResourceIr(f.run, gameIr, true)).not.toThrow()
  const old: DeliveryRun = { ...f.run, resourceProductionState: { currentTask: 'RESOURCE_DELIVERED',
    deliveryReceipt: { acceptedAt: new Date().toISOString(), resourceDigest: fixtureDigest('old'), bindings: [], catalogObserved: false } } }
  expect(() => assertResourceIr(old, gameIr, true)).toThrow('not bound')
  await f.save({ ...old, resourceProductionState: { ...old.resourceProductionState, irResultId: fixtureDigest('different IR') } })
  await f.controller.resume(f.run)
  const blocked = (await f.controller.store.load())!
  expect(blocked.status).toBe('needs_action')
  expect(blocked.phase).toBe('RESOURCE_PREPARATION')
  expect(f.requests).toHaveLength(0)
})

test('late completion after source drift is quarantined instead of admitting a resource result', async () => {
  const f = await fixture()
  await f.controller.resume(f.run)
  const request = f.requests[0]!
  await writeFile(join(f.workspace, f.review.documents[0]!.path), 'changed while worker was running')
  await f.controller.dispatcher.completeDispatch(request.dispatchId!, { workerType: 'resource-planner', status: 'completed',
    revision: request.revision, writtenPaths: [] })
  const blocked = (await f.controller.store.load())!
  expect(blocked.status).toBe('needs_action')
  expect(blocked.resourceProductionState.irResultId).toBeUndefined()
  expect(blocked.blockedReason).toContain('Accepted Foundation document changed')
  expect(f.requests).toHaveLength(1)
})

test('same receipt ID cannot hide a changed dispatched IR payload', async () => {
  const f = await fixture()
  await f.controller.resume(f.run)
  const gameIr = await readDownstreamIr({ run: f.run, workspacePath: f.workspace, ir: f.ir })
  const changed = structuredClone(f.requests[0]!)
  ;(changed.contract.gameIr as { modules: unknown[] }).modules = []
  expect(() => assertDispatchedIr(changed, gameIr)).toThrow('dispatched published IR')
})
