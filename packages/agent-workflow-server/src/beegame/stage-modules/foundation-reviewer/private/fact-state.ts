import { z } from 'zod/v4'
import { bindReviewDocuments, prepareFoundationReview, type ReviewDocumentInput } from './prepare-review'
import { createFactWorkerTask } from './worker-task'
import { admitFoundationFactTerminal, claimFoundationFactTasks, createFoundationFactTaskCollection, type FoundationFactTaskCollection } from './domain/foundation-fact-runtime'
import type { WorkflowUsage } from './domain/types'
import { foundationReviewFailureNeedsAction } from './retry-policy'

const id = z.string().min(1).max(200)
const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(), cache_creation_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative(),
}).strict()
const dispatch = { taskId: id, dispatchId: id }
export const factEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('claim'), ...dispatch }).strict(),
  z.object({ kind: z.literal('usage'), ...dispatch, usage: usageSchema }).strict(),
  z.object({ kind: z.literal('accept'), ...dispatch, output: z.unknown().refine(value => value !== undefined), usage: usageSchema }).strict(),
  z.object({ kind: z.literal('fail'), ...dispatch, usage: usageSchema, reason: z.string().min(1).max(1000) }).strict(),
  z.object({ kind: z.literal('stop') }).strict(),
  z.object({ kind: z.literal('resume') }).strict(),
  z.object({ kind: z.literal('recover_lost'), dispatchIds: z.array(id).min(1) }).strict(),
  z.object({ kind: z.literal('configuration_unavailable') }).strict(),
])
export type ReviewerFactEvent = z.infer<typeof factEventSchema>
export type ReviewerFactState = {
  phase: 'extracting_facts' | 'facts_staged' | 'format_issues' | 'stopped' | 'needs_action'
  inputDigest: string
  collection: FoundationFactTaskCollection
  usageByDispatch: Record<string, WorkflowUsage>
}

export function initialReviewerFactState(documents: readonly ReviewDocumentInput[]): ReviewerFactState {
  const prepared = prepareFoundationReview(documents)
  const collection = createFoundationFactTaskCollection({
    revision: prepared.snapshot.digest,
    phaseStartedAt: '1970-01-01T00:00:00.000Z',
    packets: prepared.kind === 'format_issues' ? [] : prepared.factPackets.map((packet, index) => ({
      taskId: `fact-${index}`, kind: 'document-facts', revision: packet.revision,
      packetDigest: packet.packetDigest, factKeyCount: packet.keys.length,
      modelTier: 'fast', status: 'pending', attempt: 0,
    })),
  })
  return { phase: prepared.kind === 'format_issues' ? 'format_issues' : collection.tasks.length ? 'extracting_facts' : 'facts_staged', inputDigest: prepared.snapshot.digest, collection, usageByDispatch: Object.create(null) }
}

function aggregate(state: ReviewerFactState): WorkflowUsage {
  const total: WorkflowUsage = { input_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 }
  for (const usage of Object.values(state.usageByDispatch))
    for (const key of Object.keys(total) as (keyof WorkflowUsage)[]) total[key] += usage[key]
  return total
}

function observed(state: ReviewerFactState, dispatchId: string, usage: WorkflowUsage) {
  const previous = Object.hasOwn(state.usageByDispatch, dispatchId) ? state.usageByDispatch[dispatchId] : undefined
  if (previous && (Object.keys(usage) as (keyof WorkflowUsage)[]).some(key => usage[key] < previous[key]))
    throw new Error('review dispatch usage regressed')
  Object.defineProperty(state.usageByDispatch, dispatchId, { value: { ...usage }, enumerable: true, configurable: true, writable: true })
}

function activePhase(state: ReviewerFactState) {
  if (state.phase !== 'extracting_facts') throw new Error('review facts are not executing')
}

