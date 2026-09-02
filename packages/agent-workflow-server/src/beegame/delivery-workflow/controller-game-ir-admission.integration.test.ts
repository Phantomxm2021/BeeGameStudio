import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { createDeliveryWorkflowController } from './controller'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun, type DeliveryWorkerPort, type WorkerDispatchRequest } from './types'
import { getGameDocumentContract } from './game-document-contracts'
import { buildFoundationSectionIndex, digestSectionIndex } from './foundation-section-index'
import { FOUNDATION_AUDIT_PRODUCTION_MANIFEST } from './foundation-audit-production-manifest'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST } from './foundation-semantic-audit'
import { createFoundationFactStore, digestFactStore } from './foundation-fact-store'
import { projectFoundationReadyReceipt } from './game-ir/foundation-ready-adapter'
import { parseGameIrCompileRequest } from './game-ir/contracts'
import { GAME_IR_STAGED_OPERATIONS, buildGameIrSourcePacket, buildStagedOperationPacket } from './game-ir/staged-compiler'
import { deriveProjectionSlicePlan, buildGameIrEvidenceFragmentCatalog } from './game-ir/projection-slices'
import { sourceSectionsForGameIrProjectionSlice } from './game-ir/projection-slice-authority'
import { digestGameIrValue } from './game-ir/model'
import { createGameIrProjectionSliceJournal, gameIrProjectionSliceJournalPath, loadGameIrProjectionSliceJournal } from './game-ir/projection-slice-journal'

const DIGEST = 'a'.repeat(64)
const ZERO_USAGE = { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 }

function document(path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]): string {
  const contract = getGameDocumentContract(path)
  return [
    '---',
    'version: 1.0.0',
    'updated_at: 2026-08-12T00:00:00.000Z',
    '---',
    `# ${path}`,
    '',
    '<!-- beegame-executive-summary -->',
    '## Executive Summary',
    '',
    'fixture authority',
    '',
    ...contract.sections.flatMap(section => [
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      '',
      'fixture authority',
      '',
    ]),
    '<!-- beegame-production-materials -->',
    '## Production Materials',
    '',
    ...contract.productionMaterials.flatMap(material => [
      `<!-- beegame-material:${material.materialId} -->`,
      `### ${material.title}`,
      '',
      'fixture authority',
      '',
    ]),
  ].join('\n') + '\n'
}

function semanticTasks(revision: string) {
  return FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(check => ({
    taskId: `semantic-${check.checkId}`,
    kind: 'semantic' as const,
    revision,
    checkId: check.checkId,
    packetDigest: DIGEST,
    modelTier: check.modelTier,
    status: 'completed' as const,
    attempt: 1,
    terminalDigest: DIGEST,
    usage: ZERO_USAGE,
    durationMs: 0,
    dispatch: {
      dispatchId: `dispatch-${check.checkId}`,
      workerType: 'foundation-semantic-reviewer' as const,
      phase: 'DOCUMENT_REVIEW' as const,
      taskId: `semantic-${check.checkId}`,
      revision,
      status: 'completed' as const,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:00.000Z',
      terminalResult: {},
    },
    admittedResult: {
      checkId: check.checkId,
      packetIdentity: DIGEST,
      outcome: 'PASS' as const,
    },
  }))
}

