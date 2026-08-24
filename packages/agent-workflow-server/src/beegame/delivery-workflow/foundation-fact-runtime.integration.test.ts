import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createDeliveryWorkflowController } from './controller'
import { createInitialDeliveryRun } from './run-store'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun, type DeliveryWorkerPort, type FoundationRevisionDocumentTask, type WorkerDispatchRequest } from './types'
import { createBeeGameDeliveryWorkerPort } from '../delivery-worker-session-port'
import { getGameDocumentContract } from './game-document-contracts'
import { loadFoundationSemanticReview } from './foundation-audit-artifacts'
import { FOUNDATION_FACT_CATALOG, foundationFactDefinition } from './foundation-fact-definitions'
import type { FactValue } from './foundation-fact-store'
import type { AuditIssue } from './foundation-issue-registry'
import { foundationRevisionPacketPath, foundationRevisionStagePath, loadFoundationRevisionPacket, revisionTaskReceiptTerminalDigest } from './foundation-revision-stage'
import { digestFoundationFactTerminal } from './foundation-fact-runtime'

function document(path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]): string {
  const contract = getGameDocumentContract(path)
  return `${[`# ${path}`, '', ...contract.sections.flatMap(section => [`<!-- beegame-section:${section.sectionId} -->`, `## ${section.title}`, '', 'unresolved prose', ''])].join('\n')}\n`
}

function port(started = new Set<string>(), requests: WorkerDispatchRequest[] = []): DeliveryWorkerPort {
  return {
    async start(request) { started.add(request.dispatchId!); requests.push(request); return { sessionId: request.dispatchId!, dispatchId: request.dispatchId! } },
    async submit() {},
    async stop() {},
    async close() {},
    async status(dispatchId) { return { dispatchId, workerType: 'foundation-fact-extractor', phase: 'DOCUMENT_REVIEW', taskId: 'unknown', revision: 'rev-1', status: started.has(dispatchId) ? 'running' : 'interrupted', startedAt: new Date().toISOString() } },
  }
}

function consistentFactValue(key: string): FactValue {
  const values: Record<string, FactValue> = {
    'game.mechanics': ['move'],
    'technical.supported_actions': ['move'],
    'game.boss.count': 1,
    'asset.boss.count': 1,
    'game.resources': ['energy'],
    'ui.displayed_resources': ['energy'],
    'level.required_assets': ['asset'],
    'asset.inventory_ids': ['asset'],
    'art.style_constraints': ['style'],
    'asset.art_constraint_refs': ['style'],
  }
  const explicit = values[key]
  if (explicit !== undefined) return explicit
  const definition = foundationFactDefinition(key)
  if (!definition) throw new Error(`unknown fact key ${key}`)
  if (definition.valueType === 'number') return definition.valueSpec.min ?? 1
  if (definition.valueType === 'string') return definition.valueSpec.enum?.[0] ?? 'fixture'
  return definition.valueType === 'number[]' ? [1] : ['fixture']
}

