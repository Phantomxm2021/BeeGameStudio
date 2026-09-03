import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../../__tests__/delivery-workflow-test-helpers'
import { createDeliveryWorkflowController } from '../controller'
import {
  buildGameIrDomainSourceEnvelope,
  GAME_IR_MODULE_SOURCE_DOCUMENTS,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  admitGameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  admitGameplaySemanticResult,
  buildGameplaySemanticPacket,
} from './gameplay-producer'
import {
  buildBalanceProjectionOperationPacket,
  type GameIrDomainSemanticReceipt as BalanceSemanticReceipt,
  type BalanceProjectionOperationPacket,
} from './balance-producer'
import {
  assembleGameplayBalanceModules,
} from './gameplay-balance-assembler'
import {
  GAME_IR_STAGED_OPERATIONS,
} from './staged-compiler'
import {
  createGameIrProjectionSliceJournal,
  gameIrProjectionSliceJournalPath,
  loadGameIrProjectionSliceJournal,
  type GameIrProjectionSliceJournal,
  type GameIrProjectionSliceJournalInput,
} from './projection-slice-journal'
import {
  buildGameIrEvidenceFragmentCatalog,
  deriveProjectionSlicePlan,
} from './projection-slices'
import { sourceSectionsForGameIrProjectionSlice } from './projection-slice-authority'
import { digestGameIrSourceSectionIndex, digestGameIrValue } from './model'
import { GAME_IR_SCHEMA_VERSION, type FoundationReadyReceipt, type GameIrCompileRequest } from './contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun, type DeliveryWorkerPort, type WorkerDispatchRequest } from '../types'
import { createBeeGameDeliveryWorkerPort } from '../../delivery-worker-session-port'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST } from '../foundation-semantic-audit'
import { writeGameIrStageCheckpoint, GameIrStageCheckpointLoader } from './stage-checkpoint'
import { buildGameIrSemanticObligationInventory } from './semantic-obligation-inventory'
import {
  admitGameIrSemanticObligationValidationResult,
  buildGameIrSemanticObligationValidationAuthority,
} from './semantic-obligation-validation'

type Node = {
  id: string
  kind: string
  value: Record<string, unknown>
  references: Array<{ targetId: string; targetType: string }>
  edges: Array<{ type: string; targetId: string; targetType: string }>
}

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex')

const balanceOperation = GAME_IR_STAGED_OPERATIONS.find(
  operation => operation.step === 'phase4/balance/projection',
)!

function node(
  id: string,
  kind: string,
  value: Record<string, unknown>,
  references: Node['references'] = [],
  edges: Node['edges'] = [],
): Node {
  return { id, kind, value, references, edges }
}

const unit = (dimensions: unknown[] = []): Node =>
  node('balance-unit', 'balance.unit', {
    symbol: 'unit',
    dimensions,
    scale: { numerator: 1, denominator: 1 },
  })

const variable = (): Node =>
  node(
    'balance-variable',
    'balance.variable',
    { label: 'Variable', baseline: 10, minimum: 0, maximum: 100, unitReferenceIndex: 0 },
    [{ targetId: 'balance-unit', targetType: 'balance.unit' }],
  )

const formula = (expression: Record<string, unknown>): Node =>
  node(
    'balance-formula',
    'balance.formula',
    { label: 'Formula', expression, outputUnitReferenceIndex: 0 },
    [{ targetId: 'balance-unit', targetType: 'balance.unit' }],
  )

function sourceFixture(): {
  gameplay: GameIrDomainSourceEnvelope
  balance: GameIrDomainSourceEnvelope
  documents: ReadonlyMap<string, string>
} {
  const selectors = ['gameplay', 'balance', 'world-scene', 'presentation', 'resource-realization', 'implementation-verification'].flatMap(module =>
    deriveProjectionSlicePlan(module as 'gameplay' | 'balance').slices.flatMap(
      slice => sourceSectionsForGameIrProjectionSlice(slice.sliceId),
    ),
  )
  const byKey = new Map(
    selectors.map(selector => [
      `${selector.documentPath}#${selector.sectionId}`,
      selector,
    ]),
  )
  for (const documentPath of CANONICAL_FOUNDATION_DOCUMENTS)
    if (![...byKey.values()].some(section => section.documentPath === documentPath))
      byKey.set(`${documentPath}#section-fixture`, {
        documentPath,
        sectionId: 'section-fixture',
      })

  const sectionBytes = new Map<string, string>()
  const documentLines = new Map<string, string[]>()
  for (const selector of byKey.values()) {
    const key = `${selector.documentPath}#${selector.sectionId}`
    const bytes = `BALANCE_MATRIX_AUTHORITY:${key}`
    sectionBytes.set(key, bytes)
    const lines = documentLines.get(selector.documentPath) ?? []
    lines.push(bytes)
    documentLines.set(selector.documentPath, lines)
  }
  const sectionIndex = [...byKey.values()].map(selector => {
    const line = documentLines.get(selector.documentPath)!.findIndex(
      value => value === sectionBytes.get(`${selector.documentPath}#${selector.sectionId}`),
    ) + 1
    return {
      ...selector,
      heading: selector.sectionId,
      startLine: line,
      endLine: line,
      digest: sha256(sectionBytes.get(`${selector.documentPath}#${selector.sectionId}`)!),
    }
  })
  const documents = new Map(
    [...documentLines.entries()].map(([path, lines]) => [path, `${lines.join('\n')}\n`]),
  )
  const documentDigests = Object.fromEntries(
    CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, sha256(documents.get(path) ?? '')]),
  ) as FoundationReadyReceipt['documentDigests']
  const derivedRoot = `.beegame/audit/foundation/balance-matrix-revision/derived`
  const foundationBody: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'balance-matrix-project',
    foundationRevision: 'balance-matrix-revision',
    confirmedBriefDigest: sha256('balance-matrix-brief'),
    documentDigests,
    sectionIndexPath: `${derivedRoot}/section-index.json`,
    sectionIndexDigest: digestGameIrSourceSectionIndex(sectionIndex),
    authority: {
      kind: 'review',
      reviewDigest: sha256('balance-matrix-review'),
      issueRegistryDigest: sha256('balance-matrix-issues'),
    },
  }
  const receipt = { ...foundationBody, receiptDigest: digestGameIrValue(foundationBody) }
  const request: GameIrCompileRequest = {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'balance-matrix-task',
    publicationId: 'balance-matrix-publication',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: receipt,
  }
  const makeSource = (moduleId: 'gameplay' | 'balance') =>
    buildGameIrDomainSourceEnvelope({
      moduleId,
      request,
      sectionIndex,
      sectionBytes: Object.fromEntries(
        sectionIndex
          .filter(section =>
            GAME_IR_MODULE_SOURCE_DOCUMENTS[moduleId].includes(
              section.documentPath,
            ),
          )
          .map(section => [
            `${section.documentPath}#${section.sectionId}`,
            sectionBytes.get(`${section.documentPath}#${section.sectionId}`)!,
          ]),
      ),
    })
  return { gameplay: makeSource('gameplay'), balance: makeSource('balance'), documents }
}