async function prepareFixture() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'game-ir-controller-admission-'))
  const revision = 'foundation-revision'
  const documents = Object.fromEntries(
    CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, document(path)]),
  )
  await Promise.all(
    Object.entries(documents).map(async ([path, bytes]) => {
      await mkdir(join(workspacePath, path, '..'), { recursive: true })
      await writeFile(join(workspacePath, path), bytes)
    }),
  )
  const sectionIndex = buildFoundationSectionIndex({ documents })
  const sectionIndexDigest = digestSectionIndex(sectionIndex)
  const documentDigests = Object.fromEntries(
    Object.entries(documents).map(([path, bytes]) => [
      path,
      createHash('sha256').update(bytes).digest('hex'),
    ]),
  )
  const derivedRoot = `.beegame/audit/foundation/${revision}/derived`
  await mkdir(join(workspacePath, derivedRoot), { recursive: true })
  await writeFile(
    join(workspacePath, `${derivedRoot}/section-index.json`),
    `${JSON.stringify({ revision, documentDigests: Object.entries(documentDigests).map(([path, digest]) => ({ path, digest })), sections: sectionIndex, digest: sectionIndexDigest })}\n`,
  )
  const factStore = createFoundationFactStore([])
  const factStoreDigest = digestFactStore(factStore)
  const foundationAuditState = {
    schemaVersion: 9,
    schemaFingerprint: 'foundation-audit-state-v9',
    status: 'audit_ready',
    revision,
    documentDigests,
    sectionIndexDigest,
    sectionIndexPath: `.beegame/audit/foundation/${revision}/staging/section-index.json`,
    manifestPath: `.beegame/audit/foundation/${revision}/staging/manifest.json`,
    phaseStartedAt: '2026-01-01T00:00:00.000Z',
    tasks: semanticTasks(revision),
    derived: {
      manifestPath: `${derivedRoot}/manifest.json`,
      manifestDigest: DIGEST,
      markerPath: `${derivedRoot}/COMMITTED.json`,
      markerDigest: DIGEST,
      factStorePath: `${derivedRoot}/fact-store.json`,
      factStoreDigest,
      sectionIndexPath: `${derivedRoot}/section-index.json`,
      sectionIndexDigest,
    },
    deterministic: {
      reviewDigest: DIGEST,
      issueRegistryPath: `.beegame/audit/foundation/${revision}/staging/review/issue-registry.json`,
      issueRegistryDigest: DIGEST,
      manifestPath: `.beegame/audit/foundation/${revision}/staging/review/manifest.json`,
      manifestDigest: DIGEST,
      markerPath: `.beegame/audit/foundation/${revision}/staging/review/COMMITTED.json`,
      markerDigest: DIGEST,
      catalogVersion: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion,
      contractGraphDigest: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contractGraphDigest,
      sectionIndexDigest,
      factStoreDigest,
    },
    semantic: { aggregateUsage: ZERO_USAGE },
    review: {
      reviewDigest: DIGEST,
      issueRegistryPath: `.beegame/audit/foundation/${revision}/review/${DIGEST}/issue-registry.json`,
      issueRegistryDigest: DIGEST,
      manifestPath: `.beegame/audit/foundation/${revision}/review/${DIGEST}/manifest.json`,
      manifestDigest: DIGEST,
      markerPath: `.beegame/audit/foundation/${revision}/review/${DIGEST}/COMMITTED.json`,
      markerDigest: DIGEST,
      sectionIndexDigest,
      factStoreDigest,
      semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest,
      issueSummary: { total: 0, blocker: 0, high: 0, medium: 0, low: 0 },
    },
  }
  const context = 'controller admission fixture'
  const run = createTestDeliveryRun({
    runId: 'game-ir-admission-run',
    projectId: 'game-ir-project',
    ownerId: 'game-ir-owner',
    confirmedBriefContext: context,
  }) as DeliveryRun
  const receipt = projectFoundationReadyReceipt({
    state: foundationAuditState as never,
    projectId: run.projectId,
    confirmedBriefDigest: run.confirmedBriefDigest,
  })
  const identity = {
    runId: run.runId,
    taskId: 'game-ir-admission-task',
    publicationId: 'game-ir-admission-publication',
    confirmedBriefDigest: run.confirmedBriefDigest,
    foundationRevision: revision,
    foundationReadyReceiptDigest: receipt.receiptDigest,
  }
  const compileRequest = parseGameIrCompileRequest({
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: identity.taskId,
    publicationId: identity.publicationId,
    gameIrSchemaVersion: 'game-ir.v1',
    foundation: receipt,
  })
  const source = await buildGameIrSourcePacket({
    workspacePath,
    request: compileRequest,
    receipt,
    domain: 'gameplay',
  })
  const operation = GAME_IR_STAGED_OPERATIONS[0]!
  const packet = buildStagedOperationPacket({ operation, source, records: new Map() }) as Record<string, unknown>
  const request: WorkerDispatchRequest = {
    dispatchId: 'game-ir-admission-dispatch',
    runId: run.runId,
    ownerId: run.ownerId,
    projectId: run.projectId,
    workspacePath,
    workerType: 'game-ir-compiler',
    phase: 'GAME_IR_COMPILATION',
    taskId: identity.taskId,
    revision,
    contract: {
      kind: 'projection',
      packet,
      compileRequestDigest: digestGameIrValue(compileRequest),
      foundationReadyReceiptDigest: receipt.receiptDigest,
      currentSlice: 'gameplay.slice.0',
      progress: [],
      sliceContext: {
        availablePriorNodes: [],
        requiredCurrentNodes: [],
        admittedCurrentNodes: [],
      },
    },
  }
  const started: WorkerDispatchRequest[] = []
  const workerPort: DeliveryWorkerPort = {
    async start(next) {
      started.push(next)
      return { sessionId: next.dispatchId!, dispatchId: next.dispatchId! }
    },
    async submit() {},
    async stop() {},
    async close() {},
    async status(dispatchId) {
      return { dispatchId, workerType: 'game-ir-compiler', phase: 'GAME_IR_COMPILATION', taskId: identity.taskId, revision, status: 'running', startedAt: '2026-01-01T00:00:00.000Z' }
    },
  }
  const controller = createDeliveryWorkflowController({ workspacePath, ownerId: run.ownerId, workerPort })
  const initial = {
    ...run,
    phase: 'GAME_IR_COMPILATION' as const,
    status: 'running' as const,
    revision: { ...run.revision, document: revision },
    foundationAuditState: foundationAuditState as never,
    activeDispatch: {
      dispatchId: request.dispatchId!,
      workerType: request.workerType,
      phase: request.phase,
      taskId: request.taskId,
      revision,
      status: 'running' as const,
      startedAt: '2026-01-01T00:00:00.000Z',
      request,
    },
    gameIrState: { status: 'compiling' as const, identity },
  } as DeliveryRun
  await controller.store.save(initial)
  const catalog = buildGameIrEvidenceFragmentCatalog({ sectionIndex: source.sectionIndex, sectionBytes: source.sectionBytes })
  const selectors = sourceSectionsForGameIrProjectionSlice('gameplay.slice.0')
  const fragmentId = catalog.fragments.find(fragment => selectors.some(selector => selector.documentPath === fragment.documentPath && selector.sectionId === fragment.sectionId))!.fragmentId
  const record = {
    fragmentId,
    node: {
      id: 'state-start',
      kind: 'gameplay.state',
      value: { label: 'Start', initial: true, terminal: 'none' },
      references: [],
      edges: [],
    },
  }
  const journalInput = {
    journalPath: gameIrProjectionSliceJournalPath({
      workspacePath,
      identity,
      operationStep: 'phase4/gameplay/projection',
    }),
    identity,
    operationStep: 'phase4/gameplay/projection' as const,
    packet: packet as never,
    slicePlan: deriveProjectionSlicePlan('gameplay'),
  }
  return { workspacePath, controller, request, record, started, identity, foundationAuditState, packet, initial, journalInput }
}

