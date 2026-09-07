import { z } from 'zod/v4'
import { createSemanticWorkerTask } from './worker-task'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST, type FoundationSemanticPacketInput, type FoundationSemanticResult } from './domain/foundation-semantic-audit'
import { createFoundationSemanticTaskCollection, claimFoundationSemanticTasks, admitFoundationSemanticTerminal,
  appendFoundationConfirmationTask, foundationSemanticTasksComplete, type FoundationSemanticTaskCollection } from './domain/foundation-semantic-runtime'
import type { WorkflowUsage } from './domain/types'
import { foundationReviewFailureNeedsAction } from './retry-policy'

const id = z.string().min(1).max(200)
const usage = z.object({ input_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(), cache_creation_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative(),
}).strict().refine(value => value.total_tokens >= value.input_tokens + value.completion_tokens, 'inconsistent usage')
const dispatch = { taskId: id, dispatchId: id }
export const semanticEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('claim'), ...dispatch }).strict(),
  z.object({ kind: z.literal('usage'), ...dispatch, usage }).strict(),
  z.object({ kind: z.literal('accept'), ...dispatch, output: z.unknown().refine(value => value !== undefined), usage }).strict(),
  z.object({ kind: z.literal('fail'), ...dispatch, usage, reason: z.string().min(1).max(1000) }).strict(),
  z.object({ kind: z.literal('configuration_unavailable'), taskId: id }).strict(),
  z.object({ kind: z.literal('stop') }).strict(), z.object({ kind: z.literal('resume') }).strict(),
  z.object({ kind: z.literal('recover_lost'), dispatchIds: z.array(id).min(1) }).strict(),
])
export type ReviewerSemanticEvent = z.infer<typeof semanticEventSchema>
export type ReviewerSemanticState = {
  phase: 'semantic_review' | 'semantic_staged' | 'stopped' | 'needs_action'
  collection: FoundationSemanticTaskCollection
  results: Record<string, FoundationSemanticResult>
  usageByDispatch: Record<string, WorkflowUsage>
}
const zero = (): WorkflowUsage => ({ input_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 })
export function initialReviewerSemanticState(packets: readonly FoundationSemanticPacketInput[], at: string): ReviewerSemanticState {
  const collection = createFoundationSemanticTaskCollection({ revision: packets[0]?.revision ?? '', phaseStartedAt: at,
    tasks: packets.map((packet, index) => ({ taskId: `semantic-${index}`, kind: 'semantic', revision: packet.revision, checkId: packet.checkId,
      packetDigest: createSemanticWorkerTask(packet).packetDigest,
      modelTier: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.find(check => check.checkId === packet.checkId)!.modelTier as 'fast' | 'balanced',
      status: 'pending', attempt: 0 })) })
  return { phase: 'semantic_review', collection, results: {}, usageByDispatch: {} }
}