const ZERO_USAGE = {
  input_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
}

function foundationReadyState(source: GameIrDomainSourceEnvelope) {
  const foundation = source.compileRequest.foundation
  if (foundation.authority.kind !== 'review') throw new Error('fixture requires review authority')
  const authority = foundation.authority
  const revision = foundation.foundationRevision
  const derivedRoot = `.beegame/audit/foundation/${revision}/derived`
  const reviewRoot = `.beegame/audit/foundation/${revision}/review/${authority.reviewDigest}`
  const factStoreDigest = sha256('balance-matrix-fact-store')
  const review = {
    reviewDigest: authority.reviewDigest,
    issueRegistryPath: `${reviewRoot}/issue-registry.json`,
    issueRegistryDigest: authority.issueRegistryDigest,
    manifestPath: `${reviewRoot}/manifest.json`,
    manifestDigest: sha256('balance-matrix-review-manifest'),
    markerPath: `${reviewRoot}/COMMITTED.json`,
    markerDigest: sha256('balance-matrix-review-marker'),
    sectionIndexDigest: foundation.sectionIndexDigest,
    factStoreDigest,
    semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest,
    issueSummary: { total: 0, blocker: 0, high: 0, medium: 0, low: 0 },
  }
  const semanticTasks = FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(check => ({
    taskId: `balance-matrix-semantic-${check.checkId}`,
    kind: 'semantic' as const,
    revision,
    checkId: check.checkId,
    packetDigest: sha256(`balance-matrix-packet:${check.checkId}`),
    modelTier: check.modelTier,
    status: 'completed' as const,
    attempt: 1,
    terminalDigest: sha256(`balance-matrix-terminal:${check.checkId}`),
    usage: ZERO_USAGE,
    durationMs: 0,
    dispatch: {
      dispatchId: `balance-matrix-dispatch-${check.checkId}`,
      workerType: 'foundation-semantic-reviewer' as const,
      phase: 'DOCUMENT_REVIEW' as const,
      taskId: `balance-matrix-semantic-${check.checkId}`,
      revision,
      status: 'completed' as const,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:00.000Z',
      terminalResult: {},
    },
    admittedResult: {
      checkId: check.checkId,
      packetIdentity: sha256(`balance-matrix-packet:${check.checkId}`),
      outcome: 'PASS' as const,
    },
  }))
  return {
    schemaVersion: 9,
    schemaFingerprint: 'foundation-audit-state-v9',
    status: 'audit_ready' as const,
    revision,
    documentDigests: foundation.documentDigests,
    sectionIndexDigest: foundation.sectionIndexDigest,
    sectionIndexPath: `.beegame/audit/foundation/${revision}/staging/section-index.json`,
    manifestPath: `.beegame/audit/foundation/${revision}/staging/manifest.json`,
    tasks: semanticTasks,
    phaseStartedAt: '2026-01-01T00:00:00.000Z',
    derived: {
      manifestPath: `${derivedRoot}/manifest.json`,
      manifestDigest: sha256('balance-matrix-derived-manifest'),
      markerPath: `${derivedRoot}/COMMITTED.json`,
      markerDigest: sha256('balance-matrix-derived-marker'),
      factStorePath: `${derivedRoot}/fact-store.json`,
      factStoreDigest,
      sectionIndexPath: `${derivedRoot}/section-index.json`,
      sectionIndexDigest: foundation.sectionIndexDigest,
    },
    deterministic: {
      reviewDigest: authority.reviewDigest,
      issueRegistryPath: `.beegame/audit/foundation/${revision}/staging/review/issue-registry.json`,
      issueRegistryDigest: authority.issueRegistryDigest,
      manifestPath: `.beegame/audit/foundation/${revision}/staging/review/manifest.json`,
      manifestDigest: sha256('balance-matrix-deterministic-manifest'),
      markerPath: `.beegame/audit/foundation/${revision}/staging/review/COMMITTED.json`,
      markerDigest: sha256('balance-matrix-deterministic-marker'),
      catalogVersion: 'balance-matrix-catalog',
      contractGraphDigest: sha256('balance-matrix-contract-graph'),
      sectionIndexDigest: foundation.sectionIndexDigest,
      factStoreDigest,
    },
    semantic: { aggregateUsage: ZERO_USAGE },
    review,
  }
}

