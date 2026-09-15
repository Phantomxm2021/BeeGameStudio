import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { foundationPublicDigest } from '../foundation-public-result'
import { readFile } from '../stage-runtime/files'
import type { GameIrOperations, GameIrPublishedView } from '../stage-modules/game-ir/public'
import { acceptedIrInput } from './game-ir-link'
import type { DeliveryRun, WorkerDispatchRequest } from './types'

export type DownstreamIr = {
  resultId: string
  foundationRevision: string
  publicationId: string
  modules: GameIrPublishedView['candidate']['modules']
}

export function consumesGameIr(worker: string): boolean {
  return ['resource-planner', 'content-author', 'implementation-worker', 'acceptance-validator'].includes(worker)
}

export function downstreamIrForWorker(worker: string, ir: DownstreamIr): DownstreamIr {
  if (consumesGameIr(worker))
    return {
      ...ir,
      modules: ir.modules.map(module => ({
        ...module,
        nodes: module.nodes.map(node => ({
          ...node,
          bindings: {},
        })),
      })),
    }
  return ir
}

export function downstreamIrForRequest(
  request: WorkerDispatchRequest,
  ir: DownstreamIr,
): DownstreamIr {
  return downstreamIrForWorker(request.workerType, ir)
}

export function isDownstreamIrPhase(phase: string): boolean {
  return ['RESOURCE_PREPARATION', 'GAME_CONTENT', 'IMPLEMENTATION', 'ACCEPTANCE'].includes(phase)
}

/** Read through the public module, which validates committed files and receipts. */
export async function readDownstreamIr(input: {
  run: DeliveryRun; workspacePath: string; ir?: GameIrOperations
}): Promise<DownstreamIr> {
  const link = input.run.gameIrStage, outcome = link?.outcome
  if (!input.ir || !link?.handle || outcome?.status !== 'completed' ||
      outcome.billingStatus !== 'settled' || link.control.action !== 'run')
    throw new Error('Downstream work requires a completed and settled IR result')
  const source = acceptedIrInput(input.run)
  if (foundationPublicDigest(source) !== link.inputDigest ||
      source.foundationResultId !== link.foundationResultId ||
      source.publishedDocumentRevision !== link.foundationRevision)
    throw new Error('Downstream IR accepted source binding changed')
  const view = await input.ir.readResult({ handle: link.handle, foundationRevision: link.foundationRevision })
  if (foundationPublicDigest(view.ready) !== foundationPublicDigest(outcome.result) ||
      foundationPublicDigest(view.input) !== link.inputDigest)
    throw new Error('Downstream IR public result binding changed')
  for (const document of view.input.documents) {
    const current = await readFile(join(input.workspacePath, document.path), 'utf8')
    if (createHash('sha256').update(current, 'utf8').digest('hex') !== document.digest)
      throw new Error(`Accepted Foundation document changed: ${document.path}`)
  }
  return { resultId: foundationPublicDigest(view.ready), foundationRevision: link.foundationRevision,
    publicationId: view.ready.publicationId, modules: view.candidate.modules }
}

export function assertResourceIr(run: DeliveryRun, ir: DownstreamIr, allowUnplanned = false): void {
  const binding = run.resourceProductionState.irResultId
  if (binding === ir.resultId) return
  if (!binding && allowUnplanned && run.phase === 'RESOURCE_PREPARATION' &&
      run.resourceProductionState.currentTask === 'RESOURCE_DELIVERY' &&
      !run.resourceProductionState.deliveryReceipt &&
      !run.evidence.resourcePreparation) return
  throw new Error('Resources are not bound to the current published IR; resource planning is required')
}

export function assertDispatchedIr(request: WorkerDispatchRequest | undefined, ir: DownstreamIr): void {
  const expected = request ? downstreamIrForRequest(request, ir) : undefined
  if (!request?.contract.gameIr || foundationPublicDigest(request.contract.gameIr) !== foundationPublicDigest(expected))
    throw new Error('Worker result does not bind the dispatched published IR')
}
