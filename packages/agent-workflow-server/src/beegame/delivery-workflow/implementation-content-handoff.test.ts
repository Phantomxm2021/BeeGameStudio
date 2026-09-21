import { expect, test } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { createDeliveryWorkflowController } from './controller'
import { buildWorkerPrompt } from './worker-prompts'
import type { DeliveryWorkerPort, WorkerDispatchRequest } from './types'
import type { BeeGameAssetManifest } from '../asset-contracts'
import {
  buildSceneUiContentAuthoringAuthority, materializeSceneUiAuthoringContract,
  GAME_CONTENT_INSPECTION_COMMAND, GAME_CONTENT_VALIDATION_COMMAND,
} from '../scene-ui-content-authoring'

test('actual initial/repair/change dispatches carry the upstream format and optional inspection tools', async () => {
  for (const contract of [{}, { currentImplementationIssues: ['existing issue'] }, { changeRequest: 'Fix rendering' }]) {
    const workspacePath = await mkdtemp(join(tmpdir(), 'implementation-handoff-'))
    let captured: WorkerDispatchRequest | undefined
    const port: DeliveryWorkerPort = {
      async start(request) { captured = request; throw new Error('offline: inspected before model startup') },
      async submit() { throw new Error('No model invocation allowed') },
      async stop() {},
      async status() { throw new Error('No running worker') },
    }
    const controller = createDeliveryWorkflowController({ workspacePath, ownerId: 'owner', workerPort: port })
    try {
      const base = createTestDeliveryRun({ ownerId: 'owner', projectId: 'project', documentRevision: 'a'.repeat(64) })
      const run = { ...base, status: 'running' as const, phase: 'IMPLEMENTATION' as const,
        revision: { ...base.revision, resource: 'b'.repeat(64), content: 'c'.repeat(64) },
        gameContentReceipt: { schemaVersion: 'game-content-ready.v2' as const,
          contentRevision: 'c'.repeat(64), documentRevision: base.revision.document,
          assetManifestRevision: 'b'.repeat(64), indexPath: 'content/index.json' as const,
          contentIds: ['scene.main'] } }
      const authority = buildSceneUiContentAuthoringAuthority({
        documentRevision: run.revision.document, assetManifestRevision: run.revision.resource,
        manifest: {} as BeeGameAssetManifest,
      })
      const upstream = await materializeSceneUiAuthoringContract(workspacePath, authority)
      await controller.store.save(run)
      await expect(controller.dispatcher.dispatch({
        runId: run.runId, ownerId: run.ownerId, projectId: run.projectId,
        workspacePath, workerType: 'implementation-worker', phase: 'IMPLEMENTATION',
        revision: run.revision.workspace, allowedPaths: ['./'], protectedPaths: ['custom/'], contract,
      })).rejects.toThrow('offline: inspected')
      const content = captured!.contract.gameContent as Record<string, unknown>
      expect(content.authoringContractPath).toBe(upstream.authoringContractPath)
      expect(JSON.parse(await readFile(join(workspacePath, String(content.authoringContractPath)), 'utf8')))
        .toEqual(authority.contract.output.format)
      expect(content.validationCommand).toEqual(GAME_CONTENT_VALIDATION_COMMAND)
      expect(content.inspectionCommand).toEqual(GAME_CONTENT_INSPECTION_COMMAND)
      expect(content).not.toHaveProperty('format')
      expect(captured!.protectedPaths).toContain('docs/GDD.md')
      expect(captured!.protectedPaths).toContain('custom/')
      expect(buildWorkerPrompt(captured!)).toContain('Protected paths (read-only')
      if ('changeRequest' in contract) expect(captured!.contract.changeRequest).toBe(contract.changeRequest)
      if ('currentImplementationIssues' in contract)
        expect(captured!.contract.currentImplementationIssues).toContain('existing issue')
    } finally {
      await controller.dispose()
      await rm(workspacePath, { recursive: true, force: true })
    }
  }
})