function mechanical(source: GameIrDomainSourceEnvelope) {
  const body = {
    schemaVersion: 'game-ir-mechanical-projection-receipt.v1' as const,
    taskId: source.taskId,
    moduleId: source.moduleId,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    sourceDigest: source.sourceDigest,
    nodes: [],
    verifiedClaims: [],
    ownedTargets: [],
  }
  return admitGameIrMechanicalProjectionReceipt({
    source,
    receipt: { ...body, receiptDigest: digestGameIrValue(body) },
  })
}

function gameplayAuthority(source: GameIrDomainSourceEnvelope) {
  const mech = mechanical(source)
  const packet = buildGameplaySemanticPacket({ source, mechanical: mech })
  const state = node('state-start', 'gameplay.state', {
    label: 'Start',
    initial: true,
    terminal: 'none',
  })
  const section = source.sectionIndex.find(
    candidate => candidate.documentPath === 'docs/GDD.md',
  )!
  const excerpt = source.sectionBytes[
    `${section.documentPath}#${section.sectionId}`
  ]!
  const sourceClaims = [
    '/id',
    '/value/initial',
    '/value/label',
    '/value/terminal',
  ].map(pointer => ({
    subject: `node:${state.id}#${pointer}`,
    documentPath: section.documentPath,
    sectionId: section.sectionId,
    sourcePointer: `/bytes/0/${Buffer.byteLength(excerpt, 'utf8')}`,
    literal: excerpt,
  }))
  const semantic = admitGameplaySemanticResult(packet, {
    outcome: 'PROJECTED',
    nodes: [state],
    sourceClaims,
  })
  return { source, mechanical: mech, semantic }
}

function identity(source: GameIrDomainSourceEnvelope) {
  const foundation = source.compileRequest.foundation
  return {
    runId: 'balance-matrix-run',
    taskId: source.taskId,
    publicationId: source.compileRequest.publicationId,
    confirmedBriefDigest: foundation.confirmedBriefDigest,
    foundationRevision: foundation.foundationRevision,
    foundationReadyReceiptDigest: foundation.receiptDigest,
  }
}

type MockPlan = { stream?: string; processExit?: string }

function mockPort(log: {
  sessions: string[]
  prompts: Array<{ sessionId: string; prompt: string }>
  attempts: Array<{ sessionId: string; sliceId: string; prompt: string }>
}): { port: DeliveryWorkerPort; emit: (dispatchId: string, sliceId: string, plan: MockPlan) => void } {
  const events = new Map<string, Array<Record<string, unknown>>>()
  const dispatchSessions = new Map<string, string>()
  const sessions = {
    start(input: { workflowDispatchId?: string }) {
      const id = `balance-provider-session-${log.sessions.length + 1}`
      log.sessions.push(id)
      events.set(id, [])
      if (input.workflowDispatchId) dispatchSessions.set(input.workflowDispatchId, id)
      return { id }
    },
    updateAuthToken() {},
    async sendWithDisplay(sessionId: string, prompt: string) {
      log.prompts.push({ sessionId, prompt })
      const sliceId = prompt.match(/\| sliceId \| ([^|]+) \|/)?.[1]?.trim()
      if (sliceId) log.attempts.push({ sessionId, sliceId, prompt })
    },
    workflowRecordStreamEvents(sessionId: string) {
      return events.get(sessionId) ?? []
    },
    get(sessionId: string) {
      return { status: 'running', turnStatus: 'idle', createdAt: new Date(), id: sessionId }
    },
    async disposeWorkflowWorker() {},
  }
  const port = createBeeGameDeliveryWorkerPort({ sessions: sessions as never, userId: 'balance-matrix-user' })
  return {
    port,
    emit(dispatchId, sliceId, plan) {
      const sessionId = dispatchSessions.get(dispatchId)
      if (!sessionId) throw new Error(`unknown mock dispatch ${dispatchId}`)
      events.get(sessionId)!.push({
        id: 1,
        sessionId,
        type: plan.processExit ? 'turn.failed' : 'result',
        text: plan.processExit ?? '',
        createdAt: new Date(),
        ...(plan.processExit
          ? {}
          : { payload: { record_stream: plan.stream ?? '' } }),
      })
    },
  }
}

function recordStream(sliceId: string, records: readonly { fragmentId: string; node: Node }[], done = true): string {
  const lines = records.map(record => JSON.stringify({ record: 'node', sliceId, ...record }))
  if (done) lines.push(JSON.stringify({ record: 'done', sliceId }))
  return `${lines.join('\n')}\n`
}

