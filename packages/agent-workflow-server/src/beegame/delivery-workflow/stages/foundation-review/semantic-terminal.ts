import type {
  DispatchRecord,
  WorkflowUsage,
} from '../../types'
import {
  FOUNDATION_SEMANTIC_AUDIT_MANIFEST,
  admitFoundationSemanticResult,
  type FoundationSemanticResult,
} from '../../foundation-semantic-audit'
import {
  admitFoundationSemanticTerminal,
  appendFoundationConfirmationTask,
  foundationSemanticTasksComplete,
  type FoundationSemanticRuntimeTask,
  type FoundationSemanticTaskCollection,
} from '../../foundation-semantic-runtime'
import { projectTaskTerminalEvidence } from '../../task-terminal-evidence'
import { buildSemanticPacketFor, requireSectionAuditIssues } from './packets'
import {
  loadCommittedFoundationDerivedArtifacts,
  loadDeterministicFoundationReview,
} from '../../foundation-audit-artifacts'

/**
 * The semantic terminal operation receives only the review-owned slice needed
 * to admit one terminal.  In particular, it does not receive the persisted
 * DeliveryRun or FoundationAuditState envelope.
 */
export type FoundationSemanticTerminalTask = FoundationSemanticRuntimeTask & {
  admittedResult?: FoundationSemanticResult
}

export type FoundationSemanticTerminalReviewSnapshot = {
  revision: string
  deterministicReviewDigest?: string
  phaseStartedAt: string
  tasks: FoundationSemanticTerminalTask[]
  aggregateUsage: WorkflowUsage
  deepPhaseStartedAt?: string
  deepAggregateUsage?: WorkflowUsage
}

export type FoundationSemanticTerminalAdmissionOutput = {
  taskId: string
  tasks: FoundationSemanticTerminalTask[]
  aggregateUsage: WorkflowUsage
  deepPhaseStartedAt?: string
  deepAggregateUsage?: WorkflowUsage
  idempotent: boolean
  accepted: boolean
  terminalDigest: string
  status: 'running' | 'needs_action'
  blockedReason?: string
  thinking: 'working' | 'idle'
}

function toRuntimeCollection(
  snapshot: FoundationSemanticTerminalReviewSnapshot,
): FoundationSemanticTaskCollection {
  return {
    revision: snapshot.revision,
    phaseStartedAt: snapshot.phaseStartedAt,
    status: 'semantic_review',
    tasks: snapshot.tasks,
    aggregateUsage: snapshot.aggregateUsage,
    ...(snapshot.deepPhaseStartedAt ? { deepPhaseStartedAt: snapshot.deepPhaseStartedAt } : {}),
    ...(snapshot.deepAggregateUsage ? { deepAggregateUsage: snapshot.deepAggregateUsage } : {}),
  }
}

/** Check completion from the exact post-commit semantic projection. */
export function isFoundationSemanticReviewComplete(
  snapshot: FoundationSemanticTerminalReviewSnapshot,
): boolean {
  return foundationSemanticTasksComplete(toRuntimeCollection(copySnapshot(snapshot)))
}

type SemanticTerminalResult = Extract<
  import('../../worker-contracts').WorkerTerminalResult,
  { workerType: 'foundation-semantic-reviewer' }
>

function copyUsage(usage: WorkflowUsage | undefined): WorkflowUsage | undefined {
  return usage ? {
    input_tokens: usage.input_tokens,
    cache_read_tokens: usage.cache_read_tokens,
    cache_creation_tokens: usage.cache_creation_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  } : undefined
}

function copyDispatch(dispatch: DispatchRecord | undefined): DispatchRecord | undefined {
  return dispatch === undefined ? undefined : structuredClone(dispatch)
}

