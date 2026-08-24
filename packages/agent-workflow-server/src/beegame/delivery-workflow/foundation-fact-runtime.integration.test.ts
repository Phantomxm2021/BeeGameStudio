import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createDeliveryWorkflowController } from './controller'
import { createInitialDeliveryRun } from './run-store'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryWorkerPort } from './types'
import { createBeeGameDeliveryWorkerPort } from '../delivery-worker-session-port'
import { getGameDocumentContract } from './game-document-contracts'

function document(path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]): string {
  const contract = getGameDocumentContract(path)
  return `${[`# ${path}`, '', ...contract.sections.flatMap(section => [`<!-- beegame-section:${section.sectionId} -->`, `## ${section.title}`, '', 'unresolved prose', ''])].join('\n')}\n`
}

function port(started = new Set<string>()): DeliveryWorkerPort {
  return {
    async start(request) { started.add(request.dispatchId!); return { sessionId: request.dispatchId!, dispatchId: request.dispatchId! } },
    async submit() {},
    async stop() {},
    async close() {},
    async status(dispatchId) { return { dispatchId, workerType: 'foundation-fact-extractor', phase: 'DOCUMENT_REVIEW', taskId: 'unknown', revision: 'rev-1', status: started.has(dispatchId) ? 'running' : 'interrupted', startedAt: new Date().toISOString() } },
  }
}

