import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkerDispatchRequest } from '../../types'
import type { FoundationFactPacket } from '../../foundation-fact-extraction'
import { buildFoundationFactStructuredOutputJsonSchema, foundationSemanticReviewerStructuredOutputJsonSchema } from '../../worker-contracts'
import { loadCommittedFoundationDerivedArtifacts, loadDeterministicFoundationReview } from '../../foundation-audit-artifacts'
import { FOUNDATION_SEMANTIC_MAX_RUNNING, foundationSemanticTasksComplete, type FoundationSemanticTaskCollection } from '../../foundation-semantic-runtime'
import { buildSemanticPacketFor, requireSectionAuditIssues } from './packets'
import type { FoundationReviewSchedulingContext } from './context'

export type FoundationReviewScheduleResult =
  | 'handled'
  | 'not-handled'
  | 'finalize-facts'
  | 'complete-deterministic'
  | 'finalize-semantic'

export interface FoundationReviewSchedulingPorts {
  // Admission is live: a serialized callback may become in-flight during replay.
  isTerminalAdmissionInFlight(dispatchId: string): boolean
  replayTerminal(dispatchId: string): Promise<void>
  dispatch(request: WorkerDispatchRequest): Promise<void>
}

export async function resumeFoundationReview(
  context: FoundationReviewSchedulingContext | undefined,
  ports: FoundationReviewSchedulingPorts,
): Promise<FoundationReviewScheduleResult> {
  if (!context) return 'not-handled'
  if (context.status === 'derived_committed' || context.status === 'deterministic_ready') return 'complete-deterministic'
  if (context.status === 'facts_staged') return 'finalize-facts'
  const runtimeTasks = context.tasks
  if (context.status === 'semantic_review') {
    const replayable = runtimeTasks.filter(task => (task.kind === 'semantic' || task.kind === 'confirmation') && task.status !== 'completed' && task.hasTerminalResult && task.dispatch && !ports.isTerminalAdmissionInFlight(task.dispatch.dispatchId)).map(task => task.dispatch!.dispatchId)
    if (replayable.length) {
      for (const dispatchId of replayable) await ports.replayTerminal(dispatchId)
      return 'handled'
    }
    const semanticRuntime: FoundationSemanticTaskCollection = {
      revision: context.revision,
      phaseStartedAt: context.phaseStartedAt!,
      status: 'semantic_review',
      tasks: runtimeTasks.filter(task => task.kind === 'semantic' || task.kind === 'confirmation'),
      aggregateUsage: context.semantic?.aggregateUsage ?? { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      ...(context.semantic?.deepPhaseStartedAt ? { deepPhaseStartedAt: context.semantic.deepPhaseStartedAt } : {}),
      ...(context.semantic?.deepAggregateUsage ? { deepAggregateUsage: context.semantic.deepAggregateUsage } : {}),
    }
    if (foundationSemanticTasksComplete(semanticRuntime)) return 'finalize-semantic'
    const available = runtimeTasks.filter(task => (task.kind === 'semantic' || task.kind === 'confirmation') && (task.status === 'pending' || task.status === 'retryable')) as Array<{ taskId: string; checkId: string; revision: string; packetDigest: string; modelTier: 'fast' | 'balanced' | 'strong'; kind: 'semantic' | 'confirmation'; sourceTaskId?: string }>
    const running = context.runningTaskCount
    if (running >= FOUNDATION_SEMANTIC_MAX_RUNNING || !available.length) return 'handled'
    const committed = await loadCommittedFoundationDerivedArtifacts({ workspacePath: context.workspacePath, revision: context.revision })
    const prefix = context.deterministicReviewDigest ? await loadDeterministicFoundationReview({ workspacePath: context.workspacePath, revision: context.revision, reviewDigest: context.deterministicReviewDigest }) : undefined
    if (!committed || !prefix) throw new Error('semantic audit immutable inputs are unavailable')
    for (const task of available.slice(0, FOUNDATION_SEMANTIC_MAX_RUNNING - running)) {
      const packet = await buildSemanticPacketFor({ workspacePath: context.workspacePath, revision: context.revision, checkId: task.checkId, sectionIndex: committed.sectionIndex, factStore: committed.factStore, deterministicReviewDigest: prefix.reviewDigest, deterministicIssuePrefix: requireSectionAuditIssues(prefix.issues), documentDigests: committed.documentDigests })
      if (packet.identity !== task.packetDigest) throw new Error('semantic retry packet differs from immutable task packet')
      await ports.dispatch({ runId: context.runId, ownerId: context.ownerId, projectId: context.projectId, workspacePath: context.workspacePath, workerType: 'foundation-semantic-reviewer', phase: 'DOCUMENT_REVIEW', taskId: task.taskId, revision: task.revision, allowedPaths: [], projectReadScope: 'empty', workflowJsonSchema: foundationSemanticReviewerStructuredOutputJsonSchema as unknown as Record<string, unknown>, contract: { packet, packetDigest: task.packetDigest, modelTier: task.modelTier, taskId: task.taskId, revision: task.revision, workerType: 'foundation-semantic-reviewer', checkId: task.checkId, kind: task.kind, ...(task.kind === 'confirmation' ? { sourceTaskId: task.sourceTaskId } : {}) } })
    }
    return 'handled'
  }
  if (context.status === 'extracting_facts') {
    const available = runtimeTasks.filter(task => task.kind === 'document-facts' && (task.status === 'pending' || task.status === 'retryable')) as Array<{ taskId: string; revision: string; packetDigest: string; modelTier: 'fast' }>
    const running = context.runningTaskCount
    if (running >= 4 || available.length === 0) return 'handled'
    for (const task of available.slice(0, 4 - running)) {
      const packetPath = join(context.workspacePath, `.beegame/audit/foundation/${context.revision}/staging/packets/${task.taskId}.json`)
      const packet = JSON.parse(await readFile(packetPath, 'utf8')) as Record<string, unknown>
      await ports.dispatch({ runId: context.runId, ownerId: context.ownerId, projectId: context.projectId, workspacePath: context.workspacePath, workerType: 'foundation-fact-extractor', phase: 'DOCUMENT_REVIEW', taskId: task.taskId, revision: task.revision, allowedPaths: [], projectReadScope: 'empty', workflowJsonSchema: buildFoundationFactStructuredOutputJsonSchema(packet as FoundationFactPacket), contract: { packet, packetDigest: task.packetDigest, modelTier: task.modelTier, taskId: task.taskId, revision: task.revision, workerType: 'foundation-fact-extractor' } })
    }
    return 'handled'
  }
  throw new Error('invalid foundation review scheduling status')
}

export interface FoundationReviewDuplicateDispatchContext {
  request: { revision: string; workerType: string; packetDigest: unknown }
  task?: {
    revision: string
    kind: string
    packetDigest: string
    status: string
    dispatch?: { status: string; workerType: string }
  }
  runningTaskCount: number
}

// A transport duplicate is only harmless when its exact task is already live
// or the pending/retryable task is waiting on the existing four-slot ceiling.
export function mayIgnoreDuplicateFoundationReviewDispatch(
  context: FoundationReviewDuplicateDispatchContext,
): boolean {
  const { request, task } = context
  if (!task || task.revision !== request.revision || task.packetDigest !== request.packetDigest) return false
  const sameKind = request.workerType === 'foundation-fact-extractor'
    ? task.kind === 'document-facts'
    : task.kind === 'semantic' || task.kind === 'confirmation'
  if (!sameKind) return false
  if (task.status === 'running' && task.dispatch?.status === 'running' && task.dispatch.workerType === request.workerType) return true
  return (task.status === 'pending' || task.status === 'retryable') && context.runningTaskCount >= 4
}

