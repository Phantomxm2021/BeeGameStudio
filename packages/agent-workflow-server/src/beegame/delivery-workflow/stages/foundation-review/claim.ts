import type {
  DispatchRecord,
  WorkflowUsage,
} from '../../types'
import type { FoundationSemanticResult } from '../../foundation-semantic-audit'
import {
  claimFoundationFactTasks,
  type FoundationFactTask,
  type FoundationFactTaskCollection,
} from '../../foundation-fact-runtime'
import {
  claimFoundationSemanticTasks,
  type FoundationSemanticRuntimeTask,
  type FoundationSemanticTaskCollection,
  type FoundationSemanticTier,
} from '../../foundation-semantic-runtime'

/**
 * The dispatch fields the claim operation is allowed to observe.  The global
 * adapter owns the complete record (and its durable identity); Reviewer claim
 * only needs the identity and start time to construct a task dispatch.
 */
export type FoundationReviewClaimRecord = Readonly<{
  dispatchId: string
  startedAt: string
}>

type ClaimDispatch = DispatchRecord

/** Complete fact-task evidence accepted at the Reviewer boundary. */
export type FoundationReviewFactClaimTaskSnapshot = Readonly<{
  taskId: string
  kind: 'document-facts'
  revision: string
  packetDigest: string
  factKeyCount: number
  modelTier: 'fast'
  status: FoundationFactTask['status']
  attempt: number
  dispatch?: ClaimDispatch
  attemptHistory?: readonly ClaimDispatch[]
  terminalDigest?: string
  receiptPath?: string
  receiptDigest?: string
  usage?: WorkflowUsage
  durationMs?: number
  failureReason?: string
}>

/** Complete semantic-task evidence accepted at the Reviewer boundary. */
export type FoundationReviewSemanticClaimTaskSnapshot = Readonly<{
  taskId: string
  kind: 'semantic' | 'confirmation'
  revision: string
  checkId: string
  packetDigest: string
  modelTier: FoundationSemanticTier
  status: FoundationSemanticRuntimeTask['status']
  attempt: number
  sourceTaskId?: string
  dispatch?: ClaimDispatch
  attemptHistory?: readonly ClaimDispatch[]
  terminalDigest?: string
  receiptPath?: string
  receiptDigest?: string
  usage?: WorkflowUsage
  durationMs?: number
  failureReason?: string
  admittedResult?: FoundationSemanticResult
}>

export type FoundationReviewFactClaimSnapshot = Readonly<{
  revision: string
  status: string
  phaseStartedAt: string
  tasks: readonly FoundationReviewFactClaimTaskSnapshot[]
  aggregateUsage?: WorkflowUsage
}>

export type FoundationReviewSemanticClaimSnapshot = Readonly<{
  revision: string
  status: 'semantic_review'
  phaseStartedAt: string
  tasks: readonly FoundationReviewSemanticClaimTaskSnapshot[]
  aggregateUsage?: WorkflowUsage
  deepPhaseStartedAt?: string
  deepAggregateUsage?: WorkflowUsage
}>

/** Fact extraction additionally needs to know whether its worker schema exists. */
export type FoundationReviewFactClaimRequest = Readonly<{
  taskId?: string
  schemaPresent: boolean
  fastModelError?: string
}>

export type FoundationReviewSemanticClaimRequest = Readonly<{
  taskId?: string
  modelTier?: unknown
  fastModelError?: string
}>

export type FoundationReviewFactClaimInput = Readonly<{
  snapshot: FoundationReviewFactClaimSnapshot
  request: FoundationReviewFactClaimRequest
  record: FoundationReviewClaimRecord
}>

export type FoundationReviewSemanticClaimInput = Readonly<{
  snapshot: FoundationReviewSemanticClaimSnapshot
  request: FoundationReviewSemanticClaimRequest
  record: FoundationReviewClaimRecord
}>

export type FoundationReviewFactClaimResult =
  | Readonly<{ kind: 'claimed'; state: FoundationFactTaskCollection }>
  | Readonly<{ kind: 'blocked'; state: FoundationFactTaskCollection; reason: string }>

export type FoundationReviewSemanticClaimResult =
  | Readonly<{ kind: 'claimed'; state: FoundationSemanticTaskCollection }>
  | Readonly<{ kind: 'blocked'; state: FoundationSemanticTaskCollection; reason: string }>

const zeroUsage = (): WorkflowUsage => ({
  input_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
})

