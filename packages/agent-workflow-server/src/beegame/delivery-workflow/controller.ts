import {
  applyAtomicTaskPlan,
  AtomicTaskPlanError,
  readAtomicTaskPlanningDocuments,
  validateAtomicTaskGraph,
  type AtomicTaskContractFacts,
} from './atomic-task-planner'
import { auditAssetContract } from '../asset-contract-audit'
import { createDeliveryDispatcher, DispatchError } from './dispatch'
import { projectTaskTerminalEvidence } from './task-terminal-evidence'
import {
  buildChangeImpactDispatch,
  buildQuestionAnswerDispatch,
  createChangeRequest,
} from './change-request'
import {
  completeDocumentDraft,
  startChecklistDraftStage,
  startDocumentStage,
} from './document-stage'
import { canStartFoundationAudit } from './foundation-audit-boundary'
import {
  activeFoundationRevisionBundle,
  activeFoundationRevisionTasks,
  createFoundationAuditState,
  foundationRuntimeTasks,
  isFoundationRevisionPhase,
} from './foundation-audit-state'
import { deriveFoundationAuditArtifacts } from './foundation-audit-artifacts'
import {
  completeResourceTask,
  reconcileCurrentResourcePreparation,
  startResourcePreparation,
} from './resource-stage'
import {
  completeImplementationTask,
  implementationCompletionIssue,
  startNextImplementationTask,
} from './implementation-stage'
import {
  computeDocumentRevision,
  computeResourceRevision,
  computeWorkspaceRevision,
} from './revision'
import { createRunStore, type RunStore } from './run-store'
import { deriveAcceptedWorkflowUnits } from './accepted-unit-journal'
import { transitionDeliveryRun } from './transition'
import {
  enterImplementationAudit,
  reconcileAcceptance,
  reconcileImplementationAudit,
  startAcceptance,
  startImplementationAudit,
} from './validation-stage'
import { readAcceptanceChecklistIds } from '../document-readiness-audit'
import {
  CANONICAL_DOCUMENT_ARTIFACTS,
  CANONICAL_FOUNDATION_DOCUMENTS,
} from './types'
import {
  auditResourceDeliveryReadiness,
  confirmedResourceLibraryUsage,
  type ResourceDeliveryReadiness,
} from '../resource-delivery-readiness'
import type {
  DeliveryWorkerPort,
  DeliveryRun,
  DispatchRecord,
  WorkerDispatchRequest,
} from './types'
import {
  parseWorkerTerminalResult,
  buildFoundationFactStructuredOutputJsonSchema,
  type WorkerTerminalResult,
} from './worker-contracts'
import { recordFoundationFailure } from './foundation-authoring-batch'
import { readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  extractNormalizedFoundationFacts,
  buildFoundationFactPackets,
  mergeFoundationFactResults,
  validateFoundationFactResults,
  type FoundationFactPacket,
  type FoundationFactReceipt,
} from './foundation-fact-extraction'
import {
  admitFoundationFactTerminal,
  digestFoundationFactTerminal,
  foundationFactTasksComplete,
  type FoundationFactTaskCollection,
} from './foundation-fact-runtime'
import {
  loadFoundationAuditArtifacts,
  loadFoundationFactReceipt,
  publishFoundationDerivedArtifacts,
  writeFoundationFactPacket,
  writeFoundationFactReceipt,
  publishDeterministicFoundationReview,
  loadCommittedFoundationDerivedArtifacts,
  loadDeterministicFoundationReview,
  publishFoundationSemanticReview,
  loadFoundationSemanticReview,
} from './foundation-audit-artifacts'
import {
  createFoundationFactStore,
  digestFactStore,
  type FoundationFact,
} from './foundation-fact-store'
import { summarizeFoundationIssues } from './foundation-audit-state'
import {
  FOUNDATION_AUDIT_PRODUCTION_MANIFEST,
  runProductionDeterministicFoundationAudit,
  runProductionDeterministicFoundationImpactAudit,
} from './foundation-audit-production-manifest'
import {
  FOUNDATION_SEMANTIC_AUDIT_MANIFEST,
  buildFoundationSemanticPacket,
  admitFoundationSemanticResult,
  digestFoundationSemanticResult,
  semanticResultToFoundationIssueDrafts,
  type FoundationSemanticPacket,
  type FoundationSemanticResult,
} from './foundation-semantic-audit'
import {
  FOUNDATION_SEMANTIC_MAX_RUNNING,
  appendFoundationConfirmationTask,
  admitFoundationSemanticTerminal,
  claimFoundationSemanticTasks,
  createFoundationSemanticTaskCollection,
  foundationSemanticTasksComplete,
  type FoundationSemanticTaskCollection,
} from './foundation-semantic-runtime'
import { compileFoundationIssueRegistry } from './foundation-audit-check-definitions'
import {
  foundationSemanticRecheckStructuredOutputJsonSchema,
  foundationSemanticReviewerStructuredOutputJsonSchema,
} from './worker-contracts'
import { buildFoundationRevisionBatches } from './foundation-revision-batches'
import { evaluateFoundationRevisionRoundPolicy } from './foundation-revision-round-policy'
import { analyzeFoundationImpact } from './foundation-impact-analysis'
import { buildFoundationSectionIndex } from './foundation-section-index'
import {
  admitFoundationSemanticRecheckResult,
  buildFoundationSemanticRecheckPacket,
  digestFoundationSemanticRecheckResult,
  FoundationSemanticAdmissionError,
  rebuildFoundationImpactedFacts,
  validateFoundationPatch,
} from './foundation-patch-validation'
import type { FoundationSemanticRecheckPacket } from './foundation-patch-validation'
import {
  buildFoundationRevisionAuthority,
  createFoundationRevisionStage,
  writeFoundationRevisionPacket,
  loadFoundationRevisionPacket,
  writeFoundationRevisionFactPacket,
  loadFoundationRevisionFactPacket,
  writeFoundationRevisionSemanticPacket,
  loadFoundationRevisionSemanticPacket,
  writeFoundationRevisionSemanticResult,
  loadFoundationRevisionSemanticResult,
  deriveFoundationPatchOperations,
  type PatchOperation,
} from './foundation-revision-stage'
import {
  loadCommittedFoundationRevisionAuthority,
  publishFoundationRevision,
  recoverFoundationRevision,
} from './foundation-revision-publication'
import { foundationRevisionTasksComplete } from './foundation-revision-stage'
import type {
  FoundationAuditState,
  FoundationDocumentPath,
  FoundationRevisionDocumentTask,
  FoundationRevisionImpactedFactsTask,
  FoundationRevisionSemanticRecheckTask,
} from './types'
import type { AuditIssue } from './foundation-issue-registry'
import { projectFoundationReadyReceipt } from './game-ir/foundation-ready-adapter'
import { parseGameIrCompileRequest } from './game-ir/contracts'
import { digestGameIrValue } from './game-ir/model'
import { readCommittedGameIr } from './game-ir/committed-reader'
import {
  writeGameIrStageCheckpoint,
  type GameIrCheckpointLoad,
} from './game-ir/stage-checkpoint'
import {
  buildGameIrSourcePacket,
  buildStagedOperationPacket,
  nextGameIrOperation,
  stagedCompilerContract,
  stagedProjectionJournalCompletion,
  admitStagedValidationOperation,
  type GameIrStagedRecords,
} from './game-ir/staged-compiler'
import {
  createGameIrProjectionSliceJournal,
  gameIrProjectionSliceJournalPath,
  cleanupGameIrProjectionSliceJournalAfterCheckpoint,
} from './game-ir/projection-slice-journal'
import {
  deriveProjectionSlicePlan,
  type GameIrProjectionRetryDiagnostic,
} from './game-ir/projection-slices'
import { commitGameIrPublication } from './game-ir/publication'
import { GameIrStageCheckpointLoader } from './game-ir/stage-checkpoint'

function sameDocumentDigests(
  left: readonly { path: string; digest: string }[],
  right: readonly { path: string; digest: string }[],
): boolean {
  return (
    JSON.stringify([...left].sort((a, b) => a.path.localeCompare(b.path))) ===
    JSON.stringify([...right].sort((a, b) => a.path.localeCompare(b.path)))
  )
}

export function gameIrCompilerAdmissionProgressIdentity(input: {
  inputDigest: string
  checkpointJournalDigest: string
  operation: string
  candidate: unknown
  reason?: string
  /** Transport identity is deliberately excluded from durable progress. */
  dispatchId?: string
}): {
  inputDigest: string
  diagnosticDigest: string
  candidateDigest: string
  checkpointJournalDigest: string
  terminalDigest: string
} {
  const diagnostic = digestGameIrValue({
    operation: input.operation,
    status: 'admission_failed',
    ...(input.reason !== undefined
      ? { reason: normalizeGameIrDiagnosticReason(input.reason) }
      : {}),
  })
  const candidateDigest = digestGameIrValue(input.candidate)
  return {
    inputDigest: input.inputDigest,
    diagnosticDigest: diagnostic,
    candidateDigest,
    checkpointJournalDigest: input.checkpointJournalDigest,
    terminalDigest: candidateDigest,
  }
}

export function normalizeGameIrDiagnosticReason(reason: string): string {
  const normalized = reason.normalize('NFC').replace(/\r\n?/g, '\n').trim()
  const schemaPrefix = 'Output does not match required schema: '
  const prefix = normalized.startsWith(schemaPrefix) ? schemaPrefix : ''
  const body = prefix ? normalized.slice(prefix.length) : normalized
  const clauses = body
    .split(/, (?=(?:\/|root:))/u)
    .filter(clause => !clause.includes('characters truncated'))
  return (
    prefix +
    [
      ...new Set(
        clauses.map(clause => clause.replace(/\/\d+(?=\/|:|$)/gu, '/*')),
      ),
    ].join(', ')
  )
}

const RETRY_DIAGNOSTIC_PREFIX = 'game-ir-retry-diagnostic:'

function retryDiagnosticActual(
  reason: string,
  diagnostic: GameIrProjectionRetryDiagnostic,
): string {
  return `${reason}\n${RETRY_DIAGNOSTIC_PREFIX}${JSON.stringify(diagnostic)}`
}

function retryDiagnosticFromActual(
  actual: string | undefined,
): GameIrProjectionRetryDiagnostic | undefined {
  if (!actual) return undefined
  const encoded = actual
    .split('\n')
    .find(line => line.startsWith(RETRY_DIAGNOSTIC_PREFIX))
  if (!encoded) return undefined
  try {
    const value = JSON.parse(encoded.slice(RETRY_DIAGNOSTIC_PREFIX.length))
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return undefined
    if (
      value.scope === 'slice' &&
      typeof value.sliceId === 'string' &&
      typeof value.reason === 'string'
    )
      return value as GameIrProjectionRetryDiagnostic
    if (
      value.scope === 'record' &&
      typeof value.sliceId === 'string' &&
      typeof value.recordId === 'string' &&
      typeof value.fragmentId === 'string' &&
      typeof value.reason === 'string'
    )
      return value as GameIrProjectionRetryDiagnostic
  } catch {
    return undefined
  }
  return undefined
}

function markRevisionCommitTransient(error: unknown): never {
  if (error && typeof error === 'object')
    Object.assign(error, { foundationRevisionCommitTransient: true })
  throw error
}

function isRevisionCommitTransient(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      (error as { foundationRevisionCommitTransient?: boolean })
        .foundationRevisionCommitTransient,
  )
}

function revisionBundleDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

class FoundationFactAttemptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FoundationFactAttemptError'
  }
}

async function deriveFoundationAudit(
  run: DeliveryRun,
  workspacePath: string,
): Promise<DeliveryRun> {
  if (
    run.foundationAuditState &&
    run.foundationAuditState.status !== 'index_staged'
  )
    return run
  const checkpoints =
    run.foundationDraftState.documents ??
    CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
      path,
      status: run.foundationDraftState.completedPaths.includes(path)
        ? ('committed' as const)
        : ('pending' as const),
    }))
  try {
    const artifacts = await deriveFoundationAuditArtifacts({
      workspacePath,
      revision: run.revision.document,
      checkpoints,
    })
    const documents = new Map(
      await Promise.all(
        CANONICAL_FOUNDATION_DOCUMENTS.map(
          async path =>
            [path, await readFile(join(workspacePath, path), 'utf8')] as const,
        ),
      ),
    )
    const extraction = extractNormalizedFoundationFacts({
      documents,
      sectionIndex: artifacts.sectionIndex,
    })
    const packets = buildFoundationFactPackets({
      revision: artifacts.revision,
      documents,
      sectionIndex: artifacts.sectionIndex,
      unresolvedKeys: extraction.unresolvedKeys,
    })
    const phaseStartedAt = new Date().toISOString()
    const baseState = createFoundationAuditState({
      revision: artifacts.revision,
      documentDigests: artifacts.documentDigests,
      manifest: artifacts.manifest,
    })
    const tasks = packets.map((packet, index) => ({
      taskId: `${artifacts.revision}:fact:${index}:${packet.packetDigest.slice(0, 12)}`,
      kind: 'document-facts' as const,
      revision: artifacts.revision,
      packetDigest: packet.packetDigest,
      factKeyCount: packet.keys.length,
      modelTier: 'fast' as const,
      status: 'pending' as const,
      attempt: 0,
    }))
    for (const [index, packet] of packets.entries())
      await writeFoundationFactPacket({
        workspacePath,
        revision: artifacts.revision,
        taskId: tasks[index]!.taskId,
        packet,
      })
    let nextState: FoundationAuditState = {
      ...baseState,
      status: packets.length
        ? ('extracting_facts' as const)
        : ('facts_staged' as const),
      tasks,
      phaseStartedAt,
    }
    return {
      ...run,
      foundationAuditState: nextState,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'running',
      activeDispatch: undefined,
      blockedReason: undefined,
      thinking: 'idle',
    }
  } catch (error) {
    return {
      ...run,
      foundationAuditState: undefined,
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'needs_action',
      activeDispatch: undefined,
      blockedReason: `foundation audit derivation failed: ${error instanceof Error ? error.message : String(error)}`,
      thinking: 'idle',
    }
  }
}

function sectionBytes(
  documents: ReadonlyMap<string, string>,
  ref: { documentPath: string; startLine: number; endLine: number },
): string {
  const document = documents.get(ref.documentPath)
  if (document === undefined)
    throw new Error(`semantic section document is missing: ${ref.documentPath}`)
  return document
    .split('\n')
    .slice(ref.startLine - 1, ref.endLine)
    .join('\n')
}

async function buildSemanticPacketFor(input: {
  workspacePath: string
  revision: string
  checkId: string
  sectionIndex: readonly import('./foundation-section-index').SectionRef[]
  factStore: readonly import('./foundation-fact-store').FoundationFact[]
  deterministicReviewDigest: string
  deterministicIssuePrefix: readonly import('./foundation-issue-registry').AuditIssue[]
  documentDigests: readonly { path: string; digest: string }[]
}): Promise<FoundationSemanticPacket> {
  const documents = new Map(
    await Promise.all(
      CANONICAL_FOUNDATION_DOCUMENTS.map(
        async path =>
          [
            path,
            await readFile(join(input.workspacePath, path), 'utf8'),
          ] as const,
      ),
    ),
  )
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const expected = input.documentDigests.find(
      item => item.path === path,
    )?.digest
    const actual = createHash('sha256')
      .update(documents.get(path)!)
      .digest('hex')
    if (!expected || expected !== actual)
      throw new Error(`semantic audit source changed after commit: ${path}`)
  }
  const bytes = Object.fromEntries(
    input.sectionIndex.map(ref => [
      `${ref.documentPath}#${ref.sectionId}`,
      sectionBytes(documents, ref),
    ]),
  )
  return buildFoundationSemanticPacket({
    revision: input.revision,
    checkId: input.checkId,
    sectionIndex: input.sectionIndex,
    sectionBytes: bytes,
    factStore: input.factStore,
    deterministicReviewDigest: input.deterministicReviewDigest,
    deterministicIssuePrefix: input.deterministicIssuePrefix,
  })
}