function terminal(request: WorkerDispatchRequest, overrides: Record<string, unknown> = {}) {
  return {
    workerType: 'game-ir-compiler', operation: 'projection', status: 'completed', sliceId: request.contract.currentSlice,
    records: [], done: true, runId: request.runId, dispatchId: request.dispatchId, taskId: request.taskId,
    revision: request.revision, compileRequestDigest: request.contract.compileRequestDigest,
    foundationReadyReceiptDigest: request.contract.foundationReadyReceiptDigest, ...overrides,
  }
}

function failedTerminal(request: WorkerDispatchRequest, reason: string, records: readonly unknown[]) {
  return terminal(request, { status: 'failed', done: false, reason, records })
}

function invalidRecord(record: Record<string, unknown>) {
  const node = record.node as Record<string, unknown>
  return { ...record, node: { ...node, id: 'state-z', value: { label: 'invalid later node' } } }
}

function secondRecord(record: Record<string, unknown>) {
  const node = record.node as Record<string, unknown>
  return {
    ...record,
    node: {
      ...node,
      id: 'state-y',
      value: { label: 'Second', initial: false, terminal: 'none' },
    },
  }
}

describe('Game IR controller admission integration', () => {
  test('completed records+done promotes the current slice through the controller', async () => {
    const fixture = await prepareFixture()
    try {
      await fixture.controller.dispatcher.completeDispatch(fixture.request.dispatchId!, terminal(fixture.request, { records: [fixture.record] }))
      const journal = await loadGameIrProjectionSliceJournal(fixture.journalInput)
      expect(journal.entries).toHaveLength(1)
      expect(journal.entries[0]?.sliceId).toBe('gameplay.slice.0')
    } finally {
      await rm(fixture.workspacePath, { recursive: true, force: true })
    }
  })

  test('durably keeps the valid prefix and exact record diagnostic after a later bad record', async () => {
    const fixture = await prepareFixture()
    try {
      const bad = invalidRecord(fixture.record)
      await fixture.controller.dispatcher.completeDispatch(
        fixture.request.dispatchId!,
        failedTerminal(fixture.request, 'record stream stopped at invalid node', [fixture.record, bad]),
      )
      const journal = await loadGameIrProjectionSliceJournal(fixture.journalInput)
      expect(journal.currentSliceRecordPrefix).toEqual([{ id: 'state-start', kind: 'gameplay.state' }])
      const current = await fixture.controller.store.load()
      expect(current?.status).toBe('running')
      const actual = current?.gameIrState && 'diagnostic' in current.gameIrState ? current.gameIrState.diagnostic?.actual ?? '' : ''
      expect(actual).toContain('game-ir-retry-diagnostic:')
      expect(actual).toContain('"scope":"record"')
      expect(actual).toContain('"recordId":"state-z"')
    } finally {
      await rm(fixture.workspacePath, { recursive: true, force: true })
    }
  })

  test('replays an exact completed terminal through controller admission without duplicating journal entries', async () => {
    const fixture = await prepareFixture()
    try {
      const completed = terminal(fixture.request, { records: [fixture.record] })
      await fixture.controller.dispatcher.completeDispatch(fixture.request.dispatchId!, completed)
      const afterFirst = await loadGameIrProjectionSliceJournal(fixture.journalInput)
      expect(afterFirst.entries).toHaveLength(1)
      await fixture.controller.store.save(fixture.initial)
      await fixture.controller.dispatcher.completeDispatch(fixture.request.dispatchId!, completed)
      const afterReplay = await loadGameIrProjectionSliceJournal(fixture.journalInput)
      expect(afterReplay.entries).toHaveLength(1)
      expect(afterReplay.currentSliceRecordPrefix).toEqual([])
    } finally {
      await rm(fixture.workspacePath, { recursive: true, force: true })
    }
  })

  test('invalidates only the owner slice after a full-module admission failure', async () => {
    const fixture = await prepareFixture()
    try {
      const journal = await createGameIrProjectionSliceJournal(fixture.journalInput)
      for (const slice of journal.slicePlan.slices.slice(0, -1))
        await journal.append({ status: 'completed', sliceId: slice.sliceId, semantic: { nodes: [], sourceEvidenceGroups: [] } })
      const finalSlice = journal.slicePlan.slices.at(-1)!
      const finalRequest = {
        ...fixture.request,
        contract: {
          ...fixture.request.contract,
          currentSlice: finalSlice.sliceId,
          progress: journal.entries.map(entry => ({ sliceId: entry.sliceId, entryDigest: entry.entryDigest })),
          sliceContext: {
            availablePriorNodes: [],
            requiredCurrentNodes: [],
            admittedCurrentNodes: [],
          },
        },
      }
      const afterSetup = await fixture.controller.store.load()
      await fixture.controller.store.save({
        ...afterSetup!,
        activeDispatch: {
          ...afterSetup!.activeDispatch!,
          request: finalRequest,
        },
      })
      const setup = await fixture.controller.store.load()
      expect(setup?.activeDispatch?.request?.contract.currentSlice).toBe(finalSlice.sliceId)
      expect(journal.entries).toHaveLength(journal.slicePlan.slices.length - 1)
      await fixture.controller.dispatcher.completeDispatch(
        finalRequest.dispatchId!,
        terminal(finalRequest),
      )
      const invalidated = await loadGameIrProjectionSliceJournal(fixture.journalInput)
      expect(invalidated.entries).toEqual([])
      expect(invalidated.nextSlice?.sliceId).toBe('gameplay.slice.0')
      expect(fixture.started.at(-1)?.contract.currentSlice).toBe('gameplay.slice.0')
      const afterAdmissionFailure = await fixture.controller.store.load()
      expect(afterAdmissionFailure?.activeDispatch?.dispatchId).not.toBe(setup?.activeDispatch?.dispatchId)
      expect(afterAdmissionFailure?.gameIrState && 'diagnostic' in afterAdmissionFailure.gameIrState ? afterAdmissionFailure.gameIrState.diagnostic?.actual : '').toContain('gameplay')
    } finally {
      await rm(fixture.workspacePath, { recursive: true, force: true })
    }
  })

  test('marks only an exact prefix diagnostic authority as no-progress and treats a new prefix as progress', async () => {
    const fixture = await prepareFixture()
    try {
      const bad = invalidRecord(fixture.record)
      await fixture.controller.dispatcher.completeDispatch(
        fixture.request.dispatchId!,
        failedTerminal(fixture.request, 'same diagnostic', [fixture.record, bad]),
      )
      const firstRetry = await fixture.controller.store.load()
      expect(firstRetry?.status).toBe('running')
      const firstRetryRequest = firstRetry?.activeDispatch?.request
      expect(firstRetryRequest).toBeDefined()
      await fixture.controller.dispatcher.completeDispatch(
        firstRetryRequest!.dispatchId!,
        failedTerminal(firstRetryRequest!, 'same diagnostic', [fixture.record, bad]),
      )
      const noProgress = await fixture.controller.store.load()
      expect(noProgress?.status).toBe('needs_action')
      await fixture.controller.store.save({ ...firstRetry!, activeDispatch: { ...firstRetry!.activeDispatch!, status: 'running' } })
      const newPrefixRequest = (await fixture.controller.store.load())!.activeDispatch!.request!
      await fixture.controller.dispatcher.completeDispatch(
        newPrefixRequest.dispatchId!,
        failedTerminal(newPrefixRequest, 'same diagnostic', [fixture.record, secondRecord(fixture.record), bad]),
      )
      const progressed = await fixture.controller.store.load()
      expect(progressed?.status).toBe('running')
      expect(progressed?.gameIrState && 'diagnostic' in progressed.gameIrState ? progressed.gameIrState.diagnostic?.actual : '').toContain('record')
    } finally {
      await rm(fixture.workspacePath, { recursive: true, force: true })
    }
  })
})