function copyUsage(usage: WorkflowUsage | undefined): WorkflowUsage | undefined {
  return usage === undefined ? undefined : {
    input_tokens: usage.input_tokens,
    cache_read_tokens: usage.cache_read_tokens,
    cache_creation_tokens: usage.cache_creation_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  }
}

/** Copy only the public dispatch protocol, including nested mutable values. */
function copyDispatch(dispatch: ClaimDispatch): DispatchRecord {
  return {
    dispatchId: dispatch.dispatchId,
    workerType: dispatch.workerType,
    phase: dispatch.phase,
    ...(dispatch.taskId === undefined ? {} : { taskId: dispatch.taskId }),
    revision: dispatch.revision,
    status: dispatch.status,
    ...(dispatch.terminalEvidencePath === undefined ? {} : { terminalEvidencePath: dispatch.terminalEvidencePath }),
    ...(dispatch.failureReason === undefined ? {} : { failureReason: dispatch.failureReason }),
    ...(dispatch.request === undefined ? {} : { request: structuredClone(dispatch.request) }),
    ...(dispatch.terminalResult === undefined ? {} : { terminalResult: structuredClone(dispatch.terminalResult) }),
    ...(dispatch.startingUsage === undefined ? {} : { startingUsage: copyUsage(dispatch.startingUsage) }),
    ...(dispatch.usage === undefined ? {} : { usage: copyUsage(dispatch.usage) }),
    startedAt: dispatch.startedAt,
    ...(dispatch.finishedAt === undefined ? {} : { finishedAt: dispatch.finishedAt }),
  }
}

export function copyFactTask(task: FoundationReviewFactClaimTaskSnapshot): FoundationFactTask {
  return {
    taskId: task.taskId,
    kind: task.kind,
    revision: task.revision,
    packetDigest: task.packetDigest,
    factKeyCount: task.factKeyCount,
    modelTier: task.modelTier,
    status: task.status,
    attempt: task.attempt,
    ...(task.dispatch === undefined ? {} : { dispatch: copyDispatch(task.dispatch) }),
    ...(task.attemptHistory === undefined ? {} : { attemptHistory: task.attemptHistory.map(copyDispatch) }),
    ...(task.terminalDigest === undefined ? {} : { terminalDigest: task.terminalDigest }),
    ...(task.receiptPath === undefined ? {} : { receiptPath: task.receiptPath }),
    ...(task.receiptDigest === undefined ? {} : { receiptDigest: task.receiptDigest }),
    ...(task.usage === undefined ? {} : { usage: copyUsage(task.usage) }),
    ...(task.durationMs === undefined ? {} : { durationMs: task.durationMs }),
    ...(task.failureReason === undefined ? {} : { failureReason: task.failureReason }),
  }
}

export function copySemanticTask(
  task: FoundationReviewSemanticClaimTaskSnapshot,
): FoundationSemanticRuntimeTask & { admittedResult?: FoundationSemanticResult } {
  return {
    taskId: task.taskId,
    kind: task.kind,
    revision: task.revision,
    checkId: task.checkId,
    packetDigest: task.packetDigest,
    modelTier: task.modelTier as never,
    status: task.status,
    attempt: task.attempt as never,
    ...(task.kind === 'confirmation' && task.sourceTaskId !== undefined ? { sourceTaskId: task.sourceTaskId } : {}),
    ...(task.dispatch === undefined ? {} : { dispatch: copyDispatch(task.dispatch) }),
    ...(task.attemptHistory === undefined ? {} : { attemptHistory: task.attemptHistory.map(copyDispatch) }),
    ...(task.terminalDigest === undefined ? {} : { terminalDigest: task.terminalDigest }),
    ...(task.receiptPath === undefined ? {} : { receiptPath: task.receiptPath }),
    ...(task.receiptDigest === undefined ? {} : { receiptDigest: task.receiptDigest }),
    ...(task.usage === undefined ? {} : { usage: copyUsage(task.usage) }),
    ...(task.durationMs === undefined ? {} : { durationMs: task.durationMs }),
    ...(task.failureReason === undefined ? {} : { failureReason: task.failureReason }),
    ...(task.admittedResult === undefined ? {} : { admittedResult: structuredClone(task.admittedResult) }),
  } as FoundationSemanticRuntimeTask & { admittedResult?: FoundationSemanticResult }
}

