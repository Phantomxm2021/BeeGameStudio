import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { startNextImplementationTask } from './implementation-stage'
import { confirmAcceptanceFromImplementation, enterAcceptance } from './validation-stage'
import { buildWorkerPrompt } from './worker-prompts'

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

test('repair dispatch preserves the original error and diagnosis in any language', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-repair-dispatch-'))
  try {
    for (const changeRequest of ['SecurityError: localStorage is unavailable', '画面が表示されない', '버튼이 겹칩니다']) {
      const base = implementationRun()
      const run = { ...base, changeRequest, changeRationale: 'Prior diagnosis',
        revision: { ...base.revision, document: 'a'.repeat(64), resource: 'b'.repeat(64), content: 'c'.repeat(64) },
        gameContentReceipt: { schemaVersion: 'game-content-ready.v2' as const, contentRevision: 'c'.repeat(64),
          documentRevision: 'a'.repeat(64), assetManifestRevision: 'b'.repeat(64),
          indexPath: 'content/index.json' as const, contentIds: ['scene.main'] } }
      let prompt = ''
      await startNextImplementationTask({ run, workspacePath, revision: run.revision.workspace,
        dispatcher: { async dispatch(request) {
          expect(request.contract.changeRequest).toBe(changeRequest)
          expect(request.contract.changeRationale).toBe('Prior diagnosis')
          prompt = buildWorkerPrompt(request)
        } } })
      expect(prompt).toContain(changeRequest)
      expect(prompt).toContain('Address contract.changeRequest')
      expect(prompt).not.toContain('Complete contract.task within allowedPaths')
    }
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

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
    await writeFile(join(workspacePath, evidencePath), JSON.stringify({ summary: 'Ran the game', revision: workspaceRevision }))
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
    expect(accepted.evidence.acceptance?.status).toBe('ready')
    expect(accepted.evidence.acceptance?.path).toContain('acceptance-host-')
    const receipt = JSON.parse(await readFile(join(workspacePath, accepted.evidence.acceptance!.path), 'utf8'))
    expect(receipt.scope).toBe('artifact-handoff')
    expect(receipt.runtimeVerification).toBe('not-assessed-by-host')
    expect(receipt.note).not.toContain('Agent performed the runtime inspection')
    const { readRuntimeAcceptance, runtimeAcceptancePath } = await import('./runtime-acceptance')
    const observedPath = '.beegame/workflow/evidence/browser-observations.txt'
    await writeFile(join(workspacePath, observedPath), 'Observed title, start and pause in the target iframe.')
    const reportPath = join(workspacePath, runtimeAcceptancePath('test-dispatch'))
    for (const status of ['passed', 'failed', 'blocked'] as const) {
      await writeFile(reportPath, JSON.stringify({status,summary:'Actual observations',environment:'Web Preview iframe',evidencePaths:[observedPath]}))
      const runtimeAcceptance = await readRuntimeAcceptance(workspacePath,'test-dispatch')
      await writeFile(join(workspacePath,evidencePath),JSON.stringify({revision:workspaceRevision,runtimeAcceptance}))
      const result = await confirmAcceptanceFromImplementation({run:completed,workspacePath})
      expect(result.evidence.acceptance?.status).toBe(status)
      expect(result.phase).toBe(status === 'passed' ? 'DELIVERY' : 'ACCEPTANCE')
      if (status !== 'passed') expect(result.status).toBe('needs_action')
    }
    await writeFile(reportPath,JSON.stringify({status:'passed',summary:'Observed',environment:'Web Preview iframe',evidencePaths:[observedPath]}))
    await writeFile(join(workspacePath,evidencePath),JSON.stringify({revision:workspaceRevision,runtimeAcceptance:await readRuntimeAcceptance(workspacePath,'test-dispatch')}))
    await writeFile(join(workspacePath,observedPath),'Changed after the Agent turn')
    expect((await confirmAcceptanceFromImplementation({run:completed,workspacePath})).evidence.acceptance?.status).toBe('blocked')
    await writeFile(join(workspacePath, evidencePath), JSON.stringify({ revision: 'old-revision' }))
    await expect(confirmAcceptanceFromImplementation({ run: completed, workspacePath })).rejects.toThrow('different revision')
  } finally {
    await rm(workspacePath, { recursive: true, force: true })
  }
})
