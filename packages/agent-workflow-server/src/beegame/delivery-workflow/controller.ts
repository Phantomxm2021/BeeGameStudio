import {
  applyAtomicTaskPlan,
  AtomicTaskPlanError,
  readAtomicTaskPlanningDocuments,
  validateAtomicTaskGraph,
  type AtomicTaskContractFacts,
} from './atomic-task-planner'
import { auditAssetContract } from '../asset-contract-audit'
import { createDeliveryDispatcher } from './dispatch'
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
import { createFoundationAuditState } from './foundation-audit-state'
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
  foundationFactStructuredOutputJsonSchema,
  type WorkerTerminalResult,
} from './worker-contracts'
import { recordFoundationFailure } from './foundation-authoring-batch'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { extractNormalizedFoundationFacts, buildFoundationFactPackets, validateFoundationFactResults } from './foundation-fact-extraction'
import { admitFoundationFactTerminal, digestFoundationFactTerminal, foundationFactTasksComplete, type FoundationFactTaskCollection } from './foundation-fact-runtime'
import { loadFoundationAuditArtifacts, loadFoundationFactReceipt, publishFoundationDerivedArtifacts, writeFoundationFactPacket, writeFoundationFactReceipt, publishDeterministicFoundationReview, loadCommittedFoundationDerivedArtifacts, loadDeterministicFoundationReview, publishFoundationSemanticReview, loadFoundationSemanticReview } from './foundation-audit-artifacts'
import { createFoundationFactStore, digestFactStore } from './foundation-fact-store'
import type { FoundationAuditState } from './foundation-audit-state'
import {
  FOUNDATION_AUDIT_PRODUCTION_MANIFEST,
  runProductionDeterministicFoundationAudit,
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
import { foundationSemanticReviewerStructuredOutputJsonSchema } from './worker-contracts'

async function deriveFoundationAudit(
  run: DeliveryRun,
  workspacePath: string,
): Promise<DeliveryRun> {
  if (run.foundationAuditState && run.foundationAuditState.status !== 'index_staged') return run
  const checkpoints = run.foundationDraftState.documents ??
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
      await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(workspacePath, path), 'utf8')] as const)),
    )
    const extraction = extractNormalizedFoundationFacts({ documents, sectionIndex: artifacts.sectionIndex })
    const packets = buildFoundationFactPackets({ revision: artifacts.revision, documents, sectionIndex: artifacts.sectionIndex, unresolvedKeys: extraction.unresolvedKeys })
    const phaseStartedAt = new Date().toISOString()
    const baseState = createFoundationAuditState({ revision: artifacts.revision, documentDigests: artifacts.documentDigests, manifest: artifacts.manifest })
    const tasks = packets.map((packet, index) => ({ taskId: `${artifacts.revision}:fact:${index}:${packet.packetDigest.slice(0, 12)}`, kind: 'document-facts' as const, revision: artifacts.revision, packetDigest: packet.packetDigest, modelTier: 'fast' as const, status: 'pending' as const, attempt: 0 }))
    for (const [index, packet] of packets.entries()) await writeFoundationFactPacket({ workspacePath, revision: artifacts.revision, taskId: tasks[index]!.taskId, packet })
    let nextState: FoundationAuditState = { ...baseState, status: packets.length ? ('extracting_facts' as const) : ('facts_staged' as const), tasks, phaseStartedAt }
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