/** Pure replay reducer. Every accepted output is revalidated against original bytes. */
export function applyReviewerFactEvent(
  prior: ReviewerFactState,
  documents: readonly ReviewDocumentInput[],
  input: ReviewerFactEvent,
  at: string,
  evidence?: { path: string; digest: string; runId: string },
): ReviewerFactState {
  const event = factEventSchema.parse(input)
  if (!Number.isFinite(Date.parse(at))) throw new Error('review event time is invalid')
  if (bindReviewDocuments(documents).digest !== prior.inputDigest) throw new Error('review state input binding changed')
  const state = structuredClone(prior)
  if (event.kind === 'claim') {
    activePhase(state)
    if (state.collection.tasks.some(task => task.dispatch?.dispatchId === event.dispatchId || task.attemptHistory?.some(item => item.dispatchId === event.dispatchId)))
      throw new Error('review dispatch identity is already used')
    const eligible = state.collection.tasks.find(task => task.taskId === event.taskId)
    if (!eligible || !['pending', 'retryable'].includes(eligible.status) || eligible.attempt >= 2)
      throw new Error('review fact task is not claimable')
    if (!state.collection.tasks.some(task => task.dispatch)) state.collection.phaseStartedAt = at
    state.collection = claimFoundationFactTasks(state.collection, { onlyTaskId: event.taskId, dispatchIdFor: () => event.dispatchId, now: at })
    if (state.collection.tasks.find(task => task.taskId === event.taskId)?.dispatch?.dispatchId !== event.dispatchId)
      throw new Error('review fact concurrency limit reached')
  } else if (event.kind === 'usage' || event.kind === 'accept' || event.kind === 'fail') {
    const task = state.collection.tasks.find(item => item.taskId === event.taskId)
    if (event.kind === 'usage') {
      if (!task || (task.dispatch?.dispatchId !== event.dispatchId && !task.attemptHistory?.some(item => item.dispatchId === event.dispatchId)))
        throw new Error('review usage does not match a known dispatch')
      observed(state, event.dispatchId, event.usage)
      const dispatch = task.dispatch?.dispatchId === event.dispatchId ? task.dispatch : task.attemptHistory?.find(item => item.dispatchId === event.dispatchId)
      if (dispatch) dispatch.usage = { ...event.usage }
      if (task.dispatch?.dispatchId === event.dispatchId) task.usage = { ...event.usage }
      state.collection.aggregateUsage = aggregate(state)
      return state
    }
    if (!task || task.status !== 'running' || task.dispatch?.dispatchId !== event.dispatchId)
      throw new Error('review terminal does not match a running dispatch')
    observed(state, event.dispatchId, event.usage)
    {
      const index = state.collection.tasks.indexOf(task)
      const results = event.kind === 'accept' ? createFactWorkerTask(documents, index).admit(event.output).receipts : []
      const terminal = {
        workerType: 'foundation-fact-extractor' as const, status: event.kind === 'accept' ? 'completed' as const : 'failed' as const,
        runId: evidence?.runId ?? state.inputDigest, taskId: task.taskId, dispatchId: event.dispatchId,
        revision: state.inputDigest, packetDigest: task.packetDigest, results,
      }
      state.collection = admitFoundationFactTerminal(state.collection, {
        taskId: task.taskId, dispatchId: event.dispatchId, revision: state.inputDigest,
        packetDigest: task.packetDigest, terminal, usage: event.usage,
        durationMs: Math.max(0, Date.parse(at) - Date.parse(task.dispatch.startedAt)), now: at,
      }).state
      const updated = state.collection.tasks.find(item => item.taskId === task.taskId)!
      updated.dispatch!.usage = { ...event.usage }
      if (evidence) updated.dispatch!.terminalEvidencePath = evidence.path
      if (event.kind === 'accept') {
        if (!evidence?.path.startsWith('.beegame/workflow/foundation-reviewer/state/') || !/^[a-f0-9]{64}$/.test(evidence.digest))
          throw new Error('review acceptance requires its own immutable receipt record')
        const accepted = state.collection.tasks.find(item => item.taskId === task.taskId)!
        accepted.receiptPath = evidence.path
        accepted.receiptDigest = evidence.digest
      }
      if (event.kind === 'fail') {
        const failed = state.collection.tasks.find(item => item.taskId === task.taskId)!
        failed.failureReason = event.reason
        failed.dispatch!.failureReason = event.reason
        if (foundationReviewFailureNeedsAction({ kind: 'document-facts', attempt: failed.attempt, reason: event.reason })) failed.status = 'needs_action'
      }
    }
  } else if (event.kind === 'configuration_unavailable') {
    activePhase(state)
    state.collection = claimFoundationFactTasks(state.collection, { dispatchIdFor: () => '', now: at, modelReady: false })
  } else if (event.kind === 'stop') {
    if (state.phase === 'facts_staged' || state.phase === 'format_issues' || state.phase === 'stopped') return state
    state.phase = 'stopped'
    for (const task of state.collection.tasks) {
      if (task.status !== 'running' || !task.dispatch) continue
      task.status = 'retryable'
      task.attempt = Math.max(0, task.attempt - 1)
      task.failureReason = 'operator stopped'
      const measured = Object.hasOwn(state.usageByDispatch, task.dispatch.dispatchId) ? state.usageByDispatch[task.dispatch.dispatchId] : undefined
      task.durationMs = Math.max(0, Date.parse(at) - Date.parse(task.dispatch.startedAt))
      if (measured) task.usage = { ...measured }
      task.dispatch = { ...task.dispatch, status: 'interrupted', finishedAt: at, failureReason: 'operator stopped', usage: measured }
    }
  } else if (event.kind === 'resume') {
    if (state.phase !== 'stopped' && state.phase !== 'needs_action') throw new Error('review facts are not paused')
    for (const task of state.collection.tasks) {
      if ((task.status === 'retryable' && task.dispatch?.status === 'interrupted' && task.failureReason === 'operator stopped') ||
        (task.status === 'needs_action' && task.attempt === 0 && !task.dispatch && task.failureReason === 'foundation fact fast model is not configured')) {
        task.status = 'pending'
        delete task.failureReason
      }
    }
    if (state.collection.tasks.some(task => task.status === 'needs_action')) throw new Error('review facts require action, not another automatic retry')
    state.phase = 'extracting_facts'
  } else {
    // The future lifecycle owner must establish process loss before appending
    // this command; merely reading a running record is not proof of a crash.
    activePhase(state)
    if (new Set(event.dispatchIds).size !== event.dispatchIds.length) throw new Error('duplicate lost dispatch')
    for (const dispatchId of event.dispatchIds) {
      const task = state.collection.tasks.find(item => item.dispatch?.dispatchId === dispatchId)
      if (!task || task.status !== 'running' || !task.dispatch) throw new Error('lost review dispatch is not running')
      task.status = 'needs_action'
      task.failureReason = 'review worker process lost; explicit recovery decision required'
      const measured = Object.hasOwn(state.usageByDispatch, dispatchId) ? state.usageByDispatch[dispatchId] : undefined
      task.durationMs = Math.max(0, Date.parse(at) - Date.parse(task.dispatch.startedAt))
      if (measured) task.usage = { ...measured }
      task.dispatch = { ...task.dispatch, status: 'interrupted', finishedAt: at, failureReason: task.failureReason, usage: measured }
    }
  }
  state.collection.aggregateUsage = aggregate(state)
  if (state.phase !== 'stopped' && state.phase !== 'format_issues') {
    state.phase = state.collection.tasks.some(task => task.status === 'needs_action') ? 'needs_action'
      : state.collection.tasks.every(task => task.status === 'completed') ? 'facts_staged' : 'extracting_facts'
    if (state.phase === 'facts_staged') state.collection.status = 'facts_staged'
  }
  return state
}
