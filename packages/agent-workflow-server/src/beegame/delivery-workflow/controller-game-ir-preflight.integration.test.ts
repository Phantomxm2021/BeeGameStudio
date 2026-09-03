import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { createDeliveryWorkflowController } from './controller'
import { recoverAndResumeRun } from './recovery'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type DeliveryRun,
  type DeliveryWorkerPort,
  type WorkerDispatchRequest,
} from './types'
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
import { gameIrProjectionSliceJournalPath, loadGameIrProjectionSliceJournal } from './game-ir/projection-slice-journal'
import { buildGameIrSemanticObligationInventory } from './game-ir/semantic-obligation-inventory'
import { buildGameIrSemanticObligationValidationAuthority } from './game-ir/semantic-obligation-validation'

const DIGEST = 'a'.repeat(64)
const ZERO_USAGE = { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 }

function document(path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]): string {
  const contract = getGameDocumentContract(path)
  return [
    '---', 'version: 1.0.0', 'updated_at: 2026-08-12T00:00:00.000Z', '---',
    `# ${path}`, '', '<!-- beegame-executive-summary -->', '## Executive Summary', '', 'fixture authority', '',
    ...contract.sections.flatMap(section => [`<!-- beegame-section:${section.sectionId} -->`, `## ${section.title}`, '', 'fixture authority', '']),
    '<!-- beegame-production-materials -->', '## Production Materials', '',
    ...contract.productionMaterials.flatMap(material => [`<!-- beegame-material:${material.materialId} -->`, `### ${material.title}`, '', 'fixture authority', '']),
  ].join('\n') + '\n'
}