function firstFragment(source: GameIrDomainSourceEnvelope, sliceId: string): string {
  const selected = new Set(sourceSectionsForGameIrProjectionSlice(sliceId).map(section => `${section.documentPath}#${section.sectionId}`))
  const fragment = buildGameIrEvidenceFragmentCatalog({ sectionIndex: source.sectionIndex, sectionBytes: source.sectionBytes }).fragments.find(item => selected.has(`${item.documentPath}#${item.sectionId}`))
  if (!fragment) throw new Error(`no authority fragment for ${sliceId}`)
  return fragment.fragmentId
}

function recordsFor(source: GameIrDomainSourceEnvelope, sliceId: string, nodes: readonly Node[]) {
  const fragmentId = firstFragment(source, sliceId)
  return nodes.map(nodeValue => ({ fragmentId, node: nodeValue }))
}

function failedProjectionTerminal(
  request: WorkerDispatchRequest,
  reason: string,
) {
  return {
    workerType: 'game-ir-compiler' as const,
    operation: 'projection' as const,
    status: 'failed' as const,
    sliceId: request.contract.currentSlice,
    records: [],
    done: false,
    reason,
    runId: request.runId,
    dispatchId: request.dispatchId,
    taskId: request.taskId,
    revision: request.revision,
    compileRequestDigest: request.contract.compileRequestDigest,
    foundationReadyReceiptDigest: request.contract.foundationReadyReceiptDigest,
  }
}

type Harness = {
  root: string
  source: ReturnType<typeof sourceFixture>
  packet: BalanceProjectionOperationPacket
  journal: GameIrProjectionSliceJournal
  journalInput: GameIrProjectionSliceJournalInput
  controller: ReturnType<typeof createDeliveryWorkflowController>
  transportPort: DeliveryWorkerPort
  emit: (dispatchId: string, sliceId: string, plan: MockPlan) => void
  log: { sessions: string[]; prompts: Array<{ sessionId: string; prompt: string }>; attempts: Array<{ sessionId: string; sliceId: string; prompt: string }> }
  dispatchCount: number
  journalClosed: boolean
}

async function harness(obligationNodes: readonly Node[]): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'balance-matrix-'))
  const source = sourceFixture()
  const foundation = source.balance.compileRequest.foundation
  await Promise.all(
    [...source.documents.entries()].map(async ([path, bytes]) => {
      await mkdir(join(root, path, '..'), { recursive: true })
      await writeFile(join(root, path), bytes)
    }),
  )
  await mkdir(join(root, foundation.sectionIndexPath, '..'), { recursive: true })
  await writeFile(
    join(root, foundation.sectionIndexPath),
    `${JSON.stringify({
      revision: foundation.foundationRevision,
      documentDigests: Object.entries(foundation.documentDigests).map(([path, digest]) => ({ path, digest })),
      sections: source.balance.authoritySectionIndex,
      digest: foundation.sectionIndexDigest,
    })}\n`,
  )
  const gameplay = gameplayAuthority(source.gameplay)
  const inventory = buildGameIrSemanticObligationInventory({
    moduleId: gameplay.source.moduleId,
    source: gameplay.source,
    records: [],
  })
  const preflightAuthority = buildGameIrSemanticObligationValidationAuthority({
    source: gameplay.source,
    inventory,
  })
  const preflightResult = admitGameIrSemanticObligationValidationResult({
    authority: preflightAuthority,
    result: {
      outcome: 'PASS',
      moduleId: gameplay.source.moduleId,
      coverage: preflightAuthority.sourceFragments.map(fragment => fragment.fragmentId),
    },
  })
  if (preflightResult.outcome !== 'PASS') throw new Error('stateless fixture preflight did not pass')
  const balanceMechanical = mechanical(source.balance)
  const packet = buildBalanceProjectionOperationPacket({
    source: source.balance,
    mechanical: balanceMechanical,
    gameplay,
  })
  const journalInput: GameIrProjectionSliceJournalInput = {
    journalPath: gameIrProjectionSliceJournalPath({
      workspacePath: root,
      identity: identity(source.balance),
      operationStep: 'phase4/balance/projection',
    }),
    identity: identity(source.balance),
    operationStep: 'phase4/balance/projection',
    packet,
    slicePlan: deriveProjectionSlicePlan('balance'),
  }
  const log = { sessions: [], prompts: [], attempts: [] }
  const transport = mockPort(log)
  const controllerPort = { ...transport.port, waitForTerminal: undefined }
  const controller = createDeliveryWorkflowController({
    workspacePath: root,
    ownerId: 'balance-matrix-owner',
    workerPort: controllerPort,
  })
  const baseRun = createTestDeliveryRun({
    runId: 'balance-matrix-run',
    projectId: 'balance-matrix-project',
    ownerId: 'balance-matrix-owner',
    confirmedBriefContext: 'balance matrix controller fixture',
  })
  const initial = {
    ...baseRun,
    confirmedBriefDigest: foundation.confirmedBriefDigest,
    phase: 'GAME_IR_COMPILATION' as const,
    status: 'running' as const,
    revision: { ...baseRun.revision, document: foundation.foundationRevision },
    foundationAuditState: foundationReadyState(source.balance) as never,
    gameIrState: { status: 'compiling' as const, identity: identity(source.balance) },
  } as DeliveryRun
  await controller.store.save(initial)
  const gameplayCheckpoint = await writeGameIrStageCheckpoint({
    workspacePath: root,
    deliveryRun: initial,
    step: {
      phase: 'phase4',
      domain: 'gameplay',
      operation: 'projection',
      records: [
        { kind: 'phase4/gameplay/source', record: gameplay.source },
        { kind: 'phase4/gameplay/mechanical', record: gameplay.mechanical },
        { kind: 'phase4/gameplay/semantic', record: gameplay.semantic },
      ],
      obligationPreflight: {
        inventory,
        validationReceipt: preflightResult.receipt,
      },
    },
  })
  await controller.store.save({
    ...initial,
    gameIrState: { ...initial.gameIrState!, latestCheckpoint: gameplayCheckpoint } as never,
  })
  const journal = await createGameIrProjectionSliceJournal(journalInput)
  const balancePlan = deriveProjectionSlicePlan('balance')
  const balanceInventory = buildGameIrSemanticObligationInventory({
    moduleId: 'balance',
    source: source.balance,
    records: obligationNodes
      .map(nodeValue => {
        const owner = balancePlan.slices.find(slice =>
          slice.nodeKinds.includes(nodeValue.kind),
        )
        if (!owner)
          throw new Error(`no Balance slice owns ${nodeValue.kind}`)
        return {
          record: 'obligation' as const,
          moduleId: 'balance' as const,
          targetId: nodeValue.id,
          targetKind: nodeValue.kind,
          fragmentId: firstFragment(source.balance, owner.sliceId),
        }
      })
      .sort((left, right) =>
        left.targetId < right.targetId
          ? -1
          : left.targetId > right.targetId
            ? 1
            : 0,
      ),
  })
  const balanceValidationAuthority = buildGameIrSemanticObligationValidationAuthority({ source: source.balance, inventory: balanceInventory })
  const balancePass = admitGameIrSemanticObligationValidationResult({
    authority: balanceValidationAuthority,
    result: { outcome: 'PASS', moduleId: 'balance', coverage: balanceValidationAuthority.sourceFragments.map(fragment => fragment.fragmentId) },
  })
  if (balancePass.outcome !== 'PASS') throw new Error('balance fixture preflight did not pass')
  await journal.admitObligationInventory(balanceInventory)
  await journal.admitObligationValidationReceipt(balancePass.receipt)
  return { root, source, packet, journal, journalInput, controller, transportPort: transport.port, emit: transport.emit, log, dispatchCount: 0, journalClosed: false }
}

