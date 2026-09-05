import type { DeliveryRun, DispatchRecord } from './types'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import { foundationRuntimeTasks } from './foundation-audit-state'
import {
  projectReviewSchedulingTask,
  projectReviewSchedulingUsage,
  type FoundationReviewSchedulingContext,
  type FoundationReviewFactsInput,
  type FoundationDeterministicReviewInput,
  type FoundationReviewSummaryInput,
  type FoundationSemanticTerminalReviewSnapshot,
  type FoundationReviewFactTerminalInput,
  projectFoundationSemanticTerminalTask,
  projectFoundationFactTerminalTask,
} from './stages/foundation-review/public'

export function projectFoundationFactTerminal(
  run: DeliveryRun,
  workspacePath: string,
  targetTaskId: string,
  record: DispatchRecord,
  result: FoundationReviewFactTerminalInput['result'],
  packet: unknown,
): FoundationReviewFactTerminalInput {
  const state = run.foundationAuditState!
  return {
    workspacePath,
    targetTaskId,
    record: structuredClone(record),
    result: structuredClone(result),
    packet: structuredClone(packet),
    snapshot: {
      revision: state.revision,
      artifactRevision: run.revision.document,
      phase: 'DOCUMENT_REVIEW',
      status: state.status,
      phaseStartedAt: state.phaseStartedAt!,
      documentDigests: Object.fromEntries(CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, state.documentDigests[path]])) as typeof state.documentDigests,
      sectionIndexDigest: state.sectionIndexDigest,
      sectionIndexPath: state.sectionIndexPath,
      manifestPath: state.manifestPath,
      aggregateUsage: projectReviewSchedulingUsage(state.aggregateUsage),
      tasks: state.tasks.filter(task => task.kind === 'document-facts').map(projectFoundationFactTerminalTask),
    },
  }
}

export function projectFoundationReviewSummary(run: DeliveryRun, workspacePath: string): FoundationReviewSummaryInput {
  const state = run.foundationAuditState!
  return {
    workspacePath,
    snapshot: {
      revision: state.revision,
      derived: state.derived ? {
        manifestPath: state.derived.manifestPath, manifestDigest: state.derived.manifestDigest,
        markerPath: state.derived.markerPath, markerDigest: state.derived.markerDigest,
        factStorePath: state.derived.factStorePath, factStoreDigest: state.derived.factStoreDigest,
        sectionIndexPath: state.derived.sectionIndexPath, sectionIndexDigest: state.derived.sectionIndexDigest,
      } : undefined,
      deterministic: state.deterministic ? {
        reviewDigest: state.deterministic.reviewDigest,
        issueRegistryPath: state.deterministic.issueRegistryPath, issueRegistryDigest: state.deterministic.issueRegistryDigest,
        manifestPath: state.deterministic.manifestPath, manifestDigest: state.deterministic.manifestDigest,
        markerPath: state.deterministic.markerPath, markerDigest: state.deterministic.markerDigest,
        catalogVersion: state.deterministic.catalogVersion, contractGraphDigest: state.deterministic.contractGraphDigest,
        sectionIndexDigest: state.deterministic.sectionIndexDigest, factStoreDigest: state.deterministic.factStoreDigest,
      } : undefined,
      tasks: foundationRuntimeTasks(state).filter(task => task.kind === 'semantic' || task.kind === 'confirmation').map(task => ({
        taskId: task.taskId, kind: task.kind, revision: task.revision, checkId: task.checkId,
        packetDigest: task.packetDigest, status: task.status,
        ...(task.kind === 'confirmation' ? { sourceTaskId: task.sourceTaskId } : {}),
        ...(task.admittedResult !== undefined ? { admittedResult: structuredClone(task.admittedResult) } : {}),
      })),
    },
  }
}