export function projectFoundationSemanticTerminalTask(
  task: FoundationSemanticTerminalTask,
): FoundationSemanticTerminalTask {
  // Keep the task projection explicit.  This protects the stage from future
  // additions to the persisted task shape while retaining admittedResult on
  // sibling tasks for the finalization handoff.
  return {
    taskId: task.taskId,
    kind: task.kind,
    revision: task.revision,
    checkId: task.checkId,
    packetDigest: task.packetDigest,
    modelTier: task.modelTier,
    status: task.status,
    attempt: task.attempt,
    ...(task.kind === 'confirmation' ? { sourceTaskId: task.sourceTaskId } : {}),
    ...(task.attemptHistory !== undefined ? { attemptHistory: structuredClone(task.attemptHistory) } : {}),
    ...(task.terminalDigest !== undefined ? { terminalDigest: task.terminalDigest } : {}),
    ...(task.receiptPath !== undefined ? { receiptPath: task.receiptPath } : {}),
    ...(task.receiptDigest !== undefined ? { receiptDigest: task.receiptDigest } : {}),
    ...(copyUsage(task.usage) ? { usage: copyUsage(task.usage) } : {}),
    ...(task.durationMs !== undefined ? { durationMs: task.durationMs } : {}),
    ...(task.failureReason !== undefined ? { failureReason: task.failureReason } : {}),
    ...(task.admittedResult !== undefined ? { admittedResult: structuredClone(task.admittedResult) } : {}),
    ...(task.dispatch !== undefined ? { dispatch: copyDispatch(task.dispatch) } : {}),
  } as FoundationSemanticTerminalTask
}

function copySnapshot(snapshot: FoundationSemanticTerminalReviewSnapshot): FoundationSemanticTerminalReviewSnapshot {
  return {
    revision: snapshot.revision,
    deterministicReviewDigest: snapshot.deterministicReviewDigest,
    phaseStartedAt: snapshot.phaseStartedAt,
    tasks: snapshot.tasks.map(projectFoundationSemanticTerminalTask),
    aggregateUsage: copyUsage(snapshot.aggregateUsage)!,
    ...(snapshot.deepPhaseStartedAt !== undefined ? { deepPhaseStartedAt: snapshot.deepPhaseStartedAt } : {}),
    ...(snapshot.deepAggregateUsage !== undefined ? { deepAggregateUsage: copyUsage(snapshot.deepAggregateUsage)! } : {}),
  }
}

function copyTerminal(terminal: SemanticTerminalResult): SemanticTerminalResult {
  return structuredClone(terminal)
}

/**
 * Admit one semantic reviewer terminal and return only stage-owned updates.
 * All caller-owned mutable protocol values are copied before the first await.
 */