function requestFor(
  h: Harness,
  sliceId: string,
  context: unknown,
  dispatchId: string,
): WorkerDispatchRequest {
  return {
    dispatchId,
    runId: h.journal.identity.runId,
    ownerId: 'balance-matrix-owner',
    projectId: 'balance-matrix-project',
    workspacePath: h.root,
    workerType: 'game-ir-compiler',
    phase: 'GAME_IR_COMPILATION',
    taskId: h.journal.identity.taskId,
    revision: h.journal.identity.foundationRevision,
    allowedPaths: [],
    projectReadScope: 'empty',
    contract: {
      kind: 'projection',
      packet: h.packet,
      compileRequestDigest: digestGameIrValue(h.source.balance.compileRequest),
      foundationReadyReceiptDigest: h.journal.identity.foundationReadyReceiptDigest,
      currentSlice: sliceId,
      progress: h.journal.entries.map(entry => ({ sliceId: entry.sliceId, entryDigest: entry.entryDigest })),
      sliceContext: context,
      obligationInventory: h.journal.obligationInventory,
    },
  } as unknown as WorkerDispatchRequest
}

async function providerTurn(
  h: Harness,
  sliceId: string,
  plan: MockPlan,
  context = h.journal.nextSliceContext,
  freshSession = false,
): Promise<Record<string, unknown>> {
  const dispatchId = `balance-dispatch-${++h.dispatchCount}`
  const request = requestFor(h, sliceId, context, dispatchId)
  let current = await h.controller.store.load()
  let active = current?.activeDispatch
  const activeSlice = active?.request?.contract.currentSlice
  if (freshSession && active && active.status === 'running' && activeSlice === sliceId) {
    await h.controller.store.save({ ...current!, activeDispatch: undefined })
    current = await h.controller.store.load()
    active = current?.activeDispatch
  }
  const dispatch = active && active.status === 'running' && activeSlice === sliceId
    ? active
    : await h.controller.dispatcher.dispatch(request)
  h.emit(dispatch.dispatchId, sliceId, plan)
  let terminal: Record<string, unknown>
  try {
    terminal = (await h.transportPort.waitForTerminal!(dispatch.dispatchId)) as Record<string, unknown>
  } catch (error) {
    if (!plan.processExit) throw error
    terminal = failedProjectionTerminal(
      request,
      error instanceof Error ? error.message : plan.processExit,
    )
  }
  await h.controller.dispatcher.completeDispatch(dispatch.dispatchId, terminal)
  try {
    h.journal = await loadGameIrProjectionSliceJournal(h.journalInput)
    h.journalClosed = false
  } catch {
    // The controller removes staging only after a loader-verified checkpoint.
    h.journalClosed = true
  }
  return terminal
}