/** Journal replay calls this with service-derived packets, never caller-selected checks. */
export function applyReviewerSemanticEvent(prior: ReviewerSemanticState, packets: readonly FoundationSemanticPacketInput[],
  input: ReviewerSemanticEvent, at: string, evidence: { path: string; digest: string; runId: string }): ReviewerSemanticState {
  const event = semanticEventSchema.parse(input)
  if (!Number.isFinite(Date.parse(at))) throw new Error('semantic event time is invalid')
  const state = structuredClone(prior)
  const active = () => { if (state.phase !== 'semantic_review') throw new Error('semantic review is not executing') }
  const observed = (dispatchId: string, value: WorkflowUsage) => {
    const previous = Object.hasOwn(state.usageByDispatch, dispatchId) ? state.usageByDispatch[dispatchId] : undefined
    if (previous && (Object.keys(value) as (keyof WorkflowUsage)[]).some(key => value[key] < previous[key])) throw new Error('semantic usage regressed')
    Object.defineProperty(state.usageByDispatch, dispatchId, { value: { ...value }, enumerable: true, configurable: true, writable: true })
  }
  if (event.kind === 'claim' || event.kind === 'configuration_unavailable') {
    active()
    const task = state.collection.tasks.find(item => item.taskId === event.taskId)
    if (!task || !['pending', 'retryable'].includes(task.status)) throw new Error('semantic task is not claimable')
    if (event.kind === 'claim' && state.collection.tasks.some(item => item.dispatch?.dispatchId === event.dispatchId || item.attemptHistory?.some(old => old.dispatchId === event.dispatchId)))
      throw new Error('semantic dispatch identity is already used')
    state.collection = claimFoundationSemanticTasks(state.collection, { onlyTaskId: event.taskId, now: at,
      dispatchIdFor: () => event.kind === 'claim' ? event.dispatchId : '', configuredTiers: { [task.modelTier]: event.kind === 'claim' } })
    if (event.kind === 'claim' && state.collection.tasks.find(item => item.taskId === event.taskId)?.dispatch?.dispatchId !== event.dispatchId)
      throw new Error('semantic concurrency or attempt limit reached')
  } else if (event.kind === 'usage' || event.kind === 'accept' || event.kind === 'fail') {
    const task = state.collection.tasks.find(item => item.taskId === event.taskId)
    const dispatched = task?.dispatch?.dispatchId === event.dispatchId ? task.dispatch : task?.attemptHistory?.find(item => item.dispatchId === event.dispatchId)
    if (!task || !dispatched) throw new Error('semantic event does not match a known dispatch')
    if (event.kind !== 'usage' && (task.status !== 'running' || task.dispatch !== dispatched)) throw new Error('semantic terminal does not match a running dispatch')
    observed(event.dispatchId, event.usage)
    dispatched.usage = { ...event.usage }
    if (task.dispatch === dispatched) task.usage = { ...event.usage }
    if (event.kind !== 'usage') {
      const packet = packets.find(item => item.checkId === task.checkId)
      if (!packet) throw new Error('semantic packet is missing')
      const worker = createSemanticWorkerTask(packet, task.kind === 'confirmation' ? 'confirmation' : 'source')
      if (worker.packetDigest !== task.packetDigest || worker.revision !== task.revision) throw new Error('semantic packet binding changed')
      const result = event.kind === 'accept' ? worker.admit(event.output) : undefined
      const terminal = { workerType: 'foundation-semantic-reviewer' as const, status: result ? 'completed' as const : 'failed' as const,
        runId: evidence.runId, taskId: task.taskId, dispatchId: event.dispatchId, revision: task.revision, packetDigest: task.packetDigest,
        outcome: result?.outcome ?? 'UNDECIDABLE' as const, ...(result ? { issues: result.issues, ...(result.reason ? { reason: result.reason } : {}) } : {}) }
      state.collection = admitFoundationSemanticTerminal(state.collection, { taskId: task.taskId, dispatchId: event.dispatchId,
        revision: task.revision, packetDigest: task.packetDigest, terminal, usage: event.usage,
        durationMs: Math.max(0, Date.parse(at) - Date.parse(dispatched.startedAt)), now: at }).state
      const updated = state.collection.tasks.find(item => item.taskId === task.taskId)!
      updated.dispatch!.terminalEvidencePath = evidence.path
      if (result) {
        if (!evidence.path.startsWith('.beegame/workflow/foundation-reviewer/state/') || !/^[a-f0-9]{64}$/.test(evidence.digest))
          throw new Error('semantic acceptance requires an owned immutable receipt')
        updated.receiptPath = evidence.path; updated.receiptDigest = evidence.digest
        state.results[task.taskId] = result
        if (task.kind === 'semantic' && (result.outcome === 'UNDECIDABLE' || FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.find(check => check.checkId === task.checkId)?.severity === 'BLOCKER'))
          state.collection = appendFoundationConfirmationTask(state.collection, { taskId: `${task.taskId}:confirmation`, sourceTaskId: task.taskId, admittedResult: result, now: at })
      } else if (event.kind === 'fail') {
        updated.failureReason = event.reason; updated.dispatch!.failureReason = event.reason
        if (foundationReviewFailureNeedsAction({ kind: task.kind, attempt: updated.attempt, reason: event.reason })) updated.status = 'needs_action'
      }
    }
  } else if (event.kind === 'stop') {
    if (state.phase === 'semantic_staged' || state.phase === 'stopped') return state
    state.phase = 'stopped'
    for (const task of state.collection.tasks) if (task.status === 'running' && task.dispatch) {
      task.status = 'retryable'
      if (task.kind === 'confirmation') task.attempt = 0
      else task.attempt = Math.max(0, task.attempt - 1)
      task.failureReason = 'operator stopped'
      task.durationMs = Math.max(0, Date.parse(at) - Date.parse(task.dispatch.startedAt))
      task.dispatch = { ...task.dispatch, status: 'interrupted', finishedAt: at, failureReason: task.failureReason }
    }
  } else if (event.kind === 'resume') {
    if (state.phase !== 'stopped' && state.phase !== 'needs_action') throw new Error('semantic review is not paused')
    for (const task of state.collection.tasks) if (
      (task.status === 'retryable' && task.dispatch?.status === 'interrupted' && task.failureReason === 'operator stopped') ||
      (task.status === 'needs_action' && task.attempt === 0 && !task.dispatch && task.failureReason === `${task.modelTier} semantic model is not configured`)) {
      task.status = 'pending'; delete task.failureReason
    }
    if (state.collection.tasks.some(task => task.status === 'needs_action') || state.collection.tasks.some(task => task.kind === 'confirmation' && state.results[task.taskId]?.outcome === 'UNDECIDABLE'))
      throw new Error('semantic review requires action, not another automatic retry')
    state.phase = 'semantic_review'
  } else {
    if (state.phase !== 'semantic_review' && state.phase !== 'needs_action') throw new Error('semantic review cannot recover lost work in this phase')
    if (new Set(event.dispatchIds).size !== event.dispatchIds.length) throw new Error('duplicate lost semantic dispatch')
    for (const dispatchId of event.dispatchIds) {
      const task = state.collection.tasks.find(item => item.dispatch?.dispatchId === dispatchId)
      if (!task || task.status !== 'running' || !task.dispatch) throw new Error('lost semantic dispatch is not running')
      task.status = 'needs_action'; task.failureReason = 'review worker process lost; explicit recovery decision required'
      task.durationMs = Math.max(0, Date.parse(at) - Date.parse(task.dispatch.startedAt))
      task.dispatch = { ...task.dispatch, status: 'interrupted', finishedAt: at, failureReason: task.failureReason }
    }
  }
  const source = zero(), deep = zero()
  for (const task of state.collection.tasks) for (const record of [...(task.attemptHistory ?? []), ...(task.dispatch ? [task.dispatch] : [])]) {
    const value = Object.hasOwn(state.usageByDispatch, record.dispatchId) ? state.usageByDispatch[record.dispatchId] : undefined
    if (value) for (const key of Object.keys(source) as (keyof WorkflowUsage)[]) (task.kind === 'confirmation' ? deep : source)[key] += value[key]
  }
  state.collection.aggregateUsage = source
  if (state.collection.deepPhaseStartedAt) state.collection.deepAggregateUsage = deep
  if (state.phase !== 'stopped') {
    state.phase = state.collection.tasks.some(task => task.status === 'needs_action' || (task.kind === 'confirmation' && state.results[task.taskId]?.outcome === 'UNDECIDABLE')) ? 'needs_action'
      : foundationSemanticTasksComplete(state.collection) ? 'semantic_staged' : 'semantic_review'
    // This is internal staged evidence, not a published Reviewer result.
  }
  return state
}
