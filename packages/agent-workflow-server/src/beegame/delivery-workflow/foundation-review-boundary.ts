import type { DeliveryRun } from './types'
import { foundationRuntimeTasks } from './foundation-audit-state'
import {
  projectReviewSchedulingTask,
  projectReviewSchedulingUsage,
  type FoundationReviewSchedulingContext,
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