export function createDeliveryWorkflowController(input: {
  workspacePath: string
  ownerId: string
  workerPort: DeliveryWorkerPort
  handoffRecoveryGraceMs?: number
}) {
  const store = createRunStore(input.workspacePath, input.ownerId)
  let dispatcher: ReturnType<typeof createDeliveryDispatcher>
  let controllerTail: Promise<void> = Promise.resolve()
  // A completed fact envelope may be durable before its serialized admission
  // callback starts. Recovery must not race that callback by replaying the
  // same envelope through the unlocked handler.
  const terminalAdmissionInFlight = new Set<string>()
  const handoffRecoveryGraceMs = input.handoffRecoveryGraceMs ?? 1_000

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = controllerTail
    const current = previous.catch(() => undefined).then(operation)
    controllerTail = current.then(
      () => undefined,
      () => undefined,
    )
    return current
  }

  dispatcher = createDeliveryDispatcher({
    store,
    workerPort: input.workerPort,
    onRetryable: async (runId, taskId) => {
      const current = await store.load()
      if (!current || current.runId !== runId || current.status !== 'running')
        return
      const task = current.foundationAuditState
        ? foundationRuntimeTasks(current.foundationAuditState).find(
            candidate => candidate.taskId === taskId,
          )
        : undefined
      if (task) {
        if (task.status !== 'retryable') return
        // A retry already has durable Foundation task authority. Do not
        // reconcile live sibling sessions while their terminal supervisors
        // are still active; a lagging status endpoint would duplicate them.
        void resume(current).catch(() => undefined)
        return
      }
      // A dispatch failure may be reconciled from inside handleTerminal's
      // serialization lane. Queue the next progress pass instead of awaiting
      // that same lane and deadlocking terminal reconciliation.
      void ensureProgress(current).catch(() => undefined)
    },
    onTerminal: async (record, result, request) =>
      handleTerminal(record, result, request),
  })

  async function persist(
    run: DeliveryRun,
    eventType: string,
    details: Record<string, unknown> = {},
  ): Promise<DeliveryRun> {
    const previous = await store.load()
    const acceptedUnits = previous
      ? deriveAcceptedWorkflowUnits(previous, run)
      : []
    const committed = await store.commit(
      run,
      {
        runId: run.runId,
        type: eventType,
        phase: run.phase,
        status: run.status,
        revision: run.revision,
        activeTaskId: run.activeTaskId,
        ...details,
      },
      acceptedUnits,
    )
    scheduleOrphanedHandoffRecovery(committed)
    return committed
  }

  function scheduleOrphanedHandoffRecovery(run: DeliveryRun): void {
    if (
      handoffRecoveryGraceMs < 0 ||
      run.status !== 'running' ||
      run.activeDispatch
    )
      return
    const handoffUpdatedAt = run.updatedAt
    const timer = setTimeout(() => {
      void serialize(async () => {
        const current = await store.load()
        if (
          !current ||
          current.status !== 'running' ||
          current.activeDispatch ||
          current.updatedAt !== handoffUpdatedAt
        )
          return
        await resumeUnlocked(current)
      }).catch(() => undefined)
    }, handoffRecoveryGraceMs)
    timer.unref()
  }

  async function contractFactsFor(run: DeliveryRun): Promise<
    AtomicTaskContractFacts & {
      resourceIds: string[]
      contentIds: string[]
      resourceReadiness: ResourceDeliveryReadiness
    }
  > {
    return plannerContractFacts(
      input.workspacePath,
      run.confirmedBriefContext,
      run.resourceProductionState.inventoryReceipt?.catalogObserved ?? false,
    )
  }

  async function failFoundationContinuation(
    run: DeliveryRun,
    error: unknown,
  ): Promise<void> {
    const reason = `foundation audit continuation failed: ${error instanceof Error ? error.message : String(error)}`
    const lease = await store.mutationLock(run.runId)
    try {
      const locked = await store.load(lease)
      if (!locked || locked.runId !== run.runId) return
      await store.commit(
        {
          ...locked,
          status: 'needs_action',
          blockedReason: reason,
          thinking: 'idle',
        },
        {
          runId: locked.runId,
          type: 'foundation.audit.continuation_failed',
          phase: locked.phase,
          status: 'needs_action',
          revision: locked.revision,
          reason,
        },
        undefined,
        lease,
      )
    } finally {
      await store.unlock(lease)
    }
  }

  async function handleTerminal(
    record: DispatchRecord,
    result: WorkerTerminalResult,
    request?: WorkerDispatchRequest,
  ): Promise<void> {
    terminalAdmissionInFlight.add(record.dispatchId)
    return serialize(() =>
      handleTerminalUnlocked(record, result, request),
    ).finally(() => {
      terminalAdmissionInFlight.delete(record.dispatchId)
    })
  }

  async function finalizeFoundationFacts(run: DeliveryRun): Promise<void> {
    const state = run.foundationAuditState
    if (!state || state.status !== 'facts_staged') return
    const artifacts = await loadFoundationAuditArtifacts({
      workspacePath: input.workspacePath,
      revision: state.revision,
      expectedState: state,
    })
    if (!artifacts)
      throw new Error(
        'foundation fact section index is unavailable during finalization',
      )
    const documents = new Map(
      await Promise.all(
        CANONICAL_FOUNDATION_DOCUMENTS.map(
          async path =>
            [
              path,
              await readFile(join(input.workspacePath, path), 'utf8'),
            ] as const,
        ),
      ),
    )
    const mechanical = extractNormalizedFoundationFacts({
      documents,
      sectionIndex: artifacts.sectionIndex,
    })
    const workerFacts: FoundationFact[] = []
    const workerReceipts: FoundationFactReceipt[] = []
    for (const task of foundationRuntimeTasks(state).filter(
      task => task.kind === 'document-facts',
    )) {
      if (!task.receiptPath || !task.receiptDigest || !task.terminalDigest)
        throw new Error('foundation fact task receipt binding is incomplete')
      const receipt = await loadFoundationFactReceipt({
        workspacePath: input.workspacePath,
        revision: state.revision,
        taskId: task.taskId,
        expectedPacketDigest: task.packetDigest,
        expectedTerminalDigest: task.terminalDigest,
        expectedReceiptPath: task.receiptPath,
        expectedReceiptDigest: task.receiptDigest,
      })
      workerFacts.push(...receipt.facts)
      workerReceipts.push(...(receipt.receipts as FoundationFactReceipt[]))
    }
    const factStore = mergeFoundationFactResults({
      mechanicalFacts: mechanical.facts,
      workerFacts,
      workerReceipts,
    })
    const normalizedFactDigest = digestFactStore(factStore)
    const published = await publishFoundationDerivedArtifacts({
      workspacePath: input.workspacePath,
      revision: state.revision,
      documentDigests: artifacts.documentDigests,
      sectionIndex: artifacts.sectionIndex,
      factStore,
      normalizedFactDigest,
      manifest: artifacts.manifest as unknown as Record<string, unknown>,
    })
    const lease = await store.mutationLock(run.runId)
    let derivedCommittedRun: DeliveryRun | undefined
    try {
      const locked = await store.load(lease)
      if (
        !locked?.foundationAuditState ||
        locked.foundationAuditState.status === 'derived_committed'
      )
        return
      if (locked.foundationAuditState.status !== 'facts_staged')
        throw new Error('foundation fact state changed before derived binding')
      const derived = {
        manifestPath: `.beegame/audit/foundation/${state.revision}/derived/manifest.json`,
        manifestDigest: published.digests.manifest,
        markerPath: `.beegame/audit/foundation/${state.revision}/derived/COMMITTED.json`,
        markerDigest: published.digests.marker,
        factStorePath: `.beegame/audit/foundation/${state.revision}/derived/fact-store.json`,
        factStoreDigest: published.digests.factStore,
        sectionIndexPath: `.beegame/audit/foundation/${state.revision}/derived/section-index.json`,
        sectionIndexDigest: published.digests.sectionIndex,
      }
      derivedCommittedRun = await store.commit(
        {
          ...locked,
          foundationAuditState: {
            ...locked.foundationAuditState,
            status: 'derived_committed',
            derived,
          },
          status: 'running',
          blockedReason: undefined,
          thinking: 'working',
        },
        {
          runId: locked.runId,
          type: 'foundation.fact.derived_committed',
          phase: locked.phase,
          status: 'running',
          revision: locked.revision,
          artifactManifestDigest: published.digests.manifest,
        },
        undefined,
        lease,
      )
    } finally {
      await store.unlock(lease)
    }
    if (derivedCommittedRun)
      await completeDeterministicFoundationAudit(derivedCommittedRun)
  }

  async function completeDeterministicFoundationAudit(
    run: DeliveryRun,
  ): Promise<void> {
    const state = run.foundationAuditState
    if (
      !state ||
      !['derived_committed', 'deterministic_ready'].includes(state.status)
    )
      return
    if (!state.derived)
      throw new Error('committed deterministic audit inputs are unavailable')
    const committed = await loadCommittedFoundationDerivedArtifacts({
      workspacePath: input.workspacePath,
      revision: state.revision,
    })
    if (!committed)
      throw new Error('committed derived authority is unavailable')
    const sectionIndex = committed.sectionIndex
    const factStore = committed.factStore
    let deterministic: NonNullable<FoundationAuditState['deterministic']>
    let deterministicReviewDigest: string
    let deterministicPrefix: Awaited<
      ReturnType<typeof loadDeterministicFoundationReview>
    >
    if (state.status === 'deterministic_ready') {
      if (!state.deterministic)
        throw new Error(
          'deterministic-ready state is missing immutable review binding',
        )
      deterministic = state.deterministic
      deterministicReviewDigest = deterministic.reviewDigest
      deterministicPrefix = await loadDeterministicFoundationReview({
        workspacePath: input.workspacePath,
        revision: state.revision,
        reviewDigest: deterministicReviewDigest,
      })
      if (
        !deterministicPrefix ||
        deterministicPrefix.revision !== state.revision ||
        deterministicPrefix.reviewDigest !== deterministic.reviewDigest ||
        deterministicPrefix.digests.issueRegistry !==
          deterministic.issueRegistryDigest ||
        deterministicPrefix.digests.manifest !== deterministic.manifestDigest ||
        deterministicPrefix.digests.marker !== deterministic.markerDigest ||
        deterministicPrefix.sectionIndexDigest !==
          deterministic.sectionIndexDigest ||
        deterministicPrefix.factStoreDigest !== deterministic.factStoreDigest ||
        deterministicPrefix.sectionIndexDigest !==
          committed.digests.sectionIndex ||
        deterministicPrefix.factStoreDigest !== committed.digests.factStore ||
        deterministicPrefix.manifestDigest !==
          FOUNDATION_AUDIT_PRODUCTION_MANIFEST.digest ||
        deterministicPrefix.catalogVersion !==
          FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion ||
        deterministicPrefix.contractGraphDigest !==
          FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contractGraphDigest ||
        deterministic.catalogVersion !==
          FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion ||
        deterministic.contractGraphDigest !==
          FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contractGraphDigest ||
        !sameDocumentDigests(
          deterministicPrefix.documentDigests,
          committed.documentDigests,
        )
      )
        throw new Error('deterministic-ready review binding is stale')
    } else {
      const documents = new Map(
        await Promise.all(
          CANONICAL_FOUNDATION_DOCUMENTS.map(
            async path =>
              [
                path,
                await readFile(join(input.workspacePath, path), 'utf8'),
              ] as const,
          ),
        ),
      )
      const issues = runProductionDeterministicFoundationAudit({
        sectionIndex,
        factStore,
        documents,
      })
      const review = await publishDeterministicFoundationReview({
        workspacePath: input.workspacePath,
        revision: state.revision,
        documentDigests: committed.documentDigests,
        sectionIndex,
        factStore,
        issues,
      })
      if (
        review.manifestDigest !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.digest ||
        review.catalogVersion !==
          FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion ||
        review.contractGraphDigest !==
          FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contractGraphDigest
      )
        throw new Error(
          'deterministic review is not bound to the controller production manifest',
        )
      const reviewRoot = `.beegame/audit/foundation/${state.revision}/staging/review/${review.reviewDigest}`
      deterministicReviewDigest = review.reviewDigest
      deterministic = {
        reviewDigest: review.reviewDigest,
        issueRegistryPath: `${reviewRoot}/issue-registry.json`,
        issueRegistryDigest: review.digests.issueRegistry,
        manifestPath: `${reviewRoot}/manifest.json`,
        manifestDigest: review.digests.manifest,
        markerPath: `${reviewRoot}/COMMITTED.json`,
        markerDigest: review.digests.marker,
        catalogVersion: review.catalogVersion,
        contractGraphDigest: review.contractGraphDigest,
        sectionIndexDigest: review.sectionIndexDigest,
        factStoreDigest: review.factStoreDigest,
      }
      deterministicPrefix = await loadDeterministicFoundationReview({
        workspacePath: input.workspacePath,
        revision: state.revision,
        reviewDigest: deterministicReviewDigest,
      })
      if (!deterministicPrefix)
        throw new Error('deterministic review prefix failed closed')
    }
    if (state.status === 'derived_committed') {
      const lease = await store.mutationLock(run.runId)
      try {
        const locked = await store.load(lease)
        if (
          !locked?.foundationAuditState ||
          ['semantic_review', 'audit_ready'].includes(
            locked.foundationAuditState.status,
          )
        )
          return
        if (locked.foundationAuditState.status !== 'derived_committed')
          throw new Error(
            'foundation audit state changed before deterministic binding',
          )
        await store.commit(
          {
            ...locked,
            foundationAuditState: {
              ...locked.foundationAuditState,
              status: 'deterministic_ready',
              deterministic,
            },
            status: 'running',
            blockedReason: undefined,
            thinking: 'working',
          },
          {
            runId: locked.runId,
            type: 'foundation.audit.deterministic_ready',
            phase: locked.phase,
            status: 'running',
            revision: locked.revision,
            reviewDigest: deterministicReviewDigest,
          },
          undefined,
          lease,
        )
      } finally {
        await store.unlock(lease)
      }
    }
    const semanticPackets = await Promise.all(
      FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(check =>
        buildSemanticPacketFor({
          workspacePath: input.workspacePath,
          revision: state.revision,
          checkId: check.checkId,
          sectionIndex,
          factStore,
          deterministicReviewDigest,
          deterministicIssuePrefix: deterministicPrefix!.issues,
          documentDigests: committed.documentDigests,
        }),
      ),
    )
    if (semanticPackets.length !== 10)
      throw new Error('semantic authority did not return exactly ten checks')
    const phaseStartedAt = new Date().toISOString()
    const semanticCollection = createFoundationSemanticTaskCollection({
      revision: state.revision,
      phaseStartedAt,
      tasks: semanticPackets.map((packet, index) => ({
        taskId: `${state.revision}:semantic:${index}:${packet.identity.slice(0, 12)}`,
        kind: 'semantic' as const,
        revision: state.revision,
        checkId: packet.checkId,
        packetDigest: packet.identity,
        modelTier: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks[index]!.modelTier,
        status: 'pending' as const,
        attempt: 0,
      })),
    })
    const lease = await store.mutationLock(run.runId)
    let seededRun: DeliveryRun | undefined
    try {
      const locked = await store.load(lease)
      if (
        !locked?.foundationAuditState ||
        ['semantic_review', 'audit_ready'].includes(
          locked.foundationAuditState.status,
        )
      )
        return
      if (locked.foundationAuditState.status !== 'deterministic_ready')
        throw new Error(
          'foundation audit state changed during deterministic recovery',
        )
      const { aggregateUsage: _factAggregateUsage, ...semanticBaseState } =
        locked.foundationAuditState
      seededRun = await store.commit(
        {
          ...locked,
          foundationAuditState: {
            ...semanticBaseState,
            status: 'semantic_review',
            deterministic,
            tasks: semanticCollection.tasks,
            phaseStartedAt,
            semantic: { aggregateUsage: semanticCollection.aggregateUsage },
          },
          status: 'running',
          blockedReason: undefined,
          thinking: 'working',
        },
        {
          runId: locked.runId,
          type: 'foundation.audit.semantic_review',
          phase: locked.phase,
          status: 'running',
          revision: locked.revision,
          reviewDigest: deterministicReviewDigest,
          semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest,
        },
        undefined,
        lease,
      )
    } finally {
      await store.unlock(lease)
    }
    if (seededRun) await resumeUnlocked(seededRun)
  }

  async function finalizeFoundationSemanticReview(
    run: DeliveryRun,
  ): Promise<void> {
    const lease = await store.mutationLock(run.runId)
    let continuation: DeliveryRun | undefined
    try {
      const locked = await store.load(lease)
      if (
        !locked?.foundationAuditState ||
        locked.foundationAuditState.status === 'audit_ready'
      )
        return
      if (locked.foundationAuditState.status !== 'semantic_review')
        throw new Error('semantic review state changed during finalization')
      const state = locked.foundationAuditState
      if (!state.deterministic || !state.derived)
        throw new Error(
          'semantic finalization requires deterministic and derived bindings',
        )
      const committed = await loadCommittedFoundationDerivedArtifacts({
        workspacePath: input.workspacePath,
        revision: state.revision,
      })
      const prefix = await loadDeterministicFoundationReview({
        workspacePath: input.workspacePath,
        revision: state.revision,
        reviewDigest: state.deterministic.reviewDigest,
      })
      if (!committed || !prefix)
        throw new Error(
          'semantic finalization immutable inputs are unavailable',
        )
      const runtimeTasks = foundationRuntimeTasks(state)
      const sourceTasks = runtimeTasks.filter(
        task => task.kind === 'semantic',
      ) as Array<{
        taskId: string
        checkId: string
        status: string
        admittedResult?: FoundationSemanticResult
      }>
      if (
        sourceTasks.length !== 10 ||
        sourceTasks.some(
          task => !task.admittedResult || task.status !== 'completed',
        )
      )
        throw new Error('semantic finalization requires every source result')
      const resultLedger: {
        checkId: string
        packetIdentity: string
        admittedResultDigest: string
        confirmationDigest?: string
      }[] = []
      const semanticDrafts = []
      for (const task of sourceTasks) {
        const packet = await buildSemanticPacketFor({
          workspacePath: input.workspacePath,
          revision: state.revision,
          checkId: task.checkId,
          sectionIndex: committed.sectionIndex,
          factStore: committed.factStore,
          deterministicReviewDigest: prefix.reviewDigest,
          deterministicIssuePrefix: prefix.issues,
          documentDigests: committed.documentDigests,
        })
        const confirmation = runtimeTasks.find(
          candidate =>
            candidate.kind === 'confirmation' &&
            candidate.sourceTaskId === task.taskId,
        ) as { admittedResult?: FoundationSemanticResult } | undefined
        const admitted = (confirmation?.admittedResult ??
          task.admittedResult) as FoundationSemanticResult
        if (admitted.outcome === 'UNDECIDABLE')
          throw new Error('semantic confirmation remained undecidable')
        semanticDrafts.push(
          ...semanticResultToFoundationIssueDrafts(packet, admitted),
        )
        resultLedger.push({
          checkId: task.checkId,
          packetIdentity: packet.identity,
          admittedResultDigest: digestFoundationSemanticResult(
            task.admittedResult!,
          ),
          ...(confirmation?.admittedResult
            ? {
                confirmationDigest: digestFoundationSemanticResult(
                  confirmation.admittedResult,
                ),
              }
            : {}),
        })
      }
      const semanticIssues = compileFoundationIssueRegistry({
        sectionIndex: committed.sectionIndex,
        factStore: committed.factStore,
        drafts: semanticDrafts,
      })
      const issues = [...prefix.issues, ...semanticIssues]
      const review = await publishFoundationSemanticReview({
        workspacePath: input.workspacePath,
        revision: state.revision,
        documentDigests: committed.documentDigests,
        sectionIndexDigest: committed.digests.sectionIndex,
        factStoreDigest: committed.digests.factStore,
        deterministicReviewDigest: prefix.reviewDigest,
        semanticManifest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST,
        semanticResultDigests: resultLedger,
        issues,
      })
      const policy = evaluateFoundationRevisionRoundPolicy({
        phase: 'plan',
        round: 1,
        issues: review.issues,
      })
      const reviewRoot = `.beegame/audit/foundation/${state.revision}/review/${review.reviewDigest}`
      const finalState = {
        ...state,
        status: 'audit_ready' as const,
        review: {
          reviewDigest: review.reviewDigest,
          issueRegistryPath: `${reviewRoot}/issue-registry.json`,
          issueRegistryDigest: review.digests.issueRegistry,
          manifestPath: `${reviewRoot}/manifest.json`,
          manifestDigest: review.digests.manifest,
          markerPath: `${reviewRoot}/COMMITTED.json`,
          markerDigest: review.digests.marker,
          sectionIndexDigest: review.sectionIndexDigest,
          factStoreDigest: review.factStoreDigest,
          semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest,
          issueSummary: summarizeFoundationIssues(review.issues),
        },
      }
      if (policy.status === 'proceed') {
        continuation = {
          ...locked,
          foundationAuditState: finalState,
          documentStep: 'FOUNDATION_REVIEW',
          status: 'running',
          blockedReason: undefined,
          thinking: 'idle',
        }
      } else {
        const authority = {
          issueAuthority: {
            kind: 'review' as const,
            reviewDigest: review.reviewDigest,
            issueRegistryDigest: review.digests.issueRegistry,
          },
          derivedDigests: {
            sectionIndex: committed.digests.sectionIndex,
            factStore: committed.digests.factStore,
            manifest: committed.digests.manifest,
          },
          documentDigests: committed.documentDigests,
        }
        const now = new Date().toISOString()
        continuation = {
          ...locked,
          foundationAuditState: {
            ...finalState,
            authority,
            roundBefore: {
              documentRevision: state.revision,
              issueRegistryDigest: review.digests.issueRegistry,
              issueAuthority: authority.issueAuthority,
            },
            round: 1,
            status: 'planning',
            phaseStartedAt: now,
            aggregateUsage: undefined,
            deterministic: undefined,
            semantic: undefined,
            review: undefined,
            issueSummary: summarizeFoundationIssues(review.issues),
            tasks: [],
          },
          status: 'running',
          blockedReason: undefined,
          thinking: 'idle',
        }
      }
      await store.commit(
        continuation,
        {
          runId: locked.runId,
          type: 'foundation.audit.audit_ready',
          phase: locked.phase,
          status: continuation.status,
          revision: locked.revision,
          reviewDigest: review.reviewDigest,
        },
        undefined,
        lease,
      )
    } finally {
      await store.unlock(lease)
    }
    if (continuation) await resumeUnlocked(continuation)
  }

  async function handleTerminalUnlocked(
    record: DispatchRecord,
    result: WorkerTerminalResult,
    request?: WorkerDispatchRequest,
  ): Promise<void> {
    const run = await store.load()
    const foundationRuntimeTaskList = run?.foundationAuditState
      ? foundationRuntimeTasks(run.foundationAuditState)
      : []
    const foundationCheckpoint = run?.foundationDraftState.documents?.find(
      document => document.dispatch?.dispatchId === record.dispatchId,
    )
    const foundationFactTask = foundationRuntimeTaskList.find(
      task => task.dispatch?.dispatchId === record.dispatchId,
    )
    const foundationSemanticTask = foundationRuntimeTaskList.find(
      task =>
        task.dispatch?.dispatchId === record.dispatchId &&
        (task.kind === 'semantic' || task.kind === 'confirmation'),
    )
    const foundationRevisionTask = foundationRuntimeTaskList.find(
      task => task.dispatch?.dispatchId === record.dispatchId,
    )
    if (
      !run ||
      (run.activeDispatch?.dispatchId !== record.dispatchId &&
        !foundationCheckpoint &&
        !foundationFactTask &&
        !foundationSemanticTask &&
        !foundationRevisionTask)
    )
      return
    if (result.workerType === 'game-ir-compiler') {
      const state = run.gameIrState
      if (!state || state.status !== 'compiling' || !request) return
      const foundationReadyReceipt = run.foundationAuditState
        ? projectFoundationReadyReceipt({
            state: run.foundationAuditState,
            projectId: run.projectId,
            confirmedBriefDigest: run.confirmedBriefDigest,
          })
        : undefined
      if (!foundationReadyReceipt)
        throw new Error(
          'Game IR compiler terminal has no Foundation READY receipt',
        )
      const compileRequest = parseGameIrCompileRequest({
        schemaVersion: 'game-ir-compile-request.v1',
        taskId: state.identity.taskId,
        publicationId: state.identity.publicationId,
        gameIrSchemaVersion: 'game-ir.v1',
        foundation: foundationReadyReceipt,
      })
      if (
        foundationReadyReceipt.receiptDigest !==
          state.identity.foundationReadyReceiptDigest ||
        request.contract.compileRequestDigest !==
          digestGameIrValue(compileRequest) ||
        request.contract.foundationReadyReceiptDigest !==
          foundationReadyReceipt.receiptDigest
      )
        throw new Error('Game IR compiler contract authority is stale')
      if (
        result.runId !== run.runId ||
        result.dispatchId !== record.dispatchId ||
        result.taskId !== state.identity.taskId ||
        result.revision !== record.revision ||
        result.compileRequestDigest !== digestGameIrValue(compileRequest) ||
        result.foundationReadyReceiptDigest !==
          state.identity.foundationReadyReceiptDigest
      )
        throw new Error('Game IR compiler terminal identity is stale')
      const loader = new GameIrStageCheckpointLoader()
      const replay = state.latestCheckpoint
        ? await loader.load({
            workspacePath: input.workspacePath,
            deliveryRun: run,
          })
        : undefined
      const operation = nextGameIrOperation(replay)
      if (
        !operation ||
        request.contract.kind !== operation.operation ||
        result.operation !== operation.operation
      )
        throw new Error('Game IR compiler operation is stale or out of order')
      const records: GameIrStagedRecords = replay?.records ?? new Map()
      const source =
        operation.operation === 'projection'
          ? await buildGameIrSourcePacket({
              workspacePath: input.workspacePath,
              request: compileRequest,
              receipt: foundationReadyReceipt,
              domain: operation.domain,
            })
          : undefined
      const packet = buildStagedOperationPacket({
        operation,
        ...(source ? { source } : {}),
        records,
      })
      if (
        digestGameIrValue(request.contract.packet) !== digestGameIrValue(packet)
      )
        throw new Error('Game IR operation packet authority is stale')
      const projectionJournal =
        operation.operation === 'projection'
          ? await createGameIrProjectionSliceJournal({
              journalPath: gameIrProjectionSliceJournalPath({
                workspacePath: input.workspacePath,
                identity: state.identity,
                operationStep: operation.step,
              }),
              identity: state.identity,
              operationStep: operation.step,
              packet: packet as never,
              slicePlan: deriveProjectionSlicePlan(operation.domain),
            })
          : undefined
      const currentSliceId = projectionJournal?.nextSlice?.sliceId
      const requestedSliceId =
        operation.operation === 'projection' &&
        result.status === 'completed' &&
        'sliceId' in result
          ? result.sliceId
          : currentSliceId
      const stableTerminalIdentity =
        result.status === 'completed'
          ? null
          : {
              operation: operation.step,
              ...(currentSliceId ? { sliceId: currentSliceId } : {}),
              status: result.status,
              reason: normalizeGameIrDiagnosticReason(result.reason),
            }
      const progressIdentity = {
        inputDigest: digestGameIrValue({
          identity: state.identity,
          operation,
          packet,
          ...(requestedSliceId ? { sliceId: requestedSliceId } : {}),
        }),
        diagnosticDigest: digestGameIrValue(stableTerminalIdentity),
        candidateDigest: digestGameIrValue(stableTerminalIdentity),
        checkpointJournalDigest: digestGameIrValue(
          state.latestCheckpoint ?? null,
        ),
        terminalDigest: digestGameIrValue(stableTerminalIdentity),
      }
      const persistCompilerDiagnostic = async (
        actual: string,
        diagnosticIdentity = progressIdentity,
        retryDiagnostic?: GameIrProjectionRetryDiagnostic,
        requiresAction = false,
      ): Promise<void> => {
        const normalizedReason = retryDiagnostic
          ? retryDiagnosticActual(
              normalizeGameIrDiagnosticReason(actual),
              retryDiagnostic,
            )
          : normalizeGameIrDiagnosticReason(actual)
        const reasonBoundIdentity = {
          ...diagnosticIdentity,
          diagnosticDigest: digestGameIrValue({
            operation: operation.step,
            reason: normalizedReason,
            base: diagnosticIdentity.diagnosticDigest,
          }),
        }
        const diagnosticRef = `game-ir-${digestGameIrValue(reasonBoundIdentity).slice(0, 12)}`
        const unchanged =
          state.progressIdentity !== undefined &&
          digestGameIrValue(state.progressIdentity) ===
            digestGameIrValue(reasonBoundIdentity)
        const status =
          requiresAction || unchanged
            ? ('needs_action' as const)
            : ('running' as const)
        const attended = await persist(
          {
            ...run,
            activeDispatch: undefined,
            status,
            blockedReason: unchanged
              ? `game_ir_compilation diagnostic ${diagnosticRef}`
              : undefined,
            thinking: unchanged ? 'idle' : 'working',
            gameIrState: {
              ...state,
              diagnosticRef,
              diagnostic: {
                phase: 'GAME_IR_COMPILATION',
                step: operation.step,
                taskId: state.identity.taskId,
                workerType: 'game-ir-compiler',
                reasonCode: 'compilation',
                expected: operation.step,
                actual: normalizedReason,
                diagnosticRef,
                recoveryAction: requiresAction
                  ? 'resolve the operation diagnostic, then retry the same compilation identity'
                  : unchanged
                    ? 'resolve the unchanged operation diagnostic, then retry the same compilation identity'
                    : 'retry the same compilation identity',
              },
              progressIdentity: reasonBoundIdentity,
            },
          },
          unchanged
            ? 'game_ir_compilation.needs_action'
            : 'game_ir_compilation.retryable',
          { diagnosticRef, reasonCode: 'compilation' },
        )
        if (attended.status === 'running') await resumeUnlocked(attended)
      }
      if (operation.operation === 'validation' && result.status !== 'completed') {
        await persistCompilerDiagnostic(result.reason)
        return
      }
      let recordsToCommit: readonly import('./game-ir/stage-checkpoint').GameIrCheckpointRecord[]
      try {
        if (operation.operation === 'projection') {
          if (!projectionJournal || !('records' in result))
            throw new Error(
              'Game IR projection terminal is missing its verified slice journal or records',
            )
          const admission = await projectionJournal.appendRecords(
            result.records,
            result.sliceId,
          )
          const admissionProgressIdentity = {
            ...progressIdentity,
            candidateDigest: digestGameIrValue(
              projectionJournal.currentSliceRecordDigests,
            ),
            terminalDigest: digestGameIrValue(
              projectionJournal.currentSliceRecordDigests,
            ),
          }
          if (admission.diagnostic && result.sliceId !== currentSliceId)
            throw new Error(admission.diagnostic.reason)
          const retryDiagnostic =
            admission.diagnostic ??
            (!result.done
              ? {
                  scope: 'slice' as const,
                  sliceId: result.sliceId,
                  reason: result.reason,
                }
              : undefined)
          if (retryDiagnostic) {
            await persistCompilerDiagnostic(
              retryDiagnostic.reason,
              admissionProgressIdentity,
              retryDiagnostic,
            )
            return
          }
          if (!admission.replayed) await projectionJournal.completeCurrentSlice()
          if (projectionJournal.nextSlice) {
            const continued = await persist(
              {
                ...run,
                activeDispatch: undefined,
                thinking: 'working',
                gameIrState: {
                  ...state,
                  diagnosticRef: undefined,
                  diagnostic: undefined,
                  progressIdentity: undefined,
                },
              },
              'game_ir_projection_slice_admitted',
              {
                sliceId: requestedSliceId,
                journalDigest: projectionJournal.snapshot.journalDigest,
              },
            )
            await resumeUnlocked(continued)
            return
          }
          recordsToCommit = stagedProjectionJournalCompletion({
            operation,
            packet,
            records,
            journal: projectionJournal,
          })
        } else {
          const stagedResult =
            'validation' in result
              ? { status: 'completed' as const, validation: result.validation }
              : (() => {
                  throw new Error(
                    'Game IR validation terminal is missing validation result',
                  )
                })()
          recordsToCommit = admitStagedValidationOperation({
            operation,
            packet,
            records,
            result: stagedResult,
          })
        }
      } catch (error) {
        const actual =
          error instanceof Error
            ? error.message
            : 'Game IR operation admission failed'
        let unattributed = false
        if (
          operation.operation === 'projection' &&
          projectionJournal &&
          !projectionJournal.nextSlice
        ) {
          const ownerSliceId =
            projectionJournal.ownerSliceIdForDiagnostic(actual)
          if (ownerSliceId) await projectionJournal.invalidate(ownerSliceId)
          else unattributed = true
        }
        const nativeCandidate =
          operation.operation === 'projection'
            ? 'records' in result
              ? result.records
              : undefined
            : 'validation' in result
              ? result.validation
              : undefined
        const admissionIdentity = gameIrCompilerAdmissionProgressIdentity({
          inputDigest: progressIdentity.inputDigest,
          checkpointJournalDigest: progressIdentity.checkpointJournalDigest,
          operation: operation.step,
          candidate:
            operation.operation === 'projection' && projectionJournal
              ? projectionJournal.currentSliceRecordDigests
              : nativeCandidate,
          reason: actual,
        })
        await persistCompilerDiagnostic(
          actual,
          admissionIdentity,
          undefined,
          unattributed,
        )
        return
      }
      const checkpoint = await writeGameIrStageCheckpoint({
        workspacePath: input.workspacePath,
        deliveryRun: run,
        step: {
          phase: operation.phase,
          domain: operation.domain,
          operation: operation.operation,
          records: recordsToCommit,
        },
      })
      const checkpointed = transitionDeliveryRun(run, {
        type: 'game_ir_checkpoint_committed',
        checkpoint,
        expectedPreviousCheckpoint: state.latestCheckpoint,
      })
      const persistedCheckpoint = await persist(
        checkpointed,
        'game_ir_checkpoint_committed',
        { checkpoint },
      )
      if (operation.operation === 'projection' && projectionJournal)
        await cleanupGameIrProjectionSliceJournalAfterCheckpoint({
          workspacePath: input.workspacePath,
          identity: state.identity,
          operationStep: operation.step,
          deliveryRun: persistedCheckpoint,
        })
      await resumeUnlocked(persistedCheckpoint)
      return
    }
    if (
      foundationRevisionTask?.kind === 'impacted-facts' &&
      result.workerType === 'foundation-fact-extractor'
    ) {
      let admitted: DeliveryRun | undefined
      let receiptWritten = false
      const lease = await store.mutationLock(run.runId)
      try {
        const locked = await store.load(lease)
        const task =
          locked?.foundationAuditState &&
          foundationRuntimeTasks(locked.foundationAuditState).find(
            candidate => candidate.taskId === foundationRevisionTask.taskId,
          )
        if (
          !locked ||
          !task ||
          task.kind !== 'impacted-facts' ||
          task.dispatch?.dispatchId !== record.dispatchId
        )
          return
        if (
          task.status === 'completed' &&
          task.receiptPath &&
          task.receiptDigest
        ) {
          if (
            task.terminalDigest !==
            digestFoundationFactTerminal(result as never)
          )
            throw new Error(
              'conflicting foundation impacted fact terminal replay',
            )
          admitted = locked
        } else {
          const committed = await loadCommittedFoundationDerivedArtifacts({
            workspacePath: input.workspacePath,
            revision: task.revision,
          })
          await assertBoundRevisionContext(
            locked.foundationAuditState!,
            committed,
          )
          const packet = await loadFoundationRevisionFactPacket({
            workspacePath: input.workspacePath,
            revision: task.revision,
            round: task.round,
            taskId: task.taskId,
            packetDigest: task.packetDigest,
          })
          const documents = await revisionDocuments(
            locked.foundationAuditState!,
          )
          const sectionIndex = buildFoundationSectionIndex({
            documents: Object.fromEntries(documents),
          })
          let validated: ReturnType<typeof validateFoundationFactResults>
          try {
            validated = validateFoundationFactResults({
              packet,
              expectedRevision: task.revision,
              documents,
              sectionIndex,
              results: result.results as never,
            })
          } catch (error) {
            throw new FoundationFactAttemptError(
              error instanceof Error
                ? error.message
                : 'foundation impacted fact result is invalid',
            )
          }
          const terminalDigest = digestFoundationFactTerminal(result as never)
          const usage = record.usage ?? {
            input_tokens: 0,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          }
          const durationMs = Math.max(
            0,
            Date.parse(record.finishedAt ?? new Date().toISOString()) -
              Date.parse(record.startedAt),
          )
          let receipt: Awaited<ReturnType<typeof writeFoundationFactReceipt>>
          try {
            receipt = await writeFoundationFactReceipt({
              workspacePath: input.workspacePath,
              revision: task.revision,
              receipt: {
                taskId: task.taskId,
                revision: task.revision,
                packetDigest: task.packetDigest,
                terminalDigest,
                normalizedFactDigest: validated.normalizedFactDigest,
                receipts: validated.receipts,
                facts: validated.facts,
                usage,
                durationMs,
              },
            })
          } catch (error) {
            throw new FoundationFactAttemptError(
              error instanceof Error
                ? error.message
                : 'foundation impacted fact receipt could not be written',
            )
          }
          receiptWritten = true
          admitted = await store.commit(
            {
              ...locked,
              foundationAuditState: {
                ...locked.foundationAuditState!,
                tasks: locked.foundationAuditState!.tasks.map(candidate =>
                  candidate.taskId === task.taskId
                    ? projectTaskTerminalEvidence(
                        {
                          ...candidate,
                          status: 'completed' as const,
                          terminalDigest,
                          receiptPath: receipt.path,
                          receiptDigest: receipt.digest,
                          usage,
                          durationMs,
                        },
                        record,
                      )
                    : candidate,
                ),
              },
            },
            {
              runId: locked.runId,
              type: 'foundation.revision.impacted_facts.admitted',
              phase: locked.phase,
              status: locked.status,
              revision: locked.revision,
              taskId: task.taskId,
              dispatchId: record.dispatchId,
              terminalDigest,
            },
            undefined,
            lease,
          )
        }
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : 'foundation impacted fact admission failed'
        if (receiptWritten) throw error
        const latest = await store.load(lease)
        if (latest?.foundationAuditState) {
          if (error instanceof FoundationFactAttemptError) {
            const invalid = {
              ...record,
              status: 'invalid' as const,
              failureReason: reason,
              terminalResult: undefined,
              finishedAt: record.finishedAt ?? new Date().toISOString(),
            }
            admitted = await store.commit(
              {
                ...latest,
                status: 'running',
                blockedReason: undefined,
                foundationAuditState: {
                  ...latest.foundationAuditState,
                  tasks: latest.foundationAuditState.tasks.map(candidate =>
                    candidate.taskId === foundationRevisionTask.taskId
                      ? projectTaskTerminalEvidence(
                          {
                            ...candidate,
                            status: 'retryable' as const,
                            failureReason: reason,
                          },
                          invalid,
                        )
                      : candidate,
                  ),
                },
              },
              {
                runId: latest.runId,
                type: 'foundation.revision.impacted_facts.admission_retryable',
                phase: latest.phase,
                status: 'running',
                revision: latest.revision,
                taskId: foundationRevisionTask.taskId,
                reason,
              },
              undefined,
              lease,
            )
          } else
            admitted = await store.commit(
              {
                ...latest,
                status: 'needs_action',
                blockedReason: reason,
                foundationAuditState: {
                  ...latest.foundationAuditState,
                  tasks: latest.foundationAuditState.tasks.map(candidate =>
                    candidate.taskId === foundationRevisionTask.taskId
                      ? projectTaskTerminalEvidence(
                          { ...candidate, status: 'needs_action' as const },
                          {
                            ...record,
                            status: 'invalid' as const,
                            failureReason: reason,
                            finishedAt:
                              record.finishedAt ?? new Date().toISOString(),
                          },
                        )
                      : candidate,
                  ),
                },
              },
              {
                runId: latest.runId,
                type: 'foundation.revision.impacted_facts.admission_failed',
                phase: latest.phase,
                status: 'needs_action',
                revision: latest.revision,
                taskId: foundationRevisionTask.taskId,
                reason,
              },
              undefined,
              lease,
            )
        }
      } finally {
        await store.unlock(lease)
      }
      if (admitted?.status === 'running') await resumeUnlocked(admitted)
      return
    }
    if (
      foundationRevisionTask?.kind === 'semantic-recheck' &&
      result.workerType === 'foundation-semantic-reviewer'
    ) {
      let admitted: DeliveryRun | undefined
      const lease = await store.mutationLock(run.runId)
      try {
        const locked = await store.load(lease)
        const task =
          locked?.foundationAuditState &&
          foundationRuntimeTasks(locked.foundationAuditState).find(
            candidate => candidate.taskId === foundationRevisionTask.taskId,
          )
        if (
          !locked ||
          !task ||
          task.kind !== 'semantic-recheck' ||
          task.dispatch?.dispatchId !== record.dispatchId
        )
          return
        if (
          task.status === 'completed' &&
          task.resultPath &&
          task.resultDigest &&
          task.terminalDigest
        ) {
          await loadFoundationRevisionSemanticResult({
            workspacePath: input.workspacePath,
            revision: task.revision,
            round: task.round,
            taskId: task.taskId,
            issueId: task.issueId,
            packetDigest: task.packetDigest,
            resultDigest: task.resultDigest,
            resultPath: task.resultPath,
          })
          if (locked.foundationAuditState!.status !== 'semantic_recheck') {
            admitted = locked
          } else {
            const semanticTasks = activeFoundationRevisionTasks(
              locked.foundationAuditState!,
            ).filter(candidate => candidate.kind === 'semantic-recheck')
            const allCompleted =
              semanticTasks.length > 0 &&
              semanticTasks.every(
                candidate =>
                  candidate.status === 'completed' &&
                  !!candidate.resultPath &&
                  !!candidate.resultDigest &&
                  !!candidate.terminalDigest,
              )
            if (!allCompleted) admitted = locked
            else {
              let allDecidable = false
              let failureReason: string | undefined
              try {
                const results = await Promise.all(
                  semanticTasks.map(candidate =>
                    loadFoundationRevisionSemanticResult({
                      workspacePath: input.workspacePath,
                      revision: candidate.revision,
                      round: candidate.round,
                      taskId: candidate.taskId,
                      issueId: candidate.issueId,
                      packetDigest: candidate.packetDigest,
                      resultDigest: candidate.resultDigest!,
                      resultPath: candidate.resultPath!,
                    }),
                  ),
                )
                const failures = results.filter(
                  candidate => candidate.status === 'FAIL',
                )
                const allPass = results.every(
                  candidate => candidate.status === 'PASS',
                )
                const actionable =
                  failures.length > 0 &&
                  failures.every(
                    candidate =>
                      candidate.diagnostic?.scopeAssessment ===
                      'repairable_in_scope',
                  )
                allDecidable = allPass || actionable
                if (!allDecidable)
                  failureReason =
                    'foundation semantic result is invalid or stale'
                const nextFoundationStatus = allPass
                  ? ('publishing' as const)
                  : actionable
                    ? ('validating' as const)
                    : ('semantic_recheck' as const)
                const nextRunStatus =
                  allPass || actionable
                    ? ('running' as const)
                    : ('needs_action' as const)
                admitted = await store.commit(
                  {
                    ...locked,
                    status: nextRunStatus,
                    blockedReason:
                      nextRunStatus === 'needs_action'
                        ? failureReason
                        : undefined,
                    foundationAuditState: {
                      ...locked.foundationAuditState!,
                      status: nextFoundationStatus,
                      phaseStartedAt: new Date().toISOString(),
                    },
                  },
                  {
                    runId: locked.runId,
                    type: allPass
                      ? 'foundation.revision.publishing'
                      : actionable
                        ? 'foundation.revision.semantic_failure_retry'
                        : 'foundation.revision.semantic_recheck.failed',
                    phase: locked.phase,
                    status: nextRunStatus,
                    revision: locked.revision,
                    taskId: task.taskId,
                    dispatchId: record.dispatchId,
                    ...(failureReason ? { reason: failureReason } : {}),
                  },
                  undefined,
                  lease,
                )
              } catch (error) {
                failureReason =
                  error instanceof Error
                    ? error.message
                    : 'foundation semantic result artifact is invalid'
              }
            }
          }
        } else {
          if (result.status !== 'completed')
            throw new Error(
              'foundation semantic revision terminal did not complete',
            )
          const packet = await loadFoundationRevisionSemanticPacket({
            workspacePath: input.workspacePath,
            revision: task.revision,
            round: task.round,
            taskId: task.taskId,
            packetDigest: task.packetDigest,
          })
          if (!task.issue)
            throw new Error(
              'foundation semantic recheck task is missing admitted Issue authority',
            )
          if (result.outcome !== 'PASS' && result.outcome !== 'FAIL')
            throw new Error(
              'foundation semantic recheck terminal outcome is invalid',
            )
          let admittedResult
          try {
            admittedResult =
              result.outcome === 'PASS'
                ? admitFoundationSemanticRecheckResult(
                    packet as never,
                    { status: 'PASS' },
                    { taskId: task.taskId, issue: task.issue },
                  )
                : (() => {
                    const diagnostic = result.diagnostic
                    if (!diagnostic)
                      throw new Error(
                        'foundation semantic FAIL terminal is missing diagnostic',
                      )
                    return admitFoundationSemanticRecheckResult(
                      packet as never,
                      {
                        status: 'FAIL',
                        diagnostic: {
                          observedActual: diagnostic.observedActual,
                          evidence: diagnostic.evidence,
                          failureReasonCode: diagnostic.failureReasonCode,
                        },
                      },
                      { taskId: task.taskId, issue: task.issue },
                    )
                  })()
          } catch (error) {
            throw new FoundationSemanticAdmissionError(
              error instanceof Error
                ? error.message
                : 'foundation semantic terminal admission failed',
              { cause: error },
            )
          }
          {
            const resultDigest =
              digestFoundationSemanticRecheckResult(admittedResult)
            const resultPath = await writeFoundationRevisionSemanticResult({
              workspacePath: input.workspacePath,
              revision: task.revision,
              round: task.round,
              taskId: task.taskId,
              issueId: task.issueId,
              packetDigest: task.packetDigest,
              result: admittedResult,
              resultDigest,
            })
            const completedTasks = locked.foundationAuditState!.tasks.map(
              candidate =>
                candidate.taskId === task.taskId
                  ? projectTaskTerminalEvidence(
                      {
                        ...candidate,
                        status: 'completed' as const,
                        resultPath,
                        resultDigest,
                        terminalDigest:
                          candidate.terminalDigest ??
                          (record.terminalResult
                            ? createHash('sha256')
                                .update(JSON.stringify(record.terminalResult))
                                .digest('hex')
                            : undefined),
                      },
                      record,
                    )
                  : candidate,
            )
            const semanticTasks = activeFoundationRevisionTasks({
              ...locked.foundationAuditState!,
              tasks: completedTasks,
            }).filter(candidate => candidate.kind === 'semantic-recheck')
            const allCompleted =
              semanticTasks.length > 0 &&
              semanticTasks.every(
                candidate =>
                  candidate.status === 'completed' &&
                  !!candidate.resultPath &&
                  !!candidate.resultDigest &&
                  !!candidate.terminalDigest,
              )
            if (!allCompleted) {
              admitted = await store.commit(
                {
                  ...locked,
                  status: 'running',
                  blockedReason: undefined,
                  foundationAuditState: {
                    ...locked.foundationAuditState!,
                    status: 'semantic_recheck',
                    phaseStartedAt: new Date().toISOString(),
                    tasks: completedTasks,
                  },
                },
                {
                  runId: locked.runId,
                  type: 'foundation.revision.semantic_recheck.progress',
                  phase: locked.phase,
                  status: 'running',
                  revision: locked.revision,
                  taskId: task.taskId,
                  dispatchId: record.dispatchId,
                  resultDigest,
                },
                undefined,
                lease,
              )
            } else {
              let allDecidable = false
              let failureReason: string | undefined
              let semanticResults: Awaited<
                ReturnType<typeof loadFoundationRevisionSemanticResult>
              >[] = []
              try {
                semanticResults = await Promise.all(
                  semanticTasks.map(candidate =>
                    loadFoundationRevisionSemanticResult({
                      workspacePath: input.workspacePath,
                      revision: candidate.revision,
                      round: candidate.round,
                      taskId: candidate.taskId,
                      issueId: candidate.issueId,
                      packetDigest: candidate.packetDigest,
                      resultDigest: candidate.resultDigest!,
                      resultPath: candidate.resultPath!,
                    }),
                  ),
                )
                allDecidable = semanticResults.every(
                  candidate => candidate.status === 'PASS',
                )
                if (!allDecidable)
                  failureReason =
                    'foundation semantic result is invalid or stale'
              } catch (error) {
                failureReason =
                  error instanceof Error
                    ? error.message
                    : 'foundation semantic result artifact is invalid'
              }
              const failures = semanticResults.filter(
                candidate => candidate.status === 'FAIL',
              )
              const allPass =
                semanticResults.length > 0 &&
                semanticResults.every(candidate => candidate.status === 'PASS')
              const actionable =
                failures.length > 0 &&
                failures.every(
                  candidate =>
                    candidate.diagnostic?.scopeAssessment ===
                    'repairable_in_scope',
                )
              allDecidable = allPass || actionable
              if (!allDecidable)
                failureReason = 'foundation semantic result is invalid or stale'
              const nextFoundationStatus = allPass
                ? ('publishing' as const)
                : actionable
                  ? ('validating' as const)
                  : ('semantic_recheck' as const)
              const nextRunStatus =
                allPass || actionable
                  ? ('running' as const)
                  : ('needs_action' as const)
              admitted = await store.commit(
                {
                  ...locked,
                  status: nextRunStatus,
                  blockedReason:
                    nextRunStatus === 'needs_action'
                      ? failureReason
                      : undefined,
                  foundationAuditState: {
                    ...locked.foundationAuditState!,
                    status: nextFoundationStatus,
                    phaseStartedAt: new Date().toISOString(),
                    tasks: completedTasks,
                  },
                },
                {
                  runId: locked.runId,
                  type: allPass
                    ? 'foundation.revision.publishing'
                    : actionable
                      ? 'foundation.revision.semantic_failure_retry'
                      : 'foundation.revision.semantic_recheck.failed',
                  phase: locked.phase,
                  status: nextRunStatus,
                  revision: locked.revision,
                  taskId: task.taskId,
                  dispatchId: record.dispatchId,
                  resultDigest,
                  ...(failureReason ? { reason: failureReason } : {}),
                },
                undefined,
                lease,
              )
            }
          }
        }
      } finally {
        await store.unlock(lease)
      }
      if (admitted?.status === 'running') await resumeUnlocked(admitted)
      return
    }
    if (
      foundationRevisionTask &&
      result.workerType === 'foundation-document-reviser'
    ) {
      let admitted: DeliveryRun | undefined
      if (
        foundationRevisionTask.status === 'running' &&
        record.status === 'completed' &&
        result.status === 'completed'
      ) {
        const lease = await store.mutationLock(run.runId)
        try {
          const locked = await store.load(lease)
          const task =
            locked?.foundationAuditState &&
            foundationRuntimeTasks(locked.foundationAuditState).find(
              candidate => candidate.taskId === foundationRevisionTask.taskId,
            )
          // Dispatch admission owns the native APPLIED declaration and durable receipt.
          if (locked && task?.kind === 'document-revision') {
            const declaration = (
              result as Extract<
                WorkerTerminalResult,
                { workerType: 'foundation-document-reviser' }
              >
            ).declaration
            if (declaration.status === 'APPLIED' && task.status === 'running') {
              admitted = await store.commit(
                {
                  ...locked,
                  foundationAuditState: {
                    ...locked.foundationAuditState!,
                    tasks: locked.foundationAuditState!.tasks.map(candidate =>
                      candidate.taskId === task.taskId
                        ? projectTaskTerminalEvidence(
                            {
                              ...candidate,
                              status: 'completed' as const,
                              receipt: declaration.receipt,
                              terminalDigest:
                                declaration.receipt.terminalDigest,
                            },
                            record,
                          )
                        : candidate,
                    ),
                  },
                },
                {
                  runId: locked.runId,
                  type: 'foundation.revision.terminal.replayed',
                  phase: locked.phase,
                  status: locked.status,
                  revision: locked.revision,
                  taskId: task.taskId,
                  dispatchId: record.dispatchId,
                },
                undefined,
                lease,
              )
            } else {
              const projected = projectTaskTerminalEvidence(
                {
                  ...task,
                  status: 'completed' as const,
                  receipt: declaration.receipt,
                  terminalDigest: declaration.receipt.terminalDigest,
                },
                record,
              )
              admitted = await store.commit(
                {
                  ...locked,
                  foundationAuditState: {
                    ...locked.foundationAuditState!,
                    tasks: locked.foundationAuditState!.tasks.map(candidate =>
                      candidate.taskId === task.taskId ? projected : candidate,
                    ),
                  },
                },
                {
                  runId: locked.runId,
                  type: 'foundation.revision.terminal.replayed',
                  phase: locked.phase,
                  status: locked.status,
                  revision: locked.revision,
                  taskId: task.taskId,
                  dispatchId: record.dispatchId,
                  terminalDigest: declaration.receipt.terminalDigest,
                },
                undefined,
                lease,
              )
            }
          }
        } finally {
          await store.unlock(lease)
        }
      }
      if (run.status === 'running') await resumeUnlocked(admitted ?? run)
      return
    }
    if (
      foundationSemanticTask &&
      result.workerType === 'foundation-semantic-reviewer'
    ) {
      const lease = await store.mutationLock(run.runId)
      let completedRun: DeliveryRun | undefined
      try {
        const locked = await store.load(lease)
        const lockedTask =
          locked?.foundationAuditState &&
          foundationRuntimeTasks(locked.foundationAuditState).find(
            task => task.taskId === foundationSemanticTask.taskId,
          )
        if (
          !locked ||
          !lockedTask ||
          (lockedTask.kind !== 'semantic' &&
            lockedTask.kind !== 'confirmation') ||
          lockedTask.dispatch?.dispatchId !== record.dispatchId
        )
          return
        const lockedState = locked.foundationAuditState!
        const committed = await loadCommittedFoundationDerivedArtifacts({
          workspacePath: input.workspacePath,
          revision: lockedState.revision,
        })
        const prefix = lockedState.deterministic
          ? await loadDeterministicFoundationReview({
              workspacePath: input.workspacePath,
              revision: lockedState.revision,
              reviewDigest: lockedState.deterministic.reviewDigest,
            })
          : undefined
        if (!committed || !prefix)
          throw new Error('semantic audit immutable inputs are unavailable')
        const packet = await buildSemanticPacketFor({
          workspacePath: input.workspacePath,
          revision: lockedState.revision,
          checkId: lockedTask.checkId,
          sectionIndex: committed.sectionIndex,
          factStore: committed.factStore,
          deterministicReviewDigest: prefix.reviewDigest,
          deterministicIssuePrefix: prefix.issues,
          documentDigests: committed.documentDigests,
        })
        if (packet.identity !== lockedTask.packetDigest)
          throw new Error(
            'semantic packet digest changed during terminal admission',
          )
        if (
          !record.usage ||
          !Number.isFinite(record.usage.total_tokens) ||
          !Number.isFinite(record.usage.input_tokens) ||
          !Number.isFinite(record.usage.completion_tokens) ||
          record.usage.total_tokens < 0 ||
          record.usage.input_tokens < 0 ||
          record.usage.completion_tokens < 0 ||
          !record.finishedAt ||
          !Number.isFinite(Date.parse(record.startedAt)) ||
          !Number.isFinite(Date.parse(record.finishedAt))
        )
          throw new Error(
            'semantic terminal is missing measured usage or duration',
          )
        const admitted = admitFoundationSemanticResult(packet, {
          checkId: lockedTask.checkId,
          packetIdentity: packet.identity,
          outcome: result.outcome,
          ...(result.issues !== undefined ? { issues: result.issues } : {}),
          ...(result.reason !== undefined ? { reason: result.reason } : {}),
        })
        const runtimeState: FoundationSemanticTaskCollection = {
          revision: lockedState.revision,
          phaseStartedAt: lockedState.phaseStartedAt!,
          status: 'semantic_review',
          tasks: lockedState.tasks.filter(
            task => task.kind === 'semantic' || task.kind === 'confirmation',
          ) as FoundationSemanticTaskCollection['tasks'],
          aggregateUsage: lockedState.semantic?.aggregateUsage ?? {
            input_tokens: 0,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
          ...(lockedState.semantic?.deepPhaseStartedAt
            ? { deepPhaseStartedAt: lockedState.semantic.deepPhaseStartedAt }
            : {}),
          ...(lockedState.semantic?.deepAggregateUsage
            ? { deepAggregateUsage: lockedState.semantic.deepAggregateUsage }
            : {}),
        }
        const admission = admitFoundationSemanticTerminal(runtimeState, {
          taskId: lockedTask.taskId,
          dispatchId: record.dispatchId,
          revision: result.revision,
          packetDigest: result.packetDigest,
          terminal: result as never,
          usage: record.usage,
          durationMs:
            Date.parse(record.finishedAt) - Date.parse(record.startedAt),
          now: new Date().toISOString(),
        })
        let tasks = admission.state.tasks.map(task =>
          task.taskId === lockedTask.taskId
            ? projectTaskTerminalEvidence(
                {
                  ...task,
                  ...(admission.accepted ? { admittedResult: admitted } : {}),
                },
                record,
              )
            : task,
        )
        let semanticState = {
          aggregateUsage: admission.state.aggregateUsage,
          ...(admission.state.deepPhaseStartedAt
            ? { deepPhaseStartedAt: admission.state.deepPhaseStartedAt }
            : {}),
          ...(admission.state.deepAggregateUsage
            ? { deepAggregateUsage: admission.state.deepAggregateUsage }
            : {}),
        }
        if (
          admission.accepted &&
          !admission.idempotent &&
          lockedTask.kind === 'semantic' &&
          (admitted.outcome === 'UNDECIDABLE' ||
            FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.find(
              check => check.checkId === lockedTask.checkId,
            )?.severity === 'BLOCKER')
        ) {
          const confirmation = appendFoundationConfirmationTask(
            {
              ...admission.state,
              tasks: tasks as FoundationSemanticTaskCollection['tasks'],
            },
            {
              taskId: `${lockedTask.taskId}:confirmation`,
              sourceTaskId: lockedTask.taskId,
              admittedResult: admitted,
              now: new Date().toISOString(),
            },
          )
          tasks = confirmation.tasks.map(task =>
            task.taskId === lockedTask.taskId
              ? { ...task, admittedResult: admitted }
              : task,
          )
          semanticState = {
            aggregateUsage: confirmation.aggregateUsage,
            ...(confirmation.deepPhaseStartedAt
              ? { deepPhaseStartedAt: confirmation.deepPhaseStartedAt }
              : {}),
            ...(confirmation.deepAggregateUsage
              ? { deepAggregateUsage: confirmation.deepAggregateUsage }
              : {}),
          }
        }
        const finalTaskState = {
          ...lockedState,
          status: 'semantic_review' as const,
          tasks,
          semantic: semanticState,
        }
        const hasNeedsAction =
          tasks.some(task => task.status === 'needs_action') ||
          (admitted.outcome === 'UNDECIDABLE' &&
            lockedTask.kind === 'confirmation')
        const runStatus: DeliveryRun['status'] = hasNeedsAction
          ? 'needs_action'
          : 'running'
        completedRun = await store.commit(
          {
            ...locked,
            foundationAuditState: finalTaskState,
            status: runStatus,
            blockedReason: hasNeedsAction
              ? 'semantic audit needs action'
              : undefined,
            thinking: hasNeedsAction ? 'idle' : 'working',
          },
          {
            runId: locked.runId,
            type: admission.idempotent
              ? 'foundation.semantic.terminal.replayed'
              : 'foundation.semantic.terminal.admitted',
            phase: locked.phase,
            status: runStatus,
            revision: locked.revision,
            dispatchId: record.dispatchId,
            taskId: lockedTask.taskId,
            terminalDigest: admission.terminalDigest,
          },
          undefined,
          lease,
        )
      } finally {
        await store.unlock(lease)
      }
      if (
        completedRun &&
        completedRun.status === 'running' &&
        completedRun.foundationAuditState &&
        foundationSemanticTasksComplete({
          revision: completedRun.foundationAuditState.revision,
          phaseStartedAt: completedRun.foundationAuditState.phaseStartedAt!,
          status: 'semantic_review',
          tasks: foundationRuntimeTasks(
            completedRun.foundationAuditState,
          ).filter(
            task => task.kind === 'semantic' || task.kind === 'confirmation',
          ) as FoundationSemanticTaskCollection['tasks'],
          aggregateUsage: completedRun.foundationAuditState.semantic
            ?.aggregateUsage ?? {
            input_tokens: 0,
            cache_read_tokens: 0,
            completion_tokens: 0,
            cache_creation_tokens: 0,
            total_tokens: 0,
          },
          ...(completedRun.foundationAuditState.semantic?.deepPhaseStartedAt
            ? {
                deepPhaseStartedAt:
                  completedRun.foundationAuditState.semantic.deepPhaseStartedAt,
              }
            : {}),
          ...(completedRun.foundationAuditState.semantic?.deepAggregateUsage
            ? {
                deepAggregateUsage:
                  completedRun.foundationAuditState.semantic.deepAggregateUsage,
              }
            : {}),
        })
      )
        await finalizeFoundationSemanticReview(completedRun)
      else if (completedRun?.status === 'running')
        await resumeUnlocked(completedRun)
      return
    }
    if (
      foundationFactTask &&
      result.workerType === 'foundation-fact-extractor'
    ) {
      const lease = await store.mutationLock(run.runId)
      let factsStagedRun: DeliveryRun | undefined
      try {
        const locked = await store.load(lease)
        const lockedTask =
          locked?.foundationAuditState &&
          foundationRuntimeTasks(locked.foundationAuditState).find(
            task => task.taskId === foundationFactTask.taskId,
          )
        if (
          !locked ||
          !lockedTask ||
          !lockedTask.dispatch ||
          lockedTask.dispatch.dispatchId !== record.dispatchId
        )
          return
        if (lockedTask.kind !== 'document-facts')
          throw new Error('foundation fact terminal reached a non-fact task')
        const lockedState = locked.foundationAuditState!
        if (lockedTask.status === 'completed') {
          if (
            lockedTask.terminalDigest !==
            digestFoundationFactTerminal(result as never)
          )
            throw new Error('conflicting foundation fact terminal replay')
          if (lockedState.status === 'facts_staged') factsStagedRun = locked
        } else {
          const packet = request?.contract.packet
          if (!packet || typeof packet !== 'object')
            throw new Error(
              'foundation fact packet is missing from dispatch contract',
            )
          const artifacts = await loadFoundationAuditArtifacts({
            workspacePath: input.workspacePath,
            revision: locked.revision.document,
            expectedState: locked.foundationAuditState,
          })
          if (!artifacts)
            throw new Error('foundation fact section index is unavailable')
          const documents = new Map(
            await Promise.all(
              CANONICAL_FOUNDATION_DOCUMENTS.map(
                async path =>
                  [
                    path,
                    await readFile(join(input.workspacePath, path), 'utf8'),
                  ] as const,
              ),
            ),
          )
          let validated: ReturnType<typeof validateFoundationFactResults>
          try {
            if (
              !Array.isArray((packet as { keys?: unknown }).keys) ||
              (packet as { keys: unknown[] }).keys.length !==
                lockedTask.factKeyCount
            )
              throw new Error(
                'foundation fact task key count does not match its immutable packet',
              )
            validated = validateFoundationFactResults({
              packet: packet as never,
              expectedRevision: lockedTask.revision,
              documents,
              sectionIndex: artifacts.sectionIndex,
              results: result.results as never,
            })
          } catch (error) {
            const invalid = new Error(
              error instanceof Error
                ? error.message
                : 'foundation fact result is invalid',
            )
            invalid.name = 'FoundationFactInvalidResultError'
            throw invalid
          }
          const runtimeState: FoundationFactTaskCollection = {
            revision: lockedState.revision,
            phaseStartedAt: lockedState.phaseStartedAt!,
            status:
              lockedState.status === 'facts_staged'
                ? 'facts_staged'
                : 'extracting_facts',
            tasks: lockedState.tasks.filter(
              task => task.kind === 'document-facts',
            ),
            aggregateUsage: lockedState.aggregateUsage ?? {
              input_tokens: 0,
              cache_read_tokens: 0,
              cache_creation_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
            },
          }
          const admission = admitFoundationFactTerminal(runtimeState, {
            taskId: lockedTask.taskId,
            dispatchId: record.dispatchId,
            revision: result.revision,
            packetDigest: result.packetDigest,
            terminal: result,
            usage: record.usage ?? {
              input_tokens: 0,
              cache_read_tokens: 0,
              cache_creation_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
            },
            durationMs: Math.max(
              0,
              Date.parse(record.finishedAt ?? new Date().toISOString()) -
                Date.parse(record.startedAt),
            ),
            now: new Date().toISOString(),
          })
          let auditState: FoundationAuditState = {
            ...lockedState,
            status: admission.state.status,
            tasks: admission.state.tasks.map(task =>
              task.taskId === lockedTask.taskId
                ? projectTaskTerminalEvidence(task, record)
                : task,
            ),
            aggregateUsage: admission.state.aggregateUsage,
          }
          const admittedTask = admission.state.tasks.find(
            task => task.taskId === lockedTask.taskId,
          )!
          if (admission.accepted && !admission.idempotent) {
            const receipt = await writeFoundationFactReceipt({
              workspacePath: input.workspacePath,
              revision: lockedTask.revision,
              receipt: {
                taskId: lockedTask.taskId,
                revision: lockedTask.revision,
                packetDigest: lockedTask.packetDigest,
                terminalDigest: admission.terminalDigest,
                normalizedFactDigest: validated.normalizedFactDigest,
                receipts: validated.receipts,
                facts: validated.facts,
                usage: admittedTask.usage,
                durationMs: admittedTask.durationMs ?? 0,
              },
            })
            auditState = {
              ...auditState,
              tasks: auditState.tasks.map(task =>
                task.taskId === lockedTask.taskId
                  ? {
                      ...task,
                      receiptPath: receipt.path,
                      receiptDigest: receipt.digest,
                    }
                  : task,
              ),
            }
          }
          const collectionAfterReceipt: FoundationFactTaskCollection = {
            ...admission.state,
            tasks: auditState.tasks.filter(
              task => task.kind === 'document-facts',
            ),
          }
          if (foundationFactTasksComplete(collectionAfterReceipt)) {
            auditState = { ...auditState, status: 'facts_staged' }
            factsStagedRun = await store.commit(
              {
                ...locked,
                foundationAuditState: auditState,
                status: 'running',
                blockedReason: undefined,
                thinking: 'working',
              },
              {
                runId: locked.runId,
                type: 'foundation.fact.facts_staged',
                phase: locked.phase,
                status: 'running',
                revision: locked.revision,
                dispatchId: record.dispatchId,
                taskId: lockedTask.taskId,
                terminalDigest: admission.terminalDigest,
              },
              undefined,
              lease,
            )
          } else {
            const status: DeliveryRun['status'] = auditState.tasks.some(
              task => task.status === 'needs_action',
            )
              ? 'needs_action'
              : 'running'
            await store.commit(
              {
                ...locked,
                foundationAuditState: auditState,
                status,
                blockedReason:
                  status === 'needs_action'
                    ? 'foundation fact extraction needs action'
                    : undefined,
                thinking: status === 'running' ? 'working' : 'idle',
              },
              {
                runId: locked.runId,
                type: admission.idempotent
                  ? 'foundation.fact.terminal.replayed'
                  : 'foundation.fact.terminal.admitted',
                phase: locked.phase,
                status,
                revision: locked.revision,
                dispatchId: record.dispatchId,
                taskId: lockedTask.taskId,
                terminalDigest: admission.terminalDigest,
              },
              undefined,
              lease,
            )
          }
        }
      } finally {
        await store.unlock(lease)
      }
      if (factsStagedRun) {
        try {
          await finalizeFoundationFacts(factsStagedRun)
        } catch (error) {
          await failFoundationContinuation(factsStagedRun, error)
        }
      } else {
        const current = await store.load()
        if (current?.status === 'running') await resumeUnlocked(current)
      }
      return
    }
    let next: DeliveryRun = foundationCheckpoint
      ? { ...run, activeDispatch: record }
      : { ...run, activeDispatch: undefined }
    if (result.workerType === 'change-impact-analyzer') {
      const message =
        typeof request?.contract.message === 'string'
          ? request.contract.message
          : ''
      const persistedChange = await createChangeRequest({
        store,
        run,
        message,
        impactResult: result,
      })
      next = {
        ...next,
        changeRequest: message,
        changeRoute: persistedChange.route,
        changeAffectedRequirementIds: persistedChange.affectedRequirementIds,
        changeAffectedChecklistIds: persistedChange.affectedChecklistIds,
        changeRationale: persistedChange.rationale,
      }
      if (result.classification === 'question') {
        await persist(next, 'change.question')
        await dispatcher.dispatch({
          ...buildQuestionAnswerDispatch(next, input.workspacePath, message),
          phase: next.phase,
        })
        return
      }
      const continued: DeliveryRun = {
        ...next,
        ...(run.confirmedBriefContext
          ? { confirmedBriefContext: run.confirmedBriefContext }
          : {}),
        changeRequest: message,
        changeRoute: result.classification,
        changeAffectedRequirementIds: result.affectedRequirementIds,
        changeAffectedChecklistIds: result.affectedChecklistIds,
        changeRationale: result.rationale,
        phase:
          result.classification === 'documents_required'
            ? 'DOCUMENT_DRAFTING'
            : 'ATOMIC_TASK_PLANNING',
        documentStep:
          result.classification === 'documents_required'
            ? 'FOUNDATION_DRAFTING'
            : undefined,
        status: 'running',
        revision: {
          ...next.revision,
          document:
            result.classification === 'documents_required'
              ? 'uncomputed'
              : next.revision.document,
        },
        tasks:
          result.classification === 'documents_required'
            ? []
            : next.tasks.map(task => ({
                ...task,
                status: 'pending',
                attempt: 0,
                evidenceRefs: [],
                startedRevision: undefined,
                completedRevision: undefined,
              })),
        evidence:
          result.classification === 'documents_required'
            ? {}
            : {
                resourcePreparation: next.evidence.resourcePreparation,
              },
        foundationDraftState:
          result.classification === 'documents_required'
            ? { completedPaths: [] }
            : next.foundationDraftState,
        foundationAuditState:
          result.classification === 'documents_required'
            ? undefined
            : next.foundationAuditState,
        resourceProductionState:
          result.classification === 'documents_required'
            ? { currentTask: 'RESOURCE_PLAN' }
            : next.resourceProductionState,
        blockedReason: undefined,
      }
      // A change is a new revision of the same delivery run. Creating a child
      // run made the dashboard show two competing workflows and doubled the
      // token/dispatch accounting. Keep one durable run and append the change
      // to its event journal instead.
      await persist(continued, 'change.impact_applied')
      await resumeUnlocked(continued)
      return
    }
    if (result.workerType === 'question-answerer') {
      const saved = await persist(
        {
          ...next,
          status: 'completed',
          lastAnswer: result.answer,
          changeRequest: undefined,
          changeRoute: undefined,
          changeAffectedRequirementIds: undefined,
          changeAffectedChecklistIds: undefined,
          changeRationale: undefined,
          blockedReason: undefined,
        },
        'question.answered',
      )
      await store.appendEvent({
        runId: saved.runId,
        type: 'question.answer',
        phase: saved.phase,
        status: saved.status,
        revision: saved.revision,
        answer: result.answer,
      })
      return
    }
    if (result.workerType === 'document-author') {
      const documentSet =
        request?.contract.documentSet === 'checklist'
          ? 'checklist'
          : 'foundation'
      next = await completeDocumentDraft({
        run: {
          ...next,
          activeDispatch: record,
          phase:
            documentSet === 'checklist'
              ? 'DOCUMENT_REVIEW'
              : 'DOCUMENT_DRAFTING',
        },
        workspacePath: input.workspacePath,
        terminal: result,
        documentSet,
      })
      if (documentSet === 'foundation' && canStartFoundationAudit(next))
        next = await deriveFoundationAudit(next, input.workspacePath)
      if (
        documentSet !== 'foundation' &&
        next.blockedReason &&
        next.status === 'running'
      ) {
        next = {
          ...next,
          status: 'needs_action',
          blockedReason: next.blockedReason ?? 'document bundle is incomplete',
        }
      }
      await persist(
        next,
        next.status === 'running'
          ? 'phase.entered'
          : 'document.draft.incomplete',
      )
      await resumeUnlocked(next)
      return
    }
    if (
      result.workerType === 'resource-planner' ||
      result.workerType === 'resource-curator' ||
      result.workerType === 'resource-content-author'
    ) {
      if (await documentRevisionChanged(next)) {
        await restartDocumentStage(
          next,
          'canonical documents changed during resource preparation; document review and downstream work must be rerun',
        )
        return
      }
      next = await completeResourceTask({
        run: next,
        workspacePath: input.workspacePath,
        terminal: result,
      })
      next = await persist(
        next,
        next.phase === 'RESOURCE_PREPARATION' && next.status === 'running'
          ? 'resource.preparation.progressed'
          : next.phase === 'DOCUMENT_REVIEW'
            ? 'resource.preparation.ready'
            : 'resource.preparation.needs_action',
      )
      await resumeUnlocked(next)
      return
    }
    if (result.workerType === 'atomic-task-planner') {
      if (await documentRevisionChanged(next)) {
        await restartDocumentStage(
          next,
          'canonical documents changed before atomic task planning; document review and downstream work must be rerun',
        )
        return
      }
      if (
        resourcePreparationMissing(next) ||
        (await resourceRevisionChanged(next))
      ) {
        await restartResourcePreparation(
          next,
          'approved resources changed before atomic task planning; resource preparation must be rerun',
        )
        return
      }
      next = applyAtomicTaskPlan({
        run: { ...next, phase: 'ATOMIC_TASK_PLANNING' },
        terminal: result,
        facts: await contractFactsFor(next),
        workspacePath: input.workspacePath,
      })
      await persist(next, 'tasks.planned', { taskGraph: next.tasks })
      await startNextImplementationTask({
        run: next,
        workspacePath: input.workspacePath,
        revision: next.revision.workspace,
        dispatcher,
        beforeDispatch: started =>
          persist(started, 'task.started').then(() => undefined),
      })
      return
    }
    if (result.workerType === 'implementation-worker') {
      if (await documentRevisionChanged(next)) {
        await restartDocumentStage(
          next,
          'canonical documents changed during implementation; document review and downstream work must be rerun',
        )
        return
      }
      if (
        resourcePreparationMissing(next) ||
        (await resourceRevisionChanged(next))
      ) {
        await restartResourcePreparation(
          next,
          'resource preparation is missing or approved resources changed during implementation; resource preparation and task planning must be rerun',
        )
        return
      }
      if (
        result.status === 'completed' &&
        result.changedPaths.some(path => isCanonicalDocumentPath(path))
      ) {
        await restartDocumentStage(
          next,
          'implementation changed a canonical document; document review and downstream work must be rerun',
        )
        return
      }
      const activeTask = next.tasks.find(task => task.id === record.taskId)
      let completionFailureReason: string | undefined
      if (result.status === 'completed' && activeTask) {
        completionFailureReason = implementationCompletionIssue({
          task: activeTask,
          workspacePath: input.workspacePath,
          terminal: result,
        })
      }
      const currentRevision = await computeWorkspaceRevision(
        input.workspacePath,
      )
      next = completeImplementationTask({
        run: { ...next, phase: 'IMPLEMENTATION', activeTaskId: record.taskId },
        workspacePath: input.workspacePath,
        terminal: result,
        currentRevision,
        ...(completionFailureReason ? { completionFailureReason } : {}),
      })
      await persist(
        next,
        next.status === 'failed' ? 'task.failed' : 'task.completed',
      )
      if (next.status !== 'running') return
      if (next.tasks.every(task => task.status === 'completed')) {
        const auditFacts = await contractFactsFor(next)
        if (!auditFacts.resourceReadiness.ready) {
          await persist(
            resourceDeliveryBlocked(next, auditFacts.resourceReadiness),
            'resource.delivery.needs_action',
          )
          return
        }
        next = await persist(enterImplementationAudit(next), 'phase.entered')
        await startImplementationAudit({
          run: next,
          workspacePath: input.workspacePath,
          dispatcher,
          expectedChecklistIds: auditFacts.checklistIds,
          expectedResourceIds: auditFacts.resourceIds,
          expectedContentIds: auditFacts.contentIds,
          resourceReadiness: auditFacts.resourceReadiness,
        })
      } else {
        await startNextImplementationTask({
          run: next,
          workspacePath: input.workspacePath,
          revision: next.revision.workspace,
          dispatcher,
          beforeDispatch: started =>
            persist(started, 'task.started').then(() => undefined),
        })
      }
      return
    }
    if (result.workerType === 'implementation-auditor') {
      if (await documentRevisionChanged(next)) {
        await restartDocumentStage(
          next,
          'canonical documents changed before implementation audit; document review and downstream work must be rerun',
        )
        return
      }
      if (
        resourcePreparationMissing(next) ||
        (await resourceRevisionChanged(next))
      ) {
        await restartResourcePreparation(
          next,
          'resource preparation is missing or approved resources changed before implementation audit; resource preparation and task planning must be rerun',
        )
        return
      }
      const auditFacts = await contractFactsFor(next)
      next = reconcileImplementationAudit({
        run: { ...next, phase: 'IMPLEMENTATION_AUDIT' },
        workspacePath: input.workspacePath,
        terminal: result,
        expectedChecklistIds: auditFacts.checklistIds,
        expectedResourceIds: auditFacts.resourceIds,
        expectedContentIds: auditFacts.contentIds,
        currentImplementationRevision: await computeWorkspaceRevision(
          input.workspacePath,
        ),
      })
      if (result.status !== 'passed') {
        if (result.status === 'blocked') {
          await persist(next, 'implementation.audit.reconciled', {
            findings: result.findings,
          })
          return
        }
        if (findingsRequireTaskReplan(next, result.findings)) {
          await restartAtomicTaskPlanning(
            next,
            'implementation audit found required artifacts outside every existing task scope; the atomic task graph must be rebuilt',
          )
          return
        }
        const invalidatedTaskIds = affectedImplementationTaskIds(
          next,
          result.findings,
        )
        next = resetImplementationTasks(next, invalidatedTaskIds)
        await persist(next, 'implementation.audit.remediation_planned', {
          findings: result.findings,
          invalidatedTaskIds,
        })
        await startNextImplementationTask({
          run: next,
          workspacePath: input.workspacePath,
          revision: next.revision.workspace,
          dispatcher,
          beforeDispatch: started =>
            persist(started, 'task.started').then(() => undefined),
        })
        return
      }
      await persist(next, 'implementation.audit.reconciled')
      const acceptanceFacts = await contractFactsFor(next)
      await startAcceptance({
        run: next,
        workspacePath: input.workspacePath,
        dispatcher,
        expectedChecklistIds: acceptanceFacts.checklistIds,
        expectedResourceIds: acceptanceFacts.resourceIds,
        expectedContentIds: acceptanceFacts.contentIds,
        currentImplementationRevision:
          next.revision.implementation ?? next.revision.workspace,
      })
      return
    }
    if (result.workerType === 'acceptance-validator') {
      if (await documentRevisionChanged(next)) {
        await restartDocumentStage(
          next,
          'canonical documents changed before acceptance; document review and downstream work must be rerun',
        )
        return
      }
      if (
        resourcePreparationMissing(next) ||
        (await resourceRevisionChanged(next))
      ) {
        await restartResourcePreparation(
          next,
          'resource preparation is missing or approved resources changed before acceptance; resource preparation and task planning must be rerun',
        )
        return
      }
      const acceptanceFacts = await contractFactsFor(next)
      next = await reconcileAcceptance({
        run: { ...next, phase: 'ACCEPTANCE' },
        workspacePath: input.workspacePath,
        terminal: result,
        expectedChecklistIds: acceptanceFacts.checklistIds,
        expectedResourceIds: acceptanceFacts.resourceIds,
        expectedContentIds: acceptanceFacts.contentIds,
        currentImplementationRevision: await computeWorkspaceRevision(
          input.workspacePath,
        ),
      })
      if (next.phase === 'DELIVERY')
        next = transitionDeliveryRun(next, { type: 'delivery_completed' })
      if (result.status === 'failed') {
        if (findingsRequireTaskReplan(next, result.findings)) {
          await restartAtomicTaskPlanning(
            next,
            'acceptance found required artifacts outside every existing task scope; the atomic task graph must be rebuilt',
          )
          return
        }
        const invalidatedTaskIds = affectedImplementationTaskIds(
          next,
          result.findings,
        )
        next = resetImplementationTasks(next, invalidatedTaskIds)
        await persist(next, 'acceptance.remediation_planned', {
          findings: result.findings,
          invalidatedTaskIds,
        })
        await startNextImplementationTask({
          run: next,
          workspacePath: input.workspacePath,
          revision: next.revision.workspace,
          dispatcher,
          beforeDispatch: started =>
            persist(started, 'task.started').then(() => undefined),
        })
      } else {
        await persist(
          next,
          next.status === 'completed'
            ? 'run.completed'
            : 'acceptance.reconciled',
        )
      }
    }
  }

  function affectedImplementationTaskIds(
    run: DeliveryRun,
    findings: Array<{ taskIds: string[] }>,
  ): string[] {
    const affected = new Set(findings.flatMap(finding => finding.taskIds))
    let changed = true
    while (changed) {
      changed = false
      for (const task of run.tasks) {
        if (
          !affected.has(task.id) &&
          task.dependsOn.some(dependencyId => affected.has(dependencyId))
        ) {
          affected.add(task.id)
          changed = true
        }
      }
    }
    return run.tasks.map(task => task.id).filter(taskId => affected.has(taskId))
  }

  function findingsRequireTaskReplan(
    run: DeliveryRun,
    findings: Array<{ artifactPaths: string[] }>,
  ): boolean {
    return findings.some(finding =>
      finding.artifactPaths.some(
        artifactPath =>
          !run.tasks.some(task =>
            task.allowedPaths.some(scope => {
              const normalizedArtifact = normalizeTaskPath(artifactPath)
              const normalizedScope = normalizeTaskPath(scope)
              return (
                normalizedArtifact === normalizedScope ||
                normalizedArtifact.startsWith(`${normalizedScope}/`)
              )
            }),
          ),
      ),
    )
  }

  function normalizeTaskPath(path: string): string {
    let normalized = path.replaceAll('\\', '/')
    while (normalized.startsWith('./')) normalized = normalized.slice(2)
    while (normalized.endsWith('/')) normalized = normalized.slice(0, -1)
    return normalized
  }

  function resetImplementationTasks(
    run: DeliveryRun,
    invalidatedTaskIds: string[],
  ): DeliveryRun {
    const invalidated = new Set(invalidatedTaskIds)
    return {
      ...run,
      phase: 'IMPLEMENTATION',
      status: 'running',
      activeTaskId: undefined,
      activeDispatch: undefined,
      blockedReason: undefined,
      revision: { ...run.revision, implementation: undefined },
      evidence: {
        ...run.evidence,
        implementationAudit: undefined,
        acceptance: undefined,
      },
      tasks: run.tasks.map(task =>
        invalidated.has(task.id)
          ? {
              ...task,
              status: 'pending',
              startedRevision: undefined,
              completedRevision: undefined,
              evidenceRefs: [],
            }
          : task,
      ),
    }
  }

  function resourceDeliveryBlocked(
    run: DeliveryRun,
    readiness: ResourceDeliveryReadiness,
  ): DeliveryRun {
    return {
      ...run,
      status: 'needs_action',
      activeDispatch: undefined,
      blockedReason: [...readiness.issues, ...readiness.readinessIssues].join(
        '; ',
      ),
      updatedAt: new Date().toISOString(),
    }
  }

  async function resourceRevisionChanged(run: DeliveryRun): Promise<boolean> {
    if (!run.revision.resource) return false
    const current = await computeResourceRevision(
      input.workspacePath,
      run.revision.document,
    )
    return current !== run.revision.resource
  }

  async function documentRevisionChanged(run: DeliveryRun): Promise<boolean> {
    const current = await computeDocumentRevision(
      input.workspacePath,
      run.confirmedBriefDigest,
    )
    return current !== run.revision.document
  }

  function resourcePreparationMissing(run: DeliveryRun): boolean {
    const evidence = run.evidence.resourcePreparation
    return (
      !run.revision.resource ||
      evidence?.status !== 'passed' ||
      evidence.revision !== run.revision.resource
    )
  }

  async function restartResourcePreparation(
    run: DeliveryRun,
    reason: string,
  ): Promise<void> {
    const invalidated = transitionDeliveryRun(run, {
      type: 'resource_preparation_required',
      reason,
    })
    const saved = await persist(invalidated, 'resource.revision.invalidated')
    await resumeUnlocked(saved)
  }

  async function restartDocumentStage(
    run: DeliveryRun,
    reason: string,
  ): Promise<void> {
    const documentRevision = await computeDocumentRevision(
      input.workspacePath,
      run.confirmedBriefDigest,
    )
    const workspaceRevision = await computeWorkspaceRevision(
      input.workspacePath,
    )
    const invalidated: DeliveryRun = {
      ...run,
      phase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      status: 'running',
      activeTaskId: undefined,
      activeDispatch: undefined,
      blockedReason: reason,
      revision: {
        ...run.revision,
        document: documentRevision,
        resource: undefined,
        implementation: undefined,
        workspace: workspaceRevision,
      },
      tasks: [],
      evidence: {},
      foundationDraftState: { completedPaths: [] },
      foundationAuditState: undefined,
      resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
    }
    await persist(invalidated, 'document.revision.invalidated')
    await startDocumentStage({
      run: invalidated,
      workspacePath: input.workspacePath,
      dispatcher,
    })
  }

  async function restartAtomicTaskPlanning(
    run: DeliveryRun,
    reason: string,
  ): Promise<void> {
    const invalidated: DeliveryRun = {
      ...run,
      phase: 'ATOMIC_TASK_PLANNING',
      status: 'running',
      activeTaskId: undefined,
      activeDispatch: undefined,
      blockedReason: reason,
      revision: { ...run.revision, implementation: undefined },
      tasks: [],
      evidence: {
        ...run.evidence,
        implementationAudit: undefined,
        acceptance: undefined,
      },
    }
    await persist(invalidated, 'atomic.task.plan.invalidated')
    await resumeUnlocked(invalidated)
  }

  async function materializeFoundationRevisionPlanning(
    run: DeliveryRun,
  ): Promise<void> {
    const state = run.foundationAuditState
    if (!state || state.status !== 'planning') return
    if (!state.authority || state.round === undefined || !state.roundBefore)
      throw new Error('foundation revision planning metadata is incomplete')
    const committed = await loadCommittedFoundationDerivedArtifacts({
      workspacePath: input.workspacePath,
      revision: state.revision,
    })
    if (!committed)
      throw new Error(
        'foundation revision planning derived authority is unavailable',
      )
    await assertBoundRevisionContext(state, committed)
    let issues: AuditIssue[]
    let sourceAuthorityDigest: string
    if (state.authority!.issueAuthority.kind === 'review') {
      const review = await loadFoundationSemanticReview({
        workspacePath: input.workspacePath,
        revision: state.revision,
        reviewDigest: state.authority!.issueAuthority.reviewDigest,
      })
      if (
        !review ||
        review.revision !== state.revision ||
        review.digests.issueRegistry !==
          state.authority!.issueAuthority.issueRegistryDigest ||
        review.sectionIndexDigest !==
          state.authority!.derivedDigests.sectionIndex ||
        review.factStoreDigest !== state.authority!.derivedDigests.factStore ||
        !sameDocumentDigests(
          review.documentDigests,
          state.authority!.documentDigests,
        )
      ) {
        throw new Error('foundation revision review authority binding is stale')
      }
      issues = review.issues
      sourceAuthorityDigest = review.reviewDigest
    } else {
      const publication = await loadCommittedFoundationRevisionAuthority({
        workspacePath: input.workspacePath,
        revision: state.authority!.issueAuthority.baseRevision,
      })
      if (
        publication.resultingRevision !== state.revision ||
        publication.authorityDigest !==
          state.authority!.issueAuthority.authorityDigest ||
        publication.resultingIssueRegistryDigest !==
          state.authority!.issueAuthority.issueRegistryDigest ||
        !sameDocumentDigests(
          Object.entries(publication.documentDigests).map(([path, digest]) => ({
            path,
            digest,
          })),
          state.authority!.documentDigests,
        )
      )
        throw new Error(
          'foundation revision publication authority binding is stale',
        )
      issues = [...publication.resultingIssues]
      sourceAuthorityDigest = publication.authorityDigest
    }
    const policy = evaluateFoundationRevisionRoundPolicy({
      phase: 'plan',
      round: state.round!,
      issues,
    })
    if (policy.status !== 'repair') {
      if (policy.status === 'proceed') {
        const lease = await store.mutationLock(run.runId)
        try {
          const locked = await store.load(lease)
          if (locked?.foundationAuditState?.status === 'planning')
            await store.commit(
              {
                ...locked,
                status: 'needs_action',
                blockedReason:
                  'foundation revision planning authority changed before repair tasks were admitted',
              },
              {
                runId: locked.runId,
                type: 'foundation.revision.planning.drift',
                phase: locked.phase,
                status: 'needs_action',
                revision: locked.revision,
              },
              undefined,
              lease,
            )
        } finally {
          await store.unlock(lease)
        }
      }
      return
    }
    const batches = buildFoundationRevisionBatches({
      issues: issues.filter(issue => policy.repairIssueIds.includes(issue.id)),
      registry: {
        validated: true as const,
        section(documentPath: string, sectionId: string) {
          return committed.sectionIndex.find(
            section =>
              section.documentPath === documentPath &&
              section.sectionId === sectionId,
          )
        },
      },
    })
    const remediationDigest = revisionBundleDigest({
      round: state.round,
      issueRegistryDigest: state.authority!.issueAuthority.issueRegistryDigest,
      issues: issues.filter(issue => policy.repairIssueIds.includes(issue.id)),
    })
    const bundleId = `${state.revision}.bundle.${state.round}.${remediationDigest.slice(0, 16)}`
    const tasks = await Promise.all(
      batches.map(async (batch, index) => {
        const taskId = `${bundleId}.task.${index}`
        const authority = await buildFoundationRevisionAuthority({
          workspacePath: input.workspacePath,
          revision: state.revision,
          taskId,
          round: state.round!,
          batch,
          issues: issues.filter(issue => batch.issueIds.includes(issue.id)),
          sourceAuthorityDigest,
          sourceIssueRegistryDigest:
            state.authority!.issueAuthority.issueRegistryDigest,
          sourceDerivedDigests: state.authority!.derivedDigests,
          sourceDocumentDigests: state.authority!.documentDigests,
          normalizedFacts: committed.factStore,
        })
        const packetPath = await writeFoundationRevisionPacket({
          workspacePath: input.workspacePath,
          revision: state.revision,
          round: state.round!,
          taskId,
          documentPath: batch.documentPath,
          packet: authority.packet,
          packetDigest: authority.packetDigest,
        })
        await createFoundationRevisionStage({
          workspacePath: input.workspacePath,
          revision: state.revision,
          documentPath: batch.documentPath,
          expectedBaseDocumentDigest: authority.baseDocumentDigest,
        })
        const dependencyDigests = Object.fromEntries(
          [
            ...new Set(
              issues
                .filter(issue => batch.issueIds.includes(issue.id))
                .flatMap(issue =>
                  [issue.source, ...(issue.target ? [issue.target] : [])]
                    .filter(ref => ref.documentPath === batch.documentPath)
                    .map(ref => `${ref.documentPath}#${ref.sectionId}`),
                ),
            ),
          ]
            .map(key => [
              key,
              committed.sectionIndex.find(
                ref => `${ref.documentPath}#${ref.sectionId}` === key,
              )?.digest,
            ])
            .filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === 'string',
            ),
        )
        return {
          taskId,
          kind: 'document-revision' as const,
          revision: state.revision,
          round: state.round!,
          packetPath,
          packetDigest: authority.packetDigest,
          status: 'pending' as const,
          attempt: 0,
          documentPath: batch.documentPath,
          issueIds: batch.issueIds,
          sectionIds: batch.sectionIds,
          stagedPath: authority.stagedPath,
          baseDocumentDigest: authority.baseDocumentDigest,
          dependencyDigests,
          bundleId,
          frozen: false,
        }
      }),
    )
    const lease = await store.mutationLock(run.runId)
    let next: DeliveryRun | undefined
    try {
      const locked = await store.load(lease)
      if (locked?.foundationAuditState?.status === 'planning') {
        try {
          const bundle = {
            bundleId,
            status: 'active' as const,
            round: state.round!,
            baseDocumentRevision: state.revision,
            baseDocumentDigests: state.authority!.documentDigests,
            remediationDigest,
            taskIds: tasks.map(task => task.taskId),
            frozenTaskIds: [] as string[],
          }
          const previousBundles =
            locked.foundationAuditState.revisionBundles ?? []
          next = await store.commit(
            {
              ...locked,
              foundationAuditState: {
                ...locked.foundationAuditState,
                status: 'revising',
                tasks,
                activeBundleId: bundleId,
                revisionBundles: [...previousBundles, bundle],
              },
            },
            {
              runId: locked.runId,
              type: 'foundation.revision.revising',
              phase: locked.phase,
              status: 'running',
              revision: locked.revision,
            },
            undefined,
            lease,
          )
        } catch (error) {
          markRevisionCommitTransient(error)
        }
      }
    } finally {
      await store.unlock(lease)
    }
    if (next) await resumeUnlocked(next)
  }

  async function assertBoundRevisionContext(
    state: FoundationAuditState,
    committed: Awaited<
      ReturnType<typeof loadCommittedFoundationDerivedArtifacts>
    >,
  ): Promise<void> {
    if (!committed)
      throw new Error('foundation revision derived authority binding is stale')
    if (
      committed.digests.sectionIndex !==
        state.authority!.derivedDigests.sectionIndex ||
      committed.digests.factStore !==
        state.authority!.derivedDigests.factStore ||
      committed.digests.manifest !== state.authority!.derivedDigests.manifest ||
      !sameDocumentDigests(
        committed.documentDigests,
        state.authority!.documentDigests,
      )
    )
      throw new Error('foundation revision derived authority binding is stale')
    for (const entry of state.authority!.documentDigests) {
      const actual = createHash('sha256')
        .update(await readFile(join(input.workspacePath, entry.path), 'utf8'))
        .digest('hex')
      if (actual !== entry.digest)
        throw new Error(
          `foundation revision canonical authority changed: ${entry.path}`,
        )
    }
  }

  async function revisionDocuments(
    state: FoundationAuditState,
  ): Promise<Map<FoundationDocumentPath, string>> {
    const documents = new Map<FoundationDocumentPath, string>(
      await Promise.all(
        CANONICAL_FOUNDATION_DOCUMENTS.map(
          async path =>
            [
              path,
              await readFile(join(input.workspacePath, path), 'utf8'),
            ] as const,
        ),
      ),
    )
    for (const task of activeFoundationRevisionTasks(state)) {
      if (task.kind !== 'document-revision' || task.status !== 'completed')
        continue
      if (!task.receipt)
        throw new Error('foundation revision completed task receipt is missing')
      const staged = await readFile(
        join(input.workspacePath, task.stagedPath),
        'utf8',
      )
      if (
        createHash('sha256').update(staged).digest('hex') !==
        task.receipt.stagedDocumentDigest
      )
        throw new Error('foundation revision active staged evidence is stale')
      documents.set(task.documentPath, staged)
    }
    return documents
  }

  async function revisionOperations(
    run: DeliveryRun,
    state: FoundationAuditState,
  ) {
    const operations = []
    for (const task of activeFoundationRevisionTasks(state)) {
      if (task.kind !== 'document-revision' || !task.receipt) continue
      const packet = await loadFoundationRevisionPacket({
        workspacePath: input.workspacePath,
        revision: task.revision,
        round: task.round,
        taskId: task.taskId,
        documentPath: task.documentPath,
        packetDigest: task.packetDigest,
      })
      operations.push(
        ...(await deriveFoundationPatchOperations({
          workspacePath: input.workspacePath,
          revision: task.revision,
          taskId: task.taskId,
          batch: {
            documentPath: task.documentPath,
            issueIds: task.issueIds,
            sectionIds: task.sectionIds,
          },
          issues: packet.issues as AuditIssue[],
          receipt: task.receipt,
        })),
      )
    }
    return operations
  }

  /** Resolve the exact immutable registry named by the round authority. */
  async function loadRoundBeforeIssues(
    _run: DeliveryRun,
    state: FoundationAuditState,
  ): Promise<AuditIssue[]> {
    const before = state.roundBefore
    if (!before)
      throw new Error('foundation revision round-before metadata is missing')
    const authority = before.issueAuthority
    if (!authority)
      throw new Error('foundation revision round-before authority is missing')
    if (authority.issueRegistryDigest !== before.issueRegistryDigest)
      throw new Error(
        'foundation revision round-before authority binding is stale',
      )
    if (authority.kind === 'review') {
      const review = await loadFoundationSemanticReview({
        workspacePath: input.workspacePath,
        revision: before.documentRevision,
        reviewDigest: authority.reviewDigest,
      })
      if (
        !review ||
        review.digests.issueRegistry !== before.issueRegistryDigest
      )
        throw new Error(
          'foundation revision round-before review authority is stale',
        )
      return [...review.issues]
    }
    const publication = await loadCommittedFoundationRevisionAuthority({
      workspacePath: input.workspacePath,
      revision: authority.baseRevision,
    })
    if (
      publication.resultingRevision !== before.documentRevision ||
      publication.resultingIssueRegistryDigest !== before.issueRegistryDigest ||
      publication.authorityDigest !== authority.authorityDigest
    )
      throw new Error(
        'foundation revision round-before publication authority is stale',
      )
    return [...publication.resultingIssues]
  }

  async function planImpactedFacts(
    run: DeliveryRun,
  ): Promise<DeliveryRun | undefined> {
    const state = run.foundationAuditState
    if (!state || state.status !== 'rebuilding_facts') return run
    if (!state.authority || state.round === undefined || !state.roundBefore)
      throw new Error('foundation revision fact rebuild metadata is incomplete')
    const committed = await loadCommittedFoundationDerivedArtifacts({
      workspacePath: input.workspacePath,
      revision: state.revision,
    })
    if (!committed)
      throw new Error(
        'foundation revision committed derived authority is unavailable',
      )
    await assertBoundRevisionContext(state, committed)
    const documents = await revisionDocuments(state)
    const sectionIndex = buildFoundationSectionIndex({
      documents: Object.fromEntries(documents),
    })
    const operations = await revisionOperations(run, state)
    const impact = analyzeFoundationImpact(operations)
    const rebuilt = rebuildFoundationImpactedFacts({
      phase: 'plan',
      committedFactStore: committed.factStore,
      documents,
      sectionIndex,
      impact,
      revision: state.revision,
    })
    const activeBundle = activeFoundationRevisionBundle(state)
    const taskPackets = await Promise.all(
      rebuilt.packets.map(async (packet, index) => {
        const taskId = `${state.revision}.bundle.${state.round}.${activeBundle.remediationDigest.slice(0, 16)}.facts.${index}`
        const packetPath = await writeFoundationRevisionFactPacket({
          workspacePath: input.workspacePath,
          revision: state.revision,
          round: state.round!,
          taskId,
          packet,
        })
        return {
          taskId,
          kind: 'impacted-facts' as const,
          revision: state.revision,
          round: state.round!,
          packetPath,
          packetDigest: packet.packetDigest,
          status: 'pending' as const,
          attempt: 0,
          bundleId: activeBundle.bundleId,
          modelTier: 'fast' as const,
        }
      }),
    )
    const lease = await store.mutationLock(run.runId)
    let next: DeliveryRun | undefined
    try {
      const locked = await store.load(lease)
      const current = locked?.foundationAuditState
      if (!locked || !current || current.status !== 'rebuilding_facts')
        return undefined
      const existing = activeFoundationRevisionTasks(current).filter(
        task => task.kind === 'impacted-facts',
      )
      if (
        existing.length &&
        (existing.length !== taskPackets.length ||
          existing.some(
            (task, index) =>
              task.taskId !== taskPackets[index]?.taskId ||
              task.packetDigest !== taskPackets[index]?.packetDigest ||
              task.packetPath !== taskPackets[index]?.packetPath,
          ))
      )
        throw new Error(
          'foundation impacted fact task plan changed during replay',
        )
      if (taskPackets.length === 0) {
        next = await store.commit(
          {
            ...locked,
            foundationAuditState: {
              ...current,
              status: 'validating',
              phaseStartedAt: new Date().toISOString(),
            },
          },
          {
            runId: locked.runId,
            type: 'foundation.revision.validating',
            phase: locked.phase,
            status: 'running',
            revision: locked.revision,
          },
          undefined,
          lease,
        )
      } else if (
        existing.length &&
        existing.every(
          task =>
            task.status === 'completed' &&
            task.receiptPath &&
            task.receiptDigest &&
            task.terminalDigest,
        )
      ) {
        next = await store.commit(
          {
            ...locked,
            foundationAuditState: {
              ...current,
              status: 'validating',
              phaseStartedAt: new Date().toISOString(),
            },
          },
          {
            runId: locked.runId,
            type: 'foundation.revision.validating',
            phase: locked.phase,
            status: 'running',
            revision: locked.revision,
          },
          undefined,
          lease,
        )
      } else if (!existing.length) {
        try {
          next = await store.commit(
            {
              ...locked,
              foundationAuditState: {
                ...current,
                tasks: [...current.tasks, ...taskPackets],
                revisionBundles: current.revisionBundles?.map(bundle =>
                  bundle.bundleId === current.activeBundleId
                    ? {
                        ...bundle,
                        taskIds: [
                          ...new Set([
                            ...bundle.taskIds,
                            ...taskPackets.map(task => task.taskId),
                          ]),
                        ],
                      }
                    : bundle,
                ),
              },
            },
            {
              runId: locked.runId,
              type: 'foundation.revision.impacted_facts.planned',
              phase: locked.phase,
              status: 'running',
              revision: locked.revision,
            },
            undefined,
            lease,
          )
        } catch (error) {
          markRevisionCommitTransient(error)
        }
      } else next = locked
    } finally {
      await store.unlock(lease)
    }
    return next ?? (await store.load())
  }

  async function validateRebuiltFoundationFacts(
    run: DeliveryRun,
  ): Promise<void> {
    const state = run.foundationAuditState
    if (!state || state.status !== 'validating') return
    if (!state.authority || state.round === undefined || !state.roundBefore)
      throw new Error('foundation revision validation metadata is incomplete')
    const committed = await loadCommittedFoundationDerivedArtifacts({
      workspacePath: input.workspacePath,
      revision: state.revision,
    })
    if (!committed)
      throw new Error(
        'foundation revision validation derived authority is unavailable',
      )
    await assertBoundRevisionContext(state, committed)
    const documents = await revisionDocuments(state)
    const sectionIndex = buildFoundationSectionIndex({
      documents: Object.fromEntries(documents),
    })
    const operations = await revisionOperations(run, state)
    const impact = analyzeFoundationImpact(operations)
    const results: FoundationFactReceipt[] = []
    for (const task of activeFoundationRevisionTasks(state)) {
      if (task.kind !== 'impacted-facts') continue
      if (
        task.status !== 'completed' ||
        !task.receiptPath ||
        !task.receiptDigest ||
        !task.terminalDigest
      )
        return
      const receipt = await loadFoundationFactReceipt({
        workspacePath: input.workspacePath,
        revision: state.revision,
        taskId: task.taskId,
        expectedPacketDigest: task.packetDigest,
        expectedTerminalDigest: task.terminalDigest,
        expectedReceiptPath: task.receiptPath,
        expectedReceiptDigest: task.receiptDigest,
      })
      results.push(...(receipt.receipts as FoundationFactReceipt[]))
    }
    const rebuilt = rebuildFoundationImpactedFacts({
      phase: 'admit',
      committedFactStore: committed.factStore,
      documents,
      sectionIndex,
      impact,
      revision: state.revision,
      results,
    })
    const validations = []
    const semanticIds = []
    const semanticCandidates: Array<{
      issue: AuditIssue
      operation: PatchOperation
    }> = []
    for (const task of activeFoundationRevisionTasks(state)) {
      if (task.kind !== 'document-revision' || !task.receipt) continue
      const packet = await loadFoundationRevisionPacket({
        workspacePath: input.workspacePath,
        revision: task.revision,
        round: task.round,
        taskId: task.taskId,
        documentPath: task.documentPath,
        packetDigest: task.packetDigest,
      })
      const taskOps = operations.filter(
        operation =>
          operation.documentPath === task.documentPath &&
          operation.issueIds.some(id => task.issueIds.includes(id)),
      )
      const taskImpact = analyzeFoundationImpact(taskOps)
      const admittedIssues = (
        packet.issues as Array<Record<string, unknown>>
      ).map(({ problem: _problem, evidenceRefs: _evidenceRefs, ...raw }) => {
        const issue = raw as unknown as AuditIssue
        const rebind = (ref: { documentPath: string; sectionId: string }) =>
          sectionIndex.find(
            candidate =>
              candidate.documentPath === ref.documentPath &&
              candidate.sectionId === ref.sectionId,
          )
        const source = rebind(issue.source)
        const target = issue.target ? rebind(issue.target) : undefined
        if (!source || (issue.target && !target))
          throw new Error(
            'foundation revision issue section is not present in rebuilt SectionIndex',
          )
        return { ...issue, source, ...(target ? { target } : {}) }
      })
      const checked = validateFoundationPatch({
        validatorTaskId: `${state.revision}.validator.${task.taskId}`,
        round: state.round,
        documentPath: task.documentPath,
        baseDocumentDigest: task.baseDocumentDigest,
        postPatchDocumentDigest: task.receipt.stagedDocumentDigest,
        patchOperations: taskOps,
        impact: taskImpact,
        admittedIssues,
        sectionIndex,
        factStore: rebuilt.factStore,
      })
      validations.push(...checked.patchValidations)
      semanticIds.push(...checked.semanticRecheckIssueIds)
      for (const issueId of checked.semanticRecheckIssueIds) {
        const issue = admittedIssues.find(candidate => candidate.id === issueId)
        const operation = taskOps.find(candidate =>
          candidate.issueIds.includes(issueId),
        )
        if (issue && operation) semanticCandidates.push({ issue, operation })
      }
    }
    // Business FAIL findings are same-round retry input. Only malformed or
    // stale validation artifacts throw above and fail closed.
    const activeBundle = activeFoundationRevisionBundle(state)
    const semanticTasks = await Promise.all(
      [
        ...new Map(
          semanticCandidates.map(candidate => [candidate.issue.id, candidate]),
        ).values(),
      ].map(async (candidate, index) => {
        const packet = buildFoundationSemanticRecheckPacket({
          issue: candidate.issue,
          patchOperation: candidate.operation,
          sectionIndex,
          documents: Object.fromEntries(documents),
          impact: analyzeFoundationImpact([candidate.operation]),
          factStore: rebuilt.factStore,
        })
        const semanticAttempt = activeFoundationRevisionTasks(state).filter(
          task =>
            task.kind === 'semantic-recheck' &&
            task.issueId === candidate.issue.id,
        ).length
        const taskId = `${state.revision}.bundle.${state.round}.${activeBundle.remediationDigest.slice(0, 16)}.semantic.${candidate.issue.id}.${semanticAttempt}.${index}`
        const packetPath = await writeFoundationRevisionSemanticPacket({
          workspacePath: input.workspacePath,
          revision: state.revision,
          round: state.round!,
          taskId,
          packet,
        })
        return {
          taskId,
          kind: 'semantic-recheck' as const,
          revision: state.revision,
          round: state.round!,
          packetPath,
          packetDigest: packet.packetDigest,
          status: 'pending' as const,
          attempt: 0,
          bundleId: activeBundle.bundleId,
          issueId: candidate.issue.id,
          issue: candidate.issue,
          modelTier: 'strong' as const,
        }
      }),
    )
    // A deterministic Patch FAIL is actionable feedback for the same
    // document. It must never enter publication: preserve PASS bytes, keep
    // the same round/base revision, and create a fresh task identity for only
    // the failed document.
    const failedIssueIds = new Set(
      validations
        .filter(
          (validation: { status: string; issueId: string }) =>
            validation.status === 'FAIL',
        )
        .map(validation => validation.issueId),
    )
    const semanticFailureTasks = activeFoundationRevisionTasks(state).filter(
      (task): task is FoundationRevisionSemanticRecheckTask =>
        task.kind === 'semantic-recheck' &&
        task.resultPath !== undefined &&
        task.resultDigest !== undefined &&
        task.terminalDigest !== undefined,
    )
    const semanticFailures = await Promise.all(
      semanticFailureTasks.map(task =>
        loadFoundationRevisionSemanticResult({
          workspacePath: input.workspacePath,
          revision: task.revision,
          round: task.round,
          taskId: task.taskId,
          issueId: task.issueId,
          packetDigest: task.packetDigest,
          resultDigest: task.resultDigest!,
          resultPath: task.resultPath!,
        }),
      ),
    )
    for (const failure of semanticFailures.filter(
      result => result.status === 'FAIL',
    ))
      failedIssueIds.add(failure.issueId)
    const failedDocuments = activeFoundationRevisionTasks(state).filter(
      (task): task is FoundationRevisionDocumentTask =>
        task.kind === 'document-revision' &&
        task.receipt !== undefined &&
        task.issueIds.some(issueId => failedIssueIds.has(issueId)),
    )
    if (failedDocuments.length) {
      const previousBundleId = activeFoundationRevisionBundle(state).bundleId
      const retryBundleId = `${state.revision}.bundle.${state.round}.retry.${revisionBundleDigest({ previousBundleId, failedIssueIds: [...failedIssueIds].sort(), semanticFailures }).slice(0, 16)}`
      const retryTasks = await Promise.all(
        failedDocuments.map(async task => {
          const retryTaskId = `${retryBundleId}.task.${task.documentPath.replaceAll('/', '_')}`
          const packet = await loadFoundationRevisionPacket({
            workspacePath: input.workspacePath,
            revision: task.revision,
            round: task.round,
            taskId: task.taskId,
            documentPath: task.documentPath,
            packetDigest: task.packetDigest,
          })
          const retryIssues = (packet.issues as AuditIssue[]).filter(issue =>
            task.issueIds.includes(issue.id),
          )
          const batch = {
            documentPath: task.documentPath,
            issueIds: task.issueIds,
            sectionIds: task.sectionIds,
          }
          const sourceAuthorityDigest =
            state.authority!.issueAuthority.kind === 'review'
              ? state.authority!.issueAuthority.reviewDigest
              : state.authority!.issueAuthority.authorityDigest
          const authority = await buildFoundationRevisionAuthority({
            workspacePath: input.workspacePath,
            revision: task.revision,
            taskId: retryTaskId,
            round: task.round,
            batch,
            issues: retryIssues,
            sourceAuthorityDigest,
            sourceIssueRegistryDigest:
              state.authority!.issueAuthority.issueRegistryDigest,
            sourceDerivedDigests: state.authority!.derivedDigests,
            sourceDocumentDigests: state.authority!.documentDigests,
            normalizedFacts: rebuilt.factStore,
            candidateDocuments: documents,
          })
          const packetPath = await writeFoundationRevisionPacket({
            workspacePath: input.workspacePath,
            revision: task.revision,
            round: task.round,
            taskId: retryTaskId,
            documentPath: task.documentPath,
            packet: authority.packet,
            packetDigest: authority.packetDigest,
          })
          const carriedStage = await readFile(
            join(input.workspacePath, task.stagedPath),
          )
          if (
            !task.receipt ||
            createHash('sha256').update(carriedStage).digest('hex') !==
              task.receipt.stagedDocumentDigest
          )
            throw new Error('foundation revision retry stage is stale')
          const dependencyDigests = Object.fromEntries(
            Object.keys(task.dependencyDigests).map(key => {
              const digest = sectionIndex.find(
                section =>
                  `${section.documentPath}#${section.sectionId}` === key,
              )?.digest
              if (!digest)
                throw new Error(
                  'foundation revision retry dependency section is missing',
                )
              return [key, digest]
            }),
          )
          return {
            ...task,
            taskId: retryTaskId,
            packetPath,
            packetDigest: authority.packetDigest,
            status: 'pending' as const,
            attempt: 0,
            dispatch: undefined,
            terminalDigest: undefined,
            usage: undefined,
            durationMs: undefined,
            failureReason: undefined,
            receipt: undefined,
            dependencyDigests,
            bundleId: retryBundleId,
            frozen: false,
          }
        }),
      )
      const retryByDocument = new Map(
        retryTasks.map(task => [task.documentPath, task]),
      )
      const frozenTaskIds = activeFoundationRevisionTasks(state)
        .filter(
          task =>
            task.kind === 'document-revision' &&
            !retryByDocument.has(task.documentPath),
        )
        .map(task => task.taskId)
      const nextOwnedTaskIds = retryTasks.map(task => task.taskId)
      const lease = await store.mutationLock(run.runId)
      let retryRun: DeliveryRun | undefined
      try {
        const locked = await store.load(lease)
        if (locked?.foundationAuditState?.status !== 'validating') return
        const superseded = new Map(
          failedDocuments.map((task, index) => [
            task.taskId,
            retryTasks[index]!.taskId,
          ]),
        )
        const oldBundleId = locked.foundationAuditState.activeBundleId
        const oldBundles = locked.foundationAuditState.revisionBundles ?? []
        const newBundle = {
          bundleId: retryBundleId,
          status: 'active' as const,
          round: state.round!,
          baseDocumentRevision: state.revision,
          baseDocumentDigests: state.authority!.documentDigests,
          remediationDigest: revisionBundleDigest({
            oldBundleId,
            failedIssueIds: [...failedIssueIds].sort(),
            semanticFailures,
          }),
          taskIds: nextOwnedTaskIds,
          frozenTaskIds,
        }
        retryRun = await store.commit(
          {
            ...locked,
            status: 'running',
            blockedReason: undefined,
            foundationAuditState: {
              ...locked.foundationAuditState,
              status: 'revising',
              tasks: [
                ...locked.foundationAuditState.tasks.map(task =>
                  frozenTaskIds.includes(task.taskId)
                    ? { ...task, frozen: true }
                    : superseded.has(task.taskId)
                      ? {
                          ...task,
                          supersededBy: superseded.get(task.taskId),
                          frozen: false,
                        }
                      : task,
                ),
                ...retryTasks,
              ],
              activeBundleId: retryBundleId,
              revisionBundles: [
                ...oldBundles.map(bundle =>
                  bundle.bundleId === oldBundleId
                    ? {
                        ...bundle,
                        status: 'superseded' as const,
                        supersededBy: retryBundleId,
                      }
                    : bundle,
                ),
                newBundle,
              ],
              phaseStartedAt: new Date().toISOString(),
            },
          },
          {
            runId: locked.runId,
            type: 'foundation.revision.same_round_retry',
            phase: locked.phase,
            status: 'running',
            revision: locked.revision,
            round: state.round,
            failedDocumentPaths: failedDocuments.map(task => task.documentPath),
            retryTaskIds: retryTasks.map(task => task.taskId),
            supersededBundleId: oldBundleId,
          },
          undefined,
          lease,
        )
      } finally {
        await store.unlock(lease)
      }
      if (retryRun) await resumeUnlocked(retryRun)
      return
    }
    const lease = await store.mutationLock(run.runId)
    let next: DeliveryRun | undefined
    try {
      const locked = await store.load(lease)
      if (
        !locked?.foundationAuditState ||
        locked.foundationAuditState.status !== 'validating'
      )
        return
      if (semanticTasks.length) {
        const existing = activeFoundationRevisionTasks(
          locked.foundationAuditState,
        ).filter(task => task.kind === 'semantic-recheck')
        if (
          existing.length &&
          (existing.length !== semanticTasks.length ||
            existing.some(
              (task, index) =>
                task.taskId !== semanticTasks[index]?.taskId ||
                task.packetDigest !== semanticTasks[index]?.packetDigest,
            ))
        )
          throw new Error(
            'foundation semantic recheck task plan changed during replay',
          )
        const planned = existing.length ? existing : semanticTasks
        const activeTaskIds = [
          ...new Set([
            ...activeFoundationRevisionBundle(locked.foundationAuditState)
              .taskIds,
            ...planned.map(task => task.taskId),
          ]),
        ]
        next = await store.commit(
          {
            ...locked,
            foundationAuditState: {
              ...locked.foundationAuditState,
              status: 'semantic_recheck',
              tasks: existing.length
                ? locked.foundationAuditState.tasks
                : [...locked.foundationAuditState.tasks, ...semanticTasks],
              revisionBundles: locked.foundationAuditState.revisionBundles?.map(
                bundle =>
                  bundle.bundleId ===
                  locked.foundationAuditState!.activeBundleId
                    ? { ...bundle, taskIds: activeTaskIds }
                    : bundle,
              ),
              phaseStartedAt: new Date().toISOString(),
            },
          },
          {
            runId: locked.runId,
            type: 'foundation.revision.semantic_recheck',
            phase: locked.phase,
            status: 'running',
            revision: locked.revision,
          },
          undefined,
          lease,
        )
      } else
        next = await store.commit(
          {
            ...locked,
            foundationAuditState: {
              ...locked.foundationAuditState,
              status: 'publishing',
              phaseStartedAt: new Date().toISOString(),
            },
          },
          {
            runId: locked.runId,
            type: 'foundation.revision.publishing',
            phase: locked.phase,
            status: 'running',
            revision: locked.revision,
          },
          undefined,
          lease,
        )
    } finally {
      await store.unlock(lease)
    }
    if (next?.status === 'running') await resumeUnlocked(next)
  }

  async function publishFoundationRevisionAtBoundary(
    run: DeliveryRun,
  ): Promise<DeliveryRun | undefined> {
    const state = run.foundationAuditState
    if (!state || state.status !== 'publishing') return run
    if (!state.authority || state.round === undefined || !state.roundBefore)
      throw new Error('foundation revision publication metadata is incomplete')
    const committed = await loadCommittedFoundationDerivedArtifacts({
      workspacePath: input.workspacePath,
      revision: state.revision,
    })
    if (!committed)
      throw new Error(
        'foundation revision publication derived authority is unavailable',
      )
    let recoveredPublication:
      | Awaited<ReturnType<typeof recoverFoundationRevision>>
      | undefined
    try {
      recoveredPublication = await recoverFoundationRevision({
        workspacePath: input.workspacePath,
        revision: state.revision,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const documents = await revisionDocuments(state)
    const sectionIndex = buildFoundationSectionIndex({
      documents: Object.fromEntries(documents),
    })
    const operations =
      recoveredPublication?.patchOperations ??
      (await revisionOperations(run, state))
    const impact = analyzeFoundationImpact(operations)
    const factResults: FoundationFactReceipt[] = []
    for (const task of activeFoundationRevisionTasks(state)) {
      if (task.kind !== 'impacted-facts') continue
      if (!task.receiptPath || !task.receiptDigest || !task.terminalDigest)
        throw new Error(
          'foundation revision fact receipt binding is incomplete',
        )
      const receipt = await loadFoundationFactReceipt({
        workspacePath: input.workspacePath,
        revision: state.revision,
        taskId: task.taskId,
        expectedPacketDigest: task.packetDigest,
        expectedTerminalDigest: task.terminalDigest,
        expectedReceiptPath: task.receiptPath,
        expectedReceiptDigest: task.receiptDigest,
      })
      factResults.push(...(receipt.receipts as FoundationFactReceipt[]))
    }
    const rebuilt = rebuildFoundationImpactedFacts({
      phase: 'admit',
      committedFactStore: committed.factStore,
      documents,
      sectionIndex,
      impact,
      revision: state.revision,
      results: factResults,
    })
    const commitPublished = async (
      publication: Awaited<ReturnType<typeof recoverFoundationRevision>>,
      factStore: ReturnType<typeof createFoundationFactStore>,
    ): Promise<DeliveryRun | undefined> => {
      const resultingDocuments = Object.fromEntries(
        await Promise.all(
          CANONICAL_FOUNDATION_DOCUMENTS.map(
            async path =>
              [
                path,
                await readFile(join(input.workspacePath, path), 'utf8'),
              ] as const,
          ),
        ),
      )
      const resultingDerived = await publishFoundationDerivedArtifacts({
        workspacePath: input.workspacePath,
        revision: publication.resultingRevision,
        documentDigests: Object.entries(publication.documentDigests).map(
          ([path, digest]) => ({ path, digest }),
        ) as Array<{
          path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]
          digest: string
        }>,
        sectionIndex: buildFoundationSectionIndex({
          documents: resultingDocuments,
        }),
        factStore,
        normalizedFactDigest: digestFactStore(factStore),
        manifest: {},
      })
      const documentRevision = await computeDocumentRevision(
        input.workspacePath,
        run.confirmedBriefDigest,
      )
      const workspaceRevision = await computeWorkspaceRevision(
        input.workspacePath,
      )
      const lease = await store.mutationLock(run.runId)
      let next: DeliveryRun | undefined
      try {
        const locked = await store.load(lease)
        if (
          !locked?.foundationAuditState ||
          locked.foundationAuditState.status !== 'publishing'
        )
          return undefined
        const resultingDocumentDigests = Object.entries(
          publication.documentDigests,
        ).map(([path, digest]) => ({ path, digest })) as Array<{
          path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]
          digest: string
        }>
        const derivedRoot = `.beegame/audit/foundation/${publication.resultingRevision}/derived`
        next = await store.commit(
          {
            ...locked,
            revision: {
              ...locked.revision,
              document: documentRevision,
              workspace: workspaceRevision,
            },
            foundationAuditState: {
              ...locked.foundationAuditState,
              revision: publication.resultingRevision,
              documentDigests: Object.fromEntries(
                resultingDocumentDigests.map(entry => [
                  entry.path,
                  entry.digest,
                ]),
              ) as Record<
                (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
                string
              >,
              sectionIndexDigest: resultingDerived.digests.sectionIndex,
              sectionIndexPath: `${derivedRoot}/section-index.json`,
              manifestPath: `${derivedRoot}/manifest.json`,
              status: 'round_closing',
              phaseStartedAt: new Date().toISOString(),
              aggregateUsage: undefined,
              deterministic: undefined,
              semantic: undefined,
              review: undefined,
              derived: {
                manifestPath: `${derivedRoot}/manifest.json`,
                manifestDigest: resultingDerived.digests.manifest,
                markerPath: `${derivedRoot}/COMMITTED.json`,
                markerDigest: resultingDerived.digests.marker,
                factStorePath: `${derivedRoot}/fact-store.json`,
                factStoreDigest: resultingDerived.digests.factStore,
                sectionIndexPath: `${derivedRoot}/section-index.json`,
                sectionIndexDigest: resultingDerived.digests.sectionIndex,
              },
              issueSummary: summarizeFoundationIssues(
                publication.resultingIssues,
              ),
              authority: {
                issueAuthority: {
                  kind: 'publication',
                  baseRevision: publication.baseRevision,
                  authorityDigest: publication.authorityDigest,
                  issueRegistryDigest: publication.resultingIssueRegistryDigest,
                },
                derivedDigests: {
                  sectionIndex: resultingDerived.digests.sectionIndex,
                  factStore: resultingDerived.digests.factStore,
                  manifest: resultingDerived.digests.manifest,
                },
                documentDigests: resultingDocumentDigests,
              },
              publication: {
                preparedPath: publication.preparedPath,
                journalPath: publication.journalPath,
                committedPath: publication.committedPath,
                authorityDigest: publication.authorityDigest,
                resultingRevision: publication.resultingRevision,
                resultingIssueRegistryDigest:
                  publication.resultingIssueRegistryDigest,
              },
            },
          },
          {
            runId: locked.runId,
            type: 'foundation.revision.round_closing',
            phase: locked.phase,
            status: 'running',
            revision: publication.resultingRevision,
          },
          undefined,
          lease,
        )
      } finally {
        await store.unlock(lease)
      }
      return next
    }
    const commitAndClose = async (
      publication: Awaited<ReturnType<typeof recoverFoundationRevision>>,
      factStore: ReturnType<typeof createFoundationFactStore>,
    ): Promise<DeliveryRun | undefined> => {
      const published = await commitPublished(publication, factStore)
      if (
        published?.status === 'running' &&
        published.foundationAuditState?.status === 'round_closing'
      ) {
        // Keep the publication -> policy boundary in one recovery chain. A
        // controller restart can still replay the durable round_closing
        // snapshot, but a successful publication must not depend on a later
        // polling tick to evaluate its close policy.
        return (await closeFoundationRevisionRound(published)) ?? published
      }
      return published
    }
    if (recoveredPublication)
      return commitAndClose(recoveredPublication, rebuilt.factStore)
    const patchValidations = []
    const batches = []
    const receipts = []
    for (const task of activeFoundationRevisionTasks(state)) {
      if (task.kind !== 'document-revision' || !task.receipt) continue
      const packet = await loadFoundationRevisionPacket({
        workspacePath: input.workspacePath,
        revision: task.revision,
        round: task.round,
        taskId: task.taskId,
        documentPath: task.documentPath,
        packetDigest: task.packetDigest,
      })
      const taskOperations = operations.filter(
        operation =>
          operation.documentPath === task.documentPath &&
          operation.issueIds.some(id => task.issueIds.includes(id)),
      )
      const taskImpact = analyzeFoundationImpact(taskOperations)
      const admittedIssues = (
        packet.issues as Array<Record<string, unknown>>
      ).map(({ problem: _problem, evidenceRefs: _evidenceRefs, ...raw }) => {
        const issue = raw as unknown as AuditIssue
        const rebind = (ref: { documentPath: string; sectionId: string }) =>
          sectionIndex.find(
            candidate =>
              candidate.documentPath === ref.documentPath &&
              candidate.sectionId === ref.sectionId,
          )
        const source = rebind(issue.source)
        const target = issue.target ? rebind(issue.target) : undefined
        if (!source || (issue.target && !target))
          throw new Error(
            'foundation revision issue section is not present in published SectionIndex',
          )
        return { ...issue, source, ...(target ? { target } : {}) }
      })
      const checked = validateFoundationPatch({
        validatorTaskId: `${state.revision}.validator.${task.taskId}`,
        round: state.round!,
        documentPath: task.documentPath,
        baseDocumentDigest: task.baseDocumentDigest,
        postPatchDocumentDigest: task.receipt.stagedDocumentDigest,
        patchOperations: taskOperations,
        impact: taskImpact,
        admittedIssues,
        sectionIndex,
        factStore: rebuilt.factStore,
      })
      patchValidations.push(...checked.patchValidations)
      batches.push({
        documentPath: task.documentPath,
        sectionIds: task.sectionIds,
        issueIds: task.issueIds,
      })
      receipts.push(task.receipt)
    }
    const semanticRecheckResults = await Promise.all(
      activeFoundationRevisionTasks(state)
        .filter(
          (task): task is FoundationRevisionSemanticRecheckTask =>
            task.kind === 'semantic-recheck',
        )
        .map(task => {
          if (!task.resultPath || !task.resultDigest || !task.terminalDigest)
            throw new Error('foundation semantic result binding is incomplete')
          return loadFoundationRevisionSemanticResult({
            workspacePath: input.workspacePath,
            revision: task.revision,
            round: task.round,
            taskId: task.taskId,
            issueId: task.issueId,
            packetDigest: task.packetDigest,
            resultDigest: task.resultDigest,
            resultPath: task.resultPath,
          })
        }),
    )
    // Recompute the complete post-publication registry at the publication
    // boundary.  Validation only returns impacted discoveries; the registry
    // must also retain unresolved issues from the preceding committed
    // authority and refresh deterministic issues against the rebuilt store.
    const beforeIssues = await loadRoundBeforeIssues(run, state)
    const resolvedIssueIds = new Set(batches.flatMap(batch => batch.issueIds))
    const postDeterministicIssues =
      runProductionDeterministicFoundationImpactAudit({
        sectionIndex,
        factStore: rebuilt.factStore,
        impact,
      })
    const resultingById = new Map<string, AuditIssue>()
    for (const issue of beforeIssues) {
      if (!resolvedIssueIds.has(issue.id)) resultingById.set(issue.id, issue)
    }
    for (const issue of postDeterministicIssues) {
      if (!resolvedIssueIds.has(issue.id)) resultingById.set(issue.id, issue)
    }
    if (
      patchValidations.some(validation => validation.status !== 'PASS') ||
      semanticRecheckResults.some(result => result.status !== 'PASS')
    )
      throw new Error(
        'foundation revision publication requires every active Patch and semantic validation to PASS',
      )
    const publication = await publishFoundationRevision({
      workspacePath: input.workspacePath,
      revision: state.revision,
      confirmedBriefDigest: run.confirmedBriefDigest,
      round: state.round!,
      batches,
      receipts,
      revisionDeclarations: receipts.map(receipt => ({
        status: 'APPLIED' as const,
      })),
      patchOperations: operations,
      patchValidations,
      semanticRecheckResults,
      resultingIssues: [...resultingById.values()],
    })
    return commitAndClose(publication, rebuilt.factStore)
  }

  async function closeFoundationRevisionRound(
    run: DeliveryRun,
  ): Promise<DeliveryRun | undefined> {
    const state = run.foundationAuditState
    if (!state || state.status !== 'round_closing') return run
    if (!state.authority || state.round === undefined || !state.roundBefore)
      throw new Error('foundation revision close metadata is incomplete')
    const beforeIssues = await loadRoundBeforeIssues(run, state)
    if (state.authority.issueAuthority.kind !== 'publication')
      throw new Error(
        'foundation revision round closing requires committed publication authority',
      )
    const publication = await loadCommittedFoundationRevisionAuthority({
      workspacePath: input.workspacePath,
      revision: state.authority.issueAuthority.baseRevision,
    })
    if (
      publication.resultingRevision !== state.revision ||
      publication.resultingIssueRegistryDigest !==
        state.authority.issueAuthority.issueRegistryDigest
    )
      throw new Error(
        'foundation revision round-closing publication authority is stale',
      )
    const afterIssues = [...publication.resultingIssues]
    const policy = evaluateFoundationRevisionRoundPolicy({
      phase: 'evaluate',
      round: state.round!,
      before: {
        issues: beforeIssues,
        issueRegistryDigest: state.roundBefore!.issueRegistryDigest,
        documentRevision: state.roundBefore!.documentRevision,
      },
      after: {
        issues: afterIssues,
        issueRegistryDigest:
          state.authority!.issueAuthority.issueRegistryDigest,
        documentRevision: state.revision,
      },
    })
    const lease = await store.mutationLock(run.runId)
    let next: DeliveryRun | undefined
    try {
      const locked = await store.load(lease)
      if (
        !locked?.foundationAuditState ||
        locked.foundationAuditState.status !== 'round_closing'
      )
        return undefined
      if (policy.status === 'proceed')
        next = await store.commit(
          {
            ...locked,
            documentStep: 'FOUNDATION_REVIEW',
            status: 'running',
            blockedReason: undefined,
            foundationAuditState: {
              ...locked.foundationAuditState,
              status: 'revision_ready',
            },
          },
          {
            runId: locked.runId,
            type: 'foundation.revision.proceed',
            phase: locked.phase,
            status: 'running',
            revision: locked.revision,
          },
          undefined,
          lease,
        )
      else if (policy.status === 'continue')
        next = await store.commit(
          {
            ...locked,
            status: 'running',
            blockedReason: undefined,
            foundationAuditState: {
              ...locked.foundationAuditState,
              round: policy.nextRound,
              status: 'planning',
              phaseStartedAt: new Date().toISOString(),
              roundBefore: {
                documentRevision: state.revision,
                issueRegistryDigest:
                  state.authority!.issueAuthority.issueRegistryDigest,
                issueAuthority: state.authority!.issueAuthority,
              },
              activeBundleId: undefined,
              revisionBundles: locked.foundationAuditState.revisionBundles?.map(
                bundle =>
                  bundle.bundleId ===
                  locked.foundationAuditState!.activeBundleId
                    ? { ...bundle, status: 'superseded' as const }
                    : bundle,
              ),
              publication: undefined,
            },
          },
          {
            runId: locked.runId,
            type: 'foundation.revision.next_round',
            phase: locked.phase,
            status: 'running',
            revision: locked.revision,
          },
          undefined,
          lease,
        )
      else
        throw new Error(
          'foundation revision round policy returned an invalid evaluate result',
        )
    } finally {
      await store.unlock(lease)
    }
    return next
  }

  async function dispatchFoundationAuditTask(
    request: WorkerDispatchRequest,
  ): Promise<void> {
    try {
      await dispatcher.dispatch(request)
    } catch (error) {
      if (
        !(error instanceof DispatchError) ||
        error.code !== 'duplicate' ||
        !request.taskId
      )
        throw error
      const current = await store.load()
      const task =
        current?.foundationAuditState &&
        foundationRuntimeTasks(current.foundationAuditState).find(
          candidate => candidate.taskId === request.taskId,
        )
      const sameTask =
        current &&
        task &&
        task.revision === request.revision &&
        task.packetDigest === request.contract.packetDigest &&
        (request.workerType === 'foundation-fact-extractor'
          ? task.kind === 'document-facts'
          : task.kind === 'semantic' || task.kind === 'confirmation')
      if (!current || !task || !sameTask) throw error
      if (
        task.status === 'running' &&
        task.dispatch?.status === 'running' &&
        task.dispatch.workerType === request.workerType
      )
        return
      if (
        (task.status === 'pending' || task.status === 'retryable') &&
        (current.foundationAuditState
          ? foundationRuntimeTasks(current.foundationAuditState).filter(
              candidate => candidate.status === 'running',
            ).length
          : 0) >= 4
      )
        return
      throw error
    }
  }

  async function resumeUnlocked(run: DeliveryRun): Promise<void> {
    if (run.status !== 'running') return
    // A persisted compiler terminal is the next Game IR input. Admit it
    // before deriving another dispatch so recovery cannot overwrite durable
    // evidence and repeat the same compilation indefinitely.
    if (
      run.phase === 'GAME_IR_COMPILATION' &&
      run.activeDispatch?.workerType === 'game-ir-compiler' &&
      run.activeDispatch.terminalResult
    ) {
      await dispatcher.replayTerminal(
        run.activeDispatch,
        handleTerminalUnlocked,
      )
      return
    }
    if (run.phase === 'GAME_IR_COMPILATION') {
      let compilationRun = run
      let state = run.gameIrState
      if (!state || state.status !== 'compiling')
        throw new Error(
          'Game IR compilation phase is missing its compiling state',
        )
      const checkpointLoader = new GameIrStageCheckpointLoader()
      let replay: GameIrCheckpointLoad | undefined
      if (state.latestCheckpoint) {
        const recovered = await checkpointLoader.recover({
          workspacePath: input.workspacePath,
          deliveryRun: compilationRun,
        })
        const recoveredCheckpoint =
          recovered.gameIrState?.status === 'compiling'
            ? recovered.gameIrState.latestCheckpoint
            : undefined
        if (
          recoveredCheckpoint?.checkpointPath !==
            state.latestCheckpoint.checkpointPath ||
          recoveredCheckpoint?.checkpointDigest !==
            state.latestCheckpoint.checkpointDigest
        )
          compilationRun = await persist(
            recovered,
            'game_ir_checkpoint.recovered',
            { checkpoint: recoveredCheckpoint },
          )
        state = compilationRun.gameIrState
        if (!state || state.status !== 'compiling')
          throw new Error('Recovered Game IR state is missing')
        const compilingState = state
        replay = await checkpointLoader.load({
          workspacePath: input.workspacePath,
          deliveryRun: compilationRun,
        })
        if (replay.status === 'closed' && replay.authority.phase7Authority) {
          const closedReplay = replay
          const phase7Authority = closedReplay.authority.phase7Authority
          if (!phase7Authority)
            throw new Error(
              'closed phase7 checkpoint is missing implementation authority',
            )
          const publicationProgress = {
            inputDigest: digestGameIrValue(compilingState.identity),
            diagnosticDigest: digestGameIrValue({ reasonCode: 'publication' }),
            candidateDigest:
              phase7Authority.implementationVerification.source.sourceDigest,
            checkpointJournalDigest: digestGameIrValue(
              state.latestCheckpoint ?? null,
            ),
            terminalDigest: digestGameIrValue({
              reasonCode: 'publication',
              phase: 'phase7',
            }),
          }
          const publishOrAttend = async (): Promise<void> => {
            try {
              const readyReceipt = await commitGameIrPublication({
                workspacePath: input.workspacePath,
                publicationId: compilingState.identity.publicationId,
                phase7Authority,
              })
              const latestCheckpoint =
                compilationRun.gameIrState?.status === 'compiling'
                  ? compilationRun.gameIrState.latestCheckpoint
                  : undefined
              if (!latestCheckpoint)
                throw new Error(
                  'Game IR publication has no committed Phase 7 checkpoint',
                )
              const candidateReady = transitionDeliveryRun(compilationRun, {
                type: 'game_ir_ready',
                state: {
                  status: 'ready',
                  identity: compilingState.identity,
                  checkpoint: latestCheckpoint,
                  readyReceipt,
                  readyReceiptDigest: digestGameIrValue(readyReceipt),
                },
              })
              await readCommittedGameIr({
                workspacePath: input.workspacePath,
                deliveryRun: candidateReady,
              })
              const readyRun = await persist(candidateReady, 'game_ir_ready', {
                readyReceiptDigest: digestGameIrValue(readyReceipt),
              })
              await resumeUnlocked(readyRun)
            } catch (error) {
              const actual =
                error instanceof Error
                  ? error.message
                  : 'Phase 7 publication or reader validation failed'
              const current = await store.load()
              const durable =
                current?.runId === compilationRun.runId
                  ? current
                  : compilationRun
              const durableState =
                durable.gameIrState?.status === 'compiling'
                  ? durable.gameIrState
                  : compilingState
              const unchanged =
                durableState.progressIdentity !== undefined &&
                digestGameIrValue(durableState.progressIdentity) ===
                  digestGameIrValue(publicationProgress)
              const diagnosticRef = `game-ir-${digestGameIrValue({ taskId: durableState.identity.taskId, progressIdentity: publicationProgress, reasonCode: 'publication' }).slice(0, 12)}`
              const attended = await persist(
                {
                  ...durable,
                  activeDispatch: undefined,
                  status: unchanged ? 'needs_action' : 'running',
                  blockedReason: unchanged
                    ? `game_ir_publication diagnostic ${diagnosticRef}`
                    : undefined,
                  thinking: unchanged ? 'idle' : 'working',
                  gameIrState: {
                    ...durableState,
                    diagnosticRef,
                    diagnostic: {
                      phase: 'GAME_IR_COMPILATION',
                      step: 'publication',
                      taskId: durableState.identity.taskId,
                      workerType: 'game-ir-compiler',
                      reasonCode: 'publication',
                      expected: 'reader-valid committed Game IR',
                      actual,
                      diagnosticRef,
                      recoveryAction: unchanged
                        ? 'resolve the unchanged publication prerequisite, then retry the same compilation identity'
                        : 'retry the same compilation identity; publication will be attempted again',
                    },
                    progressIdentity: publicationProgress,
                  },
                },
                unchanged
                  ? 'game_ir_publication.needs_action'
                  : 'game_ir_publication.retryable',
                { diagnosticRef, reasonCode: 'publication' },
              )
              if (attended.status === 'running') await resumeUnlocked(attended)
            }
          }
          await publishOrAttend()
          return
        }
      }
      const foundationReadyReceipt = compilationRun.foundationAuditState
        ? projectFoundationReadyReceipt({
            state: compilationRun.foundationAuditState,
            projectId: compilationRun.projectId,
            confirmedBriefDigest: compilationRun.confirmedBriefDigest,
          })
        : undefined
      if (!foundationReadyReceipt)
        throw new Error(
          'Game IR compilation cannot resume without Foundation READY',
        )
      if (
        foundationReadyReceipt.foundationRevision !==
          state.identity.foundationRevision ||
        foundationReadyReceipt.receiptDigest !==
          state.identity.foundationReadyReceiptDigest
      )
        throw new Error(
          'Game IR compilation identity is detached from Foundation READY',
        )
      const compileRequest = parseGameIrCompileRequest({
        schemaVersion: 'game-ir-compile-request.v1',
        taskId: state.identity.taskId,
        publicationId: state.identity.publicationId,
        gameIrSchemaVersion: 'game-ir.v1',
        foundation: foundationReadyReceipt,
      })
      const replayRecords: GameIrStagedRecords = replay?.records ?? new Map()
      const operation = nextGameIrOperation(replay)
      if (!operation)
        throw new Error('Game IR compilation has no next staged operation')
      const source =
        operation.operation === 'projection'
          ? await buildGameIrSourcePacket({
              workspacePath: input.workspacePath,
              request: compileRequest,
              receipt: foundationReadyReceipt,
              domain: operation.domain,
            })
          : undefined
      const packet = buildStagedOperationPacket({
        operation,
        ...(source ? { source } : {}),
        records: replayRecords,
      })
      const projectionJournal =
        operation.operation === 'projection'
          ? await createGameIrProjectionSliceJournal({
              journalPath: gameIrProjectionSliceJournalPath({
                workspacePath: input.workspacePath,
                identity: state.identity,
                operationStep: operation.step,
              }),
              identity: state.identity,
              operationStep: operation.step,
              packet: packet as never,
              slicePlan: deriveProjectionSlicePlan(operation.domain),
            })
          : undefined
      if (
        operation.operation === 'projection' &&
        !projectionJournal?.nextSlice
      ) {
        if (!projectionJournal)
          throw new Error('Game IR projection journal is unavailable')
        const recordsToCommit = stagedProjectionJournalCompletion({
          operation,
          packet,
          records: replayRecords,
          journal: projectionJournal,
        })
        const checkpoint = await writeGameIrStageCheckpoint({
          workspacePath: input.workspacePath,
          deliveryRun: compilationRun,
          step: {
            phase: operation.phase,
            domain: operation.domain,
            operation: operation.operation,
            records: recordsToCommit,
          },
        })
        const checkpointed = transitionDeliveryRun(compilationRun, {
          type: 'game_ir_checkpoint_committed',
          checkpoint,
          expectedPreviousCheckpoint: state.latestCheckpoint,
        })
        const persistedCheckpoint = await persist(
          checkpointed,
          'game_ir_checkpoint_committed',
          { checkpoint },
        )
        await cleanupGameIrProjectionSliceJournalAfterCheckpoint({
          workspacePath: input.workspacePath,
          identity: state.identity,
          operationStep: operation.step,
          deliveryRun: persistedCheckpoint,
        })
        await resumeUnlocked(persistedCheckpoint)
        return
      }
      const correctionDiagnostic =
        operation.operation === 'validation' &&
        state.diagnostic?.step === operation.step
          ? {
              step: state.diagnostic.step,
              reason: normalizeGameIrDiagnosticReason(state.diagnostic.actual),
            }
          : undefined
      const retryDiagnostic =
        operation.operation === 'projection' &&
        projectionJournal?.nextSlice &&
        state.diagnostic?.step === operation.step
          ? retryDiagnosticFromActual(state.diagnostic.actual) ?? {
              scope: 'slice' as const,
              sliceId: projectionJournal.nextSlice.sliceId,
              reason: normalizeGameIrDiagnosticReason(state.diagnostic.actual),
            }
          : undefined
      await dispatcher.dispatch({
        dispatchId: randomUUID(),
        runId: compilationRun.runId,
        ownerId: compilationRun.ownerId,
        projectId: compilationRun.projectId,
        workspacePath: input.workspacePath,
        workerType: 'game-ir-compiler',
        phase: 'GAME_IR_COMPILATION',
        taskId: state.identity.taskId,
        revision: state.identity.foundationRevision,
        allowedPaths: [],
        projectReadScope: 'empty',
        contract: {
          compileRequestDigest: digestGameIrValue(compileRequest),
          foundationReadyReceiptDigest: foundationReadyReceipt.receiptDigest,
          ...(projectionJournal?.nextSlice
            ? {
                currentSlice: projectionJournal.nextSlice.sliceId,
                sliceContext: projectionJournal.nextSliceContext,
              }
            : {}),
          ...(projectionJournal
            ? {
                progress: projectionJournal.entries.map(entry => ({
                  sliceId: entry.sliceId,
                  entryDigest: entry.entryDigest,
                })),
              }
            : {}),
          ...(retryDiagnostic ? { retryDiagnostic } : {}),
          ...stagedCompilerContract({
            operation,
            packet,
            correctionDiagnostic,
          }),
        },
      })
      return
    }
    if (
      run.phase === 'DOCUMENT_DRAFTING' &&
      run.foundationDraftState.documents
    ) {
      const replayable = run.foundationDraftState.documents.find(
        document => document.dispatch?.terminalResult,
      )?.dispatch
      if (replayable) {
        await dispatcher.replayTerminal(replayable, handleTerminalUnlocked)
        return
      }
      const runningDocuments = run.foundationDraftState.documents.filter(
        document => document.dispatch?.status === 'running',
      )
      if (runningDocuments.length) {
        const unavailable: typeof runningDocuments = []
        for (const document of runningDocuments) {
          const isOpen = await dispatcher
            .workerIsOpen(document.dispatch!.dispatchId)
            .catch(() => false)
          if (!isOpen) unavailable.push(document)
        }
        if (!unavailable.length) {
          await startDocumentStage({
            run,
            workspacePath: input.workspacePath,
            dispatcher,
          })
          return
        }
        let foundationDraftState = run.foundationDraftState
        for (const document of unavailable)
          foundationDraftState = recordFoundationFailure(
            foundationDraftState,
            document.path,
            'preserved native document session is unavailable',
          )
        const recovered = await persist(
          {
            ...run,
            foundationDraftState,
            status: 'needs_action',
            blockedReason: 'preserved native document session is unavailable',
          },
          'document.parallel.session_unavailable',
        )
        return
      }
    }
    // Foundation audit/revision dispatches are nested under their durable
    // task state.  A previous top-level document worker can therefore leave
    // an old terminal result on `activeDispatch` while the revision state has
    // already crossed into publishing/round-closing.  Replaying that stale
    // top-level result first would return before the revision state machine
    // gets a chance to close its committed publication.
    if (
      run.activeDispatch?.terminalResult &&
      (!run.foundationAuditState || run.gameIrState?.status === 'ready')
    ) {
      // resumeUnlocked already owns the controller serialization lane. Reuse
      // the canonical terminal handler directly instead of queueing behind
      // ourselves through handleTerminal.
      await dispatcher.replayTerminal(
        run.activeDispatch,
        handleTerminalUnlocked,
      )
      return
    }
    // A retry after foundation derivation failure carries a stale caller
    // snapshot with no audit state. Reconcile from durable state before
    // deciding whether to derive again; otherwise the retry falls through
    // the review phase with no state and no fact workers.
    if (
      run.phase === 'DOCUMENT_REVIEW' &&
      run.documentStep === 'FOUNDATION_REVIEW' &&
      !run.foundationAuditState &&
      canStartFoundationAudit(run)
    ) {
      const lease = await store.mutationLock(run.runId)
      let next: DeliveryRun | undefined
      try {
        const current = await store.load(lease)
        if (!current || current.runId !== run.runId) return
        if (current.foundationAuditState) {
          next = current
        } else if (
          current.status === 'running' &&
          current.phase === 'DOCUMENT_REVIEW' &&
          current.documentStep === 'FOUNDATION_REVIEW' &&
          canStartFoundationAudit(current)
        ) {
          next = await deriveFoundationAudit(current, input.workspacePath)
          await store.commit(
            next,
            {
              runId: next.runId,
              type: next.foundationAuditState
                ? 'foundation.audit.index_staged'
                : 'foundation.audit.derivation_failed',
              phase: next.phase,
              status: next.status,
              revision: next.revision,
            },
            undefined,
            lease,
          )
        }
      } finally {
        await store.unlock(lease)
      }
      if (next?.status === 'running') {
        await resumeUnlocked(next)
      }
      return
    }
    if (run.foundationAuditState) {
      const replayableFactDispatches = foundationRuntimeTasks(
        run.foundationAuditState,
      )
        .filter(
          task =>
            task.status !== 'completed' &&
            task.dispatch?.terminalResult &&
            !terminalAdmissionInFlight.has(task.dispatch.dispatchId),
        )
        .map(task => task.dispatch!)
      if (replayableFactDispatches.length) {
        for (const dispatch of replayableFactDispatches)
          await dispatcher.replayTerminal(dispatch, handleTerminalUnlocked)
        return
      }
    }
    if (
      run.foundationAuditState &&
      isFoundationRevisionPhase(run.foundationAuditState.status) &&
      run.foundationAuditState.status !== 'planning'
    ) {
      const replayableRevisionDispatches = foundationRuntimeTasks(
        run.foundationAuditState,
      )
        .filter(
          task =>
            (task.status !== 'completed' ||
              (task.kind === 'impacted-facts' && !task.receiptPath)) &&
            task.dispatch?.terminalResult &&
            !terminalAdmissionInFlight.has(task.dispatch.dispatchId),
        )
        .map(task => task.dispatch!)
      if (replayableRevisionDispatches.length) {
        for (const dispatch of replayableRevisionDispatches)
          await dispatcher.replayTerminal(dispatch, handleTerminalUnlocked)
        return
      }
    }
    if (
      run.foundationAuditState &&
      isFoundationRevisionPhase(run.foundationAuditState.status)
    ) {
      const revisionState = run.foundationAuditState
      if (revisionState.status === 'planning') {
        try {
          await materializeFoundationRevisionPlanning(run)
        } catch (error) {
          if (isRevisionCommitTransient(error)) throw error
          const reason =
            error instanceof Error
              ? error.message
              : 'foundation revision planning materialization failed'
          const lease = await store.mutationLock(run.runId)
          try {
            const locked = await store.load(lease)
            if (locked?.foundationAuditState?.status === 'planning')
              await store.commit(
                { ...locked, status: 'needs_action', blockedReason: reason },
                {
                  runId: locked.runId,
                  type: 'foundation.revision.planning.failed',
                  phase: locked.phase,
                  status: 'needs_action',
                  revision: locked.revision,
                  reason,
                },
                undefined,
                lease,
              )
          } finally {
            await store.unlock(lease)
          }
        }
        return
      }
      if (
        revisionState.status === 'revising' &&
        foundationRevisionTasksComplete(
          activeFoundationRevisionTasks(revisionState).filter(
            (
              task,
            ): task is
              | FoundationRevisionDocumentTask
              | FoundationRevisionImpactedFactsTask
              | FoundationRevisionSemanticRecheckTask =>
              task.kind === 'document-revision' ||
              task.kind === 'impacted-facts' ||
              task.kind === 'semantic-recheck',
          ),
        )
      ) {
        const lease = await store.mutationLock(run.runId)
        let next: DeliveryRun | undefined
        try {
          const locked = await store.load(lease)
          if (
            locked?.foundationAuditState?.status === 'revising' &&
            foundationRevisionTasksComplete(
              activeFoundationRevisionTasks(locked.foundationAuditState).filter(
                (
                  task,
                ): task is
                  | FoundationRevisionDocumentTask
                  | FoundationRevisionImpactedFactsTask
                  | FoundationRevisionSemanticRecheckTask =>
                  task.kind === 'document-revision' ||
                  task.kind === 'impacted-facts' ||
                  task.kind === 'semantic-recheck',
              ),
            )
          ) {
            next = await store.commit(
              {
                ...locked,
                foundationAuditState: {
                  ...locked.foundationAuditState,
                  status: 'rebuilding_facts',
                  phaseStartedAt: new Date().toISOString(),
                },
              },
              {
                runId: locked.runId,
                type: 'foundation.revision.rebuilding_facts',
                phase: locked.phase,
                status: 'running',
                revision: locked.revision,
              },
              undefined,
              lease,
            )
          }
        } finally {
          await store.unlock(lease)
        }
        if (next) {
          await resumeUnlocked(next)
          return
        }
      }
      if (revisionState.status === 'rebuilding_facts') {
        let planned: DeliveryRun | undefined
        try {
          planned = await planImpactedFacts(run)
        } catch (error) {
          if (isRevisionCommitTransient(error)) throw error
          const reason =
            error instanceof Error
              ? error.message
              : 'foundation impacted fact planning failed'
          const lease = await store.mutationLock(run.runId)
          try {
            const locked = await store.load(lease)
            if (locked?.foundationAuditState?.status === 'rebuilding_facts') {
              const activeTaskIds = new Set(
                foundationRuntimeTasks(locked.foundationAuditState).map(
                  task => task.taskId,
                ),
              )
              await store.commit(
                {
                  ...locked,
                  status: 'needs_action',
                  blockedReason: reason,
                  foundationAuditState: {
                    ...locked.foundationAuditState,
                    tasks: locked.foundationAuditState.tasks.map(task =>
                      !activeTaskIds.has(task.taskId) ||
                      task.status === 'completed'
                        ? task
                        : {
                            ...task,
                            status: 'needs_action' as const,
                            failureReason: reason,
                          },
                    ),
                  },
                },
                {
                  runId: locked.runId,
                  type: 'foundation.revision.fact_planning.failed',
                  phase: locked.phase,
                  status: 'needs_action',
                  revision: locked.revision,
                  reason,
                },
                undefined,
                lease,
              )
            }
          } finally {
            await store.unlock(lease)
          }
          return
        }
        if (planned?.foundationAuditState?.status === 'validating') {
          await resumeUnlocked(planned)
          return
        }
        const current = planned ?? run
        const state = current.foundationAuditState
        if (!state || state.status !== 'rebuilding_facts') return
        const runtimeTasks = foundationRuntimeTasks(state)
        const running = runtimeTasks.filter(
          task => task.kind === 'impacted-facts' && task.status === 'running',
        ).length
        const available = runtimeTasks.filter(
          (task): task is FoundationRevisionImpactedFactsTask =>
            task.kind === 'impacted-facts' &&
            (task.status === 'pending' || task.status === 'retryable'),
        )
        for (const task of available.slice(0, Math.max(0, 4 - running))) {
          const packet = await loadFoundationRevisionFactPacket({
            workspacePath: input.workspacePath,
            revision: task.revision,
            round: task.round,
            taskId: task.taskId,
            packetDigest: task.packetDigest,
          })
          await dispatcher.dispatch({
            runId: current.runId,
            ownerId: current.ownerId,
            projectId: current.projectId,
            workspacePath: input.workspacePath,
            workerType: 'foundation-fact-extractor',
            phase: 'DOCUMENT_REVIEW',
            taskId: task.taskId,
            revision: task.revision,
            allowedPaths: [],
            projectReadScope: 'empty',
            workflowJsonSchema:
              buildFoundationFactStructuredOutputJsonSchema(packet),
            contract: {
              round: task.round,
              taskId: task.taskId,
              revision: task.revision,
              packetPath: task.packetPath,
              packet,
              packetDigest: task.packetDigest,
              modelTier: task.modelTier,
              workerType: 'foundation-fact-extractor',
            },
          })
        }
        return
      }
      if (revisionState.status === 'validating') {
        try {
          await validateRebuiltFoundationFacts(run)
        } catch (error) {
          const reason =
            error instanceof Error
              ? error.message
              : 'foundation revision validation failed'
          const lease = await store.mutationLock(run.runId)
          try {
            const locked = await store.load(lease)
            if (locked?.foundationAuditState?.status === 'validating') {
              const activeTaskIds = new Set(
                foundationRuntimeTasks(locked.foundationAuditState).map(
                  task => task.taskId,
                ),
              )
              await store.commit(
                {
                  ...locked,
                  status: 'needs_action',
                  blockedReason: reason,
                  foundationAuditState: {
                    ...locked.foundationAuditState,
                    tasks: locked.foundationAuditState.tasks.map(task =>
                      !activeTaskIds.has(task.taskId) ||
                      task.status === 'completed'
                        ? task
                        : {
                            ...task,
                            status: 'needs_action' as const,
                            failureReason: reason,
                          },
                    ),
                  },
                },
                {
                  runId: locked.runId,
                  type: 'foundation.revision.validation.failed',
                  phase: locked.phase,
                  status: 'needs_action',
                  revision: locked.revision,
                  reason,
                },
                undefined,
                lease,
              )
            }
          } finally {
            await store.unlock(lease)
          }
        }
        return
      }
      if (revisionState.status === 'semantic_recheck') {
        const runtimeTasks = foundationRuntimeTasks(revisionState)
        const running = runtimeTasks.filter(
          task => task.status === 'running',
        ).length
        const available = runtimeTasks.filter(
          (task): task is FoundationRevisionSemanticRecheckTask =>
            task.kind === 'semantic-recheck' &&
            (task.status === 'pending' || task.status === 'retryable'),
        )
        for (const task of available.slice(0, Math.max(0, 4 - running))) {
          const packet = await loadFoundationRevisionSemanticPacket({
            workspacePath: input.workspacePath,
            revision: task.revision,
            round: task.round,
            taskId: task.taskId,
            packetDigest: task.packetDigest,
          })
          await dispatcher.dispatch({
            runId: run.runId,
            ownerId: run.ownerId,
            projectId: run.projectId,
            workspacePath: input.workspacePath,
            workerType: 'foundation-semantic-reviewer',
            phase: 'DOCUMENT_REVIEW',
            taskId: task.taskId,
            revision: task.revision,
            allowedPaths: [],
            projectReadScope: 'empty',
            workflowJsonSchema:
              foundationSemanticRecheckStructuredOutputJsonSchema as unknown as Record<
                string,
                unknown
              >,
            contract: {
              taskId: task.taskId,
              revision: task.revision,
              round: task.round,
              issueId: task.issueId,
              packetPath: task.packetPath,
              packet,
              packetDigest: task.packetDigest,
              modelTier: task.modelTier,
              workerType: 'foundation-semantic-reviewer',
            },
          })
        }
        return
      }
      if (revisionState.status === 'publishing') {
        const published = await publishFoundationRevisionAtBoundary(run)
        if (published) {
          await resumeUnlocked(published)
          return
        }
        return
      }
      if (revisionState.status === 'round_closing') {
        const closed = await closeFoundationRevisionRound(run)
        if (closed) {
          if (closed.status === 'running') await resumeUnlocked(closed)
          return
        }
        return
      }
      if (revisionState.status !== 'revising') return
      const runtimeTasks = foundationRuntimeTasks(revisionState)
      const running = runtimeTasks.filter(
        task => task.status === 'running',
      ).length
      const available = runtimeTasks.filter(
        (task): task is Extract<typeof task, { kind: 'document-revision' }> =>
          task.kind === 'document-revision' &&
          (task.status === 'pending' || task.status === 'retryable'),
      )
      for (const task of available.slice(0, Math.max(0, 4 - running))) {
        await dispatcher.dispatch({
          runId: run.runId,
          ownerId: run.ownerId,
          projectId: run.projectId,
          workspacePath: input.workspacePath,
          workerType: 'foundation-document-reviser',
          phase: 'DOCUMENT_REVIEW',
          taskId: task.taskId,
          revision: task.revision,
          allowedPaths: [task.stagedPath],
          projectReadScope: 'allowed',
          protectedPaths: [task.documentPath],
          contract: {
            round: task.round,
            taskId: task.taskId,
            revision: task.revision,
            documentPath: task.documentPath,
            issueIds: task.issueIds,
            sectionIds: task.sectionIds,
            stagedPath: task.stagedPath,
            baseDocumentDigest: task.baseDocumentDigest,
            packetPath: task.packetPath,
            packetDigest: task.packetDigest,
            workerType: 'foundation-document-reviser',
            ...(task.failureReason
              ? { priorFailureReason: task.failureReason }
              : {}),
          },
        })
      }
      return
    }
    if (run.activeDispatch?.status === 'running') return
    if (run.changeRequest && !run.changeRoute && run.phase === 'DELIVERY') {
      await dispatcher.dispatch(
        buildChangeImpactDispatch(run, input.workspacePath, run.changeRequest),
      )
      return
    }
    if (
      run.changeRequest &&
      run.changeRoute === 'question' &&
      run.phase === 'DELIVERY'
    ) {
      await dispatcher.dispatch(
        buildQuestionAnswerDispatch(
          run,
          input.workspacePath,
          run.changeRequest,
        ),
      )
      return
    }
    if (run.phase === 'DOCUMENT_DRAFTING') {
      if (canStartFoundationAudit(run)) {
        const next = await deriveFoundationAudit(run, input.workspacePath)
        await persist(
          next,
          next.foundationAuditState
            ? 'foundation.audit.index_staged'
            : 'foundation.audit.derivation_failed',
        )
        if (next.status === 'running') await resumeUnlocked(next)
        return
      }
      await startDocumentStage({
        run,
        workspacePath: input.workspacePath,
        dispatcher,
      })
      return
    }
    if (run.phase === 'DOCUMENT_REVIEW') {
      if (
        run.documentStep === 'FOUNDATION_REVIEW' &&
        run.foundationAuditState &&
        ['audit_ready', 'revision_ready'].includes(
          run.foundationAuditState.status,
        ) &&
        !run.gameIrState
      ) {
        const foundationReadyReceipt = projectFoundationReadyReceipt({
          state: run.foundationAuditState,
          projectId: run.projectId,
          confirmedBriefDigest: run.confirmedBriefDigest,
        })
        const identitySeed = digestGameIrValue({
          foundationRevision: foundationReadyReceipt.foundationRevision,
          foundationReadyReceiptDigest: foundationReadyReceipt.receiptDigest,
        }).slice(0, 24)
        const compileRequest = parseGameIrCompileRequest({
          schemaVersion: 'game-ir-compile-request.v1',
          taskId: `game-ir-${identitySeed}`,
          publicationId: `game-ir-${identitySeed}-publication`,
          gameIrSchemaVersion: 'game-ir.v1',
          foundation: foundationReadyReceipt,
        })
        const identity = {
          runId: run.runId,
          taskId: compileRequest.taskId,
          publicationId: compileRequest.publicationId,
          confirmedBriefDigest: run.confirmedBriefDigest,
          foundationRevision: foundationReadyReceipt.foundationRevision,
          foundationReadyReceiptDigest: foundationReadyReceipt.receiptDigest,
        }
        const compiling = transitionDeliveryRun(run, {
          type: 'game_ir_compilation_started',
          identity,
        })
        const persisted = await persist(
          compiling,
          'game_ir_compilation.started',
          {
            taskId: identity.taskId,
            publicationId: identity.publicationId,
            foundationReadyReceiptDigest: identity.foundationReadyReceiptDigest,
          },
        )
        await resumeUnlocked(persisted)
        return
      }
      if (run.foundationAuditState?.status === 'derived_committed') {
        try {
          await completeDeterministicFoundationAudit(run)
        } catch (error) {
          await failFoundationContinuation(run, error)
        }
        return
      }
      if (run.foundationAuditState?.status === 'deterministic_ready') {
        try {
          await completeDeterministicFoundationAudit(run)
        } catch (error) {
          await failFoundationContinuation(run, error)
        }
        return
      }
      if (run.foundationAuditState?.status === 'facts_staged') {
        try {
          await finalizeFoundationFacts(run)
        } catch (error) {
          await failFoundationContinuation(run, error)
        }
        return
      }
      if (run.foundationAuditState?.status === 'semantic_review') {
        const runtimeTasks = foundationRuntimeTasks(run.foundationAuditState)
        const replayable = runtimeTasks
          .filter(
            task =>
              (task.kind === 'semantic' || task.kind === 'confirmation') &&
              task.status !== 'completed' &&
              task.dispatch?.terminalResult &&
              !terminalAdmissionInFlight.has(task.dispatch.dispatchId),
          )
          .map(task => task.dispatch!)
        if (replayable.length) {
          for (const dispatch of replayable)
            await dispatcher.replayTerminal(dispatch, handleTerminalUnlocked)
          return
        }
        const semanticRuntime: FoundationSemanticTaskCollection = {
          revision: run.foundationAuditState.revision,
          phaseStartedAt: run.foundationAuditState.phaseStartedAt!,
          status: 'semantic_review',
          tasks: runtimeTasks.filter(
            task => task.kind === 'semantic' || task.kind === 'confirmation',
          ) as FoundationSemanticTaskCollection['tasks'],
          aggregateUsage: run.foundationAuditState.semantic?.aggregateUsage ?? {
            input_tokens: 0,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
          ...(run.foundationAuditState.semantic?.deepPhaseStartedAt
            ? {
                deepPhaseStartedAt:
                  run.foundationAuditState.semantic.deepPhaseStartedAt,
              }
            : {}),
          ...(run.foundationAuditState.semantic?.deepAggregateUsage
            ? {
                deepAggregateUsage:
                  run.foundationAuditState.semantic.deepAggregateUsage,
              }
            : {}),
        }
        if (foundationSemanticTasksComplete(semanticRuntime)) {
          await finalizeFoundationSemanticReview(run)
          return
        }
        const available = runtimeTasks.filter(
          task =>
            (task.kind === 'semantic' || task.kind === 'confirmation') &&
            (task.status === 'pending' || task.status === 'retryable'),
        ) as Array<{
          taskId: string
          checkId: string
          revision: string
          packetDigest: string
          modelTier: 'fast' | 'balanced' | 'strong'
          kind: 'semantic' | 'confirmation'
          sourceTaskId?: string
        }>
        const running = runtimeTasks.filter(
          task => task.status === 'running',
        ).length
        if (running >= FOUNDATION_SEMANTIC_MAX_RUNNING || !available.length)
          return
        const committed = await loadCommittedFoundationDerivedArtifacts({
          workspacePath: input.workspacePath,
          revision: run.foundationAuditState.revision,
        })
        const prefix = run.foundationAuditState.deterministic
          ? await loadDeterministicFoundationReview({
              workspacePath: input.workspacePath,
              revision: run.foundationAuditState.revision,
              reviewDigest: run.foundationAuditState.deterministic.reviewDigest,
            })
          : undefined
        if (!committed || !prefix)
          throw new Error('semantic audit immutable inputs are unavailable')
        for (const task of available.slice(
          0,
          FOUNDATION_SEMANTIC_MAX_RUNNING - running,
        )) {
          const packet = await buildSemanticPacketFor({
            workspacePath: input.workspacePath,
            revision: run.foundationAuditState.revision,
            checkId: task.checkId,
            sectionIndex: committed.sectionIndex,
            factStore: committed.factStore,
            deterministicReviewDigest: prefix.reviewDigest,
            deterministicIssuePrefix: prefix.issues,
            documentDigests: committed.documentDigests,
          })
          if (packet.identity !== task.packetDigest)
            throw new Error(
              'semantic retry packet differs from immutable task packet',
            )
          await dispatchFoundationAuditTask({
            runId: run.runId,
            ownerId: run.ownerId,
            projectId: run.projectId,
            workspacePath: input.workspacePath,
            workerType: 'foundation-semantic-reviewer',
            phase: 'DOCUMENT_REVIEW',
            taskId: task.taskId,
            revision: task.revision,
            allowedPaths: [],
            projectReadScope: 'empty',
            workflowJsonSchema:
              foundationSemanticReviewerStructuredOutputJsonSchema as unknown as Record<
                string,
                unknown
              >,
            contract: {
              packet,
              packetDigest: task.packetDigest,
              modelTier: task.modelTier,
              taskId: task.taskId,
              revision: task.revision,
              workerType: 'foundation-semantic-reviewer',
              checkId: task.checkId,
              kind: task.kind,
              ...(task.kind === 'confirmation'
                ? { sourceTaskId: task.sourceTaskId }
                : {}),
            },
          })
        }
        return
      }
      if (run.foundationAuditState?.status === 'extracting_facts') {
        const runtimeTasks = foundationRuntimeTasks(run.foundationAuditState)
        const available = runtimeTasks.filter(
          task =>
            task.kind === 'document-facts' &&
            (task.status === 'pending' || task.status === 'retryable'),
        ) as Array<{
          taskId: string
          revision: string
          packetDigest: string
          modelTier: 'fast'
        }>
        const running = runtimeTasks.filter(
          task => task.status === 'running',
        ).length
        if (running >= 4 || available.length === 0) return
        for (const task of available.slice(0, 4 - running)) {
          const packetPath = join(
            input.workspacePath,
            `.beegame/audit/foundation/${run.foundationAuditState.revision}/staging/packets/${task.taskId}.json`,
          )
          const packet = JSON.parse(
            await readFile(packetPath, 'utf8'),
          ) as Record<string, unknown>
          await dispatchFoundationAuditTask({
            runId: run.runId,
            ownerId: run.ownerId,
            projectId: run.projectId,
            workspacePath: input.workspacePath,
            workerType: 'foundation-fact-extractor',
            phase: 'DOCUMENT_REVIEW',
            taskId: task.taskId,
            revision: task.revision,
            allowedPaths: [],
            projectReadScope: 'empty',
            workflowJsonSchema: buildFoundationFactStructuredOutputJsonSchema(
              packet as FoundationFactPacket,
            ),
            contract: {
              packet,
              packetDigest: task.packetDigest,
              modelTier: task.modelTier,
              taskId: task.taskId,
              revision: task.revision,
              workerType: 'foundation-fact-extractor',
            },
          })
        }
        return
      }
      if (run.documentStep === 'CHECKLIST_DRAFTING') {
        await startChecklistDraftStage({
          run,
          workspacePath: input.workspacePath,
          dispatcher,
        })
      }
      return
    }
    if (run.phase === 'RESOURCE_PREPARATION') {
      if (await documentRevisionChanged(run)) {
        await restartDocumentStage(
          run,
          'canonical documents changed while resource preparation was paused; document review must be rerun',
        )
        return
      }
      const reconciledResources = await reconcileCurrentResourcePreparation({
        run,
        workspacePath: input.workspacePath,
      })
      if (reconciledResources) {
        const saved = await persist(
          reconciledResources,
          'resource.preparation.reconciled',
        )
        await resumeUnlocked(saved)
        return
      }
      await startResourcePreparation({
        run,
        workspacePath: input.workspacePath,
        dispatcher,
      })
      return
    }
    if (run.phase === 'ATOMIC_TASK_PLANNING') {
      if (await documentRevisionChanged(run)) {
        await restartDocumentStage(
          run,
          'canonical documents changed while task planning was paused; document review must be rerun',
        )
        return
      }
      if (resourcePreparationMissing(run)) {
        await restartResourcePreparation(
          run,
          'resource preparation evidence is missing; the resource stage must be completed before task planning',
        )
        return
      }
      const planningFacts = await contractFactsFor(run)
      await dispatcher.dispatch({
        runId: run.runId,
        ownerId: run.ownerId,
        projectId: run.projectId,
        workspacePath: input.workspacePath,
        workerType: 'atomic-task-planner',
        phase: run.phase,
        revision: run.revision.document,
        allowedPaths: [],
        contract: {
          checklistIds: planningFacts.checklistIds,
          resourceIds: planningFacts.resourceIds,
          contentIds: planningFacts.contentIds,
          planningDocuments: await readAtomicTaskPlanningDocuments(
            input.workspacePath,
          ),
          ...(run.changeRequest ? { changeRequest: run.changeRequest } : {}),
        },
      })
      return
    }
    if (run.phase === 'IMPLEMENTATION') {
      if (await documentRevisionChanged(run)) {
        await restartDocumentStage(
          run,
          'canonical documents changed while implementation was paused; document review must be rerun',
        )
        return
      }
      if (resourcePreparationMissing(run)) {
        await restartResourcePreparation(
          run,
          'resource preparation evidence is missing; implementation cannot start before the resource stage is complete',
        )
        return
      }
      try {
        validateAtomicTaskGraph(run.tasks, await contractFactsFor(run))
      } catch (error) {
        if (!(error instanceof AtomicTaskPlanError)) throw error
        await restartAtomicTaskPlanning(
          run,
          `atomic task graph is no longer valid: ${error.message}`,
        )
        return
      }
      await startNextImplementationTask({
        run,
        workspacePath: input.workspacePath,
        revision: run.revision.workspace,
        dispatcher,
        beforeDispatch: started =>
          persist(started, 'task.started').then(() => undefined),
      })
      return
    }
    if (run.phase === 'IMPLEMENTATION_AUDIT') {
      if (await documentRevisionChanged(run)) {
        await restartDocumentStage(
          run,
          'canonical documents changed while implementation audit was paused; document review must be rerun',
        )
        return
      }
      if (resourcePreparationMissing(run)) {
        await restartResourcePreparation(
          run,
          'resource preparation evidence is missing; implementation audit cannot start before the resource stage is complete',
        )
        return
      }
      const auditFacts = await contractFactsFor(run)
      if (!auditFacts.resourceReadiness.ready) {
        await persist(
          resourceDeliveryBlocked(run, auditFacts.resourceReadiness),
          'resource.delivery.needs_action',
        )
        return
      }
      await startImplementationAudit({
        run,
        workspacePath: input.workspacePath,
        dispatcher,
        expectedChecklistIds: auditFacts.checklistIds,
        expectedResourceIds: auditFacts.resourceIds,
        expectedContentIds: auditFacts.contentIds,
        resourceReadiness: auditFacts.resourceReadiness,
      })
      return
    }
    if (run.phase === 'ACCEPTANCE') {
      if (await documentRevisionChanged(run)) {
        await restartDocumentStage(
          run,
          'canonical documents changed while acceptance was paused; document review must be rerun',
        )
        return
      }
      if (resourcePreparationMissing(run)) {
        await restartResourcePreparation(
          run,
          'resource preparation evidence is missing; acceptance cannot start before the resource stage is complete',
        )
        return
      }
      const acceptanceFacts = await contractFactsFor(run)
      await startAcceptance({
        run,
        workspacePath: input.workspacePath,
        dispatcher,
        expectedChecklistIds: acceptanceFacts.checklistIds,
        expectedResourceIds: acceptanceFacts.resourceIds,
        expectedContentIds: acceptanceFacts.contentIds,
      })
    }
  }

  async function requestChangeUnlocked(
    run: DeliveryRun,
    message: string,
  ): Promise<unknown> {
    if (
      run.status === 'running' &&
      run.activeDispatch &&
      (run.activeDispatch.status === 'running' ||
        Boolean(run.activeDispatch.terminalResult))
    ) {
      throw new Error(
        'A workflow worker result is still being reconciled; wait for the current phase to settle before submitting another change.',
      )
    }
    const analysisRun: DeliveryRun = {
      ...run,
      status: 'running',
      activeDispatch: undefined,
      blockedReason: undefined,
      changeRequest: message,
      changeRoute: undefined,
      changeAffectedRequirementIds: undefined,
      changeAffectedChecklistIds: undefined,
      changeRationale: undefined,
    }
    await persist(analysisRun, 'change.request_received')
    const request = buildChangeImpactDispatch(
      analysisRun,
      input.workspacePath,
      message,
    )
    const dispatch = await dispatcher.dispatch(request)
    return { runId: analysisRun.runId, dispatch }
  }

  function resume(run: DeliveryRun): Promise<void> {
    return serialize(() => resumeUnlocked(run))
  }

  function ensureProgress(run: DeliveryRun): Promise<void> {
    return serialize(async () => {
      // Polling and retry requests may carry a stale snapshot. Reconcile the
      // durable nested task state first so an orphaned `running` projection
      // cannot preserve an admitted foundation `needs_action` terminal.
      const current = await store.reconcile(async dispatch => {
        try {
          return await dispatcher.workerIsOpen(dispatch.dispatchId)
        } catch {
          return false
        }
      })
      if (!current || current.runId !== run.runId) return
      if (current.status !== 'running') return
      if (current.activeDispatch?.status === 'running') return
      await resumeUnlocked(current)
    })
  }

  function requestChange(run: DeliveryRun, message: string): Promise<unknown> {
    return serialize(() => requestChangeUnlocked(run, message))
  }

  return {
    store,
    dispatcher,
    start: (run: DeliveryRun) =>
      startDocumentStage({
        run,
        workspacePath: input.workspacePath,
        dispatcher,
      }),
    resume,
    ensureProgress,
    requestChange,
  }
}

function isCanonicalDocumentPath(path: string): boolean {
  let normalized = path.replaceAll('\\', '/')
  while (normalized.startsWith('./')) normalized = normalized.slice(2)
  return CANONICAL_DOCUMENT_ARTIFACTS.includes(normalized as never)
}

async function plannerContractFacts(
  workspacePath: string,
  confirmedBriefContext?: string,
  catalogObserved = false,
): Promise<
  AtomicTaskContractFacts & {
    resourceIds: string[]
    contentIds: string[]
    resourceReadiness: ResourceDeliveryReadiness
  }
> {
  const assetContract = auditAssetContract(workspacePath)
  const resourceReadiness = auditResourceDeliveryReadiness({
    workspacePath,
    confirmedPolicy: confirmedResourceLibraryUsage(confirmedBriefContext),
    catalogObserved,
  })
  return {
    checklistIds: readAcceptanceChecklistIds(workspacePath),
    resourceIds: assetContract.resources.map(resource => resource.id),
    contentIds: assetContract.content.files.map(file => file.id),
    resourceReadiness,
  }
}

export type DeliveryWorkflowController = ReturnType<
  typeof createDeliveryWorkflowController
>
