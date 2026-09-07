import { z } from 'zod/v4'
import {
  prepareReviewerTargetedAudit,
  validateReviewerTargetedFacts,
  type ReviewerPreparedCandidate,
} from './targeted-preparation'
import { createReviewerTargetedFactWorker, createReviewerTargetedSemanticWorker } from './targeted-worker'
import { summarizeReviewerTargeted } from './targeted-summary'
import type { FoundationFactReceipt } from './domain/foundation-fact-extraction'
import type { WorkflowUsage } from './domain/types'
import { reviewerDigest } from './review-summary'
import {
  applyReviewerTargetedUsageEvent,
  assertTargetedUsageCanChange,
  targetedUsageEventSchema,
  type TargetedUsageLedger,
  type ReviewerTargetedUsageEvent,
} from './targeted-usage-state'

/** Targeted validation is deliberately separate from the initial-review task collection. */
export const TARGETED_MAX_RUNNING = 4
const id = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const usage = z.object({
  input_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative(), cache_creation_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
}).strict().refine(value => value.total_tokens >= value.input_tokens + value.completion_tokens, 'inconsistent usage')
const dispatch = { taskId: id, dispatchId: id }

const targetedBusinessEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('claim'), ...dispatch }).strict(),
  z.object({ kind: z.literal('usage'), ...dispatch, usage }).strict(),
  z.object({ kind: z.literal('accept'), ...dispatch, output: z.unknown().refine(value => value !== undefined), usage }).strict(),
  z.object({ kind: z.literal('fail'), ...dispatch, usage, reason: z.string().min(1).max(1000) }).strict(),
  // `validate` is an explicit boundary: deterministic checks are never hidden in
  // a worker claim and semantic work cannot begin before this command.
  z.object({ kind: z.literal('validate') }).strict(),
  z.object({ kind: z.literal('configuration_unavailable'), taskId: id.optional() }).strict(),
  z.object({ kind: z.literal('stop') }).strict(),
  z.object({ kind: z.literal('resume') }).strict(),
  z.object({ kind: z.literal('recover_lost'), dispatchIds: z.array(id).min(1), cleanup: z.object({
    path: z.string().min(1).max(500), digest, runId: id, dispatchIds: z.array(id).min(1),
  }).strict() }).strict(),
])
const targetedLifecycleEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lifecycle_failure'), code: z.enum(['execution_failed', 'publication_failed', 'billing_failed']) }).strict(),
  z.object({ kind: z.literal('lifecycle_resume') }).strict(),
])
export const targetedEventSchema = z.union([targetedBusinessEventSchema, targetedUsageEventSchema, targetedLifecycleEventSchema])
export type ReviewerTargetedEvent = z.infer<typeof targetedEventSchema>

export type TargetedTask = {
  taskId: string
  kind: 'fact' | 'semantic'
  index: number
  issueId?: string
  revision: string
  packetDigest: string
  status: 'pending' | 'running' | 'retryable' | 'completed' | 'needs_action'
  /** Targeted validation has no business attempt cap. */
  attempt: number
  dispatch?: TargetedDispatch
  attemptHistory?: TargetedDispatch[]
  terminalDigest?: string
  receiptPath?: string
  receiptDigest?: string
  usage?: WorkflowUsage
  durationMs?: number
  failureReason?: string
  factReceipts?: FoundationFactReceipt[]
  semanticResult?: { status: 'PASS' | 'FAIL'; diagnostic?: unknown }
  /** Raw worker shape is retained only so the summary can re-admit it. */
  semanticOutput?: unknown
}

export type TargetedDispatch = {
  dispatchId: string
  taskId: string
  revision: string
  status: 'running' | 'completed' | 'failed' | 'interrupted'
  startedAt: string
  finishedAt?: string
  usage?: WorkflowUsage
  terminalResult?: Record<string, unknown>
  failureReason?: string
  terminalEvidencePath?: string
}

export type ReviewerTargetedState = {
  phase: 'extracting_facts' | 'deterministic_validation' | 'semantic_review' | 'deterministic_failed' | 'targeted_staged' | 'stopped' | 'needs_action'
  inputDigest: string
  revision: string
  candidateId: string
  candidateResultId: string
  factTasks: TargetedTask[]
  semanticTasks: TargetedTask[]
  factReceipts: FoundationFactReceipt[]
  usageByDispatch: Record<string, WorkflowUsage>
  aggregateUsage: WorkflowUsage
  billing?: TargetedUsageLedger
  control?: { failure?: 'execution_failed' | 'publication_failed' | 'billing_failed' }
  deterministic?: {
    patchValidations: unknown[]
    semanticIssueIds: string[]
    newImpactedIssueIds: string[]
    failed: boolean
  }
  summary?: unknown
}