describe('foundation fact runtime controller integration', () => {
  async function preparedController(workerPortFactory?: (started: Set<string>) => DeliveryWorkerPort, resumeImmediately = true) {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-fact-runtime-'))
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) await writeFile(join(workspacePath, path), document(path))
    const context = '{"game":"bee"}'
    const run = createInitialDeliveryRun({ projectId: 'project', ownerId: 'owner', confirmedBriefContext: context, confirmedBriefDigest: createHash('sha256').update(context).digest('hex'), documentRevision: 'rev-1', workspaceRevision: 'workspace-1' })
    const ready = { ...run, phase: 'DOCUMENT_DRAFTING' as const, documentStep: 'FOUNDATION_DRAFTING' as const, foundationDraftState: { completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS] }, revision: { ...run.revision, document: 'rev-1' } }
    const started = new Set<string>()
    const controller = createDeliveryWorkflowController({ workspacePath, ownerId: 'owner', workerPort: workerPortFactory ? workerPortFactory(started) : port(started) })
    await controller.store.save(ready)
    if (resumeImmediately) await controller.resume(ready)
    return { workspacePath, controller, started }
  }

  test('runs eight tasks in two four-way waves and commits only after facts_staged', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-fact-runtime-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      for (const path of CANONICAL_FOUNDATION_DOCUMENTS) await writeFile(join(workspacePath, path), document(path))
      const context = '{"game":"bee"}'
      const run = createInitialDeliveryRun({ projectId: 'project', ownerId: 'owner', confirmedBriefContext: context, confirmedBriefDigest: createHash('sha256').update(context).digest('hex'), documentRevision: 'rev-1', workspaceRevision: 'workspace-1' })
      const ready = { ...run, phase: 'DOCUMENT_DRAFTING' as const, documentStep: 'FOUNDATION_DRAFTING' as const, foundationDraftState: { completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS] }, revision: { ...run.revision, document: 'rev-1' } }
      const started = new Set<string>()
      const controller = createDeliveryWorkflowController({ workspacePath, ownerId: 'owner', workerPort: port(started) })
      await controller.store.save(ready)
      await controller.resume(ready)
      let current = await controller.store.load()
      expect(current?.foundationAuditState?.tasks).toHaveLength(8)
      expect(started.size).toBe(4)
      expect(current?.foundationAuditState?.tasks.filter(task => task.status === 'running')).toHaveLength(4)
      expect(current?.activeDispatch).toBeUndefined()
      async function complete(taskId: string) {
        const snapshot = await controller.store.load()
        const task = snapshot!.foundationAuditState!.tasks.find(candidate => candidate.taskId === taskId)!
        const packet = task.dispatch!.request!.contract.packet as { keys: string[] }
        await controller.store.addWorkflowUsage(snapshot!.runId, { input_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 3, total_tokens: 5 }, task.dispatch!.dispatchId)
        await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, { workerType: 'foundation-fact-extractor', status: 'completed', runId: snapshot!.runId, dispatchId: task.dispatch!.dispatchId, taskId, revision: task.revision, packetDigest: task.packetDigest, results: packet.keys.map(key => ({ key, status: 'absent' })) })
      }
      const firstWave = current!.foundationAuditState!.tasks.filter(task => task.status === 'running').map(task => task.taskId)
      await Promise.all(firstWave.map(complete))
      current = await controller.store.load()
      expect(current?.foundationAuditState?.tasks.filter(task => task.status === 'running')).toHaveLength(4)
      expect(current?.foundationAuditState?.tasks.filter(task => task.status === 'completed')).toHaveLength(4)
      const firstWaveFacts = current?.foundationAuditState?.tasks.filter(task => task.kind === 'document-facts' && task.status === 'completed') ?? []
      expect(firstWaveFacts).toHaveLength(4)
      expect(firstWaveFacts.every(task => task.usage?.total_tokens === 5)).toBe(true)
      const secondWave = current!.foundationAuditState!.tasks.filter(task => task.status === 'running').map(task => task.taskId)
      await Promise.all(secondWave.map(complete))
      current = await controller.store.load()
      expect(started.size).toBe(12)
      expect(current?.foundationAuditState?.status).toBe('semantic_review')
      expect(current?.status).toBe('running')
      expect(current?.foundationAuditState?.semantic?.aggregateUsage?.total_tokens).toBe(0)
      expect(current?.foundationAuditState?.tasks.some(task => task.kind === 'document-facts')).toBe(false)
      const deterministicBefore = current?.foundationAuditState?.deterministic
      expect(deterministicBefore?.reviewDigest).toMatch(/^[a-f0-9]{64}$/)
      const events = await controller.store.readEvents()
      expect(events.some(event => event.type === 'foundation.fact.facts_staged')).toBe(true)
      expect(events.some(event => event.type === 'foundation.fact.derived_committed')).toBe(true)
      expect(events.filter(event => event.type === 'foundation.audit.semantic_review')).toHaveLength(1)
      expect(events.some(event => event.type === 'foundation.audit.deterministic_ready.recovered')).toBe(false)
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
        workerType: 'foundation-fact-extractor', status: 'completed', runId: current!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId,
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
        workerType: 'foundation-fact-extractor', status: 'completed', runId: current!.runId, dispatchId: retried.dispatch!.dispatchId, taskId: retried.taskId,
        revision: retried.revision, packetDigest: retried.packetDigest,
        results: packet.keys.map(key => ({ key, status: 'absent' })),
      })
      const admitted = await controller.store.load()
      const completed = admitted!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(completed.status).toBe('completed')
      const receiptDigest = completed.receiptDigest
      const tampered = { ...completed.dispatch!, terminalResult: { ...completed.dispatch!.terminalResult, results: [] } }
      await controller.store.commit({
        ...admitted!,
        foundationAuditState: {
          ...admitted!.foundationAuditState!,
          tasks: admitted!.foundationAuditState!.tasks.map(candidate => candidate.taskId === task.taskId ? { ...candidate, dispatch: tampered } : candidate),
        },
      }, { runId: admitted!.runId, type: 'test.tampered.replay', phase: admitted!.phase, status: admitted!.status, revision: admitted!.revision })
      await expect(controller.dispatcher.replayTerminal(tampered)).rejects.toThrow(/digest|replay|terminal/i)
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

  test('retains two terminals that enter from the same stale snapshot', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const originalLoad = controller.store.load.bind(controller.store)
      let barrierCount = 0
      let releaseBarrier!: () => void
      const barrier = new Promise<void>(resolve => { releaseBarrier = resolve })
      controller.store.load = async (...args) => {
        const snapshot = await originalLoad(...args)
        if (barrierCount < 2) {
          barrierCount += 1
          if (barrierCount === 2) releaseBarrier()
          await barrier
        }
        return snapshot
      }
      const current = await originalLoad()
      const tasks = current!.foundationAuditState!.tasks.filter(task => task.status === 'running').slice(0, 2)
      const complete = async (task: (typeof tasks)[number]) => {
        const packet = task.dispatch!.request!.contract.packet as { keys: string[] }
        await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, {
          workerType: 'foundation-fact-extractor', status: 'completed', runId: current!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId,
          revision: task.revision, packetDigest: task.packetDigest,
          results: packet.keys.map(key => ({ key, status: 'absent' })),
        })
      }
      await Promise.all([complete(tasks[0]!), complete(tasks[1]!)])
      const after = await originalLoad()
      expect(after!.foundationAuditState!.tasks.filter(task => task.status === 'completed')).toHaveLength(2)
      expect(after!.foundationAuditState!.tasks.filter(task => task.receiptPath && task.receiptDigest)).toHaveLength(2)
      expect(after!.foundationAuditState!.tasks.filter(task => task.usage)).toHaveLength(2)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('does not dispatch a new wave after the extraction phase deadline', async () => {
    const { workspacePath, controller, started } = await preparedController()
    try {
      const current = await controller.store.load()
      await controller.store.reconcile(async () => false)
      const recovered = await controller.store.load()
      await controller.store.commit({
        ...recovered!,
        foundationAuditState: { ...recovered!.foundationAuditState!, phaseStartedAt: '2026-08-23T00:00:00.000Z' },
      }, { runId: current!.runId, type: 'test.phase.expired', phase: recovered!.phase, status: recovered!.status, revision: recovered!.revision })
      const before = started.size
      await expect(controller.resume(await controller.store.load() as never)).rejects.toThrow(/deadline|claim/i)
      expect(started.size).toBe(before)
      expect((await controller.store.load())!.foundationAuditState!.tasks.every(task => task.status === 'needs_action')).toBe(true)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('does not retry a task whose measured output exceeds the cap', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const current = await controller.store.load()
      const task = current!.foundationAuditState!.tasks.find(candidate => candidate.status === 'running')!
      await controller.store.addWorkflowUsage(current!.runId, { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 513, total_tokens: 514 }, task.dispatch!.dispatchId)
      const packet = task.dispatch!.request!.contract.packet as { keys: string[] }
      await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, {
        workerType: 'foundation-fact-extractor', status: 'completed', runId: current!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId,
        revision: task.revision, packetDigest: task.packetDigest,
        results: packet.keys.map(key => ({ key, status: 'absent' })),
      })
      const after = await controller.store.load()
      expect(after!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!.status).toBe('needs_action')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('does not dispatch after the aggregate model cap is reached', async () => {
    const { workspacePath, controller, started } = await preparedController()
    try {
      const current = await controller.store.load()
      await controller.store.commit({
        ...current!,
        foundationAuditState: {
          ...current!.foundationAuditState!,
          aggregateUsage: { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 32000, total_tokens: 32000 },
          tasks: current!.foundationAuditState!.tasks.map(task => ({ ...task, status: task.status === 'running' ? 'retryable' as const : task.status, dispatch: undefined })),
        },
      }, { runId: current!.runId, type: 'test.aggregate.cap', phase: current!.phase, status: current!.status, revision: current!.revision })
      const before = started.size
      await expect(controller.resume(await controller.store.load() as never)).rejects.toThrow(/aggregate|cap|claim/i)
      const after = await controller.store.load()
      expect(started.size).toBe(before)
      expect(after!.foundationAuditState!.tasks.filter(task => task.status === 'pending' || task.status === 'retryable')).toHaveLength(0)
      expect(after!.foundationAuditState!.tasks.every(task => task.status === 'needs_action')).toBe(true)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  async function finishFacts(controller: ReturnType<typeof createDeliveryWorkflowController>) {
    while (true) {
      const current = await controller.store.load()
      const running = current?.foundationAuditState?.tasks.filter(task => task.kind === 'document-facts' && task.status === 'running') ?? []
      if (!running.length) return current!
      await Promise.all(running.map(async task => {
        const snapshot = await controller.store.load()
        const packet = task.dispatch!.request!.contract.packet as { keys: string[] }
        await controller.store.addWorkflowUsage(snapshot!.runId, { input_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 3, total_tokens: 5 }, task.dispatch!.dispatchId)
        await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, {
          workerType: 'foundation-fact-extractor', status: 'completed', runId: snapshot!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId,
          revision: task.revision, packetDigest: task.packetDigest, results: packet.keys.map(key => ({ key, status: 'absent' })),
        })
      }))
    }
  }

  async function completeSemantic(controller: ReturnType<typeof createDeliveryWorkflowController>, taskId: string, outcome: 'PASS' | 'UNDECIDABLE') {
    const snapshot = await controller.store.load()
    const task = snapshot!.foundationAuditState!.tasks.find(candidate => candidate.taskId === taskId)!
    const dispatchId = task.dispatch!.dispatchId
    await controller.store.addWorkflowUsage(snapshot!.runId, { input_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 3, total_tokens: 5 }, dispatchId)
    await controller.dispatcher.completeDispatch(dispatchId, {
      workerType: 'foundation-semantic-reviewer', status: 'completed', runId: snapshot!.runId, dispatchId, taskId,
      revision: task.revision, packetDigest: task.packetDigest, outcome, ...(outcome === 'UNDECIDABLE' ? { reason: 'insufficient evidence' } : {}),
    })
  }

  test('completes all ten semantic PASS checks into one atomic review and audit_ready', async () => {
    const { workspacePath, controller, started } = await preparedController()
    try {
      await finishFacts(controller)
      let current = await controller.store.load()
      expect(current?.foundationAuditState?.status).toBe('semantic_review')
      while (current?.foundationAuditState?.status === 'semantic_review') {
        const running = current.foundationAuditState.tasks.filter(task => (task.kind === 'semantic' || task.kind === 'confirmation') && task.status === 'running')
        expect(running.length).toBeGreaterThan(0)
        await Promise.all(running.map(task => completeSemantic(controller, task.taskId, 'PASS')))
        current = await controller.store.load()
      }
      expect(current?.foundationAuditState?.status).toBe('audit_ready')
      expect(current?.foundationAuditState?.tasks.filter(task => task.kind === 'semantic')).toHaveLength(10)
      expect(current?.foundationAuditState?.tasks.filter(task => task.kind === 'semantic' && task.status === 'completed' && task.admittedResult?.outcome === 'PASS')).toHaveLength(10)
      const review = current!.foundationAuditState!.review!
      const marker = JSON.parse(await readFile(join(workspacePath, review.markerPath), 'utf8')) as Record<string, unknown>
      expect(marker.status).toBe('committed')
      expect(marker.reviewDigest).toBe(review.reviewDigest)
      expect(await readFile(join(workspacePath, review.issueRegistryPath), 'utf8')).toContain('issues')
      const dispatched = started.size
      await controller.resume(current!)
      expect(started.size).toBe(dispatched)
      expect((await controller.store.load())!.foundationAuditState!.status).toBe('audit_ready')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('rebuilds the same semantic packet after interruption without duplicate resume dispatches', async () => {
    const { workspacePath, controller, started } = await preparedController()
    try {
      await finishFacts(controller)
      const before = started.size
      const interrupted = await controller.store.reconcile(async () => false)
      expect(interrupted!.foundationAuditState!.tasks.filter(task => (task.kind === 'semantic' || task.kind === 'confirmation') && task.status === 'retryable')).toHaveLength(4)
      await controller.resume(interrupted!)
      const after = started.size
      expect(after - before).toBe(4)
      await controller.resume(await controller.store.load() as never)
      expect(started.size).toBe(after)
      const resumed = await controller.store.load()
      expect(resumed!.foundationAuditState!.tasks.filter(task => task.kind === 'semantic' && task.status === 'running')).toHaveLength(4)
      expect(resumed!.foundationAuditState!.tasks.filter(task => task.kind === 'semantic' && task.status === 'running' && task.attempt === 2)).toHaveLength(4)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('requires same-packet strong confirmation and stops on a second UNDECIDABLE', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      await finishFacts(controller)
      let current = await controller.store.load()
      const source = current!.foundationAuditState!.tasks.find(task => task.kind === 'semantic' && task.status === 'running')!
      if (source.kind !== 'semantic') throw new Error('semantic source task was not found')
      await completeSemantic(controller, source.taskId, 'UNDECIDABLE')
      current = await controller.store.load()
      let confirmation = current!.foundationAuditState!.tasks.find(task => task.kind === 'confirmation' && task.sourceTaskId === source.taskId)
      while (confirmation?.status !== 'running') {
        const runningSources = current!.foundationAuditState!.tasks.filter(task => task.kind === 'semantic' && task.status === 'running')
        if (runningSources.length) await Promise.all(runningSources.map(task => completeSemantic(controller, task.taskId, 'PASS')))
        else await controller.resume(current!)
        current = await controller.store.load()
        confirmation = current!.foundationAuditState!.tasks.find(task => task.kind === 'confirmation' && task.sourceTaskId === source.taskId)
      }
      if (!confirmation || confirmation.kind !== 'confirmation') throw new Error('confirmation task was not dispatched')
      expect(confirmation.packetDigest).toBe(source.packetDigest)
      expect(confirmation.checkId).toBe(source.checkId)
      expect(confirmation.modelTier).toBe('strong')
      expect(confirmation.status).toBe('running')
      await completeSemantic(controller, confirmation.taskId, 'UNDECIDABLE')
      current = await controller.store.load()
      expect(current!.status).toBe('needs_action')
      expect(current!.foundationAuditState!.status).toBe('semantic_review')
      const confirmedTask = current!.foundationAuditState!.tasks.find(task => task.taskId === confirmation.taskId)
      if (!confirmedTask || confirmedTask.kind !== 'confirmation') throw new Error('confirmation result task was not retained')
      expect(confirmedTask.admittedResult?.outcome).toBe('UNDECIDABLE')
      expect(current!.foundationAuditState!.review).toBeUndefined()
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('fails closed once when the production port has no fast model and never starts or retries a worker', async () => {
    let startCalls = 0
    const { workspacePath, controller, started } = await preparedController(() => createBeeGameDeliveryWorkerPort({
      sessions: {
        start() { startCalls += 1; throw new Error('worker start must not be reached') },
      } as never,
      userId: 'owner',
    }), false)
    try {
      await expect(controller.resume(await controller.store.load() as never)).rejects.toThrow(/fast model|configured/i)
      const after = await controller.store.load()
      expect(startCalls).toBe(0)
      expect(started.size).toBe(0)
      expect(after!.foundationAuditState!.tasks.every(task => task.status === 'needs_action' && task.attempt === 0)).toBe(true)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })
})