export async function admitFoundationSemanticReviewTerminal(input: {
  workspacePath: string
  snapshot: FoundationSemanticTerminalReviewSnapshot
  taskId: string
  dispatch: DispatchRecord
  terminal: SemanticTerminalResult
}): Promise<FoundationSemanticTerminalAdmissionOutput> {
  const workspacePath = input.workspacePath
  const snapshot = copySnapshot(input.snapshot)
  const dispatch = structuredClone(input.dispatch)
  const terminal = copyTerminal(input.terminal)

  const task = snapshot.tasks.find(candidate => candidate.taskId === input.taskId)
  if (!task || (task.kind !== 'semantic' && task.kind !== 'confirmation') || task.dispatch?.dispatchId !== dispatch.dispatchId)
    throw new Error('semantic task was not found')

  const committed = await loadCommittedFoundationDerivedArtifacts({ workspacePath, revision: snapshot.revision })
  const prefix = snapshot.deterministicReviewDigest
    ? await loadDeterministicFoundationReview({ workspacePath, revision: snapshot.revision, reviewDigest: snapshot.deterministicReviewDigest })
    : undefined
  if (!committed || !prefix) throw new Error('semantic audit immutable inputs are unavailable')
  const packet = await buildSemanticPacketFor({
    workspacePath,
    revision: snapshot.revision,
    checkId: task.checkId,
    sectionIndex: committed.sectionIndex,
    factStore: committed.factStore,
    deterministicReviewDigest: prefix.reviewDigest,
    deterministicIssuePrefix: requireSectionAuditIssues(prefix.issues),
    documentDigests: committed.documentDigests,
  })
  if (packet.identity !== task.packetDigest) throw new Error('semantic packet digest changed during terminal admission')
  if (!dispatch.usage || !Number.isFinite(dispatch.usage.total_tokens) || !Number.isFinite(dispatch.usage.input_tokens) || !Number.isFinite(dispatch.usage.completion_tokens) || dispatch.usage.total_tokens < 0 || dispatch.usage.input_tokens < 0 || dispatch.usage.completion_tokens < 0 || !dispatch.finishedAt || !Number.isFinite(Date.parse(dispatch.startedAt)) || !Number.isFinite(Date.parse(dispatch.finishedAt))) throw new Error('semantic terminal is missing measured usage or duration')

  const admittedResult = admitFoundationSemanticResult(packet, {
    checkId: task.checkId,
    packetIdentity: packet.identity,
    outcome: terminal.outcome,
    ...(terminal.issues !== undefined ? { issues: terminal.issues } : {}),
    ...(terminal.reason !== undefined ? { reason: terminal.reason } : {}),
  })
  const runtimeState = toRuntimeCollection(snapshot)
  const admission = admitFoundationSemanticTerminal(runtimeState, {
    taskId: task.taskId,
    dispatchId: dispatch.dispatchId,
    revision: terminal.revision,
    packetDigest: terminal.packetDigest,
    terminal: terminal as never,
    usage: dispatch.usage,
    durationMs: Date.parse(dispatch.finishedAt) - Date.parse(dispatch.startedAt),
    now: new Date().toISOString(),
  })
  let tasks = admission.state.tasks.map(candidate => candidate.taskId === task.taskId
    ? projectTaskTerminalEvidence({ ...candidate, ...(admission.accepted ? { admittedResult } : {}) }, dispatch)
    : candidate) as FoundationSemanticTerminalTask[]
  let aggregateUsage = admission.state.aggregateUsage
  let deepPhaseStartedAt = admission.state.deepPhaseStartedAt
  let deepAggregateUsage = admission.state.deepAggregateUsage
  if (admission.accepted && !admission.idempotent && task.kind === 'semantic' && (admittedResult.outcome === 'UNDECIDABLE' || FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.find(check => check.checkId === task.checkId)?.severity === 'BLOCKER')) {
    const confirmation = appendFoundationConfirmationTask({ ...admission.state, tasks }, { taskId: `${task.taskId}:confirmation`, sourceTaskId: task.taskId, admittedResult, now: new Date().toISOString() })
    tasks = confirmation.tasks.map(candidate => candidate.taskId === task.taskId ? { ...candidate, admittedResult } : candidate) as FoundationSemanticTerminalTask[]
    aggregateUsage = confirmation.aggregateUsage
    deepPhaseStartedAt = confirmation.deepPhaseStartedAt
    deepAggregateUsage = confirmation.deepAggregateUsage
  }
  const hasNeedsAction = tasks.some(candidate => candidate.status === 'needs_action') || (admittedResult.outcome === 'UNDECIDABLE' && task.kind === 'confirmation')
  const status = hasNeedsAction ? 'needs_action' as const : 'running' as const
  return {
    taskId: task.taskId,
    tasks,
    aggregateUsage,
    ...(deepPhaseStartedAt ? { deepPhaseStartedAt } : {}),
    ...(deepAggregateUsage ? { deepAggregateUsage } : {}),
    idempotent: admission.idempotent,
    accepted: admission.accepted,
    terminalDigest: admission.terminalDigest,
    status,
    blockedReason: hasNeedsAction ? 'semantic audit needs action' : undefined,
    thinking: hasNeedsAction ? 'idle' : 'working',
  }
}
