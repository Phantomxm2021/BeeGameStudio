import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createDeliveryWorkflowController } from './controller'
import { createInitialDeliveryRun } from './run-store'
import { retryRun } from './recovery'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun, type DeliveryWorkerPort, type FoundationRevisionDocumentTask, type FoundationRevisionImpactedFactsTask, type FoundationRevisionSemanticRecheckTask, type FoundationAuditState, type WorkerDispatchRequest } from './types'
import { createBeeGameDeliveryWorkerPort } from '../delivery-worker-session-port'
import { getGameDocumentContract } from './game-document-contracts'
import { loadCommittedFoundationDerivedArtifacts, loadDeterministicFoundationReview, loadFoundationSemanticReview } from './foundation-audit-artifacts'
import { buildFoundationSectionIndex, type SectionRef } from './foundation-section-index'
import { analyzeFoundationImpact } from './foundation-impact-analysis'
import { FOUNDATION_FACT_CATALOG, foundationFactDefinition } from './foundation-fact-definitions'
import type { FactValue } from './foundation-fact-store'
import type { AuditIssue } from './foundation-issue-registry'
import { buildFoundationSemanticRecheckPacket } from './foundation-patch-validation'
import { deriveFoundationPatchOperations, foundationRevisionPacketPath, foundationRevisionStagePath, loadFoundationRevisionPacket, revisionTaskReceiptTerminalDigest, writeFoundationRevisionSemanticPacket, type PatchOperation } from './foundation-revision-stage'
import { digestFoundationFactTerminal, type FoundationFactTask } from './foundation-fact-runtime'
import { foundationSemanticRecheckStructuredOutputJsonSchema } from './worker-contracts'
import { foundationRevisionCommittedPath } from './foundation-revision-publication'
import { publishFoundationRevision, recoverFoundationRevision } from './foundation-revision-publication'
import { publishFoundationDerivedArtifacts } from './foundation-audit-artifacts'
import { digestFactStore } from './foundation-fact-store'
import { createModelConfig, resetModelConfigs } from '@bee-game-studio/agent-workflow'
import { commitFoundationRevisionDocumentMetadata } from '../authored-document-receipt'

const DOCUMENT_METADATA = '---\nversion: 1.0.0\nupdated_at: 2026-08-12T00:00:00.000Z\n---\n'

function document(path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]): string {
  const contract = getGameDocumentContract(path)
  return `${DOCUMENT_METADATA}${[`# ${path}`, '', '<!-- beegame-executive-summary -->', '## Executive Summary', '', 'summary authority', '', ...contract.sections.flatMap(section => [`<!-- beegame-section:${section.sectionId} -->`, `## ${section.title}`, '', 'unresolved prose', '']), '<!-- beegame-production-materials -->', '## Production Materials', '', ...contract.productionMaterials.flatMap(material => [`<!-- beegame-material:${material.materialId} -->`, `### ${material.title}`, '', `material ${material.materialId}`, ''])].join('\n')}\n`
}