const zeroUsage = (): WorkflowUsage => ({ input_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 })
const ownedReceipt: (evidence: { path: string; digest: string } | undefined) => asserts evidence is { path: string; digest: string } = (evidence) => {
  const prefix = '.beegame/workflow/foundation-reviewer/state/'
  const relative = evidence?.path.startsWith(prefix) ? evidence.path.slice(prefix.length) : ''
  const safePath = Boolean(relative) && relative.split('/').every(part => Boolean(part) && part !== '.' && part !== '..' && !part.includes('\\'))
  if (!evidence || !safePath || !digest.safeParse(evidence.digest).success)
    throw new Error('targeted acceptance requires an owned immutable receipt')
}
function ownedCleanupReceipt(cleanup: { path: string; digest: string; runId: string; dispatchIds: string[] }, evidence: { path: string; digest: string; runId: string } | undefined): void {
  ownedReceipt(cleanup)
  const prefix = '.beegame/workflow/foundation-reviewer/state/'
  if (!evidence || evidence.runId !== cleanup.runId || !cleanup.path.startsWith(`${prefix}${cleanup.runId}/`))
    throw new Error('targeted cleanup receipt is not bound to the current run')
}
const validTime = (at: string) => Number.isFinite(Date.parse(at))
const running = (state: ReviewerTargetedState) => [...state.factTasks, ...state.semanticTasks].filter(task => task.status === 'running').length
const tasks = (state: ReviewerTargetedState) => [...state.factTasks, ...state.semanticTasks]

function sumUsage(state: ReviewerTargetedState): WorkflowUsage {
  const total = zeroUsage()
  for (const dispatchId of Object.keys(state.usageByDispatch)) {
    if (!Object.hasOwn(state.usageByDispatch, dispatchId)) continue
    const value = state.usageByDispatch[dispatchId]!
    for (const key of Object.keys(total) as (keyof WorkflowUsage)[]) total[key] += value[key]
  }
  return total
}

function taskFor(state: ReviewerTargetedState, taskId: string): TargetedTask | undefined {
  return tasks(state).find(task => task.taskId === taskId)
}

function knownDispatch(state: ReviewerTargetedState, dispatchId: string): { task: TargetedTask; dispatch: TargetedDispatch } | undefined {
  for (const task of tasks(state)) {
    if (task.dispatch?.dispatchId === dispatchId) return { task, dispatch: task.dispatch }
    const old = task.attemptHistory?.find(item => item.dispatchId === dispatchId)
    if (old) return { task, dispatch: old }
  }
  return undefined
}

function observe(state: ReviewerTargetedState, dispatchId: string, next: WorkflowUsage): void {
  const prior = Object.hasOwn(state.usageByDispatch, dispatchId) ? state.usageByDispatch[dispatchId] : undefined
  if (prior && (Object.keys(next) as (keyof WorkflowUsage)[]).some(key => next[key] < prior[key]))
    throw new Error('targeted usage regressed')
  Object.defineProperty(state.usageByDispatch, dispatchId, { value: { ...next }, enumerable: true, configurable: true, writable: true })
}

function receiptsFor(state: ReviewerTargetedState): FoundationFactReceipt[] {
  return state.factTasks.flatMap(task => task.factReceipts ?? [])
}

function refreshFactReceipts(state: ReviewerTargetedState): void {
  state.factReceipts = receiptsFor(state)
}

function makeSummary(input: ReviewerPreparedCandidate, state: ReviewerTargetedState): void {
  if (state.deterministic?.failed) {
    state.summary = summarizeReviewerTargeted(input, state.factReceipts, [])
    return
  }
  if (state.semanticTasks.some(task => task.status !== 'completed')) return
  const replies = state.semanticTasks.map(task => ({ issueId: task.issueId!, output: structuredClone(task.semanticOutput) }))
  state.summary = summarizeReviewerTargeted(input, state.factReceipts, replies as Array<{ issueId: string; output: {} | null }>)
}