function sectionBytes(documents: ReadonlyMap<string, string>, ref: { documentPath: string; startLine: number; endLine: number }): string {
  const document = documents.get(ref.documentPath)
  if (document === undefined) throw new Error(`semantic section document is missing: ${ref.documentPath}`)
  return document.split('\n').slice(ref.startLine - 1, ref.endLine).join('\n')
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
  const documents = new Map(await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(input.workspacePath, path), 'utf8')] as const)))
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const expected = input.documentDigests.find(item => item.path === path)?.digest
    const actual = createHash('sha256').update(documents.get(path)!).digest('hex')
    if (!expected || expected !== actual) throw new Error(`semantic audit source changed after commit: ${path}`)
  }
  const bytes = Object.fromEntries(input.sectionIndex.map(ref => [`${ref.documentPath}#${ref.sectionId}`, sectionBytes(documents, ref)]))
  return buildFoundationSemanticPacket({ revision: input.revision, checkId: input.checkId, sectionIndex: input.sectionIndex, sectionBytes: bytes, factStore: input.factStore, deterministicReviewDigest: input.deterministicReviewDigest, deterministicIssuePrefix: input.deterministicIssuePrefix })
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

  async function handleTerminal(
    record: DispatchRecord,
    result: WorkerTerminalResult,
    request?: WorkerDispatchRequest,
  ): Promise<void> {
    terminalAdmissionInFlight.add(record.dispatchId)
    return serialize(() => handleTerminalUnlocked(record, result, request)).finally(() => {
      terminalAdmissionInFlight.delete(record.dispatchId)
    })
  }

  async function finalizeFoundationFacts(run: DeliveryRun): Promise<void> {
    const state = run.foundationAuditState
    if (!state || state.status !== 'facts_staged') return
    const artifacts = await loadFoundationAuditArtifacts({ workspacePath: input.workspacePath, revision: state.revision, expectedState: state })
    if (!artifacts) throw new Error('foundation fact section index is unavailable during finalization')
    const facts = []
    for (const task of state.tasks) {
      if (!task.receiptPath || !task.receiptDigest || !task.terminalDigest) throw new Error('foundation fact task receipt binding is incomplete')
      const receipt = await loadFoundationFactReceipt({ workspacePath: input.workspacePath, revision: state.revision, taskId: task.taskId, expectedPacketDigest: task.packetDigest, expectedTerminalDigest: task.terminalDigest, expectedReceiptPath: task.receiptPath, expectedReceiptDigest: task.receiptDigest })
      facts.push(...receipt.facts)
    }
    const factStore = createFoundationFactStore(facts)
    const normalizedFactDigest = digestFactStore(factStore)
    const published = await publishFoundationDerivedArtifacts({ workspacePath: input.workspacePath, revision: state.revision, documentDigests: artifacts.documentDigests, sectionIndex: artifacts.sectionIndex, factStore, normalizedFactDigest, manifest: artifacts.manifest as unknown as Record<string, unknown> })
    const lease = await store.mutationLock(run.runId)
    let derivedCommittedRun: DeliveryRun | undefined
    try {
      const locked = await store.load(lease)
      if (!locked?.foundationAuditState || locked.foundationAuditState.status === 'derived_committed') return
      if (locked.foundationAuditState.status !== 'facts_staged') throw new Error('foundation fact state changed before derived binding')
      const derived = { manifestPath: `.beegame/audit/foundation/${state.revision}/derived/manifest.json`, manifestDigest: published.digests.manifest, markerPath: `.beegame/audit/foundation/${state.revision}/derived/COMMITTED.json`, markerDigest: published.digests.marker, factStorePath: `.beegame/audit/foundation/${state.revision}/derived/fact-store.json`, factStoreDigest: published.digests.factStore, sectionIndexPath: `.beegame/audit/foundation/${state.revision}/derived/section-index.json`, sectionIndexDigest: published.digests.sectionIndex }
      derivedCommittedRun = await store.commit({ ...locked, foundationAuditState: { ...locked.foundationAuditState, status: 'derived_committed', derived }, status: 'running', blockedReason: undefined, thinking: 'working' }, { runId: locked.runId, type: 'foundation.fact.derived_committed', phase: locked.phase, status: 'running', revision: locked.revision, artifactManifestDigest: published.digests.manifest }, undefined, lease)
    } finally { await store.unlock(lease) }
    if (derivedCommittedRun) await completeDeterministicFoundationAudit(derivedCommittedRun)
  }

  async function completeDeterministicFoundationAudit(run: DeliveryRun): Promise<void> {
    const state = run.foundationAuditState
    if (!state || state.status !== 'derived_committed') return
    if (!state.derived) throw new Error('committed deterministic audit inputs are unavailable')
    const committed = await loadCommittedFoundationDerivedArtifacts({ workspacePath: input.workspacePath, revision: state.revision })
    if (!committed) throw new Error('committed derived authority is unavailable')
    const sectionIndex = committed.sectionIndex
    const factStore = committed.factStore
    const issues = runProductionDeterministicFoundationAudit({ sectionIndex, factStore })
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
      review.catalogVersion !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion ||
      review.contractGraphDigest !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contractGraphDigest
    )
      throw new Error('deterministic review is not bound to the controller production manifest')
    const reviewRoot = `.beegame/audit/foundation/${state.revision}/staging/review/${review.reviewDigest}`
    const deterministic = {
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
    const deterministicPrefix = await loadDeterministicFoundationReview({ workspacePath: input.workspacePath, revision: state.revision, reviewDigest: review.reviewDigest })
    if (!deterministicPrefix) throw new Error('deterministic review prefix failed closed')
    const semanticPackets = await Promise.all(FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(check => buildSemanticPacketFor({ workspacePath: input.workspacePath, revision: state.revision, checkId: check.checkId, sectionIndex, factStore, deterministicReviewDigest: review.reviewDigest, deterministicIssuePrefix: deterministicPrefix.issues, documentDigests: committed.documentDigests })))
    if (semanticPackets.length !== 10) throw new Error('semantic authority did not return exactly ten checks')
    const phaseStartedAt = new Date().toISOString()
    const semanticCollection = createFoundationSemanticTaskCollection({ revision: state.revision, phaseStartedAt, tasks: semanticPackets.map((packet, index) => ({ taskId: `${state.revision}:semantic:${index}:${packet.identity.slice(0, 12)}`, kind: 'semantic' as const, revision: state.revision, checkId: packet.checkId, packetDigest: packet.identity, modelTier: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks[index]!.modelTier, status: 'pending' as const, attempt: 0 })) })
    const lease = await store.mutationLock(run.runId)
    let seededRun: DeliveryRun | undefined
    try {
      const locked = await store.load(lease)
      if (!locked?.foundationAuditState || ['semantic_review', 'audit_ready'].includes(locked.foundationAuditState.status)) return
      if (locked.foundationAuditState.status !== 'derived_committed') throw new Error('foundation audit state changed during deterministic recovery')
      const { aggregateUsage: _factAggregateUsage, ...semanticBaseState } = locked.foundationAuditState
      seededRun = await store.commit({
        ...locked,
        foundationAuditState: { ...semanticBaseState, status: 'semantic_review', deterministic, tasks: semanticCollection.tasks, phaseStartedAt, semantic: { aggregateUsage: semanticCollection.aggregateUsage } },
        status: 'running', blockedReason: undefined, thinking: 'working',
      }, { runId: locked.runId, type: 'foundation.audit.semantic_review', phase: locked.phase, status: 'running', revision: locked.revision, reviewDigest: review.reviewDigest, semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest }, undefined, lease)
    } finally {
      await store.unlock(lease)
    }
    if (seededRun) await resumeUnlocked(seededRun)
  }

  async function finalizeFoundationSemanticReview(run: DeliveryRun): Promise<void> {
    const state = run.foundationAuditState
    if (!state || state.status !== 'semantic_review') return
    if (!state.deterministic || !state.derived) throw new Error('semantic finalization requires deterministic and derived bindings')
    const committed = await loadCommittedFoundationDerivedArtifacts({ workspacePath: input.workspacePath, revision: state.revision })
    const prefix = await loadDeterministicFoundationReview({ workspacePath: input.workspacePath, revision: state.revision, reviewDigest: state.deterministic.reviewDigest })
    if (!committed || !prefix) throw new Error('semantic finalization immutable inputs are unavailable')
    const sourceTasks = state.tasks.filter(task => task.kind === 'semantic') as Array<{ taskId: string; checkId: string; status: string; admittedResult?: FoundationSemanticResult }>
    if (sourceTasks.length !== 10 || sourceTasks.some(task => !task.admittedResult || task.status !== 'completed')) throw new Error('semantic finalization requires every source result')
    const resultLedger: { checkId: string; packetIdentity: string; admittedResultDigest: string; confirmationDigest?: string }[] = []
    const semanticDrafts = []
    for (const task of sourceTasks) {
      const packet = await buildSemanticPacketFor({ workspacePath: input.workspacePath, revision: state.revision, checkId: task.checkId, sectionIndex: committed.sectionIndex, factStore: committed.factStore, deterministicReviewDigest: prefix.reviewDigest, deterministicIssuePrefix: prefix.issues, documentDigests: committed.documentDigests })
      const confirmation = state.tasks.find(candidate => candidate.kind === 'confirmation' && candidate.sourceTaskId === task.taskId) as { admittedResult?: FoundationSemanticResult } | undefined
      const admitted = (confirmation?.admittedResult ?? task.admittedResult) as FoundationSemanticResult
      if (admitted.outcome === 'UNDECIDABLE') throw new Error('semantic confirmation remained undecidable')
      semanticDrafts.push(...semanticResultToFoundationIssueDrafts(packet, admitted))
      resultLedger.push({ checkId: task.checkId, packetIdentity: packet.identity, admittedResultDigest: digestFoundationSemanticResult(task.admittedResult!), ...(confirmation?.admittedResult ? { confirmationDigest: digestFoundationSemanticResult(confirmation.admittedResult) } : {}) })
    }
    const semanticIssues = compileFoundationIssueRegistry({ sectionIndex: committed.sectionIndex, factStore: committed.factStore, drafts: semanticDrafts })
    const issues = [...prefix.issues, ...semanticIssues]
    const review = await publishFoundationSemanticReview({ workspacePath: input.workspacePath, revision: state.revision, documentDigests: committed.documentDigests, sectionIndexDigest: committed.digests.sectionIndex, factStoreDigest: committed.digests.factStore, deterministicReviewDigest: prefix.reviewDigest, semanticManifest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST, semanticResultDigests: resultLedger, issues })
    const reviewRoot = `.beegame/audit/foundation/${state.revision}/review/${review.reviewDigest}`
    const finalState = { ...state, status: 'audit_ready' as const, review: { reviewDigest: review.reviewDigest, issueRegistryPath: `${reviewRoot}/issue-registry.json`, issueRegistryDigest: review.digests.issueRegistry, manifestPath: `${reviewRoot}/manifest.json`, manifestDigest: review.digests.manifest, markerPath: `${reviewRoot}/COMMITTED.json`, markerDigest: review.digests.marker, sectionIndexDigest: review.sectionIndexDigest, factStoreDigest: review.factStoreDigest, semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest } }
    const lease = await store.mutationLock(run.runId)
    try {
      const locked = await store.load(lease)
      if (!locked?.foundationAuditState || locked.foundationAuditState.status === 'audit_ready') return
      if (locked.foundationAuditState.status !== 'semantic_review') throw new Error('semantic review state changed during finalization')
      await store.commit({ ...locked, foundationAuditState: finalState, status: 'running', blockedReason: undefined, thinking: 'idle' }, { runId: locked.runId, type: 'foundation.audit.audit_ready', phase: locked.phase, status: 'running', revision: locked.revision, reviewDigest: review.reviewDigest }, undefined, lease)
    } finally { await store.unlock(lease) }
  }

  async function handleTerminalUnlocked(
    record: DispatchRecord,
    result: WorkerTerminalResult,
    request?: WorkerDispatchRequest,
  ): Promise<void> {
    const run = await store.load()
    const foundationCheckpoint = run?.foundationDraftState.documents?.find(
      document => document.dispatch?.dispatchId === record.dispatchId,
    )
    const foundationFactTask = run?.foundationAuditState?.tasks.find(
      task => task.dispatch?.dispatchId === record.dispatchId,
    )
    const foundationSemanticTask = run?.foundationAuditState?.tasks.find(
      task => task.dispatch?.dispatchId === record.dispatchId && (task.kind === 'semantic' || task.kind === 'confirmation'),
    )
    if (!run || (run.activeDispatch?.dispatchId !== record.dispatchId && !foundationCheckpoint && !foundationFactTask && !foundationSemanticTask))
      return
    if (foundationSemanticTask && result.workerType === 'foundation-semantic-reviewer') {
      const lease = await store.mutationLock(run.runId)
      let completedRun: DeliveryRun | undefined
      try {
        const locked = await store.load(lease)
        const lockedTask = locked?.foundationAuditState?.tasks.find(task => task.taskId === foundationSemanticTask.taskId)
        if (!locked || !lockedTask || (lockedTask.kind !== 'semantic' && lockedTask.kind !== 'confirmation') || lockedTask.dispatch?.dispatchId !== record.dispatchId) return
        const lockedState = locked.foundationAuditState!
        const committed = await loadCommittedFoundationDerivedArtifacts({ workspacePath: input.workspacePath, revision: lockedState.revision })
        const prefix = lockedState.deterministic ? await loadDeterministicFoundationReview({ workspacePath: input.workspacePath, revision: lockedState.revision, reviewDigest: lockedState.deterministic.reviewDigest }) : undefined
        if (!committed || !prefix) throw new Error('semantic audit immutable inputs are unavailable')
        const packet = await buildSemanticPacketFor({ workspacePath: input.workspacePath, revision: lockedState.revision, checkId: lockedTask.checkId, sectionIndex: committed.sectionIndex, factStore: committed.factStore, deterministicReviewDigest: prefix.reviewDigest, deterministicIssuePrefix: prefix.issues, documentDigests: committed.documentDigests })
        if (packet.identity !== lockedTask.packetDigest) throw new Error('semantic packet digest changed during terminal admission')
        if (!record.usage || !Number.isFinite(record.usage.total_tokens) || !Number.isFinite(record.usage.input_tokens) || !Number.isFinite(record.usage.completion_tokens) || record.usage.total_tokens < 0 || record.usage.input_tokens < 0 || record.usage.completion_tokens < 0 || !record.finishedAt || !Number.isFinite(Date.parse(record.startedAt)) || !Number.isFinite(Date.parse(record.finishedAt))) throw new Error('semantic terminal is missing measured usage or duration')
        const admitted = admitFoundationSemanticResult(packet, { checkId: lockedTask.checkId, packetIdentity: packet.identity, outcome: result.outcome, ...(result.issues !== undefined ? { issues: result.issues } : {}), ...(result.reason !== undefined ? { reason: result.reason } : {}) })
        const runtimeState: FoundationSemanticTaskCollection = { revision: lockedState.revision, phaseStartedAt: lockedState.phaseStartedAt!, status: 'semantic_review', tasks: lockedState.tasks.filter(task => task.kind === 'semantic' || task.kind === 'confirmation') as FoundationSemanticTaskCollection['tasks'], aggregateUsage: lockedState.semantic?.aggregateUsage ?? { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 }, ...(lockedState.semantic?.deepPhaseStartedAt ? { deepPhaseStartedAt: lockedState.semantic.deepPhaseStartedAt } : {}), ...(lockedState.semantic?.deepAggregateUsage ? { deepAggregateUsage: lockedState.semantic.deepAggregateUsage } : {}) }
        const admission = admitFoundationSemanticTerminal(runtimeState, { taskId: lockedTask.taskId, dispatchId: record.dispatchId, revision: result.revision, packetDigest: result.packetDigest, terminal: result as never, usage: record.usage, durationMs: Date.parse(record.finishedAt) - Date.parse(record.startedAt), now: new Date().toISOString() })
        let tasks = admission.state.tasks.map(task => task.taskId === lockedTask.taskId ? { ...task, ...(admission.accepted ? { admittedResult: admitted } : {}) } : task)
        let semanticState = { aggregateUsage: admission.state.aggregateUsage, ...(admission.state.deepPhaseStartedAt ? { deepPhaseStartedAt: admission.state.deepPhaseStartedAt } : {}), ...(admission.state.deepAggregateUsage ? { deepAggregateUsage: admission.state.deepAggregateUsage } : {}) }
        if (admission.accepted && !admission.idempotent && lockedTask.kind === 'semantic' && (admitted.outcome === 'UNDECIDABLE' || FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.find(check => check.checkId === lockedTask.checkId)?.severity === 'BLOCKER')) {
          const confirmation = appendFoundationConfirmationTask({ ...admission.state, tasks: tasks as FoundationSemanticTaskCollection['tasks'] }, { taskId: `${lockedTask.taskId}:confirmation`, sourceTaskId: lockedTask.taskId, admittedResult: admitted, now: new Date().toISOString() })
          tasks = confirmation.tasks.map(task => task.taskId === lockedTask.taskId ? { ...task, admittedResult: admitted } : task)
          semanticState = { aggregateUsage: confirmation.aggregateUsage, ...(confirmation.deepPhaseStartedAt ? { deepPhaseStartedAt: confirmation.deepPhaseStartedAt } : {}), ...(confirmation.deepAggregateUsage ? { deepAggregateUsage: confirmation.deepAggregateUsage } : {}) }
        }
        const finalTaskState = { ...lockedState, status: 'semantic_review' as const, tasks, semantic: semanticState }
        const hasNeedsAction = tasks.some(task => task.status === 'needs_action') || (admitted.outcome === 'UNDECIDABLE' && lockedTask.kind === 'confirmation')
        const runStatus: DeliveryRun['status'] = hasNeedsAction ? 'needs_action' : 'running'
        completedRun = await store.commit({ ...locked, foundationAuditState: finalTaskState, status: runStatus, blockedReason: hasNeedsAction ? 'semantic audit needs action' : undefined, thinking: hasNeedsAction ? 'idle' : 'working' }, { runId: locked.runId, type: admission.idempotent ? 'foundation.semantic.terminal.replayed' : 'foundation.semantic.terminal.admitted', phase: locked.phase, status: runStatus, revision: locked.revision, dispatchId: record.dispatchId, taskId: lockedTask.taskId, terminalDigest: admission.terminalDigest }, undefined, lease)
      } finally { await store.unlock(lease) }
      if (completedRun && completedRun.status === 'running' && completedRun.foundationAuditState && foundationSemanticTasksComplete({ revision: completedRun.foundationAuditState.revision, phaseStartedAt: completedRun.foundationAuditState.phaseStartedAt!, status: 'semantic_review', tasks: completedRun.foundationAuditState.tasks.filter(task => task.kind === 'semantic' || task.kind === 'confirmation') as FoundationSemanticTaskCollection['tasks'], aggregateUsage: completedRun.foundationAuditState.semantic?.aggregateUsage ?? { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 }, ...(completedRun.foundationAuditState.semantic?.deepPhaseStartedAt ? { deepPhaseStartedAt: completedRun.foundationAuditState.semantic.deepPhaseStartedAt } : {}), ...(completedRun.foundationAuditState.semantic?.deepAggregateUsage ? { deepAggregateUsage: completedRun.foundationAuditState.semantic.deepAggregateUsage } : {}) })) await finalizeFoundationSemanticReview(completedRun)
      else if (completedRun?.status === 'running') await resumeUnlocked(completedRun)
      return
    }
    if (foundationFactTask && result.workerType === 'foundation-fact-extractor') {
      const lease = await store.mutationLock(run.runId)
      let factsStagedRun: DeliveryRun | undefined
      try {
        const locked = await store.load(lease)
        const lockedTask = locked?.foundationAuditState?.tasks.find(task => task.taskId === foundationFactTask.taskId)
        if (!locked || !lockedTask || !lockedTask.dispatch || lockedTask.dispatch.dispatchId !== record.dispatchId) return
        const lockedState = locked.foundationAuditState!
        if (lockedTask.status === 'completed') {
          if (lockedTask.terminalDigest !== digestFoundationFactTerminal(result as never)) throw new Error('conflicting foundation fact terminal replay')
          if (lockedState.status === 'facts_staged') factsStagedRun = locked
        } else {
        const packet = request?.contract.packet
        if (!packet || typeof packet !== 'object') throw new Error('foundation fact packet is missing from dispatch contract')
        const artifacts = await loadFoundationAuditArtifacts({ workspacePath: input.workspacePath, revision: locked.revision.document, expectedState: locked.foundationAuditState })
        if (!artifacts) throw new Error('foundation fact section index is unavailable')
        const documents = new Map(await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(input.workspacePath, path), 'utf8')] as const)))
        let validated: ReturnType<typeof validateFoundationFactResults>
        try {
          validated = validateFoundationFactResults({ packet: packet as never, expectedRevision: lockedTask.revision, documents, sectionIndex: artifacts.sectionIndex, results: result.results as never })
        } catch (error) {
          const invalid = new Error(error instanceof Error ? error.message : 'foundation fact result is invalid')
          invalid.name = (record.usage?.completion_tokens ?? 0) > 512
            ? 'FoundationFactOutputCapError'
            : 'FoundationFactInvalidResultError'
          throw invalid
        }
        const runtimeState: FoundationFactTaskCollection = { revision: lockedState.revision, phaseStartedAt: lockedState.phaseStartedAt!, status: lockedState.status === 'facts_staged' ? 'facts_staged' : 'extracting_facts', tasks: lockedState.tasks.filter(task => task.kind === 'document-facts'), aggregateUsage: lockedState.aggregateUsage ?? { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 } }
        const admission = admitFoundationFactTerminal(runtimeState, { taskId: lockedTask.taskId, dispatchId: record.dispatchId, revision: result.revision, packetDigest: result.packetDigest, terminal: result, usage: record.usage ?? { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 }, durationMs: Math.max(0, Date.parse(record.finishedAt ?? new Date().toISOString()) - Date.parse(record.startedAt)), now: new Date().toISOString() })
        let auditState: FoundationAuditState = { ...lockedState, status: admission.state.status, tasks: admission.state.tasks, aggregateUsage: admission.state.aggregateUsage }
        const admittedTask = admission.state.tasks.find(task => task.taskId === lockedTask.taskId)!
        if (admission.accepted && !admission.idempotent) {
          const receipt = await writeFoundationFactReceipt({ workspacePath: input.workspacePath, revision: lockedTask.revision, receipt: { taskId: lockedTask.taskId, revision: lockedTask.revision, packetDigest: lockedTask.packetDigest, terminalDigest: admission.terminalDigest, normalizedFactDigest: validated.normalizedFactDigest, receipts: validated.receipts, facts: validated.facts, usage: admittedTask.usage, durationMs: admittedTask.durationMs ?? 0 } })
          auditState = { ...auditState, tasks: auditState.tasks.map(task => task.taskId === lockedTask.taskId ? { ...task, receiptPath: receipt.path, receiptDigest: receipt.digest } : task) }
        }
        const collectionAfterReceipt: FoundationFactTaskCollection = { ...admission.state, tasks: auditState.tasks.filter(task => task.kind === 'document-facts') }
        if (foundationFactTasksComplete(collectionAfterReceipt)) {
          auditState = { ...auditState, status: 'facts_staged' }
          factsStagedRun = await store.commit({ ...locked, foundationAuditState: auditState, status: 'running', blockedReason: undefined, thinking: 'working' }, { runId: locked.runId, type: 'foundation.fact.facts_staged', phase: locked.phase, status: 'running', revision: locked.revision, dispatchId: record.dispatchId, taskId: lockedTask.taskId, terminalDigest: admission.terminalDigest }, undefined, lease)
        } else {
          const status: DeliveryRun['status'] = auditState.tasks.some(task => task.status === 'needs_action') ? 'needs_action' : 'running'
          await store.commit({ ...locked, foundationAuditState: auditState, status, blockedReason: status === 'needs_action' ? 'foundation fact extraction needs action' : undefined, thinking: status === 'running' ? 'working' : 'idle' }, { runId: locked.runId, type: admission.idempotent ? 'foundation.fact.terminal.replayed' : 'foundation.fact.terminal.admitted', phase: locked.phase, status, revision: locked.revision, dispatchId: record.dispatchId, taskId: lockedTask.taskId, terminalDigest: admission.terminalDigest }, undefined, lease)
        }
        }
      } finally { await store.unlock(lease) }
      if (factsStagedRun) await finalizeFoundationFacts(factsStagedRun)
      else {
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
      if (next.blockedReason && next.status === 'running') {
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

  async function resumeUnlocked(run: DeliveryRun): Promise<void> {
    if (run.status !== 'running') return
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
        if (!unavailable.length) return
        let foundationDraftState = run.foundationDraftState
        for (const document of unavailable)
          foundationDraftState = recordFoundationFailure(
            foundationDraftState,
            document.path,
            'preserved native document session is unavailable',
          )
        const stillRunning = foundationDraftState.documents?.some(
          document => document.dispatch?.status === 'running',
        )
        const recovered = await persist(
          {
            ...run,
            foundationDraftState,
            status: stillRunning ? 'running' : 'needs_action',
            blockedReason: stillRunning
              ? undefined
              : 'one or more preserved native document sessions are unavailable',
          },
          'document.parallel.session_unavailable',
        )
        if (recovered.status === 'running') await resumeUnlocked(recovered)
        return
      }
    }
    if (run.activeDispatch?.terminalResult) {
      // resumeUnlocked already owns the controller serialization lane. Reuse
      // the canonical terminal handler directly instead of queueing behind
      // ourselves through handleTerminal.
      await dispatcher.replayTerminal(
        run.activeDispatch,
        handleTerminalUnlocked,
      )
      return
    }
    if (run.foundationAuditState) {
      const replayableFactDispatches = run.foundationAuditState.tasks
        .filter(task => task.status !== 'completed' && task.dispatch?.terminalResult && !terminalAdmissionInFlight.has(task.dispatch.dispatchId))
        .map(task => task.dispatch!)
      if (replayableFactDispatches.length) {
        for (const dispatch of replayableFactDispatches)
          await dispatcher.replayTerminal(dispatch, handleTerminalUnlocked)
        return
      }
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
      if (run.foundationAuditState?.status === 'derived_committed') {
        await completeDeterministicFoundationAudit(run)
        return
      }
      if (run.foundationAuditState?.status === 'facts_staged') {
        await finalizeFoundationFacts(run)
        return
      }
      if (run.foundationAuditState?.status === 'semantic_review') {
        const replayable = run.foundationAuditState.tasks.filter(task => (task.kind === 'semantic' || task.kind === 'confirmation') && task.status !== 'completed' && task.dispatch?.terminalResult && !terminalAdmissionInFlight.has(task.dispatch.dispatchId)).map(task => task.dispatch!)
        if (replayable.length) { for (const dispatch of replayable) await dispatcher.replayTerminal(dispatch, handleTerminalUnlocked); return }
        const available = run.foundationAuditState.tasks.filter(task => (task.kind === 'semantic' || task.kind === 'confirmation') && (task.status === 'pending' || task.status === 'retryable')) as Array<{ taskId: string; checkId: string; revision: string; packetDigest: string; modelTier: 'fast' | 'balanced' | 'strong' }>
        const running = run.foundationAuditState.tasks.filter(task => task.status === 'running').length
        if (running >= FOUNDATION_SEMANTIC_MAX_RUNNING || !available.length) return
        const committed = await loadCommittedFoundationDerivedArtifacts({ workspacePath: input.workspacePath, revision: run.foundationAuditState.revision })
        const prefix = run.foundationAuditState.deterministic ? await loadDeterministicFoundationReview({ workspacePath: input.workspacePath, revision: run.foundationAuditState.revision, reviewDigest: run.foundationAuditState.deterministic.reviewDigest }) : undefined
        if (!committed || !prefix) throw new Error('semantic audit immutable inputs are unavailable')
        for (const task of available.slice(0, FOUNDATION_SEMANTIC_MAX_RUNNING - running)) {
          const packet = await buildSemanticPacketFor({ workspacePath: input.workspacePath, revision: run.foundationAuditState.revision, checkId: task.checkId, sectionIndex: committed.sectionIndex, factStore: committed.factStore, deterministicReviewDigest: prefix.reviewDigest, deterministicIssuePrefix: prefix.issues, documentDigests: committed.documentDigests })
          if (packet.identity !== task.packetDigest) throw new Error('semantic retry packet differs from immutable task packet')
          await dispatcher.dispatch({ runId: run.runId, ownerId: run.ownerId, projectId: run.projectId, workspacePath: input.workspacePath, workerType: 'foundation-semantic-reviewer', phase: 'DOCUMENT_REVIEW', taskId: task.taskId, revision: task.revision, allowedPaths: [], projectReadScope: 'empty', workflowJsonSchema: foundationSemanticReviewerStructuredOutputJsonSchema as unknown as Record<string, unknown>, contract: { packet, packetDigest: task.packetDigest, modelTier: task.modelTier, taskId: task.taskId, workerType: 'foundation-semantic-reviewer', checkId: task.checkId } })
        }
        return
      }
      if (run.foundationAuditState?.status === 'extracting_facts') {
        const available = run.foundationAuditState.tasks.filter(task => task.status === 'pending' || task.status === 'retryable')
        const running = run.foundationAuditState.tasks.filter(task => task.status === 'running').length
        if (running >= 4 || available.length === 0) return
        for (const task of available.slice(0, 4 - running)) {
          const packetPath = join(input.workspacePath, `.beegame/audit/foundation/${run.foundationAuditState.revision}/staging/packets/${task.taskId}.json`)
          const packet = JSON.parse(await readFile(packetPath, 'utf8')) as Record<string, unknown>
          await dispatcher.dispatch({ runId: run.runId, ownerId: run.ownerId, projectId: run.projectId, workspacePath: input.workspacePath, workerType: 'foundation-fact-extractor', phase: 'DOCUMENT_REVIEW', taskId: task.taskId, revision: task.revision, allowedPaths: [], projectReadScope: 'empty', workflowJsonSchema: foundationFactStructuredOutputJsonSchema as unknown as Record<string, unknown>, contract: { packet, packetDigest: task.packetDigest, modelTier: task.modelTier, taskId: task.taskId, workerType: 'foundation-fact-extractor' } })
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
      // Polling and retry requests may carry a stale snapshot. Always make the
      // recovery decision from the durable run so an orphaned `running` state
      // cannot be preserved by an outdated activeDispatch value.
      const current = await store.load()
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
