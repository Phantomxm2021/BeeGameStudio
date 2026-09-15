import { afterEach, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { GameIrOperations, GameIrPublishedView } from '../stage-modules/game-ir/public'
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

test('resource worker receives the complete published IR without source bindings', () => {
  const ir = {
    resultId: 'result', foundationRevision: 'foundation', publicationId: 'publication',
    modules: [
      { moduleId: 'presentation', nodes: [{
        id: 'art', kind: 'presentation.art-direction', producerMode: 'agent-authored',
        value: {}, references: [], edges: [], bindings: { label: { documentPath: 'docs/ART_DIRECTION.md' } },
      }] },
      { moduleId: 'resource-realization', nodes: [{
        id: 'resource', kind: 'logical-resource', producerMode: 'agent-authored',
        value: {}, references: [], edges: [], bindings: { label: { documentPath: 'docs/ASSET_PLAN.md' } },
      }] },
    ],
  } as unknown as Parameters<typeof downstreamIrForWorker>[1]

  const projected = downstreamIrForWorker('resource-planner', ir)
  expect(projected.modules.map(module => module.moduleId)).toEqual([
    'presentation',
    'resource-realization',
  ])
  expect(projected.modules[0]?.nodes[0]?.bindings).toEqual({})
  expect(ir.modules[0]?.nodes[0]?.bindings).not.toEqual({})
})

test('implementation and acceptance receive published IR values without source bindings', () => {
  const ir = {
    resultId: 'result', foundationRevision: 'foundation', publicationId: 'publication',
    modules: [{ moduleId: 'gameplay', nodes: [{
      id: 'state', kind: 'gameplay.state', producerMode: 'agent-authored',
      value: { large: 'payload' }, references: ['other'], edges: [],
      bindings: { source: { documentPath: 'docs/GDD.md' } },
    }] }],
  } as unknown as Parameters<typeof downstreamIrForWorker>[1]

  const projected = downstreamIrForWorker('implementation-worker', ir)
  expect(projected.resultId).toBe('result')
  expect(projected.modules[0]?.nodes[0]).toMatchObject({
    id: 'state', kind: 'gameplay.state', value: { large: 'payload' }, bindings: {},
    references: ['other'],
  })
  expect(downstreamIrForWorker('acceptance-validator', ir)).toEqual(projected)
  expect(ir.modules[0]?.nodes[0]?.value).toEqual({ large: 'payload' })
})

test('resource repair keeps the complete IR publication', () => {
  const ir = {
    resultId: 'result', foundationRevision: 'foundation', publicationId: 'publication',
    modules: [{ moduleId: 'resource-realization', nodes: [{
      id: 'large-node', kind: 'resource-realization.logical-resource',
      producerMode: 'semantic', value: {}, references: [], edges: [], bindings: {},
    }] }],
  } as unknown as Parameters<typeof downstreamIrForRequest>[1]
  const request = {
    runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
    workerType: 'resource-planner',
    phase: 'RESOURCE_PREPARATION', revision: 'revision',
    contract: { currentContentIssues: ['received "scene-definition", which is not allowed'] },
  } as WorkerDispatchRequest

  expect(downstreamIrForRequest(request, ir)).toEqual({
    resultId: 'result', foundationRevision: 'foundation', publicationId: 'publication',
    modules: [{ moduleId: 'resource-realization', nodes: [{
      id: 'large-node', kind: 'resource-realization.logical-resource',
      producerMode: 'semantic', value: {}, references: [], edges: [], bindings: {},
    }] }],
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
    candidate: { schemaVersion: 'game-ir.v1', taskId: 'game-ir-task', foundationRevision: outcome.result.foundationRevision,
      modules: Object.keys(outcome.result.moduleDigests).map(moduleId => ({ moduleId, nodes: [] })) } as GameIrPublishedView['candidate'] }
  const ir: GameIrOperations = { async start() { return run.gameIrStage!.handle! }, async getResult() { return outcome },
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

test('resource and implementation receive the same complete IR publication', async () => {
  const f = await fixture()
  await f.controller.resume(f.run)
  const resource = f.requests[0]!
  expect(resource.workerType).toBe('resource-planner')
  const gameIr = resource.contract.gameIr as { resultId: string; modules: unknown[] }
  expect(gameIr.resultId).toBe(foundationPublicDigest(f.view.ready))
  expect(gameIr.modules).toHaveLength(6)
  const implementation: DeliveryRun = { ...f.run, phase: 'IMPLEMENTATION',
    resourceProductionState: { currentTask: 'RESOURCE_DELIVERED', irResultId: gameIr.resultId,
      deliveryReceipt: { bindings: [], catalogObserved: false, contentDigest: fixtureDigest('content'),
        acceptedAt: new Date().toISOString() } } }
  await f.save(implementation)
  await f.controller.dispatcher.dispatch({ runId: f.run.runId, ownerId: f.run.ownerId, projectId: f.run.projectId,
    workspacePath: f.workspace, workerType: 'implementation-worker', phase: 'IMPLEMENTATION', revision: f.run.revision.workspace,
    taskId: 'DIRECT_IMPLEMENTATION', allowedPaths: ['src/'], contract: { task: { id: 'DIRECT_IMPLEMENTATION' } } })
  expect((f.requests[1]!.contract.gameIr as { modules: unknown[] }).modules).toHaveLength(6)
  expect((f.requests[1]!.contract.gameIr as { resultId: string }).resultId).toBe(gameIr.resultId)
  expect(f.requests[1]!.protectedPaths).toContain('docs/GDD.md')
  expect(f.requests[1]!.protectedPaths).toContain('.beegame/ir/')
  expect(f.requests[1]!.protectedPaths).toContain('.beegame/workflow/game-ir/')
  expect(f.requests[1]!.protectedPaths).toContain('assets/')
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
    deliveryReceipt: { acceptedAt: new Date().toISOString(), contentDigest: fixtureDigest('old'), bindings: [], catalogObserved: false } } }
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

test('same receipt ID cannot hide a changed dispatched module payload', async () => {
  const f = await fixture()
  await f.controller.resume(f.run)
  const gameIr = await readDownstreamIr({ run: f.run, workspacePath: f.workspace, ir: f.ir })
  const changed = structuredClone(f.requests[0]!)
  ;(changed.contract.gameIr as { modules: unknown[] }).modules = []
  expect(() => assertDispatchedIr(changed, gameIr)).toThrow('dispatched published IR')
})