function refreshPhase(input: ReviewerPreparedCandidate, state: ReviewerTargetedState): void {
  if (state.phase === 'stopped') return
  if (tasks(state).some(task => task.status === 'needs_action')) { state.phase = 'needs_action'; return }
  if (state.factTasks.some(task => task.status === 'pending' || task.status === 'running' || task.status === 'retryable')) {
    state.phase = 'extracting_facts'; return
  }
  if (!state.deterministic) { state.phase = 'deterministic_validation'; return }
  if (state.deterministic.failed) { state.phase = 'deterministic_failed'; makeSummary(input, state); return }
  if (state.semanticTasks.some(task => task.status !== 'completed')) { state.phase = 'semantic_review'; return }
  state.phase = 'targeted_staged'; makeSummary(input, state)
}

export function initialReviewerTargetedState(input: ReviewerPreparedCandidate, at = '1970-01-01T00:00:00.000Z'): ReviewerTargetedState {
  if (!validTime(at)) throw new Error('targeted phase time is invalid')
  const prepared = prepareReviewerTargetedAudit(input)
  const revision = prepared.input.source.documentSetDigest
  const factTasks: TargetedTask[] = prepared.planned.packets.map((packet, index) => ({
    taskId: `targeted-fact-${index}`, kind: 'fact', index, revision: packet.revision, packetDigest: packet.packetDigest,
    status: 'pending', attempt: 0,
  }))
  return {
    phase: factTasks.length ? 'extracting_facts' : 'deterministic_validation',
    inputDigest: prepared.inputDigest,
    revision,
    candidateId: prepared.input.candidate.candidateId,
    candidateResultId: prepared.input.candidate.resultId,
    factTasks, semanticTasks: [], factReceipts: [], usageByDispatch: Object.create(null),
    aggregateUsage: zeroUsage(),
  }
}