function factState(snapshot: FoundationReviewFactClaimSnapshot): FoundationFactTaskCollection {
  return {
    revision: snapshot.revision,
    phaseStartedAt: snapshot.phaseStartedAt,
    status: snapshot.status === 'facts_staged' ? 'facts_staged' : 'extracting_facts',
    tasks: snapshot.tasks.map(copyFactTask),
    aggregateUsage: copyUsage(snapshot.aggregateUsage) ?? zeroUsage(),
  }
}

function semanticState(snapshot: FoundationReviewSemanticClaimSnapshot): FoundationSemanticTaskCollection {
  return {
    revision: snapshot.revision,
    phaseStartedAt: snapshot.phaseStartedAt,
    status: 'semantic_review',
    tasks: snapshot.tasks.map(copySemanticTask),
    aggregateUsage: copyUsage(snapshot.aggregateUsage) ?? zeroUsage(),
    ...(snapshot.deepPhaseStartedAt ? { deepPhaseStartedAt: snapshot.deepPhaseStartedAt } : {}),
    ...(snapshot.deepAggregateUsage ? { deepAggregateUsage: copyUsage(snapshot.deepAggregateUsage) } : {}),
  }
}

function blockedFact(
  state: FoundationFactTaskCollection,
  taskId: string | undefined,
  fastModelError: string | undefined,
): FoundationReviewFactClaimResult {
  const task = state.tasks.find(candidate => candidate.taskId === taskId)
  const reason = task?.failureReason ?? fastModelError ?? 'foundation fact task is not claimable'
  return { kind: 'blocked', state, reason }
}

function blockedSemantic(
  state: FoundationSemanticTaskCollection,
  taskId: string | undefined,
  fastModelError: string | undefined,
): FoundationReviewSemanticClaimResult {
  const task = state.tasks.find(candidate => candidate.taskId === taskId)
  const reason = task?.failureReason ?? fastModelError ?? 'foundation semantic task is not claimable'
  return { kind: 'blocked', state, reason }
}

/** Prepare one Reviewer-owned fact claim from its narrow state projection. */
export function prepareFoundationFactClaim(
  input: FoundationReviewFactClaimInput,
): FoundationReviewFactClaimResult {
  const snapshot = input.snapshot
  const request = {
    taskId: input.request.taskId,
    schemaPresent: input.request.schemaPresent,
    fastModelError: input.request.fastModelError,
  }
  const record = {
    dispatchId: input.record.dispatchId,
    startedAt: input.record.startedAt,
  }
  const claimed = claimFoundationFactTasks(factState(snapshot), {
    // This deliberately remains undefined when the readiness probe failed:
    // the runtime then applies its historical all-pending-task failure path.
    onlyTaskId: request.fastModelError ? undefined : request.taskId,
    dispatchIdFor: () => record.dispatchId,
    now: record.startedAt,
    modelReady: !request.fastModelError && request.schemaPresent,
  })
  const task = claimed.tasks.find(candidate => candidate.taskId === request.taskId)
  if (!task || task.status !== 'running') return blockedFact(claimed, request.taskId, request.fastModelError)
  return { kind: 'claimed', state: claimed }
}

/** Prepare one Reviewer-owned semantic claim from its narrow state projection. */
export function prepareFoundationSemanticClaim(
  input: FoundationReviewSemanticClaimInput,
): FoundationReviewSemanticClaimResult {
  const snapshot = input.snapshot
  const request = {
    taskId: input.request.taskId,
    modelTier: input.request.modelTier,
    fastModelError: input.request.fastModelError,
  }
  const record = {
    dispatchId: input.record.dispatchId,
    startedAt: input.record.startedAt,
  }
  // Property-key coercion, including an absent tier, is intentional.  The
  // original dispatch path used `[request.contract.modelTier as string]`.
  const configuredTiers = {
    [request.modelTier as string]: !request.fastModelError,
  } as Partial<Record<FoundationSemanticTier, boolean>>
  const claimed = claimFoundationSemanticTasks(semanticState(snapshot), {
    onlyTaskId: request.fastModelError ? undefined : request.taskId,
    dispatchIdFor: () => record.dispatchId,
    now: record.startedAt,
    configuredTiers,
  })
  const task = claimed.tasks.find(candidate => candidate.taskId === request.taskId)
  if (!task || task.status !== 'running') return blockedSemantic(claimed, request.taskId, request.fastModelError)
  return { kind: 'claimed', state: claimed }
}