function semanticTasks(revision: string) {
  return FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(check => ({
    taskId: `semantic-${check.checkId}`, kind: 'semantic' as const, revision, checkId: check.checkId,
    packetDigest: DIGEST, modelTier: check.modelTier, status: 'completed' as const, attempt: 1,
    terminalDigest: DIGEST, usage: ZERO_USAGE, durationMs: 0,
    dispatch: { dispatchId: `dispatch-${check.checkId}`, workerType: 'foundation-semantic-reviewer' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: `semantic-${check.checkId}`, revision, status: 'completed' as const, startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:00.000Z', terminalResult: {} },
    admittedResult: { checkId: check.checkId, packetIdentity: DIGEST, outcome: 'PASS' as const },
  }))
}

async function fixture() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'game-ir-controller-preflight-'))
  const revision = 'foundation-revision'
  const documents = Object.fromEntries(CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, document(path)]))
  await Promise.all(Object.entries(documents).map(async ([path, bytes]) => {
    await mkdir(join(workspacePath, path, '..'), { recursive: true })
    await writeFile(join(workspacePath, path), bytes)
  }))
  const sectionIndex = buildFoundationSectionIndex({ documents })
  const sectionIndexDigest = digestSectionIndex(sectionIndex)
  const documentDigests = Object.fromEntries(Object.entries(documents).map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]))
  const derivedRoot = `.beegame/audit/foundation/${revision}/derived`
  await mkdir(join(workspacePath, derivedRoot), { recursive: true })
  await writeFile(join(workspacePath, `${derivedRoot}/section-index.json`), `${JSON.stringify({ revision, documentDigests: Object.entries(documentDigests).map(([path, digest]) => ({ path, digest })), sections: sectionIndex, digest: sectionIndexDigest })}\n`)
  const factStore = createFoundationFactStore([])
  const factStoreDigest = digestFactStore(factStore)
  const foundationAuditState = {
    schemaVersion: 9, schemaFingerprint: 'foundation-audit-state-v9', status: 'audit_ready', revision,
    documentDigests, sectionIndexDigest, sectionIndexPath: `.beegame/audit/foundation/${revision}/staging/section-index.json`, manifestPath: `.beegame/audit/foundation/${revision}/staging/manifest.json`, phaseStartedAt: '2026-01-01T00:00:00.000Z', tasks: semanticTasks(revision),
    derived: { manifestPath: `${derivedRoot}/manifest.json`, manifestDigest: DIGEST, markerPath: `${derivedRoot}/COMMITTED.json`, markerDigest: DIGEST, factStorePath: `${derivedRoot}/fact-store.json`, factStoreDigest, sectionIndexPath: `${derivedRoot}/section-index.json`, sectionIndexDigest },
    deterministic: { reviewDigest: DIGEST, issueRegistryPath: `.beegame/audit/foundation/${revision}/staging/review/issue-registry.json`, issueRegistryDigest: DIGEST, manifestPath: `.beegame/audit/foundation/${revision}/staging/review/manifest.json`, manifestDigest: DIGEST, markerPath: `.beegame/audit/foundation/${revision}/staging/review/COMMITTED.json`, markerDigest: DIGEST, catalogVersion: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion, contractGraphDigest: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contractGraphDigest, sectionIndexDigest, factStoreDigest },
    semantic: { aggregateUsage: ZERO_USAGE },
    review: { reviewDigest: DIGEST, issueRegistryPath: `.beegame/audit/foundation/${revision}/review/${DIGEST}/issue-registry.json`, issueRegistryDigest: DIGEST, manifestPath: `.beegame/audit/foundation/${revision}/review/${DIGEST}/manifest.json`, manifestDigest: DIGEST, markerPath: `.beegame/audit/foundation/${revision}/review/${DIGEST}/COMMITTED.json`, markerDigest: DIGEST, sectionIndexDigest, factStoreDigest, semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest, issueSummary: { total: 0, blocker: 0, high: 0, medium: 0, low: 0 } },
  }
  const run = createTestDeliveryRun({ runId: 'game-ir-preflight-run', projectId: 'game-ir-preflight-project', ownerId: 'game-ir-preflight-owner', confirmedBriefContext: 'controller preflight fixture' }) as DeliveryRun
  const receipt = projectFoundationReadyReceipt({ state: foundationAuditState as never, projectId: run.projectId, confirmedBriefDigest: run.confirmedBriefDigest })
  const identity = { runId: run.runId, taskId: 'game-ir-preflight-task', publicationId: 'game-ir-preflight-publication', confirmedBriefDigest: run.confirmedBriefDigest, foundationRevision: revision, foundationReadyReceiptDigest: receipt.receiptDigest }
  const compileRequest = parseGameIrCompileRequest({ schemaVersion: 'game-ir-compile-request.v1', taskId: identity.taskId, publicationId: identity.publicationId, gameIrSchemaVersion: 'game-ir.v1', foundation: receipt })
  const source = await buildGameIrSourcePacket({ workspacePath, request: compileRequest, receipt, domain: 'gameplay' })
  const operation = GAME_IR_STAGED_OPERATIONS[0]!
  const packet = buildStagedOperationPacket({ operation, source, records: new Map() }) as Record<string, unknown>
  const catalog = buildGameIrEvidenceFragmentCatalog({ sectionIndex: source.sectionIndex, sectionBytes: source.sectionBytes })
  const selectors = sourceSectionsForGameIrProjectionSlice('gameplay.slice.0')
  const fragmentId = catalog.fragments.find(fragment => selectors.some(selector => selector.documentPath === fragment.documentPath && selector.sectionId === fragment.sectionId))!.fragmentId
  const inventoryRecord = { record: 'obligation' as const, moduleId: source.moduleId, targetId: 'state-start', targetKind: 'gameplay.state', fragmentId }
  const inventory = buildGameIrSemanticObligationInventory({ moduleId: source.moduleId, source, records: [inventoryRecord] })
  const authority = buildGameIrSemanticObligationValidationAuthority({ source, inventory })
  const passResult = { outcome: 'PASS' as const, moduleId: source.moduleId, coverage: authority.sourceFragments.map(fragment => fragment.fragmentId) }
  const journalInput = { journalPath: gameIrProjectionSliceJournalPath({ workspacePath, identity, operationStep: 'phase4/gameplay/projection' }), identity, operationStep: 'phase4/gameplay/projection' as const, packet: packet as never, slicePlan: deriveProjectionSlicePlan('gameplay') }
  const started: WorkerDispatchRequest[] = []
  const workerPort: DeliveryWorkerPort = {
    async start(request) { started.push(request); return { sessionId: request.dispatchId!, dispatchId: request.dispatchId! } },
    async submit() {}, async stop() {}, async close() {},
    async status(dispatchId) { return { dispatchId, workerType: 'game-ir-compiler', phase: 'GAME_IR_COMPILATION', taskId: identity.taskId, revision, status: 'running', startedAt: '2026-01-01T00:00:00.000Z' } },
  }
  const initial = { ...run, phase: 'GAME_IR_COMPILATION' as const, status: 'running' as const, revision: { ...run.revision, document: revision }, foundationAuditState: foundationAuditState as never, gameIrState: { status: 'compiling' as const, identity } } as DeliveryRun
  const controller = createDeliveryWorkflowController({ workspacePath, ownerId: run.ownerId, workerPort })
  await controller.store.save(initial)
  return { workspacePath, controller, workerPort, started, initial, identity, source, inventory, authority, passResult, journalInput, packet, inventoryRecord, projectionRecord: { fragmentId, node: { id: 'state-start', kind: 'gameplay.state', value: { label: 'Start', initial: true, terminal: 'none' }, references: [], edges: [] } } }
}

