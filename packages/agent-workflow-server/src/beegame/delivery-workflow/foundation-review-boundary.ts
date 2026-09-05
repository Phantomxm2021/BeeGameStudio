import type { DeliveryRun } from './types'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import { foundationRuntimeTasks } from './foundation-audit-state'
import {
  projectReviewSchedulingTask,
  projectReviewSchedulingUsage,
  type FoundationReviewSchedulingContext,
  type FoundationReviewFactsInput,
  type FoundationDeterministicReviewInput,
} from './stages/foundation-review/public'

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