async function presentFactResults(workspacePath: string, packet: { keys: string[]; sections?: Array<{ documentPath: string; sectionId: string; startLine: number; endLine: number }> }) {
  if (!packet.sections) throw new Error('fact packet sections are required for present result evidence')
  const documents = new Map<string, string>()
  for (const section of packet.sections) {
    if (!documents.has(section.documentPath)) documents.set(section.documentPath, await readFile(join(workspacePath, section.documentPath), 'utf8'))
  }
  return packet.keys.map(key => {
    const owner = foundationFactDefinition(key)!.owner
    const section = packet.sections!.find(candidate => candidate.documentPath === owner.documentPath && candidate.sectionId === owner.sectionId)
    if (!section) throw new Error(`missing packet owner section for ${key}`)
    const line = documents.get(section.documentPath)!.split('\n')[section.startLine - 1]!
    return {
      key,
      status: 'present' as const,
      value: consistentFactValue(key),
      evidence: { documentPath: section.documentPath, sectionId: section.sectionId, startLine: section.startLine, endLine: section.startLine, digest: createHash('sha256').update(line).digest('hex') },
    }
  })
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
    const requests: WorkerDispatchRequest[] = []
    const controller = createDeliveryWorkflowController({ workspacePath, ownerId: 'owner', workerPort: workerPortFactory ? workerPortFactory(started) : port(started, requests) })
    await controller.store.save(ready)
    if (resumeImmediately) await controller.resume(ready)
    return { workspacePath, controller, started, requests }
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
      expect(events.filter(event => event.type === 'foundation.audit.deterministic_ready')).toHaveLength(1)
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
        results: await presentFactResults(workspacePath, packet),
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

  async function finishFacts(controller: ReturnType<typeof createDeliveryWorkflowController>, valueForKey?: (key: string) => FactValue | undefined) {
    while (true) {
      const current = await controller.store.load()
      const running = current?.foundationAuditState?.tasks.filter(task => task.kind === 'document-facts' && task.status === 'running') ?? []
      if (!running.length) return current!
      await Promise.all(running.map(async task => {
        const snapshot = await controller.store.load()
        const packet = task.dispatch!.request!.contract.packet as { keys: string[]; sections: Array<{ documentPath: string; sectionId: string; startLine: number; endLine: number; text: string }> }
        await controller.store.addWorkflowUsage(snapshot!.runId, { input_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 3, total_tokens: 5 }, task.dispatch!.dispatchId)
        await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, {
          workerType: 'foundation-fact-extractor', status: 'completed', runId: snapshot!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId,
          revision: task.revision, packetDigest: task.packetDigest, results: packet.keys.map(key => {
            const value = valueForKey?.(key)
            if (value === undefined) return { key, status: 'absent' as const }
            const definition = foundationFactDefinition(key)
            const section = packet.sections.find(candidate => candidate.documentPath === definition?.owner.documentPath && candidate.sectionId === definition.owner.sectionId)
            if (!definition || !section) throw new Error(`fact evidence section is missing for ${key}`)
            return {
              key,
              status: 'present' as const,
              value,
              evidence: {
                documentPath: section.documentPath,
                sectionId: section.sectionId,
                startLine: section.startLine,
                endLine: section.endLine,
                digest: createHash('sha256').update(section.text).digest('hex'),
              },
            }
          }),
        })
      }))
    }
  }

  async function completeSemantic(controller: ReturnType<typeof createDeliveryWorkflowController>, taskId: string, outcome: 'PASS' | 'ISSUES' | 'UNDECIDABLE', issueSectionKey?: string) {
    const snapshot = await controller.store.load()
    const task = snapshot!.foundationAuditState!.tasks.find(candidate => candidate.taskId === taskId)!
    const dispatchId = task.dispatch!.dispatchId
    const packet = task.dispatch!.request!.contract.packet as { sections: Array<{ sectionKey: string }> }
    const sectionKey = issueSectionKey ?? packet.sections[0]!.sectionKey
    await controller.store.addWorkflowUsage(snapshot!.runId, { input_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 3, total_tokens: 5 }, dispatchId)
    await controller.dispatcher.completeDispatch(dispatchId, {
      workerType: 'foundation-semantic-reviewer', status: 'completed', runId: snapshot!.runId, dispatchId, taskId,
      revision: task.revision, packetDigest: task.packetDigest, outcome,
      ...(outcome === 'UNDECIDABLE' ? { reason: 'insufficient evidence' } : {}),
      ...(outcome === 'ISSUES' ? { issues: [{ problem: 'encounter has no readable counterplay', expected: 'counterplay is explicit', actual: 'counterplay is absent', sourceSectionKey: sectionKey, fixSectionKey: sectionKey }] } : {}),
    })
  }

  async function driveToRevisionIssue(controller: ReturnType<typeof createDeliveryWorkflowController>) {
    await finishFacts(controller, consistentFactValue)
    let current = await controller.store.load()
    let issued = false
    while (current?.foundationAuditState?.status === 'semantic_review') {
      const running = current.foundationAuditState.tasks.filter(task => task.kind === 'semantic' && task.status === 'running')
      if (!running.length) { await controller.resume(current); current = await controller.store.load(); continue }
      await Promise.all(running.map(task => {
        const outcome = issued ? 'PASS' as const : 'ISSUES' as const
        issued = true
        return completeSemantic(controller, task.taskId, outcome)
      }))
      current = await controller.store.load()
    }
    return current!
  }

  async function driveToFactOwnerRevisionIssue(controller: ReturnType<typeof createDeliveryWorkflowController>) {
    await finishFacts(controller, consistentFactValue)
    const targetFact = FOUNDATION_FACT_CATALOG.find(fact => fact.key === 'game.boss.count')!
    const documentIdByPath: Record<string, string> = {
      'docs/GDD.md': 'GDD',
      'docs/LEVEL_SCENE_DESIGN.md': 'LEVEL',
      'docs/BALANCE_DESIGN.md': 'BALANCE',
      'docs/TECHNICAL_DESIGN.md': 'TECHNICAL',
      'docs/ART_DIRECTION.md': 'ART',
      'docs/UI_UX_SPEC.md': 'UI',
      'docs/AUDIO_DESIGN.md': 'AUDIO',
      'docs/ASSET_PLAN.md': 'ASSET',
    }
    let current = await controller.store.load()
    let issued = false
    while (current?.foundationAuditState?.status === 'semantic_review') {
      const running = current.foundationAuditState.tasks.filter(task => task.kind === 'semantic' && task.status === 'running')
      if (!running.length) { await controller.resume(current); current = await controller.store.load(); continue }
      await Promise.all(running.map(async task => {
        const packet = task.dispatch!.request!.contract.packet as { sections: Array<{ sectionKey: string }> }
        const targetSection = packet.sections.find(section => {
          return `${documentIdByPath[targetFact.owner.documentPath]}#${targetFact.owner.sectionId}` === section.sectionKey
        })
        const issue = !issued && targetSection !== undefined
        if (issue) issued = true
        await completeSemantic(controller, task.taskId, issue ? 'ISSUES' : 'PASS', targetSection?.sectionKey)
      }))
      current = await controller.store.load()
    }
    if (!issued) throw new Error('semantic packet did not contain the game.boss.count owner section')
    return { run: current!, targetFact }
  }

  function ownerFactText(factKey: string, override?: FactValue): string {
    const target = FOUNDATION_FACT_CATALOG.find(fact => fact.key === factKey)!
    const ownerFacts = FOUNDATION_FACT_CATALOG.filter(fact => fact.owner.documentPath === target.owner.documentPath && fact.owner.sectionId === target.owner.sectionId)
    if (!ownerFacts.length) throw new Error(`fact owner has no catalog keys: ${factKey}`)
    return ownerFacts.map(fact => `${fact.key}: ${JSON.stringify(fact.key === factKey && override !== undefined ? override : consistentFactValue(fact.key))}`).join('\n')
  }

  async function makeRevisionTerminal(workspacePath: string, run: DeliveryRun, task: FoundationRevisionDocumentTask, replacement = 'revised prose') {
    const request = task.dispatch!.request!
    const packet = await loadFoundationRevisionPacket({ workspacePath, revision: task.revision, round: task.round, taskId: task.taskId, documentPath: task.documentPath, packetDigest: task.packetDigest }) as { sections: Array<{ sectionId: string; startLine: number; endLine: number; text: string }> }
    const section = packet.sections.find(candidate => candidate.sectionId === task.sectionIds[0])!
    const stageAbsolute = join(workspacePath, task.stagedPath)
    const stagedLines = (await readFile(stageAbsolute, 'utf8')).split('\n')
    stagedLines.splice(section.startLine - 1, section.endLine - section.startLine, ...section.text.replace('unresolved prose', replacement).split('\n'))
    await writeFile(stageAbsolute, stagedLines.join('\n'))
    const stagedBytes = await readFile(stageAbsolute)
    const receiptWithoutTerminal = { taskId: task.taskId, round: task.round, documentPath: task.documentPath, issueIds: [...task.issueIds], baseDocumentDigest: task.baseDocumentDigest, stagedDocumentDigest: createHash('sha256').update(stagedBytes).digest('hex'), changedSectionIds: [task.sectionIds[0]!], stagedPath: task.stagedPath }
    return { workerType: 'foundation-document-reviser' as const, status: 'completed' as const, runId: run!.runId, dispatchId: request.dispatchId!, taskId: task.taskId, revision: task.revision, packetDigest: task.packetDigest, round: task.round, documentPath: task.documentPath, receipt: { ...receiptWithoutTerminal, terminalDigest: revisionTaskReceiptTerminalDigest(receiptWithoutTerminal) } }
  }

  async function completeFactOwnerRevision(controller: ReturnType<typeof createDeliveryWorkflowController>, workspacePath: string, replacement = 'revised prose') {
    const { run: current, targetFact } = await driveToFactOwnerRevisionIssue(controller)
    const documentTask = current.foundationRevisionState!.tasks.find(task => task.kind === 'document-revision')! as FoundationRevisionDocumentTask
    expect(documentTask.documentPath).toBe(targetFact.owner.documentPath)
    expect(documentTask.sectionIds).toContain(targetFact.owner.sectionId)
    const terminal = await makeRevisionTerminal(workspacePath, current, documentTask, replacement)
    await controller.dispatcher.completeDispatch(documentTask.dispatch!.dispatchId, terminal)
    return { targetFact, rebuilding: (await controller.store.load())! }
  }

  async function driveToRevisionFactPlanning(controller: ReturnType<typeof createDeliveryWorkflowController>, workspacePath: string, replacement = 'revised prose') {
    const { targetFact, rebuilding } = await completeFactOwnerRevision(controller, workspacePath, replacement)
    await controller.resume(rebuilding!)
    return { targetFact, rebuilding, current: await controller.store.load() }
  }

  async function completeImpactedFact(controller: ReturnType<typeof createDeliveryWorkflowController>, workspacePath: string) {
    const { rebuilding } = await completeFactOwnerRevision(controller, workspacePath, 'game.boss.count: 1\nunresolved prose')
    await controller.resume(rebuilding!)
    const planned = await controller.store.load()
    const task = planned!.foundationRevisionState!.tasks.find(candidate => candidate.kind === 'impacted-facts')!
    const packet = JSON.parse((await readFile(join(workspacePath, task.packetPath))).toString()) as { keys: string[]; sections: Array<{ documentPath: string; sectionId: string; startLine: number; endLine: number }> }
    await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, { workerType: 'foundation-fact-extractor', status: 'completed', runId: planned!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId, revision: task.revision, packetDigest: task.packetDigest, results: await presentFactResults(workspacePath, packet) })
    return { task, run: await controller.store.load() }
  }

  test('completes all ten semantic PASS checks into one atomic review and audit_ready', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    try {
      await finishFacts(controller, consistentFactValue)
      let current = await controller.store.load()
      expect(current?.foundationAuditState?.status).toBe('semantic_review')
      while (current?.foundationAuditState?.status === 'semantic_review') {
        const running = current.foundationAuditState.tasks.filter(task => (task.kind === 'semantic' || task.kind === 'confirmation') && task.status === 'running')
        expect(running.length).toBeGreaterThan(0)
        await Promise.all(running.map(task => completeSemantic(controller, task.taskId, 'PASS').catch(error => {
          if (!(error instanceof Error) || !error.message.includes('simulated crash')) throw error
        })))
        current = await controller.store.load()
      }
      expect(current?.foundationAuditState?.status).toBe('audit_ready')
      expect(current?.foundationAuditState?.tasks.filter(task => task.kind === 'semantic')).toHaveLength(10)
      expect(current?.foundationAuditState?.tasks.filter(task => task.kind === 'semantic' && task.status === 'completed' && task.admittedResult?.outcome === 'PASS')).toHaveLength(10)
      const review = current!.foundationAuditState!.review!
      const marker = JSON.parse(await readFile(join(workspacePath, review.markerPath), 'utf8')) as Record<string, unknown>
      expect(marker.status).toBe('committed')
      expect(marker.reviewDigest).toBe(review.reviewDigest)
      const registry = JSON.parse(await readFile(join(workspacePath, review.issueRegistryPath), 'utf8')) as { issues: unknown[] }
      expect(registry.issues).toHaveLength(0)
      expect(current?.documentStep).toBe('CHECKLIST_DRAFTING')
      expect(requests.filter(request => (request as { workerType: string }).workerType === 'foundation-document-reviser')).toHaveLength(0)
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

  test('resumes from completed semantic terminals and idempotently finalizes after publication crash', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      await finishFacts(controller)
      const originalCommit = controller.store.commit.bind(controller.store)
      let failFinalCommit = true
      controller.store.commit = async (...args) => {
        const event = args[1] as { type?: string }
        if (failFinalCommit && event.type === 'foundation.audit.audit_ready') {
          failFinalCommit = false
          throw new Error('simulated crash after final review publication')
        }
        if (event.type === 'workflow.handler_failed') return args[0] as Awaited<ReturnType<typeof originalCommit>>
        return originalCommit(...args)
      }
      let current = await controller.store.load()
      let crashed = false
      while (current?.foundationAuditState?.status === 'semantic_review') {
        const running = current.foundationAuditState.tasks.filter(task => (task.kind === 'semantic' || task.kind === 'confirmation') && task.status === 'running')
        if (!running.length) {
          await controller.resume(current)
          current = await controller.store.load()
          continue
        }
        await Promise.all(running.map(task => completeSemantic(controller, task.taskId, 'PASS').catch(error => {
          if (!(error instanceof Error) || !error.message.includes('simulated crash')) throw error
          crashed = true
        })))
        current = await controller.store.load()
        if (crashed) break
      }
      expect(current?.foundationAuditState?.status).toBe('semantic_review')
      expect(current?.foundationAuditState?.review).toBeUndefined()
      const completed = current!.foundationAuditState!.tasks.filter(task => task.kind === 'semantic' && task.status === 'completed')
      expect(completed).toHaveLength(10)
      expect((await readdir(join(workspacePath, '.beegame/audit/foundation/rev-1/review'))).length).toBe(1)
      const reviewDirectories = await readFile(join(workspacePath, '.beegame/audit/foundation/rev-1/derived/COMMITTED.json'), 'utf8')
      expect(reviewDirectories).toContain('committed')
      await controller.resume(current!)
      const resumed = await controller.store.load()
      expect(resumed?.foundationAuditState?.status).toBe('audit_ready')
      expect(resumed?.foundationAuditState?.review?.reviewDigest).toMatch(/^[a-f0-9]{64}$/)
      await controller.resume(resumed!)
      expect((await controller.store.load())?.foundationAuditState?.status).toBe('audit_ready')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('preserves semantic ISSUES in the single final Issue Registry', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    try {
      const canonicalBefore = await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(workspacePath, path), 'utf8')] as const))
      await finishFacts(controller, consistentFactValue)
      let current = await controller.store.load()
      let issued = false
      while (current?.foundationAuditState?.status === 'semantic_review') {
        const running = current.foundationAuditState.tasks.filter(task => (task.kind === 'semantic' || task.kind === 'confirmation') && task.status === 'running')
        await Promise.all(running.map(task => {
          const outcome = !issued && task.kind === 'semantic' ? 'ISSUES' : 'PASS'
          issued ||= outcome === 'ISSUES'
          return completeSemantic(controller, task.taskId, outcome)
        }))
        current = await controller.store.load()
      }
      expect(current?.foundationAuditState?.status).toBe('audit_ready')
      const review = current!.foundationAuditState!.review!
      const registry = JSON.parse(await readFile(join(workspacePath, review.issueRegistryPath), 'utf8')) as { issues: AuditIssue[] }
      expect(registry.issues).toHaveLength(1)
      expect(registry.issues.filter(issue => issue.type === 'semantic')).toHaveLength(1)
      expect(registry.issues.some(issue => issue.actual === 'counterplay is absent')).toBe(true)
      expect(current!.foundationAuditState!.tasks.filter(task => task.kind === 'semantic')).toHaveLength(10)
      for (const [path, contents] of canonicalBefore) expect(await readFile(join(workspacePath, path), 'utf8')).toBe(contents)
      const revisionDispatches = requests.filter(request => (request as { workerType: string }).workerType === 'foundation-document-reviser')
      expect(revisionDispatches).toHaveLength(1)
      const expectedStagePath = foundationRevisionStagePath('rev-1', registry.issues[0]!.fixDocument)
      expect(revisionDispatches[0]!.allowedPaths).toEqual([expectedStagePath])
      expect(revisionDispatches[0]!.protectedPaths).toEqual([registry.issues[0]!.fixDocument])
      expect(revisionDispatches[0]!.contract).not.toHaveProperty('packet')
      expect(current!.foundationRevisionState!.tasks.every(task => !Object.hasOwn(task, 'packet'))).toBe(true)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('admits one real foundation revision terminal and persists its receipt', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      await finishFacts(controller, consistentFactValue)
      let current = await controller.store.load()
      let issued = false
      while (current?.foundationAuditState?.status === 'semantic_review') {
        const running = current.foundationAuditState.tasks.filter(task => task.kind === 'semantic' && task.status === 'running')
        if (!running.length) {
          if (current.foundationAuditState.tasks.some(task => task.kind === 'semantic' && task.status === 'retryable')) throw new Error('semantic task unexpectedly retryable')
          await controller.resume(current)
          current = await controller.store.load()
          continue
        }
        await Promise.all(running.map(async task => {
          const snapshot = await controller.store.load()
          const outcome = !issued && task.kind === 'semantic' ? 'ISSUES' as const : 'PASS' as const
          if (outcome === 'ISSUES') issued = true
          const semanticPacket = task.dispatch!.request!.contract.packet as { sections: Array<{ sectionKey: string }> }
          const sectionKey = semanticPacket.sections[0]!.sectionKey
          await controller.store.addWorkflowUsage(snapshot!.runId, { input_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 3, total_tokens: 5 }, task.dispatch!.dispatchId)
          await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, {
            workerType: 'foundation-semantic-reviewer', status: 'completed', runId: snapshot!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId, revision: task.revision, packetDigest: task.packetDigest,
            outcome,
            ...(outcome === 'ISSUES' ? { issues: [{ problem: 'counterplay is absent', expected: 'counterplay exists', actual: 'counterplay is absent', sourceSectionKey: sectionKey, fixSectionKey: sectionKey }] } : {}),
          })
        }))
        current = await controller.store.load()
      }
      const revisionTask = current!.foundationRevisionState!.tasks.find(task => task.kind === 'document-revision')!
      const request = revisionTask.dispatch!.request!
      const packet = await loadFoundationRevisionPacket({ workspacePath, revision: revisionTask.revision, round: revisionTask.round, taskId: revisionTask.taskId, documentPath: revisionTask.documentPath, packetDigest: revisionTask.packetDigest }) as { sections: Array<{ sectionId: string; startLine: number; endLine: number; text: string }> }
      const section = packet.sections.find(candidate => candidate.sectionId === revisionTask.sectionIds[0])!
      const stageAbsolute = join(workspacePath, revisionTask.stagedPath)
      const stagedLines = (await readFile(stageAbsolute, 'utf8')).split('\n')
      stagedLines.splice(section.startLine - 1, section.endLine - section.startLine, ...section.text.replace('unresolved prose', 'revised prose').split('\n'))
      await writeFile(stageAbsolute, stagedLines.join('\n'))
      const stagedBytes = await readFile(stageAbsolute)
      const receiptWithoutTerminal = {
        taskId: revisionTask.taskId,
        round: current!.foundationRevisionState!.round,
        documentPath: revisionTask.documentPath,
        issueIds: [...revisionTask.issueIds],
        baseDocumentDigest: revisionTask.baseDocumentDigest,
        stagedDocumentDigest: createHash('sha256').update(stagedBytes).digest('hex'),
        changedSectionIds: [revisionTask.sectionIds[0]!],
        stagedPath: revisionTask.stagedPath,
      }
      const terminal = {
        workerType: 'foundation-document-reviser' as const,
        status: 'completed' as const,
        runId: current!.runId,
        dispatchId: request.dispatchId!,
        taskId: revisionTask.taskId,
        revision: revisionTask.revision,
        packetDigest: revisionTask.packetDigest,
        round: current!.foundationRevisionState!.round,
        documentPath: revisionTask.documentPath,
        receipt: { ...receiptWithoutTerminal, terminalDigest: revisionTaskReceiptTerminalDigest(receiptWithoutTerminal) },
      }
      await controller.dispatcher.completeDispatch(request.dispatchId!, terminal)
      const completed = (await controller.store.load())!.foundationRevisionState!.tasks.find(task => task.kind === 'document-revision')!
      await controller.resume(await controller.store.load() as DeliveryRun)
      const afterRebuild = await controller.store.load() as DeliveryRun
      if (afterRebuild.foundationRevisionState?.phase === 'rebuilding_facts') await controller.resume(afterRebuild)
      expect((await controller.store.load())!.foundationRevisionState!.phase).toBe('semantic_recheck')
      expect(completed.status).toBe('completed')
      expect(completed.receipt).toEqual(terminal.receipt)
      expect(completed.terminalDigest).toBe(terminal.receipt.terminalDigest)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('after document receipts, zero unresolved impacted facts advances to targeted semantic recheck', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    try {
      const { current: currentValue } = await driveToRevisionFactPlanning(controller, workspacePath, ownerFactText('game.boss.count'))
      const current = currentValue!
      await controller.resume(current)
      expect((await controller.store.load())?.foundationRevisionState?.phase).toBe('semantic_recheck')
      expect(current.foundationRevisionState?.tasks.some(task => task.kind === 'impacted-facts')).toBe(false)
      expect(requests.filter(request => request.workerType === 'foundation-fact-extractor')).toHaveLength(8)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('plans one unresolved impacted fact packet, dispatches it, and persists its completed receipt', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    const originalCommit = controller.store.commit.bind(controller.store)
    let planningCrashObserved = false
    let plannedAtCrash: { taskId: string; packetPath: string; packetDigest: string; bytes: string } | undefined
    try {
      const revisionWorkersBefore = requests.filter(request => request.workerType === 'foundation-document-reviser').length
      controller.store.commit = async (...args) => {
        const next = args[0] as DeliveryRun
        const event = args[1] as { type?: string }
        const planned = next.foundationRevisionState?.tasks.find(task => task.kind === 'impacted-facts')
        if (!planningCrashObserved && event.type === 'foundation.revision.impacted_facts.planned' && planned) {
          plannedAtCrash = { taskId: planned.taskId, packetPath: planned.packetPath, packetDigest: planned.packetDigest, bytes: (await readFile(join(workspacePath, planned.packetPath))).toString() }
          planningCrashObserved = true
          throw new Error('simulated impacted planning crash')
        }
        return originalCommit(...args)
      }
      await completeFactOwnerRevision(controller, workspacePath, 'game.boss.count: 1\ngame.resources: []\nunresolved prose').catch(() => undefined)
      expect(planningCrashObserved).toBe(true)
      const factWorkersBefore = requests.filter(request => request.workerType === 'foundation-fact-extractor').length
      const crashed = await controller.store.load()
      expect(crashed?.foundationRevisionState?.phase).toBe('rebuilding_facts')
      expect(crashed?.foundationRevisionState?.tasks.some(task => task.kind === 'impacted-facts')).toBe(false)
      controller.store.commit = originalCommit
      await controller.resume(crashed!)
      const replayedPlanning = await controller.store.load()
      const impacted = replayedPlanning!.foundationRevisionState?.tasks.filter(task => task.kind === 'impacted-facts') ?? []
      expect(impacted).toHaveLength(1)
      const task = impacted[0]!
      expect(plannedAtCrash).toBeDefined()
      if (!plannedAtCrash) return
      const stableTask = replayedPlanning!.foundationRevisionState!.tasks.find(candidate => candidate.taskId === plannedAtCrash!.taskId && candidate.kind === 'impacted-facts')!
      expect(stableTask.taskId).toBe(plannedAtCrash.taskId)
      expect(stableTask.packetPath).toBe(plannedAtCrash.packetPath)
      expect(stableTask.packetDigest).toBe(plannedAtCrash.packetDigest)
      expect(stableTask.packetPath).toBe(foundationRevisionPacketPath(stableTask.revision, stableTask.round, stableTask.taskId))
      expect(stableTask.dispatch?.status).toBe('running')
      const packet = JSON.parse((await readFile(join(workspacePath, stableTask.packetPath))).toString()) as { revision: string; packetDigest: string; keys: string[]; sections: Array<{ documentPath: string; sectionId: string; startLine: number; endLine: number }> }
      expect(packet.revision).toBe(stableTask.revision)
      expect(packet.packetDigest).toBe(stableTask.packetDigest)
      expect(stableTask.dispatch?.request?.contract).not.toHaveProperty('packet')
      expect((await readFile(join(workspacePath, stableTask.packetPath))).toString()).toBe(plannedAtCrash.bytes)
      expect(requests.filter(request => request.workerType === 'foundation-fact-extractor')).toHaveLength(factWorkersBefore + 1)
      const snapshot = await controller.store.load()
      await controller.dispatcher.completeDispatch(stableTask.dispatch!.dispatchId, {
        workerType: 'foundation-fact-extractor',
        status: 'completed',
        runId: snapshot!.runId,
        dispatchId: stableTask.dispatch!.dispatchId,
        taskId: stableTask.taskId,
        revision: stableTask.revision,
        packetDigest: stableTask.packetDigest,
        results: await presentFactResults(workspacePath, packet),
      })
      const completed = await controller.store.load()
      const admitted = completed!.foundationRevisionState!.tasks.find(candidate => candidate.taskId === stableTask.taskId)!
      expect(admitted.status).toBe('completed')
      expect(admitted.kind).toBe('impacted-facts')
      expect('receiptPath' in admitted && admitted.receiptPath).toBeTruthy()
      expect(requests.filter(request => request.workerType === 'foundation-fact-extractor')).toHaveLength(factWorkersBefore + 1)
      let afterValidation = completed!
      if (afterValidation.foundationRevisionState?.phase === 'validating') {
        await controller.resume(afterValidation)
        afterValidation = await controller.store.load() as DeliveryRun
      }
      expect(afterValidation!.foundationRevisionState!.phase).toBe('semantic_recheck')
    } finally { controller.store.commit = originalCommit; await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('a persisted impacted-fact terminal replay does not start a second worker after handler failure', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    const originalCommit = controller.store.commit.bind(controller.store)
    let failAdmission = true
    controller.store.commit = async (...args) => {
      const next = args[0] as DeliveryRun
      const event = args[1] as { type?: string }
      if (failAdmission && event.type === 'foundation.revision.impacted_facts.admitted') {
        failAdmission = false
        throw new Error('simulated impacted fact receipt handler crash')
      }
      return originalCommit(...args)
    }
    try {
      const { current: currentValue } = await driveToRevisionFactPlanning(controller, workspacePath)
      const current = currentValue!
      const task = current.foundationRevisionState?.tasks.find(candidate => candidate.kind === 'impacted-facts')!
      expect(task).toBeDefined()
      if (!task) return
      const packet = JSON.parse((await readFile(join(workspacePath, task.packetPath))).toString()) as { keys: string[]; packetDigest: string }
      expect(packet.packetDigest).toBe(task.packetDigest)
      await expect(controller.dispatcher.completeDispatch(task!.dispatch!.dispatchId, {
        workerType: 'foundation-fact-extractor', status: 'completed', runId: current.runId, dispatchId: task!.dispatch!.dispatchId, taskId: task!.taskId, revision: task!.revision, packetDigest: task!.packetDigest, results: await presentFactResults(workspacePath, packet),
      })).rejects.toThrow(/handler|crash/i)
      const retryable = await controller.store.load()
      const failed = retryable!.foundationRevisionState!.tasks.find(candidate => candidate.taskId === task!.taskId)!
      expect(failed.status).not.toBe('completed')
      expect(failed.dispatch?.terminalResult).toBeDefined()
      expect('receiptPath' in failed && failed.receiptPath).toBeFalsy()
      const before = requests.filter(request => request.workerType === 'foundation-fact-extractor').length
      controller.store.commit = originalCommit
      await controller.resume(retryable!)
      const replayed = await controller.store.load()
      expect(replayed!.foundationRevisionState!.tasks.find(candidate => candidate.taskId === task!.taskId)!.status).toBe('completed')
      expect(requests.filter(request => request.workerType === 'foundation-fact-extractor')).toHaveLength(before)
    } finally { controller.store.commit = originalCommit; await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('stale staged bytes fail closed from validating and never cross the publishing boundary', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const { run: current } = await driveToFactOwnerRevisionIssue(controller)
      const task = current.foundationRevisionState!.tasks.find(candidate => candidate.kind === 'document-revision')! as FoundationRevisionDocumentTask
      const terminal = await makeRevisionTerminal(workspacePath, current, task)
      await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, terminal)
      const rebuilding = await controller.store.load()
      const canonicalBefore = await readFile(join(workspacePath, task.documentPath), 'utf8')
      const stagedAbsolute = join(workspacePath, task.stagedPath)
      await writeFile(stagedAbsolute, `${await readFile(stagedAbsolute, 'utf8')}\nstale bytes\n`)
      await controller.resume(rebuilding!)
      const failed = await controller.store.load()
      expect(await readFile(join(workspacePath, task.documentPath), 'utf8')).toBe(canonicalBefore)
      expect(failed?.status).toBe('needs_action')
      expect(failed?.foundationRevisionState?.phase).toBe('validating')
      expect(failed?.foundationRevisionState?.phase).not.toBe('publishing')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('deterministic new impacted issues block publishing after a real validating transition', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    try {
      const canonicalBefore = await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(workspacePath, path), 'utf8')] as const))
      await completeFactOwnerRevision(controller, workspacePath, ownerFactText('game.boss.count', 2)).catch(() => undefined)
      const validating = await controller.store.load()
      expect(validating?.status).toBe('needs_action')
      const semanticWorkersBefore = requests.filter(request => request.workerType === 'foundation-semantic-reviewer').length
      const failed = await controller.store.load()
      expect(failed?.status).toBe('needs_action')
      expect(failed?.foundationRevisionState?.phase).toBe('validating')
      expect(failed?.foundationRevisionState?.publication).toBeUndefined()
      expect(failed?.blockedReason).toMatch(/impact|validation|deterministic|issue/i)
      expect(requests.filter(request => request.workerType === 'foundation-semantic-reviewer')).toHaveLength(semanticWorkersBefore)
      for (const [path, contents] of canonicalBefore) expect(await readFile(join(workspacePath, path), 'utf8')).toBe(contents)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('claims revision attempts durably and refuses a third worker', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    try {
      await finishFacts(controller, consistentFactValue)
      let current = await controller.store.load()
      let issued = false
      while (current?.foundationAuditState?.status === 'semantic_review') {
        const running = current.foundationAuditState.tasks.filter(task => task.kind === 'semantic' && task.status === 'running')
        if (!running.length) { await controller.resume(current); current = await controller.store.load(); continue }
        await Promise.all(running.map(task => {
          const outcome = !issued ? 'ISSUES' as const : 'PASS' as const
          issued = true
          return completeSemantic(controller, task.taskId, outcome)
        }))
        current = await controller.store.load()
      }
      const first = current!.foundationRevisionState!.tasks.find(task => task.kind === 'document-revision')!
      const firstDispatch = first.dispatch!.dispatchId
      await expect(controller.dispatcher.completeDispatch(firstDispatch, {})).rejects.toThrow(/invalid|terminal/i)
      current = await controller.store.load()
      expect(current!.foundationRevisionState!.tasks.find(task => task.taskId === first.taskId)!.status).toBe('retryable')
      expect(current!.foundationRevisionState!.tasks.find(task => task.taskId === first.taskId)!.attempt).toBe(1)
      await controller.resume(current!)
      current = await controller.store.load()
      const second = current!.foundationRevisionState!.tasks.find(task => task.taskId === first.taskId)!
      expect(second.dispatch).toBeDefined()
      await expect(controller.dispatcher.completeDispatch(second.dispatch!.dispatchId, {})).rejects.toThrow(/invalid|terminal/i)
      current = await controller.store.load()
      const exhausted = current!.foundationRevisionState!.tasks.find(task => task.taskId === first.taskId)!
      expect(exhausted.status).toBe('needs_action')
      expect(exhausted.attempt).toBe(2)
      const startedCount = requests.filter(request => request.workerType === 'foundation-document-reviser').length
      await controller.resume(current!)
      expect(requests.filter(request => request.workerType === 'foundation-document-reviser')).toHaveLength(startedCount)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('rejects a stale caller snapshot against the durable revision deadline without touching stage', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    try {
      const current = await driveToRevisionIssue(controller)
      const original = current.foundationRevisionState!.tasks.find(task => task.kind === 'document-revision')!
      const stageBefore = await readFile(join(workspacePath, original.stagedPath))
      const startedBefore = requests.filter(request => request.workerType === 'foundation-document-reviser').length
      const expired = { ...current, foundationRevisionState: { ...current.foundationRevisionState!, roundDeadlineAt: new Date(0).toISOString(), tasks: current.foundationRevisionState!.tasks.map(task => task.taskId === original.taskId ? { ...task, status: 'pending' as const, attempt: 0, dispatch: undefined } : task) } }
      await controller.store.commit(expired, { runId: current.runId, type: 'test.revision.deadline', phase: current.phase, status: 'running', revision: current.revision })
      const snapshot = await controller.store.load()
      const task = snapshot!.foundationRevisionState!.tasks.find(candidate => candidate.taskId === original.taskId)! as FoundationRevisionDocumentTask
      const request = { runId: snapshot!.runId, ownerId: snapshot!.ownerId, projectId: snapshot!.projectId, workspacePath, workerType: 'foundation-document-reviser' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: task.taskId, revision: task.revision, allowedPaths: [task.stagedPath], projectReadScope: 'allowed' as const, protectedPaths: [task.documentPath], contract: { workerType: 'foundation-document-reviser' as const, taskId: task.taskId, revision: task.revision, round: task.round, documentPath: task.documentPath, issueIds: task.issueIds, sectionIds: task.sectionIds, stagedPath: task.stagedPath, baseDocumentDigest: task.baseDocumentDigest, packetPath: task.packetPath, packetDigest: task.packetDigest } }
      await expect(controller.dispatcher.dispatch(request)).rejects.toThrow(/deadline/i)
      const after = await controller.store.load()
      expect(after!.foundationRevisionState!.tasks.find(task => task.taskId === original.taskId)!.attempt).toBe(0)
      expect(await readFile(join(workspacePath, original.stagedPath))).toEqual(stageBefore)
      expect(requests.filter(request => request.workerType === 'foundation-document-reviser')).toHaveLength(startedBefore)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('recovers planning after a partial packet/stage crash with one exact dispatch per task', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    const originalCommit = controller.store.commit.bind(controller.store)
    let crash = true
    controller.store.commit = async (...args) => {
      const event = args[1] as { type?: string }
      if (crash && event.type === 'foundation.revision.revising') { crash = false; throw new Error('simulated planning crash') }
      return originalCommit(...args)
    }
    try {
      await expect(driveToRevisionIssue(controller)).rejects.toThrow(/simulated planning crash/)
      const crashed = await controller.store.load()
      expect(crashed?.foundationRevisionState?.phase).toBe('planning')
      const tasksRoot = join(workspacePath, '.beegame/audit/foundation/rev-1/round-1/tasks')
      const taskIds = await readdir(tasksRoot)
      const packetsBefore = await Promise.all(taskIds.map(async taskId => [taskId, await readFile(join(tasksRoot, taskId, 'packet.json'))] as const))
      const retry = { ...crashed!, status: 'running' as const, foundationRevisionState: { ...crashed!.foundationRevisionState!, status: 'running' as const } }
      await originalCommit(retry, { runId: retry.runId, type: 'test.planning.resume', phase: retry.phase, status: 'running', revision: retry.revision })
      await controller.resume(retry)
      const resumed = await controller.store.load()
      expect(resumed!.foundationRevisionState!.phase).toBe('revising')
      expect(resumed!.foundationRevisionState!.tasks).toHaveLength(taskIds.length)
      expect(await Promise.all(taskIds.map(async taskId => (await readFile(join(tasksRoot, taskId, 'packet.json'))).equals(packetsBefore.find(item => item[0] === taskId)![1])))).toEqual(taskIds.map(() => true))
      expect(requests.filter(request => request.workerType === 'foundation-document-reviser')).toHaveLength(taskIds.length)
      await controller.resume(resumed!)
      expect(requests.filter(request => request.workerType === 'foundation-document-reviser')).toHaveLength(taskIds.length)
    } finally { controller.store.commit = originalCommit; await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('reconciles a lost revision session and replays a persisted terminal', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    try {
      const initial = await driveToRevisionIssue(controller)
      const firstTask = initial.foundationRevisionState!.tasks.find(task => task.kind === 'document-revision')!
      const firstRecovered = await controller.store.reconcile(async () => false)
      const retryTask = firstRecovered!.foundationRevisionState!.tasks.find(task => task.taskId === firstTask.taskId)!
      expect(retryTask.status).toBe('retryable')
      expect(retryTask.attempt).toBe(1)
      await controller.resume(firstRecovered!)
      const claimed = await controller.store.load()
      const secondTask = claimed!.foundationRevisionState!.tasks.find(task => task.taskId === firstTask.taskId)! as FoundationRevisionDocumentTask
      expect(secondTask.attempt).toBe(2)
      const terminal = await makeRevisionTerminal(workspacePath, claimed!, secondTask)
      const withTerminal = { ...claimed!, foundationRevisionState: { ...claimed!.foundationRevisionState!, tasks: claimed!.foundationRevisionState!.tasks.map(task => task.taskId === secondTask.taskId ? { ...task, dispatch: { ...task.dispatch!, status: 'running' as const, terminalResult: terminal } } : task) } }
      await controller.store.commit(withTerminal, { runId: claimed!.runId, type: 'test.revision.persisted_terminal', phase: claimed!.phase, status: 'running', revision: claimed!.revision })
      const beforeReplay = requests.filter(request => request.workerType === 'foundation-document-reviser').length
      const reconciled = await controller.store.reconcile(async () => false)
      expect(reconciled!.foundationRevisionState!.tasks.find(task => task.taskId === secondTask.taskId)!.status).toBe('running')
      await controller.resume(reconciled!)
      const admitted = await controller.store.load()
      const completed = admitted!.foundationRevisionState!.tasks.find(task => task.taskId === secondTask.taskId)!
      expect(requests.filter(request => request.workerType === 'foundation-document-reviser')).toHaveLength(beforeReplay)
      expect(completed.status).toBe('completed')
      expect(completed.terminalDigest).toBe(terminal.receipt.terminalDigest)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('keeps an admitted revision receipt after handler failure and resumes without a new writer', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    const originalCommit = controller.store.commit.bind(controller.store)
    let failHandler = true
    controller.store.commit = async (...args) => {
      const event = args[1] as { type?: string }
      if (failHandler && event.type === 'foundation.revision.rebuilding_facts') { failHandler = false; throw new Error('simulated terminal handler failure') }
      return originalCommit(...args)
    }
    try {
      const current = await driveToRevisionIssue(controller)
      const task = current.foundationRevisionState!.tasks.find(candidate => candidate.kind === 'document-revision')! as FoundationRevisionDocumentTask
      const terminal = await makeRevisionTerminal(workspacePath, current, task)
      await expect(controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, terminal)).rejects.toThrow(/handler|failure/i)
      const admitted = await controller.store.load()
      const completed = admitted!.foundationRevisionState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(completed.status).toBe('completed')
      expect(completed.terminalDigest).toBe(terminal.receipt.terminalDigest)
      const beforeResume = requests.filter(request => request.workerType === 'foundation-document-reviser').length
      controller.store.commit = originalCommit
      await controller.resume(admitted!)
      let resumed = await controller.store.load()
      if (resumed!.foundationRevisionState!.phase === 'validating') {
        await controller.resume(resumed!)
        resumed = await controller.store.load()
      }
      expect(resumed!.foundationRevisionState!.phase).toBe('semantic_recheck')
      expect(requests.filter(request => request.workerType === 'foundation-document-reviser')).toHaveLength(beforeResume)
    } finally { controller.store.commit = originalCommit; await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('rejects a final review whose semantic manifest declaration is tampered despite its self-reported digest', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      await finishFacts(controller)
      let current = await controller.store.load()
      while (current?.foundationAuditState?.status === 'semantic_review') {
        const running = current.foundationAuditState.tasks.filter(task => (task.kind === 'semantic' || task.kind === 'confirmation') && task.status === 'running')
        await Promise.all(running.map(task => completeSemantic(controller, task.taskId, 'PASS')))
        current = await controller.store.load()
      }
      const review = current!.foundationAuditState!.review!
      const manifestPath = join(workspacePath, review.manifestPath)
      const markerPath = join(workspacePath, review.markerPath)
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { semanticManifest: { checks: Array<{ objective: string }> } }
      manifest.semanticManifest.checks[0]!.objective = 'tampered objective'
      const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
      await writeFile(manifestPath, manifestText, 'utf8')
      const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { manifestDigest: string }
      marker.manifestDigest = createHash('sha256').update(manifestText).digest('hex')
      await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
      await expect(loadFoundationSemanticReview({ workspacePath, revision: 'rev-1', reviewDigest: review.reviewDigest })).rejects.toThrow(/manifest|authority|declaration/i)
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

  test('replays a persisted impacted terminal after callback-before-receipt crash without starting a worker', async () => {
    const { workspacePath, controller, started, requests } = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(controller, workspacePath)
      await controller.resume(rebuilding!)
      const planned = await controller.store.load()
      const task = planned!.foundationRevisionState!.tasks.find(candidate => candidate.kind === 'impacted-facts')!
      const packet = JSON.parse((await readFile(join(workspacePath, task.packetPath))).toString()) as { keys: string[] }
      const terminal = { workerType: 'foundation-fact-extractor' as const, status: 'completed' as const, runId: planned!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId, revision: task.revision, packetDigest: task.packetDigest, results: await presentFactResults(workspacePath, packet) }
      const crashed = { ...planned!, foundationRevisionState: { ...planned!.foundationRevisionState!, tasks: planned!.foundationRevisionState!.tasks.map(candidate => candidate.taskId === task.taskId ? { ...candidate, status: 'completed' as const, terminalDigest: digestFoundationFactTerminal(terminal), dispatch: { ...candidate.dispatch!, status: 'completed' as const, terminalResult: terminal }, receiptPath: undefined, receiptDigest: undefined } : candidate) } }
      await controller.store.commit(crashed, { runId: crashed.runId, type: 'test.process_boundary.terminal', phase: crashed.phase, status: crashed.status, revision: crashed.revision })
      const crashedTask = crashed!.foundationRevisionState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(crashedTask.status).toBe('completed')
      expect(crashedTask.dispatch?.status).toBe('completed')
      expect(crashedTask.dispatch?.terminalResult).toBeDefined()
      const baseline = requests.filter(request => request.workerType === 'foundation-fact-extractor').length
      const resumedController = createDeliveryWorkflowController({ workspacePath, ownerId: 'owner', workerPort: port(started, requests) })
      await resumedController.resume(crashed!)
      const replayed = await resumedController.store.load()
      const completed = replayed!.foundationRevisionState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(completed.status).toBe('completed')
      expect(completed.kind === 'impacted-facts' && completed.receiptPath).toBeDefined()
      expect(requests.filter(request => request.workerType === 'foundation-fact-extractor')).toHaveLength(baseline)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('fails closed when revision authority bindings drift during fact admission', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(controller, workspacePath)
      await controller.resume(rebuilding!)
      const planned = await controller.store.load()
      const impacted = planned!.foundationRevisionState!.tasks.find(candidate => candidate.kind === 'impacted-facts')!
      const staleAdmission = { ...planned!, foundationRevisionState: { ...planned!.foundationRevisionState!, authority: { ...planned!.foundationRevisionState!.authority, derivedDigests: { ...planned!.foundationRevisionState!.authority.derivedDigests, factStore: '0'.repeat(64) } } } }
      await controller.store.commit(staleAdmission, { runId: staleAdmission.runId, type: 'test.stale.revision.authority', phase: staleAdmission.phase, status: staleAdmission.status, revision: staleAdmission.revision })
      const canonicalBefore = await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(workspacePath, path))] as const))
      const packet = JSON.parse((await readFile(join(workspacePath, impacted.packetPath))).toString()) as { keys: string[] }
      await controller.dispatcher.completeDispatch(impacted.dispatch!.dispatchId, { workerType: 'foundation-fact-extractor', status: 'completed', runId: staleAdmission.runId, dispatchId: impacted.dispatch!.dispatchId, taskId: impacted.taskId, revision: impacted.revision, packetDigest: impacted.packetDigest, results: packet.keys.map(key => ({ key, status: 'absent' as const })) })
      const failed = await controller.store.load()
      expect(failed!.status).toBe('needs_action')
      const failedTask = failed!.foundationRevisionState!.tasks.find(candidate => candidate.taskId === impacted.taskId)!
      expect(failedTask.kind === 'impacted-facts' && failedTask.receiptPath).toBeFalsy()
      for (const [path, bytes] of canonicalBefore) expect(await readFile(join(workspacePath, path))).toEqual(bytes)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('fails closed on derived/document authority drift in planning and validation', async () => {
    const planning = await preparedController()
    try {
      const current = await driveToRevisionIssue(planning.controller)
      const stalePlanning = { ...current, foundationRevisionState: { ...current.foundationRevisionState!, phase: 'planning' as const, tasks: [], authority: { ...current.foundationRevisionState!.authority, derivedDigests: { ...current.foundationRevisionState!.authority.derivedDigests, sectionIndex: '2'.repeat(64) } } } }
      await planning.controller.store.commit(stalePlanning, { runId: stalePlanning.runId, type: 'test.stale.planning.derived', phase: stalePlanning.phase, status: stalePlanning.status, revision: stalePlanning.revision })
      await planning.controller.resume(stalePlanning)
      expect((await planning.controller.store.load())!.status).toBe('needs_action')
    } finally { await rm(planning.workspacePath, { recursive: true, force: true }) }

    const validating = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(validating.controller, validating.workspacePath, ownerFactText('game.boss.count'))
      await validating.controller.resume(rebuilding!)
      const ready = await validating.controller.store.load()
      const stale = { ...ready!, foundationRevisionState: { ...ready!.foundationRevisionState!, phase: 'validating' as const, authority: { ...ready!.foundationRevisionState!.authority, documentDigests: ready!.foundationRevisionState!.authority.documentDigests.map((entry, index) => index === 0 ? { ...entry, digest: '3'.repeat(64) } : entry) } } }
      await validating.controller.store.commit(stale, { runId: stale.runId, type: 'test.stale.validation.document', phase: stale.phase, status: stale.status, revision: stale.revision })
      await validating.controller.resume(stale)
      expect((await validating.controller.store.load())!.status).toBe('needs_action')
    } finally { await rm(validating.workspacePath, { recursive: true, force: true }) }
  })

  test('document and impacted terminals continue the revision chain without a manual resume', async () => {
    const zero = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(zero.controller, zero.workspacePath, ownerFactText('game.boss.count'))
      expect(rebuilding.foundationRevisionState?.phase).toBe('semantic_recheck')
    } finally { await rm(zero.workspacePath, { recursive: true, force: true }) }

      const impactedController = await preparedController()
    try {
      const impacted = await completeImpactedFact(impactedController.controller, impactedController.workspacePath)
      let finalImpacted = impacted.run!
      if (finalImpacted.foundationRevisionState?.phase === 'validating') {
        await impactedController.controller.resume(finalImpacted)
        finalImpacted = await impactedController.controller.store.load() as DeliveryRun
      }
      expect(finalImpacted.foundationRevisionState?.phase).toMatch(/publishing|semantic_recheck/)
    } finally { await rm(impactedController.workspacePath, { recursive: true, force: true }) }
  })

  test('semantic originals create exact targeted recheck tasks instead of publishing', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      await completeFactOwnerRevision(controller, workspacePath, ownerFactText('game.boss.count'))
      const beforeRecheck = await controller.store.load()
      if (beforeRecheck?.foundationRevisionState?.phase === 'validating') await controller.resume(beforeRecheck)
      const rechecked = await controller.store.load()
      const tasks = rechecked!.foundationRevisionState!.tasks.filter(task => task.kind === 'semantic-recheck')
      expect(rechecked!.foundationRevisionState!.phase).toBe('semantic_recheck')
      expect(tasks).toHaveLength(1)
      const documentTask = rechecked!.foundationRevisionState!.tasks.find(task => task.kind === 'document-revision')!
      expect(tasks[0]!.issueId).toBe(documentTask.kind === 'document-revision' ? documentTask.issueIds[0] ?? '' : '')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('revision impacted fact dispatch enforces fast readiness, output cap, aggregate cap, and task kind', async () => {
    const revisionRequests: WorkerDispatchRequest[] = []
    const { workspacePath, controller } = await preparedController(started => {
      const value = port(started, revisionRequests)
      value.assertFoundationFactFastReady = async request => { if (typeof request.contract.packetPath === 'string' && request.contract.packetPath.includes('/round-')) throw new Error('fast model unavailable') }
      return value
    })
    try {
      await expect(completeFactOwnerRevision(controller, workspacePath)).rejects.toThrow(/fast model unavailable/i)
      const baseline = revisionRequests.filter(request => typeof request.contract.packetPath === 'string' && request.contract.packetPath.includes('/round-')).length
      const failed = await controller.store.load()
      expect(failed!.status).toBe('needs_action')
      expect(revisionRequests.filter(request => typeof request.contract.packetPath === 'string' && request.contract.packetPath.includes('/round-'))).toHaveLength(baseline)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('revision impacted fact terminals enforce the output cap', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(controller, workspacePath)
      await controller.resume(rebuilding!)
      const planned = await controller.store.load()
      const task = planned!.foundationRevisionState!.tasks.find(candidate => candidate.kind === 'impacted-facts')!
      const packet = JSON.parse((await readFile(join(workspacePath, task.packetPath))).toString()) as { keys: string[] }
      await controller.store.addWorkflowUsage(planned!.runId, { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 513, total_tokens: 514 }, task.dispatch!.dispatchId)
      await expect(controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, { workerType: 'foundation-fact-extractor', status: 'completed', runId: planned!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId, revision: task.revision, packetDigest: task.packetDigest, results: packet.keys.map(key => ({ key, status: 'absent' as const })) })).rejects.toThrow(/invalid|cap/i)
      expect((await controller.store.load())!.foundationRevisionState!.tasks.find(candidate => candidate.taskId === task.taskId)!.status).toBe('needs_action')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('revision impacted fact claim enforces the round aggregate cap and exact worker kind', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(controller, workspacePath)
      await controller.resume(rebuilding!)
      const planned = await controller.store.load()
      const task = planned!.foundationRevisionState!.tasks.find(candidate => candidate.kind === 'impacted-facts')!
      const pending = { ...planned!, foundationRevisionState: { ...planned!.foundationRevisionState!, tasks: planned!.foundationRevisionState!.tasks.map(candidate => candidate.taskId === task.taskId ? { ...candidate, status: 'retryable' as const, attempt: 1, dispatch: undefined, usage: { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 32000, total_tokens: 32000 } } : candidate) } }
      await controller.store.commit(pending, { runId: pending.runId, type: 'test.revision.aggregate.cap', phase: pending.phase, status: pending.status, revision: pending.revision })
      await expect(controller.resume(pending)).rejects.toThrow(/aggregate|cap/i)
      const after = await controller.store.load()
      expect(after!.foundationRevisionState!.tasks.find(candidate => candidate.taskId === task.taskId)!.status).toBe('needs_action')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('revision impacted fact rejects a wrong worker kind without starting it', async () => {
    const wrong = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(wrong.controller, wrong.workspacePath)
      await wrong.controller.resume(rebuilding!)
      const pending = await wrong.controller.store.load()
      const task = pending!.foundationRevisionState!.tasks.find(candidate => candidate.kind === 'impacted-facts')!
      const pendingTask = { ...pending!, foundationRevisionState: { ...pending!.foundationRevisionState!, tasks: pending!.foundationRevisionState!.tasks.map(candidate => candidate.taskId === task.taskId ? { ...candidate, status: 'retryable' as const, dispatch: undefined } : candidate) } }
      await wrong.controller.store.commit(pendingTask, { runId: pendingTask.runId, type: 'test.wrong.kind.pending', phase: pendingTask.phase, status: pendingTask.status, revision: pendingTask.revision })
      const baseline = wrong.requests.filter(request => request.workerType === 'foundation-document-reviser').length
      const wrongRequest = { runId: pending!.runId, ownerId: pending!.ownerId, projectId: pending!.projectId, workspacePath: wrong.workspacePath, workerType: 'foundation-document-reviser' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: task.taskId, revision: task.revision, allowedPaths: [], projectReadScope: 'allowed' as const, contract: { workerType: 'foundation-document-reviser', taskId: task.taskId, revision: task.revision, round: task.round, packetPath: task.packetPath, packetDigest: task.packetDigest, documentPath: 'docs/GDD.md', issueIds: [], sectionIds: [], stagedPath: '.beegame/audit/foundation/rev-1/revision/docs/GDD.md', baseDocumentDigest: '0'.repeat(64) } }
      await expect(wrong.controller.dispatcher.dispatch(wrongRequest)).rejects.toThrow(/kind mismatch/i)
      expect(wrong.requests.filter(request => request.workerType === 'foundation-document-reviser')).toHaveLength(baseline)
    } finally { await rm(wrong.workspacePath, { recursive: true, force: true }) }
  })

  test('corrupt revision fact packet fails explicitly and never remains silently running', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(controller, workspacePath)
      await controller.resume(rebuilding!)
      const planned = await controller.store.load()
      const impacted = planned!.foundationRevisionState!.tasks.find(task => task.kind === 'impacted-facts')!
      await writeFile(join(workspacePath, impacted.packetPath), '{not-json\n')
      const retry = { ...planned!, foundationRevisionState: { ...planned!.foundationRevisionState!, tasks: planned!.foundationRevisionState!.tasks.map(task => task.taskId === impacted.taskId ? { ...task, status: 'retryable' as const, attempt: 2, dispatch: undefined } : task) } }
      await controller.store.commit(retry, { runId: retry.runId, type: 'test.corrupt.revision.fact.packet', phase: retry.phase, status: retry.status, revision: retry.revision })
      await controller.resume(retry)
      const failed = await controller.store.load()
      expect(failed!.status).toBe('needs_action')
      expect(failed!.blockedReason).toMatch(/packet|digest|artifact|JSON/i)
      expect(failed!.foundationRevisionState!.tasks.find(task => task.taskId === impacted.taskId)!.status).not.toBe('running')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('a rebuilding packet parse error is durably needs_action rather than silently running', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(controller, workspacePath)
      const documentTask = rebuilding.foundationRevisionState!.tasks.find(task => task.kind === 'document-revision')!
      await writeFile(join(workspacePath, documentTask.packetPath), '{broken revision packet\n')
      await controller.resume(rebuilding)
      const failed = await controller.store.load()
      expect(failed!.status).toBe('needs_action')
      expect(failed!.blockedReason).toMatch(/JSON|packet|malformed|Unexpected/i)
      expect(failed!.foundationRevisionState!.phase).toBe('validating')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })
})