function service(request: WorkerDispatchRequest, operation: string, extra: Record<string, unknown> = {}) {
  return { workerType: 'game-ir-compiler', operation, status: 'completed', runId: request.runId, dispatchId: request.dispatchId, taskId: request.taskId, revision: request.revision, compileRequestDigest: request.contract.compileRequestDigest, foundationReadyReceiptDigest: request.contract.foundationReadyReceiptDigest, ...extra }
}

async function recover(fixtureValue: Awaited<ReturnType<typeof fixture>>, workerPort: DeliveryWorkerPort) {
  const current = await fixtureValue.controller.store.load()
  await fixtureValue.controller.store.save({ ...current!, activeDispatch: undefined })
  const recoveredController = createDeliveryWorkflowController({ workspacePath: fixtureValue.workspacePath, ownerId: current!.ownerId, workerPort })
  await recoverAndResumeRun({ store: recoveredController.store, workspacePath: fixtureValue.workspacePath, ownerId: current!.ownerId, projectId: current!.projectId, confirmedBriefContext: current!.confirmedBriefContext, stopWorkspaceWorkers: async () => {}, resumeCurrentRun: run => recoveredController.resume(run) })
  return recoveredController
}

describe('Game IR controller obligation preflight integration', () => {
  test('drives inventory, validation PASS, and projection with the admitted inventory', async () => {
    const f = await fixture()
    try {
      await f.controller.resume(f.initial)
      expect(f.started[0]?.contract.kind).toBe('obligation-inventory')
      const inventoryDispatch = f.started[0]!
      await f.controller.dispatcher.completeDispatch(inventoryDispatch.dispatchId!, service(inventoryDispatch, 'obligation-inventory', { records: [f.inventoryRecord], done: true }))
      expect(f.started[1]?.contract.kind).toBe('obligation-validation')
      const validationDispatch = f.started[1]!
      await f.controller.dispatcher.completeDispatch(validationDispatch.dispatchId!, service(validationDispatch, 'obligation-validation', { result: f.passResult, done: true }))
      const projectionDispatch = f.started[2]!
      expect(projectionDispatch.contract.kind).toBe('projection')
      expect(projectionDispatch.contract.obligationInventory).toEqual(f.inventory)
      const journal = await loadGameIrProjectionSliceJournal(f.journalInput)
      expect(journal.obligationInventory).toEqual(f.inventory)
      expect(journal.validationReceipt?.schemaVersion).toBe('game-ir-semantic-obligation-validation-receipt.v1')
    } finally { await rm(f.workspacePath, { recursive: true, force: true }) }
  })

  test('missing obligation clears preflight evidence and returns to inventory dispatch', async () => {
    const f = await fixture()
    try {
      await f.controller.resume(f.initial)
      const inventoryDispatch = f.started[0]!
      await f.controller.dispatcher.completeDispatch(inventoryDispatch.dispatchId!, service(inventoryDispatch, 'obligation-inventory', { records: [f.inventoryRecord], done: true }))
      const validationDispatch = f.started[1]!
      await f.controller.dispatcher.completeDispatch(validationDispatch.dispatchId!, service(validationDispatch, 'obligation-validation', { result: { outcome: 'FAIL', moduleId: f.source.moduleId, reasonCode: 'missing-obligation', targetId: 'state-later', expectedKind: 'gameplay.state', semanticRole: 'state', fragmentId: f.inventoryRecord.fragmentId }, done: true }))
      const journal = await loadGameIrProjectionSliceJournal(f.journalInput)
      expect(journal.obligationInventory).toBeUndefined()
      expect(journal.validationReceipt).toBeUndefined()
      expect(f.started[2]?.contract.kind).toBe('obligation-inventory')
    } finally { await rm(f.workspacePath, { recursive: true, force: true }) }
  })

  test('AMBIGUOUS needs action and does not dispatch projection', async () => {
    const f = await fixture()
    try {
      await f.controller.resume(f.initial)
      const inventoryDispatch = f.started[0]!
      await f.controller.dispatcher.completeDispatch(inventoryDispatch.dispatchId!, service(inventoryDispatch, 'obligation-inventory', { records: [f.inventoryRecord], done: true }))
      const validationDispatch = f.started[1]!
      await f.controller.dispatcher.completeDispatch(validationDispatch.dispatchId!, service(validationDispatch, 'obligation-validation', { result: { outcome: 'AMBIGUOUS', moduleId: f.source.moduleId, reasonCode: 'ambiguous-obligation', detail: 'two candidate owners' }, done: true }))
      const run = await f.controller.store.load()
      expect(run?.status).toBe('needs_action')
      expect(run?.blockedReason).toContain('ambiguous')
      expect(f.started).toHaveLength(2)
    } finally { await rm(f.workspacePath, { recursive: true, force: true }) }
  })

  test('recovery derives validation from persisted inventory before validator dispatch', async () => {
    const f = await fixture()
    try {
      await f.controller.resume(f.initial)
      const inventoryDispatch = f.started[0]!
      await f.controller.dispatcher.completeDispatch(inventoryDispatch.dispatchId!, service(inventoryDispatch, 'obligation-inventory', { records: [f.inventoryRecord], done: true }))
      const recovered = await recover(f, f.workerPort)
      const run = await recovered.store.load()
      expect(run?.activeDispatch?.request?.contract.kind).toBe('obligation-validation')
      expect(f.started.at(-1)?.contract.kind).toBe('obligation-validation')
    } finally { await rm(f.workspacePath, { recursive: true, force: true }) }
  })

  test('recovery derives projection from persisted PASS receipt before first slice', async () => {
    const f = await fixture()
    try {
      await f.controller.resume(f.initial)
      const inventoryDispatch = f.started[0]!
      await f.controller.dispatcher.completeDispatch(inventoryDispatch.dispatchId!, service(inventoryDispatch, 'obligation-inventory', { records: [f.inventoryRecord], done: true }))
      const validationDispatch = f.started[1]!
      await f.controller.dispatcher.completeDispatch(validationDispatch.dispatchId!, service(validationDispatch, 'obligation-validation', { result: f.passResult, done: true }))
      const recovered = await recover(f, f.workerPort)
      const run = await recovered.store.load()
      expect(run?.activeDispatch?.request?.contract.kind).toBe('projection')
      expect(run?.activeDispatch?.request?.contract.currentSlice).toBe('gameplay.slice.0')
    } finally { await rm(f.workspacePath, { recursive: true, force: true }) }
  })

  test('accepts only a complete PASS contract for an empty inventory', async () => {
    const f = await fixture()
    try {
      const emptyInventory = buildGameIrSemanticObligationInventory({ moduleId: f.source.moduleId, source: f.source, records: [] })
      const authority = buildGameIrSemanticObligationValidationAuthority({ source: f.source, inventory: emptyInventory })
      const passResult = { outcome: 'PASS' as const, moduleId: f.source.moduleId, coverage: authority.sourceFragments.map(fragment => fragment.fragmentId) }
      await f.controller.resume(f.initial)
      const inventoryDispatch = f.started[0]!
      await f.controller.dispatcher.completeDispatch(inventoryDispatch.dispatchId!, service(inventoryDispatch, 'obligation-inventory', { records: [], done: true }))
      const validationDispatch = f.started[1]!
      await f.controller.dispatcher.completeDispatch(validationDispatch.dispatchId!, service(validationDispatch, 'obligation-validation', { result: passResult, done: true }))
      expect(f.started[2]?.contract.kind).toBe('projection')
    } finally { await rm(f.workspacePath, { recursive: true, force: true }) }
  })
})
