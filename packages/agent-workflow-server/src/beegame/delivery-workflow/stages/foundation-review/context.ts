import type { DispatchRecord, WorkflowUsage } from '../../types'
import type { FoundationFactTask } from '../../foundation-fact-runtime'
import type { FoundationSemanticRuntimeTask } from '../../foundation-semantic-runtime'

export type FoundationReviewSchedulingStatus =
  | 'extracting_facts'
  | 'facts_staged'
  | 'derived_committed'
  | 'deterministic_ready'
  | 'semantic_review'

type SchedulingEvidence = 'taskId' | 'revision' | 'packetDigest' | 'status' | 'attempt' | 'terminalDigest' | 'usage' | 'durationMs' | 'dispatch'
export type FoundationReviewSchedulingTask =
  | (Pick<FoundationFactTask, SchedulingEvidence | 'kind' | 'factKeyCount' | 'modelTier'> & { hasTerminalResult: boolean })
  | (Pick<Extract<FoundationSemanticRuntimeTask, { kind: 'semantic' }>, SchedulingEvidence | 'kind' | 'checkId' | 'modelTier'> & { hasTerminalResult: boolean })
  | (Pick<Extract<FoundationSemanticRuntimeTask, { kind: 'confirmation' }>, SchedulingEvidence | 'kind' | 'checkId' | 'sourceTaskId' | 'modelTier'> & { hasTerminalResult: boolean })

// Scheduler inputs intentionally exclude the revision authority, candidate
// bundles, author state and dispatch terminal payloads. No mutable disk envelope.
export interface FoundationReviewSchedulingContext {
  runId: string
  ownerId: string
  projectId: string
  workspacePath: string
  revision: string
  status: FoundationReviewSchedulingStatus
  phaseStartedAt?: string
  tasks: FoundationReviewSchedulingTask[]
  runningTaskCount: number
  deterministicReviewDigest?: string
  semantic?: {
    aggregateUsage?: WorkflowUsage
    deepPhaseStartedAt?: string
    deepAggregateUsage?: WorkflowUsage
  }
}

export function projectReviewSchedulingTask(
  task: FoundationFactTask | FoundationSemanticRuntimeTask,
): FoundationReviewSchedulingTask {
  const dispatch: DispatchRecord | undefined = task.dispatch ? {
    dispatchId: task.dispatch.dispatchId,
    workerType: task.dispatch.workerType,
    phase: task.dispatch.phase,
    revision: task.dispatch.revision,
    status: task.dispatch.status,
    startedAt: task.dispatch.startedAt,
  } : undefined
  const common = {
    taskId: task.taskId,
    revision: task.revision,
    packetDigest: task.packetDigest,
    status: task.status,
    attempt: task.attempt,
    terminalDigest: task.terminalDigest,
    usage: projectReviewSchedulingUsage(task.usage),
    durationMs: task.durationMs,
    dispatch,
    hasTerminalResult: Boolean(task.dispatch?.terminalResult),
  }
  if (task.kind === 'document-facts') return { ...common, kind: task.kind, factKeyCount: task.factKeyCount, modelTier: task.modelTier }
  if (task.kind === 'semantic') return { ...common, kind: task.kind, checkId: task.checkId, modelTier: task.modelTier }
  return { ...common, kind: task.kind, checkId: task.checkId, sourceTaskId: task.sourceTaskId, modelTier: task.modelTier, attempt: task.attempt }
}

export function projectReviewSchedulingUsage(usage: WorkflowUsage | undefined): WorkflowUsage | undefined {
  return usage ? {
    input_tokens: usage.input_tokens,
    cache_read_tokens: usage.cache_read_tokens,
    cache_creation_tokens: usage.cache_creation_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  } : undefined
}