/** Pure replay reducer for Reviewer-owned targeted validation. */
export function applyReviewerTargetedEvent(
  prior: ReviewerTargetedState,
  input: ReviewerPreparedCandidate,
  command: ReviewerTargetedEvent,
  at: string,
  evidence?: { path: string; digest: string; runId: string; ownerId?: string },
): ReviewerTargetedState {
  const event = targetedEventSchema.parse(command)
  if (!validTime(at)) throw new Error('targeted event time is invalid')
  const prepared = prepareReviewerTargetedAudit(input)
  if (prepared.inputDigest !== prior.inputDigest) throw new Error('targeted state input binding changed')
  if (event.kind === 'lifecycle_failure') return { ...structuredClone(prior), control: { failure: event.code } }
  if (event.kind === 'lifecycle_resume') {
    if (running(prior)) throw new Error('targeted native cleanup is required before continuation')
    const cleared = { ...structuredClone(prior), control: {} }
    const state = prior.phase === 'stopped' || prior.phase === 'needs_action'
      ? applyReviewerTargetedEvent(cleared, input, { kind: 'resume' }, at, evidence) : cleared
    state.control = {}
    return state
  }
  if (prior.control?.failure && ['claim', 'validate', 'resume'].includes(event.kind))
    throw new Error('targeted lifecycle requires explicit continuation')
  if (event.kind === 'seal_usage' || event.kind === 'billing_ack') {
    if (!evidence?.runId.trim() || !evidence.ownerId) throw new Error('targeted usage journal binding is missing')
    if (evidence.ownerId !== input.source.ownerId) throw new Error('targeted usage journal owner mismatch')
    return applyReviewerTargetedUsageEvent(prior, event as ReviewerTargetedUsageEvent, { runId: evidence.runId, ownerId: evidence.ownerId })
  }
  const state = structuredClone(prior)

  if (event.kind === 'claim') {
    if (!['extracting_facts', 'semantic_review'].includes(state.phase)) throw new Error('targeted review is not executing')
    if (running(state) >= TARGETED_MAX_RUNNING) throw new Error('targeted concurrency limit reached')
    if (tasks(state).some(task => task.dispatch?.dispatchId === event.dispatchId || task.attemptHistory?.some(item => item.dispatchId === event.dispatchId)))
      throw new Error('targeted dispatch identity is already used')
    const task = taskFor(state, event.taskId)
    if (!task || !['pending', 'retryable'].includes(task.status)) throw new Error('targeted task is not claimable')
    if (task.kind === 'fact' && state.phase !== 'extracting_facts') throw new Error('targeted fact phase is closed')
    if (task.kind === 'semantic' && state.phase !== 'semantic_review') throw new Error('targeted semantic phase is not executing')
    if (task.kind === 'semantic' && !state.semanticTasks.length) throw new Error('targeted semantic tasks are not initialized')
    if (task.dispatch) task.attemptHistory = [...(task.attemptHistory ?? []), task.dispatch]
    task.status = 'running'; task.attempt += 1; delete task.failureReason
    task.dispatch = { dispatchId: event.dispatchId, taskId: task.taskId, revision: task.revision, status: 'running', startedAt: at }
  } else if (event.kind === 'usage') {
    const known = knownDispatch(state, event.dispatchId)
    if (!known || known.task.taskId !== event.taskId) throw new Error('targeted usage does not match a known dispatch')
    assertTargetedUsageCanChange(state, event.dispatchId, event.usage)
    observe(state, event.dispatchId, event.usage)
    known.dispatch.usage = { ...event.usage }
    if (known.task.dispatch === known.dispatch) known.task.usage = { ...event.usage }
  } else if (event.kind === 'accept' || event.kind === 'fail') {
    const task = taskFor(state, event.taskId)
    // Completed terminal replay is idempotent only after the output has been
    // admitted again against the exact packet and compared with the old digest.
    if (event.kind === 'accept' && task?.status === 'completed' && task.dispatch?.dispatchId === event.dispatchId) {
      ownedReceipt(evidence)
      if (!evidence.runId.trim()) throw new Error('targeted acceptance run identity is missing')
      let terminal: Record<string, unknown>
      if (task.kind === 'fact') {
        const admitted = createReviewerTargetedFactWorker(input, task.index).admit(event.output)
        terminal = { status: 'completed', taskId: task.taskId, packetDigest: task.packetDigest, results: admitted.receipts }
      } else {
        const admitted = createReviewerTargetedSemanticWorker(input, state.factReceipts, task.index).admit(event.output)
        terminal = { status: 'completed', taskId: task.taskId, packetDigest: task.packetDigest, result: admitted }
      }
      if (task.terminalDigest !== reviewerDigest(terminal) || task.receiptPath !== evidence.path || task.receiptDigest !== evidence.digest)
        throw new Error('conflicting targeted terminal replay')
      assertTargetedUsageCanChange(state, event.dispatchId, event.usage)
      observe(state, event.dispatchId, event.usage)
      task.dispatch.usage = { ...event.usage }; task.usage = { ...event.usage }
      state.aggregateUsage = sumUsage(state)
      return state
    }
    if (!task || task.status !== 'running' || task.dispatch?.dispatchId !== event.dispatchId) throw new Error('targeted terminal does not match a running dispatch')
    assertTargetedUsageCanChange(state, event.dispatchId, event.usage)
    observe(state, event.dispatchId, event.usage)
    const dispatch = task.dispatch!
    const durationMs = Math.max(0, Date.parse(at) - Date.parse(dispatch.startedAt))
    let terminal: Record<string, unknown>
    if (event.kind === 'accept') {
      ownedReceipt(evidence)
      if (!evidence.runId.trim()) throw new Error('targeted acceptance run identity is missing')
      if (task.kind === 'fact') {
        const worker = createReviewerTargetedFactWorker(input, task.index)
        const admitted = worker.admit(event.output)
        task.factReceipts = structuredClone(admitted.receipts)
        task.receiptPath = evidence.path; task.receiptDigest = evidence.digest
        terminal = { status: 'completed', taskId: task.taskId, packetDigest: task.packetDigest, results: admitted.receipts }
      } else {
        const worker = createReviewerTargetedSemanticWorker(input, state.factReceipts, task.index)
        const admitted = worker.admit(event.output)
        task.semanticResult = structuredClone(admitted)
        task.semanticOutput = structuredClone(event.output)
        task.receiptPath = evidence.path; task.receiptDigest = evidence.digest
        terminal = { status: 'completed', taskId: task.taskId, packetDigest: task.packetDigest, result: admitted }
      }
      task.status = 'completed'
    } else {
      terminal = { status: 'failed', taskId: task.taskId, packetDigest: task.packetDigest, reason: event.reason }
      task.status = 'retryable'; task.failureReason = event.reason
      dispatch.failureReason = event.reason
    }
    task.terminalDigest = reviewerDigest(terminal)
    task.usage = { ...event.usage }; task.durationMs = durationMs
    dispatch.status = event.kind === 'accept' ? 'completed' : 'failed'; dispatch.finishedAt = at; dispatch.usage = { ...event.usage }; dispatch.terminalResult = terminal
    if (evidence) dispatch.terminalEvidencePath = evidence.path
    refreshFactReceipts(state)
  } else if (event.kind === 'validate') {
    if (state.phase !== 'deterministic_validation') throw new Error('targeted deterministic validation is not ready')
    if (state.factTasks.some(task => task.status !== 'completed')) throw new Error('targeted facts are incomplete')
    refreshFactReceipts(state)
    const validation = validateReviewerTargetedFacts(input, state.factReceipts)
    const failed = validation.documentValidations.some(item => item.checked.patchValidations.some(check => check.status === 'FAIL'))
    state.deterministic = {
      patchValidations: structuredClone(validation.documentValidations.flatMap(item => item.checked.patchValidations)),
      semanticIssueIds: validation.semantic.map(item => item.issue.id),
      newImpactedIssueIds: validation.newImpactedIssues.map(issue => issue.id), failed,
    }
    if (!failed) state.semanticTasks = validation.semantic.map(({ issue, packet }, index) => ({
      taskId: `targeted-semantic-${index}`, kind: 'semantic', index, issueId: issue.id,
      revision: validation.prepared.input.source.documentSetDigest, packetDigest: packet.packetDigest,
      status: 'pending', attempt: 0,
    }))
  } else if (event.kind === 'configuration_unavailable') {
    if (!['extracting_facts', 'semantic_review'].includes(state.phase)) throw new Error('targeted review is not waiting for model configuration')
    for (const task of tasks(state)) if ((!event.taskId || task.taskId === event.taskId) && (task.status === 'pending' || task.status === 'retryable')) {
      task.status = 'needs_action'
      task.failureReason = task.kind === 'fact' ? 'foundation targeted fact model is not configured' : 'foundation targeted semantic model is not configured'
    }
  } else if (event.kind === 'recover_lost') {
    if (!['extracting_facts', 'semantic_review', 'needs_action'].includes(state.phase)) throw new Error('targeted review cannot recover lost work in this phase')
    if (new Set(event.dispatchIds).size !== event.dispatchIds.length) throw new Error('duplicate lost targeted dispatch')
    if (new Set(event.cleanup.dispatchIds).size !== event.cleanup.dispatchIds.length ||
      event.cleanup.dispatchIds.length !== event.dispatchIds.length ||
      event.cleanup.dispatchIds.some(dispatchId => !event.dispatchIds.includes(dispatchId)))
      throw new Error('targeted cleanup receipt dispatch IDs do not match recovery')
    ownedCleanupReceipt(event.cleanup, evidence)
    for (const dispatchId of event.dispatchIds) {
      const known = knownDispatch(state, dispatchId)
      if (!known || known.task.status !== 'running' || known.task.dispatch !== known.dispatch) throw new Error('lost targeted dispatch is not running')
      known.task.status = 'retryable'; known.task.failureReason = 'targeted worker process lost; retry permitted'
      known.dispatch.status = 'interrupted'; known.dispatch.finishedAt = at; known.dispatch.failureReason = known.task.failureReason
      known.task.durationMs = Math.max(0, Date.parse(at) - Date.parse(known.dispatch.startedAt))
    }
  } else if (event.kind === 'stop') {
    if (state.phase === 'targeted_staged' || state.phase === 'deterministic_failed' || state.phase === 'stopped') return state
    state.phase = 'stopped'
    for (const task of tasks(state)) if (task.status === 'running' && task.dispatch) {
      task.status = 'retryable'; task.attempt = Math.max(0, task.attempt - 1); task.failureReason = 'operator stopped'
      task.durationMs = Math.max(0, Date.parse(at) - Date.parse(task.dispatch.startedAt))
      task.dispatch.status = 'interrupted'; task.dispatch.finishedAt = at; task.dispatch.failureReason = task.failureReason
    }
  } else {
    if (state.phase !== 'stopped' && state.phase !== 'needs_action') throw new Error('targeted review is not paused')
    for (const task of tasks(state)) if (task.status === 'needs_action' && task.attempt === 0 && task.dispatch === undefined &&
      task.attemptHistory === undefined && task.terminalDigest === undefined && task.receiptPath === undefined && task.receiptDigest === undefined &&
      task.factReceipts === undefined && task.semanticResult === undefined && task.semanticOutput === undefined && task.failureReason === (task.kind === 'fact'
        ? 'foundation targeted fact model is not configured' : 'foundation targeted semantic model is not configured')) {
      task.status = 'pending'; delete task.failureReason
    }
    if (tasks(state).some(task => task.status === 'needs_action')) throw new Error('targeted review requires action')
    state.phase = 'extracting_facts'
    refreshPhase(input, state)
  }

  // Keep usage in a stable, inspectable location without making it a second
  // billing ledger. Consumers may derive aggregate telemetry from this map.
  state.aggregateUsage = sumUsage(state)
  refreshPhase(input, state)
  return state
}