function completeDocument(path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]): string {
  const contract = getGameDocumentContract(path)
  return `${DOCUMENT_METADATA}${[`# ${path}`, '', '<!-- beegame-executive-summary -->', '## Executive Summary', '', 'summary authority', '', ...contract.sections.flatMap(section => [
    `<!-- beegame-section:${section.sectionId} -->`,
    `## ${section.title}`,
    '',
    ...FOUNDATION_FACT_CATALOG
      .filter(fact => fact.owner.documentPath === path && fact.owner.sectionId === section.sectionId)
      .map(fact => `${fact.key}: ${JSON.stringify(consistentFactValue(fact.key))}`),
    '',
    ]), '<!-- beegame-production-materials -->', '## Production Materials', '', ...contract.productionMaterials.flatMap(material => [`<!-- beegame-material:${material.materialId} -->`, `### ${material.title}`, '', `material ${material.materialId}`, ''])].join('\n')}\n`
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

function staleTopLevelTerminalDispatch(revision: string): NonNullable<DeliveryRun['activeDispatch']> {
  const startedAt = new Date(0).toISOString()
  return {
    dispatchId: 'stale-document-author-terminal',
    workerType: 'document-author',
    phase: 'DOCUMENT_REVIEW',
    revision,
    status: 'completed',
    startedAt,
    finishedAt: startedAt,
    terminalResult: { workerType: 'document-author', status: 'completed' },
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
    'asset.covered_level_requirements': ['asset'],
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
  async function preparedController(workerPortFactory?: (started: Set<string>, requests: WorkerDispatchRequest[]) => DeliveryWorkerPort, resumeImmediately = true, documentOverrides: Partial<Record<(typeof CANONICAL_FOUNDATION_DOCUMENTS)[number], string>> = {}) {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-fact-runtime-'))
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) await writeFile(join(workspacePath, path), documentOverrides[path] ?? document(path))
    const context = '{"game":"bee"}'
    const run = createInitialDeliveryRun({ projectId: 'project', ownerId: 'owner', confirmedBriefContext: context, confirmedBriefDigest: createHash('sha256').update(context).digest('hex'), documentRevision: 'rev-1', workspaceRevision: 'workspace-1' })
    const ready = { ...run, phase: 'DOCUMENT_DRAFTING' as const, documentStep: 'FOUNDATION_DRAFTING' as const, foundationDraftState: { completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS] }, revision: { ...run.revision, document: 'rev-1' } }
    const started = new Set<string>()
    const requests: WorkerDispatchRequest[] = []
    const controller = createDeliveryWorkflowController({ workspacePath, ownerId: 'owner', workerPort: workerPortFactory ? workerPortFactory(started, requests) : port(started, requests) })
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
        const packet = task.dispatch!.request!.contract.packet as { keys: string[]; sections: Array<{ documentPath: string; sectionId: string; startLine: number; endLine: number; text: string }> }
        await controller.store.addWorkflowUsage(snapshot!.runId, { input_tokens: 2, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 3, total_tokens: 5 }, task.dispatch!.dispatchId)
        await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, { workerType: 'foundation-fact-extractor', status: 'completed', runId: snapshot!.runId, dispatchId: task.dispatch!.dispatchId, taskId, revision: task.revision, packetDigest: task.packetDigest, results: await presentFactResults(workspacePath, packet) })
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

  test('publishes mechanically resolved and worker-resolved facts through one complete store', async () => {
    const mechanicalGdd = document('docs/GDD.md').replace('unresolved prose', 'players.max: 4')
    const { workspacePath, controller, requests } = await preparedController(undefined, true, { 'docs/GDD.md': mechanicalGdd })
    try {
      await finishFacts(controller)
      const committed = await loadCommittedFoundationDerivedArtifacts({ workspacePath, revision: 'rev-1' })
      expect(committed?.factStore).toHaveLength(FOUNDATION_FACT_CATALOG.length)
      expect(committed?.factStore.find(fact => fact.key === 'game.players.max')?.value).toBe(4)
      expect(committed?.factStore.find(fact => fact.key === 'game.platform')?.value).toBe('quest')
      const factPackets = requests.filter(request => request.workerType === 'foundation-fact-extractor')
      expect(factPackets.every(request => !((request.contract as { packet?: { keys?: string[] } }).packet?.keys ?? []).includes('game.players.max'))).toBe(true)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('publishes admitted absent facts and lets deterministic review own missing-value issues', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const absentKeys = new Set(['game.boss.count', 'asset.boss.count'])
      const current = await finishFacts(controller, key =>
        absentKeys.has(key) ? undefined : consistentFactValue(key),
      )
      expect(current.status).toBe('running')
      expect(current.foundationAuditState?.status).toBe('semantic_review')
      expect(current.blockedReason).toBeUndefined()
      const committed = await loadCommittedFoundationDerivedArtifacts({ workspacePath, revision: 'rev-1' })
      expect(committed?.factStore.some(fact => absentKeys.has(fact.key))).toBe(false)
      expect(committed?.factStore).toHaveLength(FOUNDATION_FACT_CATALOG.length - absentKeys.size)
      expect(current.foundationAuditState?.deterministic?.reviewDigest).toMatch(/^[a-f0-9]{64}$/)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('passes canonical documents into the production deterministic review', async () => {
    const gdd = document('docs/GDD.md').replaceAll(
      'unresolved prose',
      '每次间隙的可用露珠不能同时满足建造与升级。',
    )
    const { workspacePath, controller } = await preparedController(undefined, true, {
      'docs/GDD.md': gdd,
    })
    try {
      const current = await finishFacts(controller)
      expect({ status: current.status, blockedReason: current.blockedReason }).toEqual({
        status: 'running',
        blockedReason: undefined,
      })
      const reviewDigest = current.foundationAuditState?.deterministic?.reviewDigest
      expect(reviewDigest).toMatch(/^[a-f0-9]{64}$/)
      const review = await loadDeterministicFoundationReview({
        workspacePath,
        revision: 'rev-1',
        reviewDigest: reviewDigest!,
      })
      expect(review?.issues).toContainEqual(expect.objectContaining({
        expected: expect.stringContaining('FIXED_SETTLEMENT_DEW'),
        remediation: {
          kind: 'patch',
          documentPath: 'docs/GDD.md',
          sectionIds: ['progression'],
        },
      }))
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('isolates deterministic seeding failure from admitted fact tasks and fails the run closed', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const originalGdd = await readFile(join(workspacePath, 'docs/GDD.md'), 'utf8')
      const originalCommit = controller.store.commit.bind(controller.store)
      controller.store.commit = async (next, event, acceptedUnits, lease) => {
        const committed = await originalCommit(next, event, acceptedUnits, lease)
        if (event.type === 'foundation.audit.deterministic_ready') {
          await writeFile(join(workspacePath, 'docs/GDD.md'), `${await readFile(join(workspacePath, 'docs/GDD.md'), 'utf8')}\nchanged after deterministic admission\n`)
        }
        return committed
      }

      const after = await finishFacts(controller)
      expect(after.status).toBe('needs_action')
      expect(after.blockedReason).toMatch(/semantic audit source changed after commit: docs\/GDD\.md/)
      expect(after.foundationAuditState?.status).toBe('deterministic_ready')
      const factTasks = after.foundationAuditState?.tasks.filter(task => task.kind === 'document-facts') ?? []
      expect(factTasks).toHaveLength(8)
      expect(factTasks.every(task => task.status === 'completed' && task.receiptPath && task.receiptDigest && task.terminalDigest)).toBe(true)

      await writeFile(join(workspacePath, 'docs/GDD.md'), originalGdd)
      const retried = await retryRun({ store: controller.store, runId: after.runId, workspacePath })
      await controller.resume(retried)
      const recovered = await controller.store.load()
      expect(recovered?.status).toBe('running')
      expect(recovered?.foundationAuditState?.status).toBe('semantic_review')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('zero worker packets use the same finalizer and commit a complete store', async () => {
    const completeDocuments = Object.fromEntries(CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, completeDocument(path)])) as Partial<Record<(typeof CANONICAL_FOUNDATION_DOCUMENTS)[number], string>>
    const { workspacePath, controller, requests } = await preparedController(undefined, true, completeDocuments)
    try {
      const current = await controller.store.load()
      expect(current?.foundationAuditState?.status).toBe('semantic_review')
      expect(requests.filter(request => request.workerType === 'foundation-fact-extractor')).toHaveLength(0)
      const committed = await loadCommittedFoundationDerivedArtifacts({ workspacePath, revision: 'rev-1' })
      expect(committed?.factStore).toHaveLength(FOUNDATION_FACT_CATALOG.length)
      expect(JSON.parse((await readFile(join(workspacePath, '.beegame/audit/foundation/rev-1/derived/COMMITTED.json'))).toString()).status).toBe('committed')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('keeps invalid results retryable and replays an admitted terminal idempotently', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      let current = await controller.store.load()
      const task = current!.foundationAuditState!.tasks.find((candidate): candidate is FoundationFactTask => candidate.kind === 'document-facts' && candidate.status === 'running')!
      await expect(controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, {
        workerType: 'foundation-fact-extractor', status: 'completed', runId: current!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId,
        revision: task.revision, packetDigest: task.packetDigest,
        results: [{ key: 'not-in-packet', status: 'absent' }],
      })).rejects.toThrow()
      current = await controller.store.load()
      const retryable = current!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      // The retryable boundary is immediately claimed by the serialized
      // controller resume; the durable second attempt is already running.
      expect(retryable.status).toBe('running')
      expect(retryable.attempt).toBe(2)
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
      const completed = admitted!.foundationAuditState!.tasks.find((candidate): candidate is FoundationFactTask => candidate.taskId === task.taskId && candidate.kind === 'document-facts')!
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
      expect(replayed!.foundationAuditState!.tasks.find((candidate): candidate is FoundationFactTask => candidate.taskId === task.taskId && candidate.kind === 'document-facts')!.receiptDigest).toBe(receiptDigest)
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

  test('converges a stale running projection without replaying an admitted semantic needs_action terminal', async () => {
    const { workspacePath, controller, started } = await preparedController()
    try {
      await finishFacts(controller)
      const current = await controller.store.load()
      const audit = current?.foundationAuditState
      if (!current || !audit) throw new Error('semantic audit fixture is incomplete')
      const semanticTasks = audit.tasks.filter(task => task.kind === 'semantic')
      if (semanticTasks.length < 4) throw new Error('semantic audit task fixture is incomplete')
      const admitted = semanticTasks[0]!
      const interrupted = semanticTasks.slice(1, 3)
      const pending = semanticTasks[3]!
      const staleTasks = audit.tasks.map(task => {
        if (task.taskId === admitted.taskId)
          return {
            ...task,
            status: 'needs_action' as const,
            dispatch: task.dispatch
              ? { ...task.dispatch, status: 'completed' as const, terminalResult: { status: 'completed' } }
              : undefined,
            failureReason: 'semantic audit needs action',
          }
        if (interrupted.some(candidate => candidate.taskId === task.taskId))
          return {
            ...task,
            status: 'running' as const,
            dispatch: task.dispatch
              ? { ...task.dispatch, status: 'running' as const }
              : undefined,
          }
        if (task.taskId === pending.taskId)
          return { ...task, status: 'pending' as const, dispatch: undefined }
        return task.status === 'running'
          ? { ...task, status: 'pending' as const, dispatch: undefined }
          : task
      })
      const stale = {
        ...current,
        status: 'running' as const,
        blockedReason: 'semantic audit needs action',
        foundationAuditState: { ...audit, tasks: staleTasks },
      }
      await controller.store.commit(stale, {
        runId: stale.runId,
        type: 'test.stale.running.foundation.audit',
        phase: stale.phase,
        status: stale.status,
        revision: stale.revision,
      })
      const recovered = await controller.store.reconcile(async () => false)
      expect(recovered).toMatchObject({ status: 'needs_action', blockedReason: 'semantic audit needs action' })
      expect(recovered!.foundationAuditState!.tasks.filter(task => task.status === 'retryable')).toHaveLength(2)

      // Reproduce the stale top-level projection observed after recovery. The
      // next progress check must repair only the projection, not the terminal.
      const staleProjection = { ...recovered!, status: 'running' as const }
      await controller.store.commit(staleProjection, {
        runId: staleProjection.runId,
        type: 'test.stale.running.foundation.audit.projection',
        phase: staleProjection.phase,
        status: staleProjection.status,
        revision: staleProjection.revision,
      })
      await controller.ensureProgress(staleProjection)

      const converged = await controller.store.load()
      const convergedAdmitted = converged!.foundationAuditState!.tasks.find(task => task.taskId === admitted.taskId)!
      expect(converged).toMatchObject({ status: 'needs_action', blockedReason: 'semantic audit needs action' })
      expect(convergedAdmitted).toMatchObject({ status: 'needs_action', dispatch: { status: 'completed', terminalResult: { status: 'completed' } } })
      expect(converged!.foundationAuditState!.tasks.filter(task => task.status === 'retryable')).toHaveLength(2)
      expect(converged!.foundationAuditState!.tasks.filter(task => task.status === 'running')).toHaveLength(0)
      expect(started.size).toBe(12)
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
      expect(after!.foundationAuditState!.tasks.filter((task): task is FoundationFactTask => task.kind === 'document-facts' && Boolean(task.receiptPath && task.receiptDigest))).toHaveLength(2)
      expect(after!.foundationAuditState!.tasks.filter(task => task.usage)).toHaveLength(2)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('admits a detailed fact result without a fixed business token gate', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const current = await controller.store.load()
      const task = current!.foundationAuditState!.tasks.find((candidate): candidate is FoundationFactTask => candidate.kind === 'document-facts' && candidate.status === 'running')!
      await controller.store.addWorkflowUsage(current!.runId, { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 1, total_tokens: 2 }, task.dispatch!.dispatchId)
      const packet = task.dispatch!.request!.contract.packet as { keys: string[]; sections: Array<{ documentPath: string; sectionId: string; startLine: number; endLine: number }> }
      const oversizedResults = (await presentFactResults(workspacePath, packet)) as Array<Record<string, unknown>>
      const first = oversizedResults[0]!
      delete first.value
      first.status = 'uncertain'
      first.reason = 'x'.repeat(12_000)
      await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, {
        workerType: 'foundation-fact-extractor', status: 'completed', runId: current!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId,
        revision: task.revision, packetDigest: task.packetDigest,
        results: oversizedResults,
      })
      const after = await controller.store.load()
      const completedTask = after!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(completedTask.status).toBe('completed')
      expect(completedTask.failureReason).toBeUndefined()
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('admits a small final payload despite large provider completion usage', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const current = await controller.store.load()
      const task = current!.foundationAuditState!.tasks.find((candidate): candidate is FoundationFactTask => candidate.kind === 'document-facts' && candidate.status === 'running')!
      await controller.store.addWorkflowUsage(current!.runId, { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 4_897, total_tokens: 4_898 }, task.dispatch!.dispatchId)
      const packet = task.dispatch!.request!.contract.packet as { keys: string[] }
      await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, {
        workerType: 'foundation-fact-extractor', status: 'completed', runId: current!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId,
        revision: task.revision, packetDigest: task.packetDigest,
        results: packet.keys.map(key => ({ key, status: 'absent' })),
      })
      const after = await controller.store.load()
      expect(after!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!.status).toBe('completed')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  async function finishFacts(controller: ReturnType<typeof createDeliveryWorkflowController>, valueForKey: (key: string) => FactValue | undefined = consistentFactValue) {
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
      ...(outcome === 'ISSUES' ? { issues: [{ problem: 'encounter has no readable counterplay', expected: 'counterplay is explicit', actual: 'counterplay is absent', sourceSectionKey: sectionKey, remediation: { kind: 'patch' as const, sectionKeys: [sectionKey] } }] } : {}),
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
    // `game.boss.count` is intentionally omitted from semantic packets because
    // its owner section is not needed once normalized facts are bound. Use a
    // declared packet fact to exercise the revision-owner path.
    const targetFact = FOUNDATION_FACT_CATALOG.find(fact => fact.key === 'game.mechanics')!
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
    if (!issued) throw new Error('semantic packet did not contain the declared game.mechanics owner section')
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
    await commitFoundationRevisionDocumentMetadata({
      workspacePath,
      canonicalPath: task.documentPath,
      stagedPath: task.stagedPath,
      expectedCanonicalDigest: task.baseDocumentDigest,
    })
    const stagedBytes = await readFile(stageAbsolute)
    const receiptWithoutTerminal = { taskId: task.taskId, round: task.round, documentPath: task.documentPath, issueIds: [...task.issueIds], baseDocumentDigest: task.baseDocumentDigest, stagedDocumentDigest: createHash('sha256').update(stagedBytes).digest('hex'), changedSectionIds: [task.sectionIds[0]!], stagedPath: task.stagedPath }
    return { workerType: 'foundation-document-reviser' as const, status: 'completed' as const, runId: run!.runId, dispatchId: request.dispatchId!, taskId: task.taskId, revision: task.revision, packetDigest: task.packetDigest, round: task.round, documentPath: task.documentPath, declaration: { status: 'APPLIED' as const, receipt: { ...receiptWithoutTerminal, terminalDigest: revisionTaskReceiptTerminalDigest(receiptWithoutTerminal) } } }
  }

  async function makeUnauthorizedRevisionTerminal(workspacePath: string, run: DeliveryRun, task: FoundationRevisionDocumentTask) {
    const request = task.dispatch!.request!
    const packet = await loadFoundationRevisionPacket({ workspacePath, revision: task.revision, round: task.round, taskId: task.taskId, documentPath: task.documentPath, packetDigest: task.packetDigest }) as { sections: Array<{ sectionId: string; startLine: number; endLine: number; text: string }> }
    const authorized = packet.sections.find(section => task.sectionIds.includes(section.sectionId))!
    const base = await readFile(join(workspacePath, task.documentPath), 'utf8')
    const allSections = buildFoundationSectionIndex({ documents: { [task.documentPath]: base } })
    const unauthorized = allSections.find(section => !task.sectionIds.includes(section.sectionId))
    if (!unauthorized) throw new Error(`fixture has no unauthorized section: ${task.sectionIds.join(',')}`)
    const stageAbsolute = join(workspacePath, task.stagedPath)
    const stagedLines = (await readFile(stageAbsolute, 'utf8')).split('\n')
    stagedLines.splice(authorized.startLine - 1, authorized.endLine - authorized.startLine, ...authorized.text.replace('unresolved prose', 'revised prose').split('\n'))
    const unauthorizedText = base.split('\n').slice(unauthorized.startLine - 1, unauthorized.endLine).join('\n')
    stagedLines.splice(unauthorized.startLine - 1, unauthorized.endLine - unauthorized.startLine, ...unauthorizedText.replace('unresolved prose', 'unauthorized drift').split('\n'))
    await writeFile(stageAbsolute, stagedLines.join('\n'))
    await commitFoundationRevisionDocumentMetadata({ workspacePath, canonicalPath: task.documentPath, stagedPath: task.stagedPath, expectedCanonicalDigest: task.baseDocumentDigest })
    const stagedBytes = await readFile(stageAbsolute)
    const receiptWithoutTerminal = { taskId: task.taskId, round: task.round, documentPath: task.documentPath, issueIds: [...task.issueIds], baseDocumentDigest: task.baseDocumentDigest, stagedDocumentDigest: createHash('sha256').update(stagedBytes).digest('hex'), changedSectionIds: [authorized.sectionId], stagedPath: task.stagedPath }
    return { workerType: 'foundation-document-reviser' as const, status: 'completed' as const, runId: run.runId, dispatchId: request.dispatchId!, taskId: task.taskId, revision: task.revision, packetDigest: task.packetDigest, round: task.round, documentPath: task.documentPath, declaration: { status: 'APPLIED' as const, receipt: { ...receiptWithoutTerminal, terminalDigest: revisionTaskReceiptTerminalDigest(receiptWithoutTerminal) } } }
  }

  async function completeFactOwnerRevision(controller: ReturnType<typeof createDeliveryWorkflowController>, workspacePath: string, replacement = 'revised prose') {
    const { run: current, targetFact } = await driveToFactOwnerRevisionIssue(controller)
    const documentTask = current.foundationAuditState!.tasks.find(task => task.kind === 'document-revision')! as FoundationRevisionDocumentTask
    expect(documentTask.documentPath).toBe(targetFact.owner.documentPath)
    expect(documentTask.sectionIds).toContain(targetFact.owner.sectionId)
    const terminal = await makeRevisionTerminal(workspacePath, current, documentTask, replacement)
    await controller.dispatcher.completeDispatch(documentTask.dispatch!.dispatchId, terminal)
    return { targetFact, rebuilding: (await controller.store.load())! }
  }

  async function seedRoundClosingRevision(options: { resultingIssue?: boolean; round?: number; unchangedBefore?: boolean } = {}) {
    const prepared = await preparedController()
    const round = options.round ?? 1
    const { rebuilding } = await completeFactOwnerRevision(prepared.controller, prepared.workspacePath, ownerFactText('game.mechanics'))
    const current = rebuilding
    const documentTask = current.foundationAuditState!.tasks.find(task => task.kind === 'document-revision' && task.status === 'completed')! as FoundationRevisionDocumentTask
    const packet = await loadFoundationRevisionPacket({ workspacePath: prepared.workspacePath, revision: documentTask.revision, round: documentTask.round, taskId: documentTask.taskId, documentPath: documentTask.documentPath, packetDigest: documentTask.packetDigest }) as { issues: AuditIssue[] }
    const receiptCore = { ...documentTask.receipt!, round }
    const roundReceipt = { ...receiptCore, terminalDigest: revisionTaskReceiptTerminalDigest((({ terminalDigest: _terminal, ...core }) => core)(receiptCore)) }
    const roundPacketPath = foundationRevisionPacketPath(documentTask.revision, round, documentTask.taskId)
    const terminalResult = documentTask.dispatch!.terminalResult as Record<string, unknown>
    const request = documentTask.dispatch!.request as WorkerDispatchRequest
    const roundTask: FoundationRevisionDocumentTask = {
      ...documentTask,
      bundleId: `${documentTask.revision}.round-fixture.${round}`,
      round,
      packetPath: roundPacketPath,
      terminalDigest: roundReceipt.terminalDigest,
      receipt: roundReceipt,
      dispatch: {
        ...documentTask.dispatch!,
        request: { ...request, contract: { ...request.contract, round, packetPath: roundPacketPath } },
        terminalResult: { ...terminalResult, round, declaration: { status: 'APPLIED' as const, receipt: roundReceipt } },
      },
    }
    const operations = await deriveFoundationPatchOperations({ workspacePath: prepared.workspacePath, revision: roundTask.revision, taskId: roundTask.taskId, batch: { documentPath: roundTask.documentPath, issueIds: roundTask.issueIds, sectionIds: roundTask.sectionIds }, issues: packet.issues, receipt: roundReceipt })
    const baseDerived = await loadCommittedFoundationDerivedArtifacts({ workspacePath: prepared.workspacePath, revision: current.foundationAuditState!.revision })
    if (!baseDerived) throw new Error('round fixture requires committed derived authority')
    const sourceIssueAuthority = current.foundationAuditState!.authority!.issueAuthority
    let before = { documentRevision: current.foundationAuditState!.revision, issueRegistryDigest: sourceIssueAuthority.issueRegistryDigest, issueAuthority: sourceIssueAuthority }
    const sourceIssue = packet.issues[0]!
    const resultingIssues = options.resultingIssue ? [{ ...sourceIssue, id: `NEXT-${options.round ?? 1}`, severity: 'HIGH' as const }] : []
    const publication = await publishFoundationRevision({
      workspacePath: prepared.workspacePath,
      revision: current.foundationAuditState!.revision,
      confirmedBriefDigest: current.confirmedBriefDigest,
      round,
      batches: [{ documentPath: roundTask.documentPath, sectionIds: roundTask.sectionIds, issueIds: roundTask.issueIds }],
      receipts: [roundReceipt],
      revisionDeclarations: [{ status: 'APPLIED' as const, changedSectionIds: [...roundReceipt.changedSectionIds] }],
      patchOperations: operations,
      patchValidations: [],
      semanticRecheckResults: [{ taskId: roundTask.taskId, issueId: roundTask.issueIds[0]!, packetDigest: roundTask.packetDigest, status: 'PASS' }],
      resultingIssues,
    })
    if (options.unchangedBefore) {
      const issueAuthority = { kind: 'publication' as const, baseRevision: current.foundationAuditState!.revision, authorityDigest: publication.authorityDigest, issueRegistryDigest: publication.resultingIssueRegistryDigest }
      before = { documentRevision: publication.resultingRevision, issueRegistryDigest: publication.resultingIssueRegistryDigest, issueAuthority }
    }
    const documents = Object.fromEntries(await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(prepared.workspacePath, path), 'utf8')] as const)))
    const resultingDerived = await publishFoundationDerivedArtifacts({
      workspacePath: prepared.workspacePath,
      revision: publication.resultingRevision,
      documentDigests: Object.entries(publication.documentDigests).map(([path, digest]) => ({ path, digest })) as Array<{ path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]; digest: string }>,
      sectionIndex: buildFoundationSectionIndex({ documents }),
      factStore: baseDerived.factStore,
      normalizedFactDigest: digestFactStore(baseDerived.factStore),
      manifest: {},
    })
    const foundationAuditState: FoundationAuditState = {
      ...current.foundationAuditState!,
      documentDigests: Object.fromEntries(Object.entries(publication.documentDigests)) as FoundationAuditState['documentDigests'],
      sectionIndexDigest: resultingDerived.digests.sectionIndex,
      sectionIndexPath: `.beegame/audit/foundation/${publication.resultingRevision}/derived/section-index.json`,
      manifestPath: `.beegame/audit/foundation/${publication.resultingRevision}/derived/manifest.json`,
      authority: {
        issueAuthority: { kind: 'publication', baseRevision: current.foundationAuditState!.revision, authorityDigest: publication.authorityDigest, issueRegistryDigest: publication.resultingIssueRegistryDigest },
        derivedDigests: { sectionIndex: resultingDerived.digests.sectionIndex, factStore: resultingDerived.digests.factStore, manifest: resultingDerived.digests.manifest },
        documentDigests: Object.entries(publication.documentDigests).map(([path, digest]) => ({ path, digest })) as Array<{ path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]; digest: string }>,
      },
      roundBefore: before,
      revision: publication.resultingRevision,
      round,
      status: 'round_closing',
      phaseStartedAt: new Date().toISOString(),
      issueSummary: { total: resultingIssues.length, blocker: 0, high: resultingIssues.length, medium: 0, low: 0 },
      tasks: [roundTask],
      activeBundleId: roundTask.bundleId,
      revisionBundles: [{ bundleId: roundTask.bundleId, status: 'active', round, baseDocumentRevision: roundTask.revision, baseDocumentDigests: Object.entries(publication.documentDigests).map(([path, digest]) => ({ path, digest })) as Array<{ path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]; digest: string }>, remediationDigest: createHash('sha256').update(`round-fixture:${round}`).digest('hex'), taskIds: [roundTask.taskId], frozenTaskIds: [] }],
      publication: { preparedPath: publication.preparedPath, journalPath: publication.journalPath, committedPath: publication.committedPath, authorityDigest: publication.authorityDigest, resultingRevision: publication.resultingRevision, resultingIssueRegistryDigest: publication.resultingIssueRegistryDigest },
      derived: { manifestPath: `.beegame/audit/foundation/${publication.resultingRevision}/derived/manifest.json`, manifestDigest: resultingDerived.digests.manifest, markerPath: `.beegame/audit/foundation/${publication.resultingRevision}/derived/COMMITTED.json`, markerDigest: resultingDerived.digests.marker, factStorePath: `.beegame/audit/foundation/${publication.resultingRevision}/derived/fact-store.json`, factStoreDigest: resultingDerived.digests.factStore, sectionIndexPath: `.beegame/audit/foundation/${publication.resultingRevision}/derived/section-index.json`, sectionIndexDigest: resultingDerived.digests.sectionIndex },
    }
    const seeded = { ...current, status: 'running' as const, documentStep: 'FOUNDATION_REVIEW' as const, revision: { ...current.revision, document: publication.resultingRevision }, foundationAuditState }
    await prepared.controller.store.commit(seeded, { runId: seeded.runId, type: 'test.foundation.revision.round_closing', phase: seeded.phase, status: seeded.status, revision: seeded.revision })
    return { ...prepared, run: seeded, resultingIssues }
  }

  async function driveToRevisionFactPlanning(controller: ReturnType<typeof createDeliveryWorkflowController>, workspacePath: string, replacement = 'revised prose') {
    const { targetFact, rebuilding } = await completeFactOwnerRevision(controller, workspacePath, replacement)
    await controller.resume(rebuilding!)
    return { targetFact, rebuilding, current: await controller.store.load() }
  }

  async function completeImpactedFact(controller: ReturnType<typeof createDeliveryWorkflowController>, workspacePath: string) {
    const { rebuilding } = await completeFactOwnerRevision(controller, workspacePath, 'game.resources: []\nunresolved prose')
    await controller.resume(rebuilding!)
    const planned = await controller.store.load()
    const task = planned!.foundationAuditState!.tasks.find(candidate => candidate.kind === 'impacted-facts')!
    const packet = JSON.parse((await readFile(join(workspacePath, task.packetPath))).toString()) as { keys: string[]; sections: Array<{ documentPath: string; sectionId: string; startLine: number; endLine: number }> }
    await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, { workerType: 'foundation-fact-extractor', status: 'completed', runId: planned!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId, revision: task.revision, packetDigest: task.packetDigest, results: await presentFactResults(workspacePath, packet) })
    return { task, run: await controller.store.load() }
  }

  async function reachSemanticRecheck(controller: ReturnType<typeof createDeliveryWorkflowController>, workspacePath: string) {
    await completeFactOwnerRevision(controller, workspacePath, ownerFactText('game.mechanics'))
    let current = await controller.store.load()
    for (let attempt = 0; attempt < 4 && current?.foundationAuditState?.status !== 'semantic_recheck'; attempt++) {
      await controller.resume(current!)
      current = await controller.store.load()
    }
    return current!
  }

  function revisionSemanticRequest(run: DeliveryRun, task: FoundationRevisionSemanticRecheckTask, workspacePath: string): WorkerDispatchRequest {
    return { runId: run.runId, ownerId: run.ownerId, projectId: run.projectId, workspacePath, workerType: 'foundation-semantic-reviewer', phase: 'DOCUMENT_REVIEW', taskId: task.taskId, revision: task.revision, allowedPaths: [], projectReadScope: 'empty', workflowJsonSchema: foundationSemanticRecheckStructuredOutputJsonSchema as unknown as Record<string, unknown>, contract: { workerType: 'foundation-semantic-reviewer', taskId: task.taskId, revision: task.revision, round: task.round, issueId: task.issueId, packetPath: task.packetPath, packetDigest: task.packetDigest, modelTier: task.modelTier } }
  }

  async function exerciseSemanticNegativeOutcome() {
    const { workspacePath, controller, requests } = await preparedController()
    const originalCommit = controller.store.commit.bind(controller.store)
    let terminalEvidence: FoundationRevisionSemanticRecheckTask | undefined
    try {
      const canonicalBefore = new Map(await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(workspacePath, path), 'utf8')] as const)))
      await completeFactOwnerRevision(controller, workspacePath, ownerFactText('game.mechanics'))
      let current = await controller.store.load()
      for (let attempt = 0; attempt < 4 && current?.foundationAuditState?.status !== 'semantic_recheck'; attempt++) {
        await controller.resume(current!)
        current = await controller.store.load()
      }
      expect(current?.foundationAuditState?.status).toBe('semantic_recheck')
      const beforeRegistry = current?.foundationAuditState
      const task = current!.foundationAuditState!.tasks.find(candidate => candidate.kind === 'semantic-recheck')!
      controller.store.commit = async (...args) => {
        const candidate = args[0] as DeliveryRun
        const admitted = candidate.foundationAuditState?.tasks.find(item => item.taskId === task.taskId)
        if (admitted?.kind === 'semantic-recheck' && admitted.status === 'completed') terminalEvidence = admitted
        return originalCommit(...args)
      }
      await controller.resume(current!)
      const claimed = await controller.store.load()
      const request = requests.find(candidate => candidate.taskId === task.taskId)
      expect(request).toBeDefined()
      if (!request) return
      const runningTask = claimed!.foundationAuditState!.tasks.find((candidate): candidate is FoundationRevisionSemanticRecheckTask => candidate.taskId === task.taskId && candidate.kind === 'semantic-recheck')!
      const packet = JSON.parse((await readFile(join(workspacePath, runningTask.packetPath))).toString()) as { sections?: Array<{ sectionKey: string }> }
      const sectionKey = packet.sections?.[0]?.sectionKey ?? 'GDD#core_loop'
      const issue = { problem: 'counterplay remains unclear', expected: 'counterplay is explicit', actual: 'counterplay is absent', sourceSectionKey: sectionKey, remediation: { kind: 'patch' as const, sectionKeys: [sectionKey] } }
      const source = runningTask.kind === 'semantic-recheck' ? runningTask.issue.source : undefined
      await controller.dispatcher.completeDispatch(request.dispatchId!, {
        workerType: 'foundation-semantic-reviewer', status: 'completed', runId: claimed!.runId, dispatchId: request.dispatchId!, taskId: runningTask.taskId, revision: runningTask.revision, packetDigest: runningTask.packetDigest,
        outcome: 'FAIL', diagnostic: { observedActual: 'counterplay is absent', evidence: source ? [{ documentPath: source.documentPath, sectionId: source.sectionId, digest: source.digest }] : [], failureReasonCode: 'actual_persists', scopeAssessment: 'repairable_in_scope' },
      })
      const after = await controller.store.load()
      expect(after!.status).toBe('running')
      expect(after!.foundationAuditState!.status).toBe('revising')
      expect(after!.foundationAuditState!.round).toBe(beforeRegistry!.round)
      expect(after!.foundationAuditState!.publication).toBeUndefined()
      for (const path of CANONICAL_FOUNDATION_DOCUMENTS) expect(await readFile(join(workspacePath, path), 'utf8')).toBe(canonicalBefore.get(path)!)
      controller.store.commit = originalCommit
      const admittedTask = terminalEvidence ?? after!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)
      expect(admittedTask).toMatchObject({
        dispatch: { status: 'completed' },
        usage: { total_tokens: 0 },
        durationMs: expect.any(Number),
      })
      expect(admittedTask?.kind === 'semantic-recheck' && admittedTask.resultPath).toBeTruthy()
      if (admittedTask?.kind === 'semantic-recheck' && admittedTask.resultPath) {
        const resultArtifact = JSON.parse((await readFile(join(workspacePath, admittedTask.resultPath))).toString()) as { status?: string }
        expect(resultArtifact.status).toBe('FAIL')
      }
    } finally { controller.store.commit = originalCommit; await rm(workspacePath, { recursive: true, force: true }) }
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

  test('ignores stale semantic resume when another wave fills the durable concurrency limit', async () => {
    const { workspacePath, controller, started, requests } = await preparedController()
    try {
      await finishFacts(controller)
      const durable = await controller.store.load()
      const audit = durable?.foundationAuditState
      expect(audit?.status).toBe('semantic_review')
      const runningSemantic = audit?.tasks.filter(task => (task.kind === 'semantic' || task.kind === 'confirmation') && task.status === 'running') ?? []
      expect(runningSemantic).toHaveLength(4)
      const staleTasks = (audit?.tasks ?? []).map(task => {
        if (task.kind !== 'semantic' && task.kind !== 'confirmation') return task
        const { dispatch: _dispatch, ...withoutDispatch } = task
        return { ...withoutDispatch, status: 'pending' as const, attempt: 0 } as typeof task
      })
      const semanticTarget = staleTasks.find(task => task.kind === 'semantic' && task.status === 'pending' && task.taskId !== runningSemantic[0]?.taskId)
      if (!durable || !audit || !semanticTarget) throw new Error('semantic stale snapshot fixture is incomplete')
      const orderedStaleTasks = [semanticTarget, ...staleTasks.filter(task => task.taskId !== semanticTarget.taskId)]
      const stale = { ...durable, foundationAuditState: { ...audit, tasks: orderedStaleTasks } } as DeliveryRun
      const second = createDeliveryWorkflowController({ workspacePath, ownerId: durable.ownerId, workerPort: port(started, requests) })

      await second.resume(stale)

      const converged = await controller.store.load()
      expect(converged).toMatchObject({ status: 'running', foundationAuditState: { status: 'semantic_review' } })
      expect(converged?.foundationAuditState?.tasks.filter(task => task.status === 'running')).toHaveLength(4)
      expect(started.size).toBe(12)
      expect(requests.filter(request => request.workerType === 'foundation-semantic-reviewer')).toHaveLength(4)
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

  test('automatically resumes retryable semantic workers and drains the pending queue', async () => {
    const completeDocuments = Object.fromEntries(CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, completeDocument(path)])) as Partial<Record<(typeof CANONICAL_FOUNDATION_DOCUMENTS)[number], string>>
    let active = 0
    let maxActive = 0
    const failedOnce = new Set<string>()
    let resolveSemanticTerminals!: () => void
    const semanticTerminals = new Promise<void>(resolve => { resolveSemanticTerminals = resolve })
    let successfulSemanticTerminals = 0
    const { workspacePath, controller, requests } = await preparedController((started, capturedRequests) => {
      const byDispatch = new Map<string, WorkerDispatchRequest>()
      return {
        async start(request) {
          started.add(request.dispatchId!)
          capturedRequests.push(request)
          byDispatch.set(request.dispatchId!, request)
          return { sessionId: request.dispatchId!, dispatchId: request.dispatchId! }
        },
        async submit() {},
        async stop() {},
        async close() {},
        async status(dispatchId) {
          return { dispatchId, workerType: 'foundation-semantic-reviewer', phase: 'DOCUMENT_REVIEW', taskId: byDispatch.get(dispatchId)?.taskId ?? 'unknown', revision: byDispatch.get(dispatchId)?.revision ?? 'rev-1', status: 'interrupted', startedAt: new Date().toISOString() }
        },
        async waitForTerminal(dispatchId) {
          const request = byDispatch.get(dispatchId)
          // Stop the fixture at the semantic boundary. The real controller
          // will advance to checklist drafting after audit_ready; that worker
          // is outside this retry scheduling test.
          if (request?.workerType !== 'foundation-semantic-reviewer') return new Promise<never>(() => {})
          if (!request.taskId) throw new Error(`missing semantic request ${dispatchId}`)
          active += 1
          maxActive = Math.max(maxActive, active)
          try {
            if (failedOnce.size < 4 && !failedOnce.has(request.taskId)) {
              failedOnce.add(request.taskId)
              throw new Error('Failed to provide valid structured output after 5 attempts')
            }
            successfulSemanticTerminals += 1
            if (successfulSemanticTerminals === 10) resolveSemanticTerminals()
            return {
              workerType: 'foundation-semantic-reviewer' as const,
              status: 'completed' as const,
              runId: request.runId,
              dispatchId,
              taskId: request.taskId,
              revision: request.revision,
              packetDigest: request.contract.packetDigest as string,
              outcome: 'PASS' as const,
            }
          } finally {
            active -= 1
          }
        },
      }
    }, true, completeDocuments)
    try {
      await semanticTerminals
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await controller.store.load()
        const semanticTasks = current?.foundationAuditState?.tasks.filter(task => task.kind === 'semantic' || task.kind === 'confirmation') ?? []
        if (semanticTasks.length === 10 && semanticTasks.every(task => task.status === 'completed')) break
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      const current = await controller.store.load()
      const semanticTasks = current?.foundationAuditState?.tasks.filter(task => task.kind === 'semantic' || task.kind === 'confirmation') ?? []
      expect(requests.filter(request => request.workerType === 'foundation-semantic-reviewer')).toHaveLength(14)
      expect(semanticTasks).toHaveLength(10)
      expect(semanticTasks.every(task => task.status === 'completed')).toBe(true)
      expect(maxActive).toBeLessThanOrEqual(4)
      expect(active).toBe(0)
      expect(current?.status).toBe('running')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  }, 15_000)

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
      expect(current?.foundationAuditState?.status).toMatch(/audit_ready|planning|revising/)
      const reviewRoot = join(workspacePath, '.beegame/audit/foundation/rev-1/review')
      const reviewDigest = (await readdir(reviewRoot)).find(name => /^[a-f0-9]{64}$/.test(name))
      if (!reviewDigest) throw new Error('semantic issue registry review evidence was not committed')
      const registry = JSON.parse(await readFile(join(reviewRoot, reviewDigest, 'issue-registry.json'), 'utf8')) as { issues: AuditIssue[] }
      expect(registry.issues).toHaveLength(1)
      expect(registry.issues.filter(issue => issue.type === 'semantic')).toHaveLength(1)
      expect(registry.issues.some(issue => issue.actual === 'counterplay is absent')).toBe(true)
      expect(current!.foundationAuditState!.tasks.every(task => task.kind === 'document-revision' || task.kind === 'impacted-facts' || task.kind === 'semantic-recheck')).toBe(true)
      for (const [path, contents] of canonicalBefore) expect(await readFile(join(workspacePath, path), 'utf8')).toBe(contents)
      const revisionDispatches = requests.filter(request => (request as { workerType: string }).workerType === 'foundation-document-reviser')
      expect(revisionDispatches).toHaveLength(1)
      const remediation = registry.issues[0]!.remediation
      if (remediation.kind !== 'patch') throw new Error('product decision cannot dispatch a revision')
      const expectedStagePath = foundationRevisionStagePath('rev-1', remediation.documentPath)
      expect(revisionDispatches[0]!.allowedPaths).toEqual([expectedStagePath])
      expect(revisionDispatches[0]!.protectedPaths).toEqual([remediation.documentPath])
      expect(revisionDispatches[0]!.contract).not.toHaveProperty('packet')
      expect(current!.foundationAuditState!.tasks.every(task => !Object.hasOwn(task, 'packet'))).toBe(true)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('admits one real foundation revision terminal and persists its receipt', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const canonicalBefore = await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(workspacePath, path))] as const))
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
            ...(outcome === 'ISSUES' ? { issues: [{ problem: 'counterplay is absent', expected: 'counterplay exists', actual: 'counterplay is absent', sourceSectionKey: sectionKey, remediation: { kind: 'patch' as const, sectionKeys: [sectionKey] } }] } : {}),
          })
        }))
        current = await controller.store.load()
      }
      const revisionTask = current!.foundationAuditState!.tasks.find(task => task.kind === 'document-revision')!
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
        round: revisionTask.round,
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
        round: revisionTask.round,
        documentPath: revisionTask.documentPath,
        declaration: { status: 'APPLIED' as const, receipt: { ...receiptWithoutTerminal, terminalDigest: revisionTaskReceiptTerminalDigest(receiptWithoutTerminal) } },
      }
      await controller.dispatcher.completeDispatch(request.dispatchId!, terminal)
      const completed = (await controller.store.load())!.foundationAuditState!.tasks.find(task => task.kind === 'document-revision')!
      expect(completed.status).toBe('completed')
      expect(completed.receipt).toEqual(terminal.declaration.receipt)
      expect(completed.terminalDigest).toBe(terminal.declaration.receipt.terminalDigest)
      expect(completed.dispatch).toMatchObject({ status: 'completed', terminalResult: terminal })
      expect(completed.usage).toMatchObject({ total_tokens: 0 })
      expect(completed.durationMs).toBe(
        Math.max(0, Date.parse(completed.dispatch!.finishedAt!) - Date.parse(completed.dispatch!.startedAt)),
      )
      for (const [path, contents] of canonicalBefore) expect(await readFile(join(workspacePath, path))).toEqual(contents)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('stopping a running revision task preserves interrupted terminal evidence', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const { run } = await driveToFactOwnerRevisionIssue(controller)
      const task = run.foundationAuditState!.tasks.find(candidate => candidate.kind === 'document-revision' && candidate.status === 'running')!
      const beforeStop = (await controller.store.load())!
      await controller.store.save({
        ...beforeStop,
        foundationAuditState: {
          ...beforeStop.foundationAuditState!,
          tasks: beforeStop.foundationAuditState!.tasks.map(candidate =>
            candidate.taskId === task.taskId ? { ...candidate, attempt: 2 } : candidate,
          ) as FoundationAuditState['tasks'],
        },
      })
      await controller.dispatcher.stop(task.dispatch!.dispatchId, 'operator stopped foundation revision')
      const stopped = await controller.store.load()
      const interrupted = stopped!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(interrupted).toMatchObject({
        status: 'retryable',
        attempt: 1,
        failureReason: 'operator stopped foundation revision',
        dispatch: { status: 'interrupted', failureReason: 'operator stopped foundation revision' },
        durationMs: expect.any(Number),
      })
      expect(stopped?.status).toBe('stopped')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('after document receipts, zero unresolved impacted facts advances to targeted semantic recheck', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    try {
      const { current: currentValue } = await driveToRevisionFactPlanning(controller, workspacePath, ownerFactText('game.mechanics'))
      const current = currentValue!
      await controller.resume(current)
      expect((await controller.store.load())?.foundationAuditState?.status).toBe('semantic_recheck')
      expect(current.foundationAuditState?.tasks.some(task => task.kind === 'impacted-facts')).toBe(false)
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
        const planned = next.foundationAuditState?.tasks.find(task => task.kind === 'impacted-facts')
        if (!planningCrashObserved && event.type === 'foundation.revision.impacted_facts.planned' && planned) {
          plannedAtCrash = { taskId: planned.taskId, packetPath: planned.packetPath, packetDigest: planned.packetDigest, bytes: (await readFile(join(workspacePath, planned.packetPath))).toString() }
          planningCrashObserved = true
          throw new Error('simulated impacted planning crash')
        }
        return originalCommit(...args)
      }
      await completeFactOwnerRevision(controller, workspacePath, 'game.resources: []\nunresolved prose').catch(() => undefined)
      expect(planningCrashObserved).toBe(true)
      const factWorkersBefore = requests.filter(request => request.workerType === 'foundation-fact-extractor').length
      const crashed = await controller.store.load()
      expect(crashed?.foundationAuditState?.status).toBe('rebuilding_facts')
      expect(crashed?.foundationAuditState?.tasks.some(task => task.kind === 'impacted-facts')).toBe(false)
      controller.store.commit = originalCommit
      await controller.resume(crashed!)
      const replayedPlanning = await controller.store.load()
      const impacted = replayedPlanning!.foundationAuditState?.tasks.filter(task => task.kind === 'impacted-facts') ?? []
      expect(impacted).toHaveLength(1)
      const task = impacted[0]!
      expect(plannedAtCrash).toBeDefined()
      if (!plannedAtCrash) return
      const stableTask = replayedPlanning!.foundationAuditState!.tasks.find((candidate): candidate is FoundationRevisionImpactedFactsTask => candidate.taskId === plannedAtCrash!.taskId && candidate.kind === 'impacted-facts')!
      expect(stableTask.taskId).toBe(plannedAtCrash.taskId)
      expect(stableTask.packetPath).toBe(plannedAtCrash.packetPath)
      expect(stableTask.packetDigest).toBe(plannedAtCrash.packetDigest)
      expect(stableTask.packetPath).toBe(foundationRevisionPacketPath(stableTask.revision, stableTask.round, stableTask.taskId))
      expect(stableTask.dispatch?.status).toBe('running')
      const packet = JSON.parse((await readFile(join(workspacePath, stableTask.packetPath))).toString()) as { revision: string; packetDigest: string; keys: string[]; sections: Array<{ documentPath: string; sectionId: string; startLine: number; endLine: number }> }
      expect(packet.revision).toBe(stableTask.revision)
      expect(packet.packetDigest).toBe(stableTask.packetDigest)
      expect(stableTask.dispatch?.request?.contract.packet).toEqual(packet)
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
      const admitted = completed!.foundationAuditState!.tasks.find(candidate => candidate.taskId === stableTask.taskId)!
      expect(admitted.status).toBe('completed')
      expect(admitted.kind).toBe('impacted-facts')
      expect('receiptPath' in admitted && admitted.receiptPath).toBeTruthy()
      expect(admitted.dispatch).toMatchObject({ status: 'completed' })
      expect(admitted.usage).toMatchObject({ total_tokens: 0 })
      expect(admitted.durationMs).toBe(
        Math.max(0, Date.parse(admitted.dispatch!.finishedAt!) - Date.parse(admitted.dispatch!.startedAt)),
      )
      expect(requests.filter(request => request.workerType === 'foundation-fact-extractor')).toHaveLength(factWorkersBefore + 1)
      let afterValidation = completed!
      if (afterValidation.foundationAuditState?.status === 'validating') {
        await controller.resume(afterValidation)
        afterValidation = await controller.store.load() as DeliveryRun
      }
      expect(afterValidation!.foundationAuditState!.status).toBe('semantic_recheck')
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
      const task = current.foundationAuditState?.tasks.find(candidate => candidate.kind === 'impacted-facts')!
      expect(task).toBeDefined()
      if (!task) return
      const packet = JSON.parse((await readFile(join(workspacePath, task.packetPath))).toString()) as { keys: string[]; packetDigest: string }
      expect(packet.packetDigest).toBe(task.packetDigest)
      await expect(controller.dispatcher.completeDispatch(task!.dispatch!.dispatchId, {
        workerType: 'foundation-fact-extractor', status: 'completed', runId: current.runId, dispatchId: task!.dispatch!.dispatchId, taskId: task!.taskId, revision: task!.revision, packetDigest: task!.packetDigest, results: await presentFactResults(workspacePath, packet),
      })).rejects.toThrow(/handler|crash/i)
      const retryable = await controller.store.load()
      const failed = retryable!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task!.taskId)!
      expect(failed.status).not.toBe('completed')
      expect(failed.dispatch?.terminalResult).toBeDefined()
      expect('receiptPath' in failed && failed.receiptPath).toBeFalsy()
      const before = requests.filter(request => request.workerType === 'foundation-fact-extractor').length
      controller.store.commit = originalCommit
      await controller.resume(retryable!)
      const replayed = await controller.store.load()
      expect(replayed!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task!.taskId)!.status).toBe('completed')
      expect(requests.filter(request => request.workerType === 'foundation-fact-extractor')).toHaveLength(before)
    } finally { controller.store.commit = originalCommit; await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('stale staged bytes fail closed in impacted-fact planning and never cross the publishing boundary', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const { run: current } = await driveToFactOwnerRevisionIssue(controller)
      const task = current.foundationAuditState!.tasks.find(candidate => candidate.kind === 'document-revision')! as FoundationRevisionDocumentTask
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
      expect(failed?.foundationAuditState?.status).toBe('rebuilding_facts')
      expect(failed?.foundationAuditState?.status).not.toBe('publishing')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('retry resumes validating boundary after all terminals without redispatching workers', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    try {
      const { run: completedValue } = await completeImpactedFact(controller, workspacePath)
      if (!completedValue) throw new Error('validating boundary fixture did not produce a run')
      const completed = completedValue
      const validating = {
        ...completed,
        status: 'running' as const,
        foundationAuditState: {
          ...completed.foundationAuditState!,
          status: 'validating' as const,
          tasks: completed.foundationAuditState!.tasks.filter(task => task.kind !== 'semantic-recheck'),
          revisionBundles: completed.foundationAuditState!.revisionBundles?.map(bundle => ({ ...bundle, taskIds: bundle.taskIds.filter(taskId => completed.foundationAuditState!.tasks.some(task => task.taskId === taskId && task.kind !== 'semantic-recheck')) })),
        },
      }
      await controller.store.commit(validating, { runId: validating.runId, type: 'test.foundation.revision.validating_boundary', phase: validating.phase, status: validating.status, revision: validating.revision })
      const documentTask = validating.foundationAuditState!.tasks.find(task => task.kind === 'document-revision')! as FoundationRevisionDocumentTask
      const stagedAbsolute = join(workspacePath, documentTask.stagedPath)
      const stagedBefore = await readFile(stagedAbsolute)
      await writeFile(stagedAbsolute, Buffer.concat([stagedBefore, Buffer.from('\nstale bytes\n')]))
      await controller.resume(validating)
      const failed = await controller.store.load()
      expect(failed?.status).toBe('needs_action')
      expect(failed?.foundationAuditState?.status).toBe('validating')
      expect(failed?.foundationAuditState?.tasks.every(task => task.status === 'completed')).toBe(true)

      const dispatchCount = requests.length
      const revisionDispatchCount = requests.filter(request => request.workerType === 'foundation-document-reviser').length
      const semanticDispatchCount = requests.filter(request => request.workerType === 'foundation-semantic-reviewer').length
      await writeFile(stagedAbsolute, stagedBefore)
      const retried = await retryRun({ store: controller.store, runId: completed.runId, workspacePath })
      expect(retried.status).toBe('running')
      expect(retried.foundationAuditState?.status).toBe('validating')
      await controller.resume(retried)
      const resumed = await controller.store.load()
      expect(resumed?.foundationAuditState?.status).toBe('semantic_recheck')
      expect(requests.filter(request => request.workerType === 'foundation-document-reviser')).toHaveLength(revisionDispatchCount)
      expect(requests.filter(request => request.workerType === 'foundation-semantic-reviewer').length).toBeGreaterThan(semanticDispatchCount)
      expect(requests.length).toBeGreaterThan(dispatchCount)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('publishes a new impacted issue and starts Round 2 from its registry digest', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      await completeFactOwnerRevision(controller, workspacePath, ownerFactText('game.mechanics', ['move', 'dash'])).catch(() => undefined)
      let current = await controller.store.load()
      expect(current?.foundationAuditState?.status).toBe('semantic_recheck')
      while (current?.foundationAuditState?.status === 'semantic_recheck') {
        await controller.resume(current)
        current = await controller.store.load()
        const running = current!.foundationAuditState!.tasks.find(
          task => task.kind === 'semantic-recheck' && task.status === 'running',
        )
        if (!running) {
          await controller.resume(current!)
        } else {
          const dispatchId = running.dispatch!.dispatchId
          await controller.dispatcher.completeDispatch(dispatchId, {
            workerType: 'foundation-semantic-reviewer',
            status: 'completed',
            runId: current!.runId,
            dispatchId,
            taskId: running.taskId,
            revision: running.revision,
            packetDigest: running.packetDigest,
            outcome: 'PASS',
          })
        }
        current = await controller.store.load()
      }
      expect(['round_closing', 'planning', 'revising']).toContain(current?.foundationAuditState?.status ?? '')
      const next = current!
      expect(next?.foundationAuditState?.round).toBe(2)
      const issueAuthority = next!.foundationAuditState!.authority!.issueAuthority
      expect(issueAuthority.kind).toBe('publication')
      const publishedIssueRegistryDigest = issueAuthority.kind === 'publication' ? issueAuthority.issueRegistryDigest : ''
      expect(publishedIssueRegistryDigest).toMatch(/^[a-f0-9]{64}$/)
      expect(next?.foundationAuditState?.roundBefore!.documentRevision).toBe(next?.foundationAuditState?.revision)
      expect(next?.foundationAuditState?.authority!.issueAuthority.issueRegistryDigest).toBe(publishedIssueRegistryDigest)
      expect(next?.foundationAuditState?.roundBefore!.issueRegistryDigest).toBe(publishedIssueRegistryDigest)
      const round2Tasks = next!.foundationAuditState!.tasks.filter(task => task.kind === 'document-revision')
      expect(round2Tasks.length).toBeGreaterThan(0)
      expect(round2Tasks.every((task): task is FoundationRevisionDocumentTask => task.kind === 'document-revision' && task.round === 2)).toBe(true)
      if (issueAuthority.kind !== 'publication') throw new Error('expected publication issue authority')
      const publication = await recoverFoundationRevision({ workspacePath, revision: issueAuthority.baseRevision })
      expect(publication.resultingIssues.some(issue => issue.severity === 'HIGH')).toBe(true)
      for (const task of round2Tasks) {
        const packet = JSON.parse(await readFile(join(workspacePath, task.packetPath), 'utf8')) as { immutableDigests?: { sourceIssueRegistryDigest?: string } }
        expect(packet.immutableDigests?.sourceIssueRegistryDigest).toBe(publishedIssueRegistryDigest)
      }
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('keeps an unresolved deterministic FAIL in the same round registry', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const absentKeys = new Set(['game.boss.count', 'asset.boss.count'])
      await finishFacts(controller, key => absentKeys.has(key) ? undefined : consistentFactValue(key))
      let current = await controller.store.load()
      while (current?.foundationAuditState?.status === 'semantic_review') {
        const running = current.foundationAuditState.tasks.filter(task => (task.kind === 'semantic' || task.kind === 'confirmation') && task.status === 'running')
        if (!running.length) { await controller.resume(current); current = await controller.store.load(); continue }
        await Promise.all(running.map(task => completeSemantic(controller, task.taskId, 'PASS')))
        current = await controller.store.load()
      }
      const documentTask = current!.foundationAuditState!.tasks.find(task => task.kind === 'document-revision') as FoundationRevisionDocumentTask
      const originalIssueId = documentTask.issueIds[0]!
      while (current?.foundationAuditState?.status === 'revising') {
        const snapshot = current
        const revisionState = snapshot.foundationAuditState
        if (!revisionState) throw new Error('deterministic revision state disappeared while revising')
        const running = revisionState.tasks.filter((task): task is FoundationRevisionDocumentTask => task.kind === 'document-revision' && task.status === 'running')
        if (!running.length) { await controller.resume(snapshot); current = await controller.store.load(); continue }
        await Promise.all(running.map(async task => controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, await makeRevisionTerminal(workspacePath, snapshot, task))))
        current = await controller.store.load()
      }
      while (current?.foundationAuditState?.status === 'rebuilding_facts') {
        const snapshot = current
        await controller.resume(snapshot)
        current = await controller.store.load()
        if (!current) throw new Error('deterministic revision run disappeared while rebuilding facts')
        const factRun = current
        const running = factRun.foundationAuditState!.tasks.filter((task): task is FoundationRevisionImpactedFactsTask => task.kind === 'impacted-facts' && task.status === 'running')
        if (!running.length) continue
        await Promise.all(running.map(async task => {
          const packet = JSON.parse((await readFile(join(workspacePath, task.packetPath))).toString()) as { keys: string[] }
          await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, { workerType: 'foundation-fact-extractor', status: 'completed', runId: factRun.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId, revision: task.revision, packetDigest: task.packetDigest, results: packet.keys.map(key => ({ key, status: 'absent' as const })) })
        }))
        current = await controller.store.load()
      }
      if (current!.foundationAuditState!.round === 1) {
        if (current!.foundationAuditState!.status === 'validating') {
          await controller.resume(current!)
          current = await controller.store.load()
          expect(current!.status).toBe('running')
          expect(current!.foundationAuditState!.status as string).toBe('publishing')
        }
        if (current!.foundationAuditState!.status === 'publishing' || current!.foundationAuditState!.status === 'round_closing') await controller.resume(current!)
      }
      const nextRound = await controller.store.load()
      expect(nextRound!.foundationAuditState!.round).toBe(1)
      const authority = nextRound!.foundationAuditState!.authority!.issueAuthority
      expect(authority.kind).toBe('review')
      if (authority.kind !== 'review') return
      const review = await loadFoundationSemanticReview({ workspacePath, revision: nextRound!.foundationAuditState!.revision, reviewDigest: authority.reviewDigest })
      expect(review?.issues.some(issue => issue.id === originalIssueId)).toBe(true)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('claims document revision attempts durably beyond the former third-attempt cap', async () => {
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
      const first = current!.foundationAuditState!.tasks.find(task => task.kind === 'document-revision')!
      const firstDispatch = first.dispatch!.dispatchId
      await expect(controller.dispatcher.completeDispatch(firstDispatch, {})).rejects.toThrow(/invalid|terminal/i)
      current = await controller.store.load()
      if (current!.foundationAuditState!.tasks.find(task => task.taskId === first.taskId)!.status === 'retryable') {
        await controller.resume(current!)
        current = await controller.store.load()
      }
      const firstRetry = current!.foundationAuditState!.tasks.find(task => task.taskId === first.taskId)!
      expect(firstRetry.status).toBe('running')
      expect(firstRetry.attempt).toBe(2)
      expect(firstRetry.failureReason).toBeUndefined()
      const revisionRequestsAfterFirstFailure = requests.filter(request => request.workerType === 'foundation-document-reviser')
      expect(revisionRequestsAfterFirstFailure[revisionRequestsAfterFirstFailure.length - 1]!.contract.priorFailureReason).toMatch(/invalid|terminal/i)
      await controller.resume(current!)
      current = await controller.store.load()
      const second = current!.foundationAuditState!.tasks.find(task => task.taskId === first.taskId)!
      expect(second.dispatch).toBeDefined()
      expect(second.status).toBe('running')
      expect(second.attempt).toBe(2)
      expect(second.failureReason).toBeUndefined()
      expect(requests.find(request => request.dispatchId === second.dispatch!.dispatchId)?.contract.priorFailureReason).toMatch(/.+/)
      await expect(controller.dispatcher.completeDispatch(second.dispatch!.dispatchId, {})).rejects.toThrow(/invalid|terminal/i)
      current = await controller.store.load()
      const thirdRetry = current!.foundationAuditState!.tasks.find(task => task.taskId === first.taskId)!
      expect(thirdRetry.status).toBe('running')
      expect(thirdRetry.attempt).toBe(3)
      expect(thirdRetry.failureReason).toBeUndefined()
      const startedCount = requests.filter(request => request.workerType === 'foundation-document-reviser').length
      expect(startedCount).toBeGreaterThanOrEqual(3)
      await expect(controller.dispatcher.completeDispatch(thirdRetry.dispatch!.dispatchId, {})).rejects.toThrow(/invalid|terminal/i)
      current = await controller.store.load()
      const fourthRetry = current!.foundationAuditState!.tasks.find(task => task.taskId === first.taskId)!
      expect(fourthRetry.status).toBe('running')
      expect(fourthRetry.attempt).toBe(4)
      expect(current!.status).toBe('running')
      expect(requests.filter(request => request.workerType === 'foundation-document-reviser').length).toBeGreaterThan(startedCount)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('keeps unauthorized-section revision failure in the automatic retry loop', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const { run: current } = await driveToFactOwnerRevisionIssue(controller)
      const task = current.foundationAuditState!.tasks.find(candidate => candidate.kind === 'document-revision')! as FoundationRevisionDocumentTask
      await expect(controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, await makeUnauthorizedRevisionTerminal(workspacePath, current, task))).rejects.toThrow(/invalid foundation revision terminal/i)
      const retried = await controller.store.load()
      const retry = retried!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId && candidate.kind === 'document-revision')!
      expect(retried!.status).toBe('running')
      expect(retried!.foundationAuditState!.status).toBe('revising')
      expect(retry.status).toBe('running')
      expect(retry.attempt).toBe(2)
      expect(retried!.blockedReason).toBeUndefined()
      expect(retry.failureReason).toBeUndefined()
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('recovers impacted-facts and semantic-recheck workers beyond attempt two', async () => {
    const impacted = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(impacted.controller, impacted.workspacePath)
      await impacted.controller.resume(rebuilding!)
      let current = await impacted.controller.store.load()
      const impactedTask = current!.foundationAuditState!.tasks.find((candidate): candidate is FoundationRevisionImpactedFactsTask => candidate.kind === 'impacted-facts' && candidate.status === 'running')!
      const firstRecovery = await impacted.controller.store.reconcile(async () => false)
      expect(firstRecovery!.foundationAuditState!.tasks.find(candidate => candidate.taskId === impactedTask.taskId)).toMatchObject({ status: 'retryable', attempt: 1 })
      await impacted.controller.resume(firstRecovery!)
      current = await impacted.controller.store.load()
      const secondRecovery = await impacted.controller.store.reconcile(async () => false)
      expect(secondRecovery).toMatchObject({ status: 'running' })
      expect(secondRecovery!.foundationAuditState!.tasks.find(candidate => candidate.taskId === impactedTask.taskId)).toMatchObject({ status: 'retryable', attempt: 2 })
    } finally { await rm(impacted.workspacePath, { recursive: true, force: true }) }

    const semantic = await preparedController()
    try {
      let current = await reachSemanticRecheck(semantic.controller, semantic.workspacePath)
      let task = current.foundationAuditState!.tasks.find((candidate): candidate is FoundationRevisionSemanticRecheckTask => candidate.kind === 'semantic-recheck' && candidate.status === 'running')
      if (!task) {
        await semantic.controller.resume(current)
        const resumed = await semantic.controller.store.load()
        if (!resumed) throw new Error('semantic recheck run disappeared while dispatching')
        current = resumed
        task = resumed.foundationAuditState!.tasks.find((candidate): candidate is FoundationRevisionSemanticRecheckTask => candidate.kind === 'semantic-recheck' && candidate.status === 'running')
      }
      if (!task) throw new Error('semantic recheck task was not dispatched')
      const firstRecovery = await semantic.controller.store.reconcile(async () => false)
      expect(firstRecovery!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task!.taskId)).toMatchObject({ status: 'retryable', attempt: 1 })
      await semantic.controller.resume(firstRecovery!)
      const secondRecovery = await semantic.controller.store.reconcile(async () => false)
      expect(secondRecovery).toMatchObject({ status: 'running' })
      expect(secondRecovery!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task!.taskId)).toMatchObject({ status: 'retryable', attempt: 2 })
    } finally { await rm(semantic.workspacePath, { recursive: true, force: true }) }
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
      expect(crashed?.foundationAuditState?.status).toBe('planning')
      const tasksRoot = join(workspacePath, '.beegame/audit/foundation/rev-1/round-1/tasks')
      const taskIds = await readdir(tasksRoot)
      const packetsBefore = await Promise.all(taskIds.map(async taskId => [taskId, await readFile(join(tasksRoot, taskId, 'packet.json'))] as const))
      const retry = { ...crashed!, status: 'running' as const, foundationAuditState: { ...crashed!.foundationAuditState!, status: 'planning' as const } }
      await originalCommit(retry, { runId: retry.runId, type: 'test.planning.resume', phase: retry.phase, status: 'running', revision: retry.revision })
      await controller.resume(retry)
      const resumed = await controller.store.load()
      expect(resumed!.foundationAuditState!.status).toBe('revising')
      expect(resumed!.foundationAuditState!.tasks).toHaveLength(taskIds.length)
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
      const firstTask = initial.foundationAuditState!.tasks.find(task => task.kind === 'document-revision')!
      const firstRecovered = await controller.store.reconcile(async () => false)
      const retryTask = firstRecovered!.foundationAuditState!.tasks.find(task => task.taskId === firstTask.taskId)!
      expect(retryTask.status).toBe('retryable')
      expect(retryTask.attempt).toBe(1)
      await controller.resume(firstRecovered!)
      const claimed = await controller.store.load()
      const secondTask = claimed!.foundationAuditState!.tasks.find(task => task.taskId === firstTask.taskId)! as FoundationRevisionDocumentTask
      expect(secondTask.attempt).toBe(2)
      const terminal = await makeRevisionTerminal(workspacePath, claimed!, secondTask)
      const terminalUsage = { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      const terminalFinishedAt = new Date().toISOString()
      const terminalDurationMs = Math.max(0, Date.parse(terminalFinishedAt) - Date.parse(secondTask.dispatch!.startedAt))
      const withTerminal = { ...claimed!, foundationAuditState: { ...claimed!.foundationAuditState!, tasks: claimed!.foundationAuditState!.tasks.map(task => task.taskId === secondTask.taskId ? { ...task, terminalDigest: terminal.declaration.receipt.terminalDigest, receipt: terminal.declaration.receipt, usage: terminalUsage, durationMs: terminalDurationMs, dispatch: { ...task.dispatch!, status: 'completed' as const, terminalResult: terminal, usage: terminalUsage, finishedAt: terminalFinishedAt } } : task) } }
      await controller.store.commit(withTerminal, { runId: claimed!.runId, type: 'test.revision.persisted_terminal', phase: claimed!.phase, status: 'running', revision: claimed!.revision })
      const beforeReplay = requests.filter(request => request.workerType === 'foundation-document-reviser').length
      const reconciled = await controller.store.reconcile(async () => false)
      expect(reconciled!.foundationAuditState!.tasks.find(task => task.taskId === secondTask.taskId)!.status).toBe('running')
      await controller.resume(reconciled!)
      const admitted = await controller.store.load()
      const completed = admitted!.foundationAuditState!.tasks.find(task => task.taskId === secondTask.taskId)!
      expect(requests.filter(request => request.workerType === 'foundation-document-reviser')).toHaveLength(beforeReplay)
      expect(completed.status).toBe('completed')
      expect(completed.terminalDigest).toBe(terminal.declaration.receipt.terminalDigest)
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
      const task = current.foundationAuditState!.tasks.find(candidate => candidate.kind === 'document-revision')! as FoundationRevisionDocumentTask
      const terminal = await makeRevisionTerminal(workspacePath, current, task)
      await expect(controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, terminal)).rejects.toThrow(/handler|failure/i)
      const admitted = await controller.store.load()
      const completed = admitted!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(completed.status).toBe('completed')
      expect(completed.terminalDigest).toBe(terminal.declaration.receipt.terminalDigest)
      const beforeResume = requests.filter(request => request.workerType === 'foundation-document-reviser').length
      controller.store.commit = originalCommit
      await controller.resume(admitted!)
      let resumed = await controller.store.load()
      if (resumed!.foundationAuditState!.status === 'validating') {
        await controller.resume(resumed!)
        resumed = await controller.store.load()
      }
      expect(resumed!.foundationAuditState!.status).toBe('semantic_recheck')
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
    const { workspacePath, controller, requests } = await preparedController()
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
      const confirmationRequest = requests.find(request => request.taskId === confirmation.taskId)
      expect(confirmationRequest?.contract).toMatchObject({
        kind: 'confirmation',
        sourceTaskId: source.taskId,
        taskId: confirmation.taskId,
        revision: source.revision,
        packetDigest: source.packetDigest,
        packet: expect.objectContaining({
          revision: source.revision,
          identity: source.packetDigest,
        }),
      })
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
    const config = createModelConfig('owner', {
      name: 'missing-fast-model',
      provider: 'anthropic-compatible',
      apiKey: 'test-key',
      models: { balanced: 'balanced-model', strong: 'strong-model' },
    })
    const { workspacePath, controller, started } = await preparedController(() => createBeeGameDeliveryWorkerPort({
      sessions: {
        start() { startCalls += 1; throw new Error('worker start must not be reached') },
      } as never,
      userId: 'owner',
      modelConfigId: config.id,
    }), false)
    try {
      await expect(controller.resume(await controller.store.load() as never)).rejects.toThrow(/fast model|configured/i)
      const after = await controller.store.load()
      expect(startCalls).toBe(0)
      expect(started.size).toBe(0)
      expect(after!.foundationAuditState!.tasks.every(task => task.status === 'needs_action' && task.attempt === 0)).toBe(true)
    } finally {
      resetModelConfigs()
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('replays a persisted impacted terminal after callback-before-receipt crash without starting a worker', async () => {
    const { workspacePath, controller, started, requests } = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(controller, workspacePath)
      await controller.resume(rebuilding!)
      const planned = await controller.store.load()
      const task = planned!.foundationAuditState!.tasks.find(candidate => candidate.kind === 'impacted-facts')!
      const packet = JSON.parse((await readFile(join(workspacePath, task.packetPath))).toString()) as { keys: string[] }
      const terminal = { workerType: 'foundation-fact-extractor' as const, status: 'completed' as const, runId: planned!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId, revision: task.revision, packetDigest: task.packetDigest, results: await presentFactResults(workspacePath, packet) }
      const crashed = { ...planned!, foundationAuditState: { ...planned!.foundationAuditState!, tasks: planned!.foundationAuditState!.tasks.map(candidate => candidate.taskId === task.taskId ? { ...candidate, status: 'running' as const, terminalDigest: digestFoundationFactTerminal(terminal), dispatch: { ...candidate.dispatch!, status: 'completed' as const, terminalResult: terminal } } : candidate) } }
      await controller.store.commit(crashed, { runId: crashed.runId, type: 'test.process_boundary.terminal', phase: crashed.phase, status: crashed.status, revision: crashed.revision })
      const crashedTask = crashed!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(crashedTask.status).toBe('running')
      expect(crashedTask.dispatch?.status).toBe('completed')
      expect(crashedTask.dispatch?.terminalResult).toBeDefined()
      const baseline = requests.filter(request => request.workerType === 'foundation-fact-extractor').length
      const resumedController = createDeliveryWorkflowController({ workspacePath, ownerId: 'owner', workerPort: port(started, requests) })
      await resumedController.resume(crashed!)
      const replayed = await resumedController.store.load()
      const completed = replayed!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(completed.status).toBe('completed')
      expect(completed.kind === 'impacted-facts' && completed.receiptPath).toBeDefined()
      expect(requests.filter(request => request.workerType === 'foundation-fact-extractor')).toHaveLength(baseline)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('retains an impacted terminal when replay admission transiently fails', async () => {
    const { workspacePath, controller, started, requests } = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(controller, workspacePath)
      await controller.resume(rebuilding!)
      const planned = await controller.store.load()
      const task = planned!.foundationAuditState!.tasks.find(candidate => candidate.kind === 'impacted-facts')!
      const packet = JSON.parse((await readFile(join(workspacePath, task.packetPath))).toString()) as { keys: string[] }
      const terminal = { workerType: 'foundation-fact-extractor' as const, status: 'completed' as const, runId: planned!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId, revision: task.revision, packetDigest: task.packetDigest, results: await presentFactResults(workspacePath, packet) }
      const crashed = { ...planned!, foundationAuditState: { ...planned!.foundationAuditState!, tasks: planned!.foundationAuditState!.tasks.map(candidate => candidate.taskId === task.taskId ? { ...candidate, status: 'running' as const, terminalDigest: digestFoundationFactTerminal(terminal), dispatch: { ...candidate.dispatch!, status: 'completed' as const, terminalResult: terminal, finishedAt: candidate.dispatch!.startedAt } } : candidate) } }
      await controller.store.commit(crashed, { runId: crashed.runId, type: 'test.process_boundary.terminal.transient', phase: crashed.phase, status: crashed.status, revision: crashed.revision })
      const baseline = requests.filter(request => request.workerType === 'foundation-fact-extractor').length
      const resumedController = createDeliveryWorkflowController({ workspacePath, ownerId: 'owner', workerPort: port(started, requests) })
      const originalCommit = resumedController.store.commit.bind(resumedController.store)
      let failReplay = true
      resumedController.store.commit = async (...args) => {
        const event = args[1] as { type?: string }
        if (failReplay && event.type === 'foundation.revision.impacted_facts.admitted') {
          failReplay = false
          throw new Error('simulated transient replay admission failure')
        }
        return originalCommit(...args)
      }
      await expect(resumedController.resume(crashed)).rejects.toThrow(/transient|replay|admission/i)
      const afterFailure = await resumedController.store.load()
      const retained = afterFailure!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(afterFailure!.status).toBe('running')
      expect(retained.status).toBe('running')
      expect(retained.dispatch?.terminalResult).toBeDefined()
      expect('receiptPath' in retained && retained.receiptPath).toBeFalsy()
      resumedController.store.commit = originalCommit
      await resumedController.resume(afterFailure!)
      const replayed = await resumedController.store.load()
      expect(replayed!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!.status).toBe('completed')
      expect(requests.filter(request => request.workerType === 'foundation-fact-extractor')).toHaveLength(baseline)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('fails closed when revision authority bindings drift during fact admission', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(controller, workspacePath)
      await controller.resume(rebuilding!)
      const planned = await controller.store.load()
      const impacted = planned!.foundationAuditState!.tasks.find((candidate): candidate is FoundationRevisionImpactedFactsTask => candidate.kind === 'impacted-facts')!
      const staleAdmission = { ...planned!, foundationAuditState: { ...planned!.foundationAuditState!, authority: { ...planned!.foundationAuditState!.authority!, derivedDigests: { ...planned!.foundationAuditState!.authority!.derivedDigests, factStore: '0'.repeat(64) } } } }
      await controller.store.commit(staleAdmission, { runId: staleAdmission.runId, type: 'test.stale.revision.authority', phase: staleAdmission.phase, status: staleAdmission.status, revision: staleAdmission.revision })
      const canonicalBefore = await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(workspacePath, path))] as const))
      const packet = JSON.parse((await readFile(join(workspacePath, impacted.packetPath))).toString()) as { keys: string[] }
      await controller.dispatcher.completeDispatch(impacted.dispatch!.dispatchId, { workerType: 'foundation-fact-extractor', status: 'completed', runId: staleAdmission.runId, dispatchId: impacted.dispatch!.dispatchId, taskId: impacted.taskId, revision: impacted.revision, packetDigest: impacted.packetDigest, results: packet.keys.map(key => ({ key, status: 'absent' as const })) })
      const failed = await controller.store.load()
      expect(failed!.status).toBe('needs_action')
      const failedTask = failed!.foundationAuditState!.tasks.find(candidate => candidate.taskId === impacted.taskId)!
      expect(failedTask.kind === 'impacted-facts' && failedTask.receiptPath).toBeFalsy()
      for (const [path, bytes] of canonicalBefore) expect(await readFile(join(workspacePath, path))).toEqual(bytes)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('fails closed on derived/document authority drift in planning and validation', async () => {
    const planning = await preparedController()
    try {
      const current = await driveToRevisionIssue(planning.controller)
      const stalePlanning = { ...current, foundationAuditState: { ...current.foundationAuditState!, status: 'planning' as const, tasks: [], authority: { ...current.foundationAuditState!.authority!, derivedDigests: { ...current.foundationAuditState!.authority!.derivedDigests, sectionIndex: '2'.repeat(64) } } } }
      await planning.controller.store.commit(stalePlanning, { runId: stalePlanning.runId, type: 'test.stale.planning.derived', phase: stalePlanning.phase, status: stalePlanning.status, revision: stalePlanning.revision })
      await planning.controller.resume(stalePlanning)
      expect((await planning.controller.store.load())!.status).toBe('needs_action')
    } finally { await rm(planning.workspacePath, { recursive: true, force: true }) }

    const validating = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(validating.controller, validating.workspacePath, ownerFactText('game.mechanics'))
      await validating.controller.resume(rebuilding!)
      const ready = await validating.controller.store.load()
      const stale = { ...ready!, foundationAuditState: { ...ready!.foundationAuditState!, status: 'validating' as const, authority: { ...ready!.foundationAuditState!.authority!, documentDigests: ready!.foundationAuditState!.authority!.documentDigests.map((entry, index) => index === 0 ? { ...entry, digest: '3'.repeat(64) } : entry) } } }
      await validating.controller.store.commit(stale, { runId: stale.runId, type: 'test.stale.validation.document', phase: stale.phase, status: stale.status, revision: stale.revision })
      await validating.controller.resume(stale)
      expect((await validating.controller.store.load())!.status).toBe('needs_action')
    } finally { await rm(validating.workspacePath, { recursive: true, force: true }) }
  })

  test('document and impacted terminals continue the revision chain without a manual resume', async () => {
    const zero = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(zero.controller, zero.workspacePath, ownerFactText('game.mechanics'))
      expect(rebuilding.foundationAuditState?.status).toBe('semantic_recheck')
    } finally { await rm(zero.workspacePath, { recursive: true, force: true }) }

      const impactedController = await preparedController()
    try {
      const impacted = await completeImpactedFact(impactedController.controller, impactedController.workspacePath)
      let finalImpacted = impacted.run!
      if (finalImpacted.foundationAuditState?.status === 'validating') {
        await impactedController.controller.resume(finalImpacted)
        finalImpacted = await impactedController.controller.store.load() as DeliveryRun
      }
      expect(finalImpacted.foundationAuditState?.status).toMatch(/publishing|semantic_recheck/)
    } finally { await rm(impactedController.workspacePath, { recursive: true, force: true }) }
  })

  test('semantic originals create exact targeted recheck tasks instead of publishing', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      await completeFactOwnerRevision(controller, workspacePath, ownerFactText('game.mechanics'))
      const beforeRecheck = await controller.store.load()
      if (beforeRecheck?.foundationAuditState?.status === 'validating') await controller.resume(beforeRecheck)
      const rechecked = await controller.store.load()
      const tasks = rechecked!.foundationAuditState!.tasks.filter(task => task.kind === 'semantic-recheck')
      expect(rechecked!.foundationAuditState!.status).toBe('semantic_recheck')
      expect(tasks).toHaveLength(1)
      const documentTask = rechecked!.foundationAuditState!.tasks.find(task => task.kind === 'document-revision')!
      expect(tasks[0]!.issueId).toBe(documentTask.kind === 'document-revision' ? documentTask.issueIds[0] ?? '' : '')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('automatically dispatches the semantic wave and crosses its publication boundary', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    try {
      await completeFactOwnerRevision(controller, workspacePath, ownerFactText('game.mechanics'))
      let current = await controller.store.load()
      expect(current?.foundationAuditState?.status).toBe('semantic_recheck')
      const semanticTasks = current!.foundationAuditState!.tasks.filter(task => task.kind === 'semantic-recheck')
      expect(semanticTasks.length).toBeGreaterThan(0)
      expect(semanticTasks.filter(task => task.status === 'running')).toHaveLength(Math.min(4, semanticTasks.length))
      const semanticTaskIds = new Set(semanticTasks.map(task => task.taskId))
      while (current?.foundationAuditState?.status === 'semantic_recheck') {
        const running = current.foundationAuditState.tasks.filter(task => task.kind === 'semantic-recheck' && task.status === 'running')
        expect(running.length).toBeGreaterThan(0)
        await Promise.all(running.map(task => controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, {
          workerType: 'foundation-semantic-reviewer',
          status: 'completed',
          runId: current!.runId,
          dispatchId: task.dispatch!.dispatchId,
          taskId: task.taskId,
          revision: task.revision,
          packetDigest: task.packetDigest,
          outcome: 'PASS',
        })))
        current = await controller.store.load()
      }
      expect(['revision_ready', 'round_closing', 'planning', 'revising', 'rebuilding_facts', 'validating']).toContain(current?.foundationAuditState?.status ?? '')
      expect(requests.filter(request => request.taskId && semanticTaskIds.has(request.taskId))).toHaveLength(semanticTasks.length)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('claims revision semantic rechecks from FoundationAuditState and injects only the artifact at prompt time', async () => {
    const prompts: string[] = []
    const { workspacePath, controller, requests } = await preparedController((started, capturedRequests) => {
      const base = port(started, capturedRequests)
      return { ...base, async submit(_dispatchId, prompt) { prompts.push(prompt) } }
    })
    try {
      await completeFactOwnerRevision(controller, workspacePath, ownerFactText('game.mechanics'))
      let current = await controller.store.load()
      for (let attempt = 0; attempt < 4 && current?.foundationAuditState?.status !== 'semantic_recheck'; attempt++) {
        await controller.resume(current!)
        current = await controller.store.load()
      }
      expect(current?.foundationAuditState?.status).toBe('semantic_recheck')
      const task = current!.foundationAuditState!.tasks.find(candidate => candidate.kind === 'semantic-recheck')!
      const beforeAudit = current!.foundationAuditState
      await controller.resume(current!)
      const claimed = await controller.store.load()
      const claimedTask = claimed!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      const request = requests.find(candidate => candidate.taskId === task.taskId)
      expect(request).toBeDefined()
      expect(request?.workerType).toBe('foundation-semantic-reviewer')
      expect(request?.allowedPaths).toEqual([])
      expect(request?.projectReadScope).toBe('empty')
      expect(request?.workflowJsonSchema).toEqual(foundationSemanticRecheckStructuredOutputJsonSchema)
      expect(request?.contract).toMatchObject({ taskId: task.taskId, packetPath: task.packetPath, packetDigest: task.packetDigest, packet: expect.any(Object), issueId: task.issueId, modelTier: 'strong' })
      const packet = JSON.parse((await readFile(join(workspacePath, task.packetPath))).toString()) as { expected?: string; actual?: string; sections?: Array<{ text?: string }> }
      expect(claimedTask.kind).toBe('semantic-recheck')
      expect(claimedTask.status).toBe('running')
      expect(claimedTask.attempt).toBe(1)
      expect(claimed!.foundationAuditState!.tasks.filter(candidate => candidate.status === 'running')).toHaveLength(1)
      expect(claimed!.foundationAuditState).toEqual(beforeAudit)
      expect(prompts.at(-1)).not.toContain(task.packetDigest)
      expect(prompts.at(-1)).not.toContain(task.issueId)
      expect(packet.expected).toBeTruthy()
      expect(packet.actual).toBeTruthy()
      expect(packet.sections?.[0]?.text).toBeTruthy()
      expect(prompts.at(-1)).toContain(packet.expected!)
      expect(prompts.at(-1)).toContain(packet.actual!)
      expect(prompts.at(-1)).toContain(JSON.stringify(packet.sections![0]!.text!))
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('admits a semantic PASS result artifact into the revision task and reaches publishing without rerunning the worker', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    try {
      await completeFactOwnerRevision(controller, workspacePath, ownerFactText('game.mechanics'))
      let current = await controller.store.load()
      for (let attempt = 0; attempt < 4 && current?.foundationAuditState?.status !== 'semantic_recheck'; attempt++) {
        await controller.resume(current!)
        current = await controller.store.load()
      }
      expect(current?.foundationAuditState?.status).toBe('semantic_recheck')
      const task = current!.foundationAuditState!.tasks.find(candidate => candidate.kind === 'semantic-recheck')!
      await controller.resume(current!)
      const claimed = await controller.store.load()
      const request = requests.find(candidate => candidate.taskId === task.taskId)
      expect(request).toBeDefined()
      if (!request) return
      const runningTask = claimed!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      const workerCount = requests.filter(candidate => candidate.taskId === task.taskId).length
      await controller.dispatcher.completeDispatch(request.dispatchId!, { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: claimed!.runId, dispatchId: request.dispatchId!, taskId: runningTask.taskId, revision: runningTask.revision, packetDigest: runningTask.packetDigest, outcome: 'PASS' })
      const after = await controller.store.load()
      const completed = after!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(completed.status).toBe('completed')
      expect(completed.terminalDigest).toMatch(/^[a-f0-9]{64}$/)
      expect(completed.kind === 'semantic-recheck' && completed.resultPath).toMatch(/result|semantic/i)
      expect(completed.kind === 'semantic-recheck' && completed.resultDigest).toMatch(/^[a-f0-9]{64}$/)
      expect(completed.dispatch).toMatchObject({ status: 'completed' })
      expect(completed.usage).toMatchObject({ total_tokens: 0 })
      expect(completed.durationMs).toBe(
        Math.max(0, Date.parse(completed.dispatch!.finishedAt!) - Date.parse(completed.dispatch!.startedAt)),
      )
      expect(after!.foundationAuditState!.status).not.toBe('semantic_recheck')
      expect(after!.foundationAuditState!.status).not.toBe('publishing')
      expect(requests.filter(candidate => candidate.taskId === task.taskId)).toHaveLength(workerCount)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('publishes an all-PASS revision, commits resulting derived authority, and closes the round', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    try {
      const pending = await reachSemanticRecheck(controller, workspacePath)
      const task = pending.foundationAuditState!.tasks.find(candidate => candidate.kind === 'semantic-recheck')!
      await controller.resume(pending)
      const claimed = await controller.store.load()
      const request = requests.find(candidate => candidate.taskId === task.taskId)!
      const runningTask = claimed!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      const stale = { ...claimed!, activeDispatch: staleTopLevelTerminalDispatch(claimed!.revision.document) }
      await controller.store.commit(stale, { runId: stale.runId, type: 'test.stale.top_level_terminal', phase: stale.phase, status: stale.status, revision: stale.revision })
      await controller.dispatcher.completeDispatch(request.dispatchId!, { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: claimed!.runId, dispatchId: request.dispatchId!, taskId: runningTask.taskId, revision: runningTask.revision, packetDigest: runningTask.packetDigest, outcome: 'PASS' })
      const closed = await controller.store.load()
      expect(closed!.documentStep).toBe('CHECKLIST_DRAFTING')
      expect(closed!.foundationAuditState!.status).not.toBe('semantic_recheck')
      expect(closed!.foundationAuditState!.status).not.toBe('publishing')
      expect(closed!.foundationAuditState!.publication).toBeDefined()
      const committedPath = closed!.foundationAuditState!.publication!.committedPath
      expect(committedPath).toMatch(/\/revision\/COMMITTED\.json$/)
      const committed = JSON.parse(await readFile(join(workspacePath, committedPath), 'utf8')) as { status: string; resultingRevision: string }
      expect(committed.status).toBe('committed')
      expect(committed.resultingRevision).toBe(closed!.foundationAuditState!.publication!.resultingRevision)
      expect(typeof committed.resultingRevision).toBe('string')
      await expect(loadCommittedFoundationDerivedArtifacts({ workspacePath, revision: committed.resultingRevision })).resolves.toBeDefined()
      expect(requests.filter(candidate => candidate.taskId === task.taskId)).toHaveLength(1)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('round closing with no resulting issues proceeds to checklist drafting', async () => {
    const seeded = await seedRoundClosingRevision()
    try {
      const stale = { ...seeded.run, activeDispatch: staleTopLevelTerminalDispatch(seeded.run.revision.document) }
      await seeded.controller.store.commit(stale, { runId: stale.runId, type: 'test.stale.top_level_terminal', phase: stale.phase, status: stale.status, revision: stale.revision })
      await seeded.controller.resume(stale)
      const after = await seeded.controller.store.load()
      expect(after!.documentStep).toBe('CHECKLIST_DRAFTING')
    } finally { await rm(seeded.workspacePath, { recursive: true, force: true }) }
  })

  test('round closing with a changed high issue starts the next planning round with a fresh task set', async () => {
    const seeded = await seedRoundClosingRevision({ resultingIssue: true, round: 1 })
    try {
      await seeded.controller.resume(seeded.run)
      const after = await seeded.controller.store.load()
      expect(after!.foundationAuditState!.status).toMatch(/planning|revising/)
      expect(after!.foundationAuditState!.round).toBe(2)
      expect(after!.foundationAuditState!.authority!.issueAuthority.kind).toBe('publication')
      expect(after!.foundationAuditState!.authority!.issueAuthority.issueRegistryDigest).toBe(seeded.run.foundationAuditState!.publication!.resultingIssueRegistryDigest)
      expect(after!.foundationAuditState!.tasks.every((task): task is FoundationRevisionDocumentTask | FoundationRevisionImpactedFactsTask | FoundationRevisionSemanticRecheckTask => ('round' in task) && task.round === 2)).toBe(true)
    } finally { await rm(seeded.workspacePath, { recursive: true, force: true }) }
  })

  test('round two closing with a changed high issue starts round three', async () => {
    const seeded = await seedRoundClosingRevision({ resultingIssue: true, round: 2 })
    try {
      await seeded.controller.resume(seeded.run)
      const after = await seeded.controller.store.load()
      expect(after!.status).toBe('running')
      expect(after!.foundationAuditState!.status).toMatch(/planning|revising/)
      expect(after!.foundationAuditState!.round).toBe(3)
    } finally { await rm(seeded.workspacePath, { recursive: true, force: true }) }
  })

  test('round closing with unchanged publication authority becomes needs_action', async () => {
    const seeded = await seedRoundClosingRevision({ resultingIssue: true, round: 2, unchangedBefore: true })
    try {
      await seeded.controller.resume(seeded.run)
      const after = await seeded.controller.store.load()
      expect(after!.status).toBe('needs_action')
      expect(after!.foundationAuditState!.status).toBe('round_closing')
      expect(after!.blockedReason).toMatch(/no.progress|no progress/i)
    } finally { await rm(seeded.workspacePath, { recursive: true, force: true }) }
  })

  test('round three closing with a changed high issue starts round four', async () => {
    const seeded = await seedRoundClosingRevision({ resultingIssue: true, round: 3 })
    try {
      await seeded.controller.resume(seeded.run)
      const after = await seeded.controller.store.load()
      expect(after!.status).toBe('running')
      expect(after!.foundationAuditState!.status).toMatch(/planning|revising/)
      expect(after!.foundationAuditState!.round).toBe(4)
    } finally { await rm(seeded.workspacePath, { recursive: true, force: true }) }
  })

  test('replays publishing after a controller crash without rerunning canonical writers', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    const originalCommit = controller.store.commit.bind(controller.store)
    let crash = true
    try {
      const pending = await reachSemanticRecheck(controller, workspacePath)
      const task = pending.foundationAuditState!.tasks.find(candidate => candidate.kind === 'semantic-recheck')!
      await controller.resume(pending)
      const claimed = await controller.store.load()
      const request = requests.find(candidate => candidate.taskId === task.taskId)!
      const runningTask = claimed!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      controller.store.commit = async (...args) => {
        const next = args[0] as DeliveryRun
        if (crash && next.foundationAuditState?.status === 'round_closing') {
          crash = false
          throw new Error('simulated publishing controller crash')
        }
        return originalCommit(...args)
      }
      await expect(controller.dispatcher.completeDispatch(request.dispatchId!, { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: claimed!.runId, dispatchId: request.dispatchId!, taskId: runningTask.taskId, revision: runningTask.revision, packetDigest: runningTask.packetDigest, outcome: 'PASS' })).rejects.toThrow(/crash|publishing/i)
      controller.store.commit = originalCommit
      const crashed = await controller.store.load()
      expect(crashed!.foundationAuditState!.status).toBe('publishing')
      const committed = JSON.parse(await readFile(join(workspacePath, foundationRevisionCommittedPath(crashed!.foundationAuditState!.revision)), 'utf8')) as { status: string; resultingRevision: string; documentDigests: Record<string, string> }
      expect(committed.status).toBe('committed')
      for (const path of CANONICAL_FOUNDATION_DOCUMENTS) expect(committed.documentDigests[path]).toBe(createHash('sha256').update(await readFile(join(workspacePath, path))).digest('hex'))
      const completedDocuments = crashed!.foundationAuditState!.tasks.filter((task): task is FoundationRevisionDocumentTask => task.kind === 'document-revision' && task.status === 'completed')
      for (const task of completedDocuments) expect(await readFile(join(workspacePath, task.documentPath), 'utf8')).toBe(await readFile(join(workspacePath, task.stagedPath), 'utf8'))
      await expect(loadCommittedFoundationDerivedArtifacts({ workspacePath, revision: committed.resultingRevision })).resolves.toBeDefined()
      const freshRequests: WorkerDispatchRequest[] = []
      const freshStarted = new Set<string>()
      const freshController = createDeliveryWorkflowController({ workspacePath, ownerId: 'owner', workerPort: port(freshStarted, freshRequests) })
      await freshController.resume(crashed!)
      const recovered = await freshController.store.load()
      expect(recovered!.foundationAuditState!.status).toBe('revision_ready')
      expect(freshRequests.filter(request => request.workerType === 'foundation-document-reviser' || request.workerType === 'foundation-fact-extractor' || request.workerType === 'foundation-semantic-reviewer')).toHaveLength(0)
      expect(recovered!.foundationAuditState!.publication).toBeDefined()
      expect(recovered!.foundationAuditState!.publication!.resultingRevision).toBe(committed.resultingRevision)
    } finally { controller.store.commit = originalCommit; await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('loads every semantic result artifact before publishing and fails closed on a tampered sibling', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    try {
      const current = await reachSemanticRecheck(controller, workspacePath)
      const source = current.foundationAuditState!.tasks.find(candidate => candidate.kind === 'semantic-recheck')! as FoundationRevisionSemanticRecheckTask
      const sourcePacket = JSON.parse((await readFile(join(workspacePath, source.packetPath))).toString()) as { expected: string; actual: string; sections: Array<{ ref: SectionRef; text: string }>; patchOperation: PatchOperation }
      const committed = await loadCommittedFoundationDerivedArtifacts({ workspacePath, revision: source.revision })
      expect(committed).toBeDefined()
      const documents = Object.fromEntries(await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(workspacePath, path), 'utf8')] as const))) as Record<string, string>
      for (const task of current.foundationAuditState!.tasks) if (task.kind === 'document-revision' && task.status === 'completed') documents[task.documentPath] = (await readFile(join(workspacePath, task.stagedPath))).toString()
      const sectionIndex = buildFoundationSectionIndex({ documents })
      const issueId = 'AUD-recheck-sibling'
      const sourceRef = sectionIndex.find(ref => ref.documentPath === sourcePacket.patchOperation.documentPath && ref.sectionId === sourcePacket.patchOperation.sectionId)!
      const operation: PatchOperation = sourcePacket.patchOperation.kind === 'DELETE' ? { ...sourcePacket.patchOperation, issueIds: [issueId] } : { ...sourcePacket.patchOperation, issueIds: [issueId], afterDigest: sourceRef.digest }
      const issue: AuditIssue = { id: issueId, severity: 'HIGH', type: 'semantic', source: sourceRef, expected: sourcePacket.expected, actual: sourcePacket.actual, remediation: { kind: 'patch', documentPath: operation.documentPath, sectionIds: [operation.sectionId] } }
      const packet = buildFoundationSemanticRecheckPacket({ issue, patchOperation: operation, sectionIndex, documents, impact: analyzeFoundationImpact([operation]), factStore: committed!.factStore })
      const secondTaskId = `${source.revision}.semantic-recheck.${source.round}.sibling`
      const packetPath = await writeFoundationRevisionSemanticPacket({ workspacePath, revision: source.revision, round: source.round, taskId: secondTaskId, packet })
      const secondTask: FoundationRevisionSemanticRecheckTask = { taskId: secondTaskId, kind: 'semantic-recheck', revision: source.revision, round: source.round, packetPath, packetDigest: packet.packetDigest, status: 'pending', attempt: 0, bundleId: source.bundleId ?? 'test-bundle', issueId, issue, modelTier: 'strong' }
      const widened = { ...current, foundationAuditState: { ...current.foundationAuditState!, tasks: [...current.foundationAuditState!.tasks.filter(candidate => candidate.taskId !== source.taskId), source, secondTask], revisionBundles: current.foundationAuditState!.revisionBundles?.map(bundle => bundle.bundleId === current.foundationAuditState!.activeBundleId ? { ...bundle, taskIds: [...new Set([...bundle.taskIds, secondTaskId])] } : bundle) } }
      await controller.store.commit(widened, { runId: widened.runId, type: 'test.semantic.sibling_tasks', phase: widened.phase, status: widened.status, revision: widened.revision })
      await controller.resume(widened)
      const claimed = await controller.store.load()
      const firstRequest = requests.find(request => request.taskId === source.taskId)!
      const secondRequest = requests.find(request => request.taskId === secondTaskId)!
      expect(firstRequest).toBeDefined()
      expect(secondRequest).toBeDefined()
      await controller.dispatcher.completeDispatch(firstRequest.dispatchId!, { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: claimed!.runId, dispatchId: firstRequest.dispatchId!, taskId: source.taskId, revision: source.revision, packetDigest: source.packetDigest, outcome: 'PASS' })
      const firstCompleted = await controller.store.load()
      expect(firstCompleted!.status).toBe('running')
      if (firstCompleted!.status !== 'running') return
      const firstResultTask = firstCompleted!.foundationAuditState!.tasks.find(candidate => candidate.taskId === source.taskId)!
      const firstResultPath = firstResultTask.kind === 'semantic-recheck' ? firstResultTask.resultPath : undefined
      expect(firstResultPath).toBeDefined()
      await writeFile(join(workspacePath, firstResultPath!), `${await readFile(join(workspacePath, firstResultPath!))}tampered`)
      await controller.dispatcher.completeDispatch(secondRequest.dispatchId!, { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: firstCompleted!.runId, dispatchId: secondRequest.dispatchId!, taskId: secondTaskId, revision: source.revision, packetDigest: packet.packetDigest, outcome: 'PASS' })
      const failed = await controller.store.load()
      expect(failed!.status).toBe('needs_action')
      expect(failed!.foundationAuditState!.status).toBe('semantic_recheck')
      expect(failed!.foundationAuditState!.publication).toBeUndefined()
      expect(failed!.blockedReason).toMatch(/digest|artifact|stale/i)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('semantic recheck FAIL starts same-round retry without publishing', async () => {
    await exerciseSemanticNegativeOutcome()
  })

  test('frozen PASS dependency drift thaws only the affected document in the same round and preserves the old bundle', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(controller, workspacePath, 'game.resources: []\nunresolved prose')
      const before = rebuilding.foundationAuditState!
      const originalTask = before.tasks.find(task => task.kind === 'document-revision' && task.status === 'completed') as FoundationRevisionDocumentTask | undefined
      if (!originalTask) throw new Error('frozen dependency fixture requires a completed document revision')
      const activeImpactedTask = before.tasks.find(task => task.kind === 'impacted-facts' && task.status === 'running') as FoundationRevisionImpactedFactsTask | undefined
      if (!activeImpactedTask) throw new Error('frozen dependency fixture requires an active impacted-facts task')
      const impactedPacket = JSON.parse((await readFile(join(workspacePath, activeImpactedTask.packetPath))).toString()) as { keys: string[]; sections: Array<{ documentPath: string; sectionId: string; startLine: number; endLine: number }> }
      await controller.dispatcher.completeDispatch(activeImpactedTask.dispatch!.dispatchId, { workerType: 'foundation-fact-extractor', status: 'completed', runId: rebuilding.runId, dispatchId: activeImpactedTask.dispatch!.dispatchId, taskId: activeImpactedTask.taskId, revision: activeImpactedTask.revision, packetDigest: activeImpactedTask.packetDigest, results: await presentFactResults(workspacePath, impactedPacket) })
      const validating = (await controller.store.load())!
      const validatingState = validating.foundationAuditState!
      const dependencyKeys = Object.keys(originalTask.dependencyDigests)
      if (!dependencyKeys.length) throw new Error('frozen dependency fixture requires dependency section evidence')
      const originalBundle = validatingState.revisionBundles?.find(bundle => bundle.bundleId === originalTask.bundleId)
      if (!originalBundle) throw new Error('frozen dependency fixture requires the original revision bundle')
      const activeBundleId = `${originalTask.bundleId}.frozen-fixture`
      const stale = {
        ...validating,
        foundationAuditState: {
          ...validatingState,
          status: 'validating' as const,
          activeBundleId,
          tasks: validatingState.tasks.map(task => task.taskId === originalTask.taskId
            ? { ...task, frozen: true, dependencyDigests: Object.fromEntries(dependencyKeys.map(key => [key, '0'.repeat(64)])) }
            : task.taskId === activeImpactedTask.taskId
              ? { ...task, bundleId: activeBundleId }
              : task),
          revisionBundles: [
            ...validatingState.revisionBundles!.map(bundle => bundle.bundleId === originalBundle.bundleId
              ? { ...bundle, status: 'superseded' as const, supersededBy: activeBundleId, taskIds: bundle.taskIds.filter(taskId => taskId !== activeImpactedTask.taskId) }
              : bundle),
            {
              bundleId: activeBundleId,
              status: 'active' as const,
              round: originalBundle.round,
              baseDocumentRevision: originalBundle.baseDocumentRevision,
              baseDocumentDigests: originalBundle.baseDocumentDigests,
              remediationDigest: createHash('sha256').update(`${activeBundleId}:fixture`).digest('hex'),
              taskIds: [activeImpactedTask.taskId],
              frozenTaskIds: [originalTask.taskId],
            },
          ],
        },
      } as DeliveryRun
      await controller.store.commit(stale, { runId: stale.runId, type: 'test.frozen.pass.dependency.drift', phase: stale.phase, status: stale.status, revision: stale.revision })
      await controller.resume(stale)
      const retried = await controller.store.load()
      expect(retried?.foundationAuditState?.status).toBe('revising')
      const oldTask = retried!.foundationAuditState!.tasks.find(task => task.taskId === originalTask.taskId) as FoundationRevisionDocumentTask
      const retryTask = retried!.foundationAuditState!.tasks.find(task => task.kind === 'document-revision' && task.taskId !== originalTask.taskId) as FoundationRevisionDocumentTask | undefined
      expect(retryTask).toBeDefined()
      expect(oldTask).toMatchObject({ status: 'completed', frozen: false, supersededBy: expect.any(String), receipt: { taskId: originalTask.taskId } })
      expect(retryTask).toMatchObject({ status: 'running', round: originalTask.round, revision: originalTask.revision, bundleId: expect.not.stringMatching(new RegExp(`^${originalTask.bundleId}$`)), attempt: 1, frozen: false })
      expect(retried!.foundationAuditState!.revisionBundles).toEqual(expect.arrayContaining([
        expect.objectContaining({ bundleId: originalTask.bundleId, status: 'superseded', supersededBy: activeBundleId, taskIds: expect.arrayContaining([originalTask.taskId]) }),
        expect.objectContaining({ bundleId: activeBundleId, status: 'superseded', supersededBy: retryTask!.bundleId, taskIds: [activeImpactedTask.taskId], frozenTaskIds: [originalTask.taskId] }),
        expect.objectContaining({ bundleId: retryTask!.bundleId, status: 'active', round: originalTask.round, baseDocumentRevision: originalTask.revision, taskIds: [retryTask!.taskId] }),
      ]))
      expect(requests.filter(request => request.workerType === 'foundation-document-reviser')).toHaveLength(2)
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('replays a persisted semantic terminal after admission commit failure without starting another worker', async () => {
    const { workspacePath, controller, requests } = await preparedController()
    const originalCommit = controller.store.commit.bind(controller.store)
    let crash = true
    try {
      await completeFactOwnerRevision(controller, workspacePath, ownerFactText('game.mechanics'))
      let current = await controller.store.load()
      for (let attempt = 0; attempt < 4 && current?.foundationAuditState?.status !== 'semantic_recheck'; attempt++) {
        await controller.resume(current!)
        current = await controller.store.load()
      }
      const task = current!.foundationAuditState!.tasks.find(candidate => candidate.kind === 'semantic-recheck')!
      await controller.resume(current!)
      const claimed = await controller.store.load()
      const request = requests.find(candidate => candidate.taskId === task.taskId)
      expect(request).toBeDefined()
      if (!request) return
      const runningTask = claimed!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      controller.store.commit = async (...args) => {
        const next = args[0] as DeliveryRun
        const committedTask = next.foundationAuditState?.tasks.find(candidate => candidate.taskId === task.taskId)
        if (crash && committedTask?.kind === 'semantic-recheck' && committedTask.status === 'completed' && committedTask.resultPath) {
          crash = false
          throw new Error('simulated semantic admission commit crash')
        }
        return originalCommit(...args)
      }
      const workerCount = requests.filter(candidate => candidate.taskId === task.taskId).length
      await expect(controller.dispatcher.completeDispatch(request.dispatchId!, { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: claimed!.runId, dispatchId: request.dispatchId!, taskId: runningTask.taskId, revision: runningTask.revision, packetDigest: runningTask.packetDigest, outcome: 'PASS' })).rejects.toThrow(/crash|commit/i)
      controller.store.commit = originalCommit
      const crashed = await controller.store.load()
      const crashedTask = crashed!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(crashedTask.dispatch?.status).toBe('completed')
      expect(crashedTask.dispatch?.terminalResult).toBeDefined()
      expect(crashedTask.kind === 'semantic-recheck' && crashedTask.resultPath).toBeUndefined()
      const freshRequests: WorkerDispatchRequest[] = []
      const freshStarted = new Set<string>()
      const freshController = createDeliveryWorkflowController({ workspacePath, ownerId: 'owner', workerPort: port(freshStarted, freshRequests) })
      await freshController.resume(crashed!)
      const replayed = await freshController.store.load()
      expect(replayed!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!.status).toBe('completed')
      expect(replayed!.foundationAuditState!.status).not.toBe('semantic_recheck')
      expect(replayed!.foundationAuditState!.status).not.toBe('publishing')
      expect(freshRequests.filter(candidate => candidate.taskId === task.taskId)).toHaveLength(0)
      expect(requests.filter(candidate => candidate.taskId === task.taskId)).toHaveLength(workerCount)
    } finally { controller.store.commit = originalCommit; await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('revision semantic claim fails closed when strong model readiness is unavailable', async () => {
    const unavailable = await preparedController((started, capturedRequests) => {
      const base = port(started, capturedRequests)
      return { ...base, async assertFoundationSemanticModelReady(request: WorkerDispatchRequest) { if (request.contract.issueId) throw new Error('strong semantic model unavailable') } }
    })
    try {
      const current = await reachSemanticRecheck(unavailable.controller, unavailable.workspacePath)
      const task = current.foundationAuditState!.tasks.find(candidate => candidate.kind === 'semantic-recheck')! as FoundationRevisionSemanticRecheckTask
      await expect(unavailable.controller.dispatcher.dispatch(revisionSemanticRequest(current, task, unavailable.workspacePath))).rejects.toThrow()
      const after = await unavailable.controller.store.load()
      expect(unavailable.requests.filter(request => request.taskId === task.taskId)).toHaveLength(0)
      expect(after!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!.attempt).toBe(0)
      expect(after!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!.status).toBe('needs_action')
    } finally { await rm(unavailable.workspacePath, { recursive: true, force: true }) }
  })

  test('revision semantic claim keeps retrying beyond the former third-attempt cap', async () => {
    const capped = await preparedController()
    try {
      const current = await reachSemanticRecheck(capped.controller, capped.workspacePath)
      const task = current.foundationAuditState!.tasks.find(candidate => candidate.kind === 'semantic-recheck')! as FoundationRevisionSemanticRecheckTask
      const baselineDispatches = capped.requests.filter(request => request.taskId === task.taskId).length
      const retry = { ...current, foundationAuditState: { ...current.foundationAuditState!, tasks: current.foundationAuditState!.tasks.map(candidate => candidate.taskId === task.taskId && candidate.kind === 'semantic-recheck' ? { ...candidate, status: 'retryable' as const, attempt: 2, dispatch: undefined } : candidate) } }
      await capped.controller.store.commit(retry, { runId: retry.runId, type: 'test.semantic.retry.beyond.cap', phase: retry.phase, status: retry.status, revision: retry.revision })
      await capped.controller.dispatcher.dispatch(revisionSemanticRequest(retry, { ...task, status: 'retryable', attempt: 2, dispatch: undefined }, capped.workspacePath))
      const after = await capped.controller.store.load()
      expect(capped.requests.filter(request => request.taskId === task.taskId)).toHaveLength(baselineDispatches + 1)
      expect(after!.status).toBe('running')
      expect(after!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)).toMatchObject({ status: 'running', attempt: 3 })
    } finally { await rm(capped.workspacePath, { recursive: true, force: true }) }
  })

  test('rejects spoofed revision semantic identity and tier before claiming the task', async () => {
    const cases = [
      { name: 'wrong issue identity', request: (run: DeliveryRun, task: FoundationRevisionSemanticRecheckTask, workspacePath: string) => ({ ...revisionSemanticRequest(run, task, workspacePath), contract: { ...revisionSemanticRequest(run, task, workspacePath).contract, issueId: 'AUD-spoofed' } }) },
      { name: 'request fast tier for strong task', request: (run: DeliveryRun, task: FoundationRevisionSemanticRecheckTask, workspacePath: string) => ({ ...revisionSemanticRequest(run, task, workspacePath), contract: { ...revisionSemanticRequest(run, task, workspacePath).contract, modelTier: 'fast' } }) },
      { name: 'persisted task is not strong', request: (run: DeliveryRun, task: FoundationRevisionSemanticRecheckTask, workspacePath: string) => revisionSemanticRequest(run, task, workspacePath), taskTier: 'fast' as const },
    ] as const
    for (const scenario of cases) {
      const spoof = await preparedController()
      try {
        let current = await reachSemanticRecheck(spoof.controller, spoof.workspacePath)
        let task = current.foundationAuditState!.tasks.find(candidate => candidate.kind === 'semantic-recheck')! as FoundationRevisionSemanticRecheckTask
        const baselineDispatches = spoof.requests.filter(request => request.taskId === task.taskId).length
        const baselineAttempt = task.attempt
        current = { ...current, foundationAuditState: { ...current.foundationAuditState!, tasks: current.foundationAuditState!.tasks.map(candidate => candidate.taskId === task.taskId && candidate.kind === 'semantic-recheck' ? { ...candidate, status: 'pending' as const, dispatch: undefined } : candidate) } }
        if ('taskTier' in scenario && scenario.taskTier) {
          current = { ...current, foundationAuditState: { ...current.foundationAuditState!, tasks: current.foundationAuditState!.tasks.map(candidate => candidate.taskId === task.taskId && candidate.kind === 'semantic-recheck' ? { ...candidate, modelTier: scenario.taskTier } : candidate) } }
        }
        await spoof.controller.store.commit(current, { runId: current.runId, type: 'test.semantic.spoof', phase: current.phase, status: current.status, revision: current.revision })
        task = current.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)! as FoundationRevisionSemanticRecheckTask
        const request = scenario.request(current, task, spoof.workspacePath)
        await expect(spoof.controller.dispatcher.dispatch(request)).rejects.toThrow(/identity|tier|model|strong|kind/i)
        const after = await spoof.controller.store.load()
        const durable = after!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
        expect(durable.attempt).toBe(baselineAttempt)
        expect(durable.status).toBe('pending')
        expect(spoof.requests.filter(candidate => candidate.taskId === task.taskId)).toHaveLength(baselineDispatches)
      } finally { await rm(spoof.workspacePath, { recursive: true, force: true }) }
    }
  })

  test('revision semantic claim starts at most four of five distinct issue packets', async () => {
    const concurrent = await preparedController()
    try {
      const current = await reachSemanticRecheck(concurrent.controller, concurrent.workspacePath)
      const source = current.foundationAuditState!.tasks.find(candidate => candidate.kind === 'semantic-recheck')! as FoundationRevisionSemanticRecheckTask
      const sourcePacket = JSON.parse((await readFile(join(concurrent.workspacePath, source.packetPath))).toString()) as {
        expected: string
        actual: string
        sections: Array<{ ref: SectionRef; text: string }>
        patchOperation: PatchOperation
      }
      const committed = await loadCommittedFoundationDerivedArtifacts({ workspacePath: concurrent.workspacePath, revision: source.revision })
      expect(committed).toBeDefined()
      const documents = Object.fromEntries(await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(concurrent.workspacePath, path), 'utf8')] as const))) as Record<string, string>
      for (const task of current.foundationAuditState!.tasks) {
        if (task.kind !== 'document-revision' || task.status !== 'completed') continue
        documents[task.documentPath] = (await readFile(join(concurrent.workspacePath, task.stagedPath))).toString()
      }
      const sectionIndex = buildFoundationSectionIndex({ documents })
      const semanticTasks = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
        const issueId = `AUD-recheck-concurrency-${index}`
        const taskId = `${source.revision}.semantic-recheck.${source.round}.concurrency-${index}`
        const baseOperation: PatchOperation = { ...sourcePacket.patchOperation, issueIds: [issueId] }
        const sourceRef = sectionIndex.find(ref => ref.documentPath === baseOperation.documentPath && ref.sectionId === baseOperation.sectionId)!
        const operation: PatchOperation = baseOperation.kind === 'DELETE' ? baseOperation : { ...baseOperation, afterDigest: sourceRef.digest }
        const issue: AuditIssue = { id: issueId, severity: 'HIGH', type: 'semantic', source: sourceRef, expected: sourcePacket.expected, actual: sourcePacket.actual, remediation: { kind: 'patch', documentPath: operation.documentPath, sectionIds: [operation.sectionId] } }
        const packet = buildFoundationSemanticRecheckPacket({ issue, patchOperation: operation, sectionIndex, documents, impact: analyzeFoundationImpact([operation]), factStore: committed!.factStore })
        const packetPath = await writeFoundationRevisionSemanticPacket({ workspacePath: concurrent.workspacePath, revision: source.revision, round: source.round, taskId, packet })
        return { taskId, kind: 'semantic-recheck' as const, revision: source.revision, round: source.round, packetPath, packetDigest: packet.packetDigest, status: 'pending' as const, attempt: 0, bundleId: source.bundleId ?? 'test-bundle', issueId, issue, modelTier: 'strong' as const }
      }))
      const taskIds = new Set(semanticTasks.map(task => task.taskId))
      const baseline = concurrent.requests.filter(request => request.taskId && taskIds.has(request.taskId)).length
      const widened = { ...current, foundationAuditState: { ...current.foundationAuditState!, tasks: [...current.foundationAuditState!.tasks.filter(candidate => candidate.kind !== 'semantic-recheck'), ...semanticTasks], revisionBundles: current.foundationAuditState!.revisionBundles?.map(bundle => bundle.bundleId === current.foundationAuditState!.activeBundleId ? { ...bundle, taskIds: [...new Set([...bundle.taskIds.filter(taskId => current.foundationAuditState!.tasks.some(task => task.taskId === taskId && task.kind !== 'semantic-recheck')), ...semanticTasks.map(task => task.taskId)])] } : bundle) } }
      await concurrent.controller.store.commit(widened, { runId: widened.runId, type: 'test.semantic.concurrency', phase: widened.phase, status: widened.status, revision: widened.revision })
      const dispatchResults = await Promise.allSettled(semanticTasks.map(task => concurrent.controller.dispatcher.dispatch(revisionSemanticRequest(widened, task as FoundationRevisionSemanticRecheckTask, concurrent.workspacePath))))
      expect(dispatchResults.filter(result => result.status === 'fulfilled')).toHaveLength(4)
      const rejected = dispatchResults.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      expect(rejected).toHaveLength(1)
      expect(String(rejected[0]!.reason)).toMatch(/concurrency|limit/i)
      const after = await concurrent.controller.store.load()
      expect(concurrent.requests.filter(request => request.taskId && taskIds.has(request.taskId))).toHaveLength(baseline + 4)
      expect(after!.foundationAuditState!.tasks.filter(candidate => candidate.kind === 'semantic-recheck' && candidate.status === 'running')).toHaveLength(4)
      expect(after!.foundationAuditState!.tasks.filter(candidate => candidate.kind === 'semantic-recheck' && candidate.status === 'pending')).toHaveLength(1)
    } finally { await rm(concurrent.workspacePath, { recursive: true, force: true }) }
  })

  test('revision impacted fact dispatch enforces fast readiness and task authority', async () => {
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

  test('revision impacted fact terminals admit detailed valid results', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(controller, workspacePath)
      await controller.resume(rebuilding!)
      const planned = await controller.store.load()
      const task = planned!.foundationAuditState!.tasks.find(candidate => candidate.kind === 'impacted-facts')!
      const packet = JSON.parse((await readFile(join(workspacePath, task.packetPath))).toString()) as { keys: string[]; sections: Array<{ documentPath: string; sectionId: string; startLine: number; endLine: number }> }
      await controller.store.addWorkflowUsage(planned!.runId, { input_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 1, total_tokens: 2 }, task.dispatch!.dispatchId)
      const oversizedResults = (await presentFactResults(workspacePath, packet)) as Array<Record<string, unknown>>
      const first = oversizedResults[0]!
      delete first.value
      first.status = 'uncertain'
      first.reason = 'x'.repeat(10_000)
      await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, { workerType: 'foundation-fact-extractor', status: 'completed', runId: planned!.runId, dispatchId: task.dispatch!.dispatchId, taskId: task.taskId, revision: task.revision, packetDigest: task.packetDigest, results: oversizedResults })
      const completedTask = (await controller.store.load())!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(completedTask.status).toBe('completed')
      expect(completedTask.failureReason).toBeUndefined()
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('revision impacted fact terminal failures remain retryable after the former cap', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(controller, workspacePath)
      await controller.resume(rebuilding!)
      let current = await controller.store.load()
      const task = current!.foundationAuditState!.tasks.find((candidate): candidate is FoundationRevisionImpactedFactsTask => candidate.kind === 'impacted-facts' && candidate.status === 'running')!
      await expect(controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, {})).rejects.toThrow(/invalid|terminal/i)
      current = await controller.store.load()
      const secondAttempt = current!.foundationAuditState!.tasks.find((candidate): candidate is FoundationRevisionImpactedFactsTask => candidate.taskId === task.taskId && candidate.kind === 'impacted-facts' && candidate.status === 'running')!
      await expect(controller.dispatcher.completeDispatch(secondAttempt.dispatch!.dispatchId, {})).rejects.toThrow(/invalid|terminal/i)
      const after = await controller.store.load()
      expect(after!.status).toBe('running')
      expect(after!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)).toMatchObject({ status: 'running', attempt: 3 })
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('retries a structurally valid impacted-fact result rejected by business validation', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const { current: planned } = await driveToRevisionFactPlanning(controller, workspacePath)
      const task = planned!.foundationAuditState!.tasks.find((candidate): candidate is FoundationRevisionImpactedFactsTask => candidate.kind === 'impacted-facts' && candidate.status === 'running')!
      const packet = JSON.parse((await readFile(join(workspacePath, task.packetPath))).toString()) as { keys: string[]; sections: Array<{ documentPath: string; sectionId: string; startLine: number; endLine: number }> }
      const invalidResults = await presentFactResults(workspacePath, packet)
      invalidResults[0] = {
        ...invalidResults[0]!,
        evidence: { ...invalidResults[0]!.evidence, digest: '0'.repeat(64) },
      }

      await controller.dispatcher.completeDispatch(task.dispatch!.dispatchId, {
        workerType: 'foundation-fact-extractor', status: 'completed', runId: planned!.runId,
        dispatchId: task.dispatch!.dispatchId, taskId: task.taskId, revision: task.revision,
        packetDigest: task.packetDigest, results: invalidResults,
      })

      const after = await controller.store.load()
      const retried = after!.foundationAuditState!.tasks.find(candidate => candidate.taskId === task.taskId)!
      expect(after!.status).toBe('running')
      expect(retried.status).toBe('running')
      expect(retried.attempt).toBe(2)
      expect(retried.dispatch?.dispatchId).not.toBe(task.dispatch!.dispatchId)
      expect(retried.dispatch?.terminalResult).toBeUndefined()
      expect('receiptPath' in retried && retried.receiptPath).toBeFalsy()
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('revision impacted fact rejects a wrong worker kind without starting it', async () => {
    const wrong = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(wrong.controller, wrong.workspacePath)
      await wrong.controller.resume(rebuilding!)
      const pending = await wrong.controller.store.load()
      const task = pending!.foundationAuditState!.tasks.find(candidate => candidate.kind === 'impacted-facts')!
      const pendingTask = { ...pending!, foundationAuditState: { ...pending!.foundationAuditState!, tasks: pending!.foundationAuditState!.tasks.map(candidate => candidate.taskId === task.taskId ? { ...candidate, status: 'retryable' as const, dispatch: undefined } : candidate) } }
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
      const impacted = planned!.foundationAuditState!.tasks.find(task => task.kind === 'impacted-facts')!
      await writeFile(join(workspacePath, impacted.packetPath), '{not-json\n')
      const retry = { ...planned!, foundationAuditState: { ...planned!.foundationAuditState!, tasks: planned!.foundationAuditState!.tasks.map(task => task.taskId === impacted.taskId && task.kind === 'impacted-facts' ? { ...task, status: 'retryable' as const, attempt: 2, dispatch: undefined } : task) } }
      await controller.store.commit(retry, { runId: retry.runId, type: 'test.corrupt.revision.fact.packet', phase: retry.phase, status: retry.status, revision: retry.revision })
      await controller.resume(retry)
      const failed = await controller.store.load()
      expect(failed!.status).toBe('needs_action')
      expect(failed!.blockedReason).toMatch(/packet|digest|artifact|JSON/i)
      expect(failed!.foundationAuditState!.tasks.find(task => task.taskId === impacted.taskId)!.status).not.toBe('running')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('a rebuilding packet parse error is durably needs_action rather than silently running', async () => {
    const { workspacePath, controller } = await preparedController()
    try {
      const { rebuilding } = await completeFactOwnerRevision(controller, workspacePath)
      const documentTask = rebuilding.foundationAuditState!.tasks.find(task => task.kind === 'document-revision')!
      await writeFile(join(workspacePath, documentTask.packetPath), '{broken revision packet\n')
      await controller.resume(rebuilding)
      const failed = await controller.store.load()
      expect(failed!.status).toBe('needs_action')
      expect(failed!.blockedReason).toMatch(/JSON|packet|malformed|Unexpected/i)
      expect(failed!.foundationAuditState!.status).toBe('rebuilding_facts')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })
})
