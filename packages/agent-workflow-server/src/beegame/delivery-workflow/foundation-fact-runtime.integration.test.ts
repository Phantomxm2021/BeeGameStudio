import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createDeliveryWorkflowController } from './controller'
import { createInitialDeliveryRun } from './run-store'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryWorkerPort } from './types'
import { getGameDocumentContract } from './game-document-contracts'

function document(path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]): string {
  const contract = getGameDocumentContract(path)
  return `${[`# ${path}`, '', ...contract.sections.flatMap(section => [`<!-- beegame-section:${section.sectionId} -->`, `## ${section.title}`, '', 'unresolved prose', ''])].join('\n')}\n`
}

function port(): DeliveryWorkerPort {
  const started = new Set<string>()
  return {
    async start(request) { started.add(request.dispatchId!); return { sessionId: request.dispatchId!, dispatchId: request.dispatchId! } },
    async submit() {},
    async stop() {},
    async close() {},
    async status(dispatchId) { return { dispatchId, workerType: 'foundation-fact-extractor', phase: 'DOCUMENT_REVIEW', taskId: 'unknown', revision: 'rev-1', status: started.has(dispatchId) ? 'running' : 'interrupted', startedAt: new Date().toISOString() } },
  }
}

describe('foundation fact runtime controller integration', () => {
  async function preparedController() {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-fact-runtime-'))
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) await writeFile(join(workspacePath, path), document(path))
    const context = '{"game":"bee"}'
    const run = createInitialDeliveryRun({ projectId: 'project', ownerId: 'owner', confirmedBriefContext: context, confirmedBriefDigest: createHash('sha256').update(context).digest('hex'), documentRevision: 'rev-1', workspaceRevision: 'workspace-1' })
    const ready = { ...run, phase: 'DOCUMENT_DRAFTING' as const, documentStep: 'FOUNDATION_DRAFTING' as const, foundationDraftState: { completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS] }, revision: { ...run.revision, document: 'rev-1' } }
    const controller = createDeliveryWorkflowController({ workspacePath, ownerId: 'owner', workerPort: port() })
    await controller.store.save(ready)
    await controller.resume(ready)
    return { workspacePath, controller }
  }

  test('runs eight tasks in two four-way waves and commits only after facts_staged', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-fact-runtime-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      for (const path of CANONICAL_FOUNDATION_DOCUMENTS) await writeFile(join(workspacePath, path), document(path))
      const context = '{"game":"bee"}'
      const run = createInitialDeliveryRun({ projectId: 'project', ownerId: 'owner', confirmedBriefContext: context, confirmedBriefDigest: createHash('sha256').update(context).digest('hex'), documentRevision: 'rev-1', workspaceRevision: 'workspace-1' })
      const ready = { ...run, phase: 'DOCUMENT_DRAFTING' as const, documentStep: 'FOUNDATION_DRAFTING' as const, foundationDraftState: { completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS] }, revision: { ...run.revision, document: 'rev-1' } }
      const controller = createDeliveryWorkflowController({ workspacePath, ownerId: 'owner', workerPort: port() })
      await controller.store.save(ready)
      await controller.resume(ready)
      let current = await controller.store.load()
      expect(current?.foundationAuditState?.tasks).toHaveLength(8)
      expect(current?.foundationAuditState?.tasks.filter(task => task.status === 'running')).toHaveLength(4)
      expect(current?.activeDispatch).toBeUndefined()
      async function complete(taskId: string) {
        const snapshot = await controller.store.load()
        const task = snapshot!.foundationAuditState!.tasks.find(candidate => candidate.taskId === taskId)!
        const packet = task.dispatch!.request!.contract.packet as { keys: string[] }
        await controller.store.addWorkflowUsage(snapshot!.runId, { input_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 3, total_tokens: 5 }, task.dispatch!.dispatchId)
        await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, { workerType: 'foundation-fact-extractor', status: 'completed', taskId, revision: task.revision, packetDigest: task.packetDigest, results: packet.keys.map(key => ({ key, status: 'absent' })) })
      }
      const firstWave = current!.foundationAuditState!.tasks.filter(task => task.status === 'running').map(task => task.taskId)
      await Promise.all(firstWave.map(complete))
      current = await controller.store.load()
      expect(current?.foundationAuditState?.tasks.filter(task => task.status === 'running')).toHaveLength(4)
      expect(current?.foundationAuditState?.tasks.filter(task => task.status === 'completed')).toHaveLength(4)
      const secondWave = current!.foundationAuditState!.tasks.filter(task => task.status === 'running').map(task => task.taskId)
      await Promise.all(secondWave.map(complete))
      current = await controller.store.load()
      expect(current?.foundationAuditState?.status).toBe('derived_committed')
      expect(current?.status).toBe('needs_action')
      expect(current?.foundationAuditState?.aggregateUsage?.total_tokens).toBe(40)
      expect(current?.foundationAuditState?.tasks.every(task => task.usage?.total_tokens === 5)).toBe(true)
      const events = await controller.store.readEvents()
      expect(events.some(event => event.type === 'foundation.fact.facts_staged')).toBe(true)
      expect(events.some(event => event.type === 'foundation.fact.derived_committed')).toBe(true)
      const marker = JSON.parse(await readFile(join(workspacePath, '.beegame/audit/foundation/rev-1/derived/COMMITTED.json'), 'utf8')) as Record<string, unknown>
      expect(marker.status).toBe('committed')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('keeps invalid results retryable and replays an admitted terminal idempotently', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      let current = await controller.store.load()
      const task = current!.foundationAuditState!.tasks.find(candidate => candidate.status === 'running')!
      await expect(controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, {
        workerType: 'foundation-fact-extractor', status: 'completed', taskId: task.taskId,
        revision: task.revision, packetDigest: task.packetDigest,
        results: [{ key: 'not-in-packet', status: 'absent' }],
      })).rejects.toThrow()
      current = await controller.store.load()
      const retryable = current!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(retryable.status).toBe('retryable')
      expect(retryable.status).not.toBe('completed')
      await controller.resume(current!)
      current = await controller.store.load()
      const retried = current!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      const packet = retried.dispatch!.request!.contract.packet as { keys: string[] }
      await controller.dispatcher.completeDispatch(retried.dispatch!.dispatchId, {
        workerType: 'foundation-fact-extractor', status: 'completed', taskId: retried.taskId,
        revision: retried.revision, packetDigest: retried.packetDigest,
        results: packet.keys.map(key => ({ key, status: 'absent' })),
      })
      const admitted = await controller.store.load()
      const completed = admitted!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(completed.status).toBe('completed')
      const receiptDigest = completed.receiptDigest
      await controller.dispatcher.replayTerminal(completed.dispatch!)
      const replayed = await controller.store.load()
      expect(replayed!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!.receiptDigest).toBe(receiptDigest)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('production recovery scans every running fact task and preserves ordinary dispatch authority', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      let current = await controller.store.load()
      const ordinary = {
        dispatchId: 'ordinary-dispatch', workerType: 'resource-planner' as const, phase: 'DOCUMENT_REVIEW' as const,
        revision: current!.revision.workspace, status: 'running' as const, startedAt: new Date().toISOString(),
      }
      await controller.store.commit({ ...current!, activeDispatch: ordinary }, { runId: current!.runId, type: 'test.ordinary.active', phase: current!.phase, status: current!.status, revision: current!.revision })
      const recovered = await controller.store.reconcile(async () => false)
      expect(recovered!.activeDispatch?.dispatchId).toBe('ordinary-dispatch')
      expect(recovered!.foundationAuditState!.tasks.filter(task => task.status === 'retryable')).toHaveLength(4)
      expect(recovered!.foundationAuditState!.tasks.filter(task => task.status === 'running')).toHaveLength(0)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })
})