function assertFreshSelectedAuthority(
  h: Harness,
  sliceId: string,
  previousAttempt: { sessionId: string; sliceId: string; prompt: string },
) {
  expect(previousAttempt.sliceId).toBe(sliceId)
  expect(h.log.sessions).toContain(previousAttempt.sessionId)
  expect(new Set(h.log.sessions).size).toBe(h.log.sessions.length)
  const attempt = h.log.attempts
    .filter(item => item.sliceId === sliceId)
    .at(-1)
  expect(attempt).toBeDefined()
  expect(attempt!.sessionId).not.toBe(previousAttempt.sessionId)
  expect(h.log.sessions.indexOf(attempt!.sessionId)).toBeGreaterThan(
    h.log.sessions.indexOf(previousAttempt.sessionId),
  )
  const prompt = attempt!.prompt
  expect(prompt).toContain('## Current slice')
  expect(prompt).toContain(sliceId)
  const selectedMarkers = [...prompt.matchAll(/BALANCE_MATRIX_AUTHORITY:([^\n]+)/g)].map(match => match[1]!.trim())
  expect(selectedMarkers.length).toBeGreaterThan(0)
  for (const marker of selectedMarkers)
    expect(h.source.balance.sectionBytes[marker]).toBe(`BALANCE_MATRIX_AUTHORITY:${marker}`)
  for (const [key, bytes] of Object.entries(h.source.balance.sectionBytes))
    if (!selectedMarkers.includes(key)) expect(prompt).not.toContain(bytes)
  expect(prompt).not.toContain('game-ir-balance-projection-operation-packet.v1')
}

async function complete(h: Harness, sliceId: string, nodes: readonly Node[]) {
  const records = recordsFor(h.source.balance, sliceId, nodes)
  const terminal = await providerTurn(h, sliceId, {
    stream: recordStream(sliceId, records),
  })
  expect(terminal.status).toBe('completed')
  return records
}

async function finishEmptySlices(h: Harness) {
  while (!h.journalClosed && h.journal.nextSlice) {
    if (
      h.journal.nextSlice.sliceId === 'balance.slice.0' &&
      h.log.attempts.filter(item => item.sliceId === 'balance.slice.0').length > 1
    )
      return
    await complete(h, h.journal.nextSlice.sliceId, [])
  }
}

async function finalManifest(h: Harness) {
  const durableRun = await h.controller.store.load()
  if (!durableRun) throw new Error('controller run is not durable')
  const checkpoint = await new GameIrStageCheckpointLoader().load({
    workspacePath: h.root,
    deliveryRun: durableRun,
  })
  if (checkpoint.step !== 'phase4/balance/projection')
    throw new Error(`Balance checkpoint is not durable: ${checkpoint.step}`)
  const records = checkpoint.records
  const gameplay = {
    source: records.get('phase4/gameplay/source') as ReturnType<typeof gameplayAuthority>['source'],
    mechanical: records.get('phase4/gameplay/mechanical') as ReturnType<typeof gameplayAuthority>['mechanical'],
    semantic: records.get('phase4/gameplay/semantic') as ReturnType<typeof gameplayAuthority>['semantic'],
  }
  const balance = {
    source: records.get('phase4/balance/source') as GameIrDomainSourceEnvelope,
    mechanical: records.get('phase4/balance/mechanical') as ReturnType<typeof mechanical>,
    semantic: records.get('phase4/balance/semantic') as BalanceSemanticReceipt,
  }
  if (Object.values(gameplay).some(value => value === undefined) || Object.values(balance).some(value => value === undefined))
    throw new Error('Balance checkpoint is missing an admitted assembly record')
  const operationRecords = [...records.keys()].filter(kind => kind.startsWith('phase4/balance/'))
  const pair = assembleGameplayBalanceModules({
    gameplay,
    balance,
  })
  return {
    pair,
    operationManifest: {
      operation: balanceOperation.step,
      projectionDigest: pair.balance.projectionDigest,
      records: operationRecords,
    },
  }
}

async function assertUniqueBalanceManifest(h: Harness) {
  const first = await finalManifest(h)
  const second = await finalManifest(h)
  expect(first.operationManifest).toEqual(second.operationManifest)
  expect(first.pair.balance.projectionDigest).toBe(second.pair.balance.projectionDigest)
  expect(first.operationManifest.operation).toBe('phase4/balance/projection')
  expect(first.operationManifest.records).toEqual([
    'phase4/balance/source',
    'phase4/balance/mechanical',
    'phase4/balance/semantic',
  ])
  expect(new Set(first.operationManifest.records).size).toBe(first.operationManifest.records.length)
  return first
}