// Admission reads persisted review tasks; completion checks the active runtime
// collection returned by the store, matching the original post-commit boundary.
export function projectFoundationSemanticTerminal(
  run: DeliveryRun,
  postCommit = false,
): FoundationSemanticTerminalReviewSnapshot {
  const state = run.foundationAuditState!
  return {
    revision: state.revision,
    deterministicReviewDigest: state.deterministic?.reviewDigest,
    phaseStartedAt: state.phaseStartedAt!,
    tasks: (postCommit ? foundationRuntimeTasks(state) : state.tasks)
      .filter(task => task.kind === 'semantic' || task.kind === 'confirmation')
      .map(projectFoundationSemanticTerminalTask),
    aggregateUsage: projectReviewSchedulingUsage(state.semantic?.aggregateUsage) ?? { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    ...(state.semantic?.deepPhaseStartedAt ? { deepPhaseStartedAt: state.semantic.deepPhaseStartedAt } : {}),
    ...(state.semantic?.deepAggregateUsage ? { deepAggregateUsage: projectReviewSchedulingUsage(state.semantic.deepAggregateUsage)! } : {}),
  }
}

// Global routing adapter: reads only the current review slice, without exposing
// the combined persisted audit/revision state to stage-private code.
export function projectFoundationReviewScheduling(
  run: DeliveryRun,
  workspacePath: string,
): FoundationReviewSchedulingContext | undefined {
  if (run.phase !== 'DOCUMENT_REVIEW') throw new Error('review scheduling context requires DOCUMENT_REVIEW')
  const state = run.foundationAuditState
  if (!state) return undefined
  const status = state.status
  if (
    status !== 'extracting_facts' && status !== 'facts_staged' &&
    status !== 'derived_committed' && status !== 'deterministic_ready' &&
    status !== 'semantic_review'
  ) return undefined
  const runtimeTasks = foundationRuntimeTasks(state)
  return structuredClone({
    runId: run.runId,
    ownerId: run.ownerId,
    projectId: run.projectId,
    workspacePath,
    revision: state.revision,
    status,
    phaseStartedAt: state.phaseStartedAt,
    tasks: runtimeTasks.filter(task => task.kind === 'document-facts' || task.kind === 'semantic' || task.kind === 'confirmation').map(projectReviewSchedulingTask),
    runningTaskCount: runtimeTasks.filter(task => task.status === 'running').length,
    deterministicReviewDigest: state.deterministic?.reviewDigest,
    semantic: state.semantic ? {
      aggregateUsage: projectReviewSchedulingUsage(state.semantic.aggregateUsage),
      deepPhaseStartedAt: state.semantic.deepPhaseStartedAt,
      deepAggregateUsage: projectReviewSchedulingUsage(state.semantic.deepAggregateUsage),
    } : undefined,
  })
}

export function projectFoundationReviewFacts(
  run: DeliveryRun,
  workspacePath: string,
): FoundationReviewFactsInput {
  const state = run.foundationAuditState
  if (run.phase !== 'DOCUMENT_REVIEW' || !state || state.status !== 'facts_staged')
    throw new Error('review facts context requires staged review facts')
  return {
    workspacePath,
    snapshot: {
      revision: state.revision,
      status: state.status,
      documentDigests: Object.fromEntries(CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, state.documentDigests[path]])) as typeof state.documentDigests,
      sectionIndexDigest: state.sectionIndexDigest,
      sectionIndexPath: state.sectionIndexPath,
      manifestPath: state.manifestPath,
      tasks: foundationRuntimeTasks(state).filter(task => task.kind === 'document-facts').map(task => ({
        taskId: task.taskId,
        kind: task.kind,
        revision: task.revision,
        packetDigest: task.packetDigest,
        terminalDigest: task.terminalDigest,
        receiptPath: task.receiptPath,
        receiptDigest: task.receiptDigest,
      })),
    },
  }
}

export function projectFoundationDeterministicReview(
  run: DeliveryRun,
  workspacePath: string,
): FoundationDeterministicReviewInput {
  const state = run.foundationAuditState
  if (run.phase !== 'DOCUMENT_REVIEW' || !state || (state.status !== 'derived_committed' && state.status !== 'deterministic_ready'))
    throw new Error('deterministic review context requires committed review facts')
  return {
    workspacePath,
    revision: state.revision,
    status: state.status,
    derived: state.derived ? {
      manifestPath: state.derived.manifestPath,
      manifestDigest: state.derived.manifestDigest,
      markerPath: state.derived.markerPath,
      markerDigest: state.derived.markerDigest,
      factStorePath: state.derived.factStorePath,
      factStoreDigest: state.derived.factStoreDigest,
      sectionIndexPath: state.derived.sectionIndexPath,
      sectionIndexDigest: state.derived.sectionIndexDigest,
    } : undefined,
    deterministic: state.deterministic ? {
      reviewDigest: state.deterministic.reviewDigest,
      issueRegistryPath: state.deterministic.issueRegistryPath,
      issueRegistryDigest: state.deterministic.issueRegistryDigest,
      manifestPath: state.deterministic.manifestPath,
      manifestDigest: state.deterministic.manifestDigest,
      markerPath: state.deterministic.markerPath,
      markerDigest: state.deterministic.markerDigest,
      catalogVersion: state.deterministic.catalogVersion,
      contractGraphDigest: state.deterministic.contractGraphDigest,
      sectionIndexDigest: state.deterministic.sectionIndexDigest,
      factStoreDigest: state.deterministic.factStoreDigest,
    } : undefined,
  }
}
