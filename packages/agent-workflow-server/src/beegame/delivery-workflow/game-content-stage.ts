import { readBeeGameAssetManifestSync } from '../asset-contracts'
import { acceptBeeGameContentPackage } from '../game-content-package'
import { buildSceneUiContentAuthoringAuthority } from '../scene-ui-content-authoring'
import { transitionDeliveryRun } from './transition'
import type { DeliveryRun, WorkerDispatchRequest } from './types'
import type { WorkerTerminalResult } from './worker-contracts'

type Dispatcher = { dispatch(request: WorkerDispatchRequest): Promise<unknown> }

function authority(input: {
  workspacePath: string
  documentRevision: string
  assetManifestRevision: string
}) {
  return buildSceneUiContentAuthoringAuthority({
    documentRevision: input.documentRevision,
    assetManifestRevision: input.assetManifestRevision,
    manifest: readBeeGameAssetManifestSync(input.workspacePath),
  })
}

export async function startGameContentStage(input: {
  run: DeliveryRun
  workspacePath: string
  dispatcher: Dispatcher
}): Promise<unknown> {
  if (input.run.phase !== 'GAME_CONTENT' || input.run.status !== 'running')
    throw new Error('game content is not the active phase')
  if (input.run.activeDispatch) return input.run.activeDispatch
  const assetManifestRevision = input.run.revision.resource
  if (!assetManifestRevision)
    throw new Error('game content requires an accepted Asset Manifest revision')
  const task = authority({
    workspacePath: input.workspacePath,
    documentRevision: input.run.revision.document,
    assetManifestRevision,
  })
  return input.dispatcher.dispatch({
    runId: input.run.runId,
    ownerId: input.run.ownerId,
    projectId: input.run.projectId,
    workspacePath: input.workspacePath,
    workerType: 'content-author',
    phase: 'GAME_CONTENT',
    revision: assetManifestRevision,
    allowedPaths: [...task.allowedPaths],
    contract: {
      ...task.contract,
      ...(input.run.blockedReason
        ? { currentContentIssues: [input.run.blockedReason] }
        : {}),
    },
  })
}

export function completeGameContentStage(input: {
  run: DeliveryRun
  workspacePath: string
  terminal: Extract<WorkerTerminalResult, { workerType: 'content-author' }>
}): DeliveryRun {
  if (input.run.phase !== 'GAME_CONTENT')
    throw new Error('game content is not the active phase')
  const assetManifestRevision = input.run.revision.resource
  if (!assetManifestRevision)
    throw new Error('game content requires an accepted Asset Manifest revision')
  try {
    const manifest = readBeeGameAssetManifestSync(input.workspacePath)
    const receipt = acceptBeeGameContentPackage(input.workspacePath, {
      documentRevision: input.run.revision.document,
      assetManifestRevision,
      manifest,
    })
    const run = { ...input.run, activeDispatch: undefined, gameContentReceipt: receipt }
    return transitionDeliveryRun(run, {
      type: 'game_content_ready',
      contentRevision: receipt.contentRevision,
      evidence: {
        path: receipt.indexPath,
        kind: 'game_content',
        revision: receipt.contentRevision,
        status: 'passed',
        observedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return transitionDeliveryRun(
      { ...input.run, activeDispatch: undefined },
      {
        type: 'game_content_needs_action',
        reason,
        evidence: {
          path: 'content/index.json',
          kind: 'game_content',
          revision: input.terminal.revision,
          status: 'failed',
          observedAt: new Date().toISOString(),
        },
      },
    )
  }
}