describe('stateless Balance projection fault matrix', () => {
  test('corrects unsorted unit dimensions in a fresh session and changes only that record', async () => {
    const h = await harness([unit()])
    try {
      const bad = unit([{ base: 'z', exponent: 1 }, { base: 'a', exponent: 1 }])
      const good = unit()
      const attemptsBefore = h.log.attempts.length
      const badRecords = recordsFor(h.source.balance, 'balance.slice.0', [bad])
      const terminal = await providerTurn(h, 'balance.slice.0', { stream: recordStream('balance.slice.0', badRecords) })
      expect(terminal.status).toBe('completed')
      const previousAttempt = h.log.attempts[attemptsBefore]!
      const goodRecords = recordsFor(h.source.balance, 'balance.slice.0', [good])
      const goodDigest = digestGameIrValue(goodRecords[0])
      const corrected = await providerTurn(h, 'balance.slice.0', {
        stream: recordStream('balance.slice.0', goodRecords),
      })
      expect(corrected.status).toBe('completed')
      expect(digestGameIrValue(goodRecords[0])).toBe(goodDigest)
      expect(h.journal.entries[0]!.entryDigest).toBeString()
      await finishEmptySlices(h)
      assertFreshSelectedAuthority(h, 'balance.slice.0', previousAttempt)
      expect(h.journal.entries[0]!.semantic.nodes[0]!.value).toEqual(good.value)
      expect(await assertUniqueBalanceManifest(h)).toBeDefined()
    } finally { await rm(h.root, { recursive: true, force: true }) }
  })

  test('corrects a formula AST/reference mismatch without rewriting the admitted unit record', async () => {
    const h = await harness([
      unit(),
      formula({ kind: 'literal', value: 1, unitReferenceIndex: 0 }),
    ])
    try {
      await complete(h, 'balance.slice.0', [unit()])
      const bad = formula({ kind: 'reference', referenceIndex: 1 })
      const previousAttempt = h.log.attempts.filter(item => item.sliceId === 'balance.slice.1').at(-1)!
      await complete(h, 'balance.slice.1', [bad])
      const diagnosticState = (await h.controller.store.load())?.gameIrState
      expect(diagnosticState?.status === 'compiling' ? diagnosticState.diagnostic?.actual : '').toMatch(/reference index|formula/i)
      const unitDigest = h.journal.entries[0]!.entryDigest
      const good = formula({ kind: 'literal', value: 1, unitReferenceIndex: 0 })
      await complete(h, 'balance.slice.1', [good])
      await finishEmptySlices(h)
      assertFreshSelectedAuthority(h, 'balance.slice.1', previousAttempt)
      expect(h.journal.entries[0]!.entryDigest).toBe(unitDigest)
      expect((await assertUniqueBalanceManifest(h)).operationManifest.records).toHaveLength(3)
    } finally { await rm(h.root, { recursive: true, force: true }) }
  })

  test('keeps two valid records after a malformed third record and admits one final manifest', async () => {
    const h = await harness([unit(), variable()])
    try {
      const valid = recordsFor(h.source.balance, 'balance.slice.0', [unit(), variable()])
      const malformed = recordsFor(h.source.balance, 'balance.slice.0', [
        { id: 'balance-z-node', kind: 'balance.formula', value: {}, references: [], edges: [] },
      ])[0]!
      const attemptsBefore = h.log.attempts.length
      const terminal = await providerTurn(h, 'balance.slice.0', { stream: recordStream('balance.slice.0', [...valid, malformed]) })
      expect(terminal.status).toBe('completed')
      const previousAttempt = h.log.attempts[attemptsBefore]!
      const digests = valid.map(record => digestGameIrValue(record))
      expect(h.journal.currentSliceRecordPrefix).toEqual(valid.map(record => ({ id: record.node.id, kind: record.node.kind })))
      const retry = await providerTurn(h, 'balance.slice.0', { stream: recordStream('balance.slice.0', valid) }, h.journal.nextSliceContext)
      expect(retry.status).toBe('completed')
      await finishEmptySlices(h)
      assertFreshSelectedAuthority(h, 'balance.slice.0', previousAttempt)
      expect(h.journal.entries[0]!.semantic.nodes).toHaveLength(2)
      expect(h.journal.entries[0]!.entryDigest).toBeString()
      expect(digests).toHaveLength(2)
      expect((await assertUniqueBalanceManifest(h)).pair.balance.module.nodes).toHaveLength(2)
    } finally { await rm(h.root, { recursive: true, force: true }) }
  })

  test('does not promote a provider process exit with no complete response, then succeeds in a fresh session', async () => {
    const h = await harness([unit()])
    try {
      const attemptsBefore = h.log.attempts.length
      const failed = await providerTurn(h, 'balance.slice.0', { processExit: 'provider exited before complete response' })
      expect(failed.status).toBe('failed')
      expect(h.journal.entries).toHaveLength(0)
      const previousAttempt = h.log.attempts[attemptsBefore]!
      await complete(h, 'balance.slice.0', [unit()])
      await finishEmptySlices(h)
      assertFreshSelectedAuthority(h, 'balance.slice.0', previousAttempt)
      expect((await assertUniqueBalanceManifest(h)).pair.balance.projectionDigest).toBeString()
    } finally { await rm(h.root, { recursive: true, force: true }) }
  })

  test('replays an admitted record prefix through a fresh session without changing its digest', async () => {
    const h = await harness([unit()])
    try {
      const records = recordsFor(h.source.balance, 'balance.slice.0', [unit()])
      const attemptsBefore = h.log.attempts.length
      const firstTerminal = await providerTurn(h, 'balance.slice.0', { stream: recordStream('balance.slice.0', records, false) })
      expect(firstTerminal.status).toBe('failed')
      const digest = h.journal.currentSliceRecordDigests[0]
      const previousAttempt = h.log.attempts[attemptsBefore]!
      const terminal = await providerTurn(h, 'balance.slice.0', { stream: recordStream('balance.slice.0', records) }, h.journal.nextSliceContext, true)
      expect(terminal.status).toBe('completed')
      expect(digestGameIrValue(records[0])).toBe(digest)
      await finishEmptySlices(h)
      assertFreshSelectedAuthority(h, 'balance.slice.0', previousAttempt)
      expect((await assertUniqueBalanceManifest(h)).pair.balance.projectionDigest).toBeString()
    } finally { await rm(h.root, { recursive: true, force: true }) }
  })

  test('recovers a pending formula record after a crash with a new authority session', async () => {
    const h = await harness([
      unit(),
      formula({ kind: 'literal', value: 1, unitReferenceIndex: 0 }),
    ])
    try {
      await complete(h, 'balance.slice.0', [unit()])
      const records = recordsFor(h.source.balance, 'balance.slice.1', [formula({ kind: 'literal', value: 1, unitReferenceIndex: 0 })])
      const attemptsBefore = h.log.attempts.length
      const firstTerminal = await providerTurn(h, 'balance.slice.1', { stream: recordStream('balance.slice.1', records, false) })
      expect(firstTerminal.status).toBe('failed')
      const pendingDigest = h.journal.currentSliceRecordDigests[0]
      const previousAttempt = h.log.attempts[attemptsBefore]!
      const durable = await h.controller.store.load()
      expect(durable).toBeDefined()
      await h.controller.store.save({ ...durable!, activeDispatch: undefined })
      h.controller = createDeliveryWorkflowController({
        workspacePath: h.root,
        ownerId: 'balance-matrix-owner',
        workerPort: { ...h.transportPort, waitForTerminal: undefined },
      })
      h.journal = await loadGameIrProjectionSliceJournal(h.journalInput)
      const terminal = await providerTurn(h, 'balance.slice.1', { stream: recordStream('balance.slice.1', records) }, h.journal.nextSliceContext)
      expect(terminal.status).toBe('completed')
      expect(digestGameIrValue(records[0])).toBe(pendingDigest)
      await finishEmptySlices(h)
      assertFreshSelectedAuthority(h, 'balance.slice.1', previousAttempt)
      expect((await assertUniqueBalanceManifest(h)).operationManifest.records).toHaveLength(3)
    } finally { await rm(h.root, { recursive: true, force: true }) }
  })

  test('rejects a stale Foundation revision during retry before a second provider session can write', async () => {
    const h = await harness([unit()])
    try {
      const records = recordsFor(h.source.balance, 'balance.slice.0', [unit()])
      const first = await providerTurn(h, 'balance.slice.0', {
        stream: recordStream('balance.slice.0', records, false),
      })
      expect(first.status).toBe('failed')
      const previousAttempt = h.log.attempts.filter(item => item.sliceId === 'balance.slice.0').at(-1)!
      const pending = await loadGameIrProjectionSliceJournal(h.journalInput)
      expect(pending.currentSliceRecordDigests).toEqual([digestGameIrValue(records[0])])
      h.journal = pending
      const durable = await h.controller.store.load()
      expect(durable?.activeDispatch?.status).toBe('running')
      expect(durable?.activeDispatch?.request?.contract.currentSlice).toBe('balance.slice.0')
      const retryRequest = durable!.activeDispatch!.request!
      await h.controller.store.save({
        ...durable!,
        activeDispatch: {
          ...durable!.activeDispatch!,
          revision: 'stale-foundation',
          request: {
            ...retryRequest,
            revision: 'stale-foundation',
          },
        },
      })
      h.controller = createDeliveryWorkflowController({
        workspacePath: h.root,
        ownerId: 'balance-matrix-owner',
        workerPort: { ...h.transportPort, waitForTerminal: undefined },
      })
      const recovered = await h.controller.store.load()
      const before = h.log.sessions.length
      await expect(h.controller.resume(recovered!)).rejects.toThrow(/another delivery worker|detached|identity|revision/i)
      expect(h.log.sessions.length).toBe(before)
      expect((await h.controller.store.load())?.activeDispatch?.revision).toBe('stale-foundation')
      await h.controller.store.save({ ...(await h.controller.store.load())!, activeDispatch: undefined })
      h.journal = await loadGameIrProjectionSliceJournal(h.journalInput)
      expect(h.journal.currentSliceRecordDigests).toEqual([digestGameIrValue(records[0])])
      const retry = await providerTurn(h, 'balance.slice.0', {
        stream: recordStream('balance.slice.0', records),
      }, h.journal.nextSliceContext, true)
      expect(retry.status).toBe('completed')
      await finishEmptySlices(h)
      assertFreshSelectedAuthority(h, 'balance.slice.0', previousAttempt)
      await assertUniqueBalanceManifest(h)
    } finally { await rm(h.root, { recursive: true, force: true }) }
  })

  test('assembles Balance from all four slices into one deterministic operation manifest', async () => {
    const h = await harness([
      unit(),
      variable(),
      formula({ kind: 'literal', value: 1, unitReferenceIndex: 0 }),
    ])
    try {
      await complete(h, 'balance.slice.0', [unit(), variable()])
      await complete(h, 'balance.slice.1', [formula({ kind: 'literal', value: 1, unitReferenceIndex: 0 })])
      await complete(h, 'balance.slice.2', [])
      await complete(h, 'balance.slice.3', [])
      const first = await finalManifest(h)
      const second = await finalManifest(h)
      const checkpoint = await new GameIrStageCheckpointLoader().load({ workspacePath: h.root, deliveryRun: (await h.controller.store.load())! })
      expect(checkpoint.step).toBe('phase4/balance/projection')
      expect(first.operationManifest).toEqual(second.operationManifest)
      expect(first.pair.balance.projectionDigest).toBe(second.pair.balance.projectionDigest)
      expect(first.operationManifest.records).toEqual([
        'phase4/balance/source',
        'phase4/balance/mechanical',
        'phase4/balance/semantic',
      ])
      expect(new Set(h.log.attempts.filter(item => item.sliceId.startsWith('balance.slice')).map(item => item.sessionId)).size).toBe(4)
      await assertUniqueBalanceManifest(h)
    } finally { await rm(h.root, { recursive: true, force: true }) }
  })
})
