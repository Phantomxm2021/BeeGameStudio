import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { startNextImplementationTask } from './implementation-stage'
import { confirmAcceptanceFromImplementation, enterAcceptance } from './validation-stage'

function implementationRun() {
  const base = createTestDeliveryRun({ ownerId: 'owner', projectId: 'project' })
  return {
    ...base,
    phase: 'IMPLEMENTATION' as const,
    tasks: [{
      id: 'DIRECT_IMPLEMENTATION', title: 'Implement', checklistIds: [],
      resourceIds: [], contentIds: ['scene.main'], allowedPaths: ['./'],
      status: 'pending' as const, attempt: 0, evidenceRefs: [],
    }],
  }
}

test('implementation cannot bypass the accepted Scene/UI package', async () => {
  const run = implementationRun()
  await expect(startNextImplementationTask({
    run,
    workspacePath: '/unused',
    revision: run.revision.workspace,
    dispatcher: { async dispatch() { throw new Error('must not dispatch') } },
  })).rejects.toThrow('exact accepted Scene/UI content package')
})

test('acceptance cannot bypass the accepted Scene/UI package', () => {
  const run = implementationRun()
  const completed = {
    ...run,
    tasks: run.tasks.map(task => ({
      ...task,
      status: 'completed' as const,
      completedRevision: run.revision.workspace,
      evidenceRefs: ['evidence.json'],
    })),
  }
  expect(() => enterAcceptance(completed)).toThrow('accepted Scene/UI content package')
})

test('host acceptance confirms current implementation evidence without dispatching another Agent', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-host-acceptance-'))
  try {
    const base = createTestDeliveryRun({ ownerId: 'owner', projectId: 'project' })
    const documentRevision = 'a'.repeat(64)
    const assetManifestRevision = 'b'.repeat(64)
    const contentRevision = 'c'.repeat(64)
    const workspaceRevision = 'd'.repeat(64)
    await mkdir(join(workspacePath, '.beegame/workflow/evidence'), { recursive: true })
    const evidencePath = '.beegame/workflow/evidence/implementation.json'
    await writeFile(join(workspacePath, evidencePath), '{"summary":"Ran the game"}\n')
    const completed = {
      ...base,
      phase: 'ACCEPTANCE' as const,
      revision: {
        document: documentRevision,
        resource: assetManifestRevision,
        content: contentRevision,
        implementation: workspaceRevision,
        workspace: workspaceRevision,
      },
      gameContentReceipt: {
        schemaVersion: 'game-content-ready.v2' as const,
        contentRevision,
        documentRevision,
        assetManifestRevision,
        indexPath: 'content/index.json' as const,
        contentIds: ['scene.main'],
      },
      tasks: [{
        id: 'DIRECT_IMPLEMENTATION', title: 'Implement', checklistIds: [],
        resourceIds: [], contentIds: ['scene.main'], allowedPaths: ['./'],
        status: 'completed' as const, attempt: 1,
        completedRevision: workspaceRevision, evidenceRefs: [evidencePath],
      }],
    }
    const accepted = await confirmAcceptanceFromImplementation({
      run: completed,
      workspacePath,
    })
    expect(accepted.phase).toBe('DELIVERY')
    expect(accepted.evidence.acceptance?.path).toContain('acceptance-host-')
  } finally {
    await rm(workspacePath, { recursive: true, force: true })
  }
})
