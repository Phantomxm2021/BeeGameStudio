import { createHash } from 'node:crypto'
import type { DispatchRecord, WorkflowUsage } from './types'

export const FOUNDATION_SEMANTIC_MAX_TASKS = 10
export const FOUNDATION_SEMANTIC_MAX_RUNNING = 4
export const FOUNDATION_SEMANTIC_MAX_ATTEMPTS = 2
export const FOUNDATION_SEMANTIC_OUTPUT_MAX_TOKENS = 768
export const FOUNDATION_SEMANTIC_MAX_MODEL_TOKENS = 80_000
export const FOUNDATION_SEMANTIC_PHASE_DEADLINE_MS = 5 * 60 * 1000
export const FOUNDATION_DEEP_MAX_TASKS = 4
export const FOUNDATION_DEEP_MAX_ATTEMPTS = 1
export const FOUNDATION_DEEP_OUTPUT_MAX_TOKENS = 1_024
export const FOUNDATION_DEEP_MAX_MODEL_TOKENS = 32_000
export const FOUNDATION_DEEP_PHASE_DEADLINE_MS = 5 * 60 * 1000

export type FoundationSemanticTaskStatus = 'pending' | 'running' | 'retryable' | 'completed' | 'needs_action'
export type FoundationSemanticTier = 'fast' | 'balanced' | 'strong'

export type FoundationSemanticTask = {
  taskId: string
  kind: 'semantic'
  revision: string
  checkId: string
  packetDigest: string
  modelTier: 'fast' | 'balanced'
  status: FoundationSemanticTaskStatus
  attempt: number
  dispatch?: DispatchRecord
  terminalDigest?: string
  receiptPath?: string
  receiptDigest?: string
  usage?: WorkflowUsage
  durationMs?: number
  failureReason?: string
}

export type FoundationConfirmationTask = {
  taskId: string
  kind: 'confirmation'
  revision: string
  checkId: string
  sourceTaskId: string
  packetDigest: string
  modelTier: 'strong'
  status: FoundationSemanticTaskStatus
  attempt: 0 | 1
  dispatch?: DispatchRecord
  terminalDigest?: string
  receiptPath?: string
  receiptDigest?: string
  usage?: WorkflowUsage
  durationMs?: number
  failureReason?: string
}

export type FoundationSemanticRuntimeTask = FoundationSemanticTask | FoundationConfirmationTask
export type FoundationSemanticTaskCollection = {
  revision: string
  phaseStartedAt: string
  status: 'semantic_review' | 'audit_ready'
  tasks: FoundationSemanticRuntimeTask[]
  aggregateUsage: WorkflowUsage
  deepPhaseStartedAt?: string
  deepAggregateUsage?: WorkflowUsage
}

export type FoundationSemanticTerminal = {
  workerType: 'foundation-semantic-reviewer'
  status: 'completed' | 'failed' | 'blocked'
  runId: string
  dispatchId: string
  taskId: string
  revision: string
  packetDigest: string
  outcome: 'PASS' | 'ISSUES' | 'UNDECIDABLE'
  [key: string]: unknown
}

export type FoundationSemanticTerminalAdmission = {
  taskId: string
  dispatchId: string
  revision: string
  packetDigest: string
  terminal: FoundationSemanticTerminal
  usage: WorkflowUsage
  durationMs: number
  now: string
}

export type FoundationSemanticTerminalAdmissionResult = {
  state: FoundationSemanticTaskCollection
  idempotent: boolean
  terminalDigest: string
  accepted: boolean
}

const zeroUsage = (): WorkflowUsage => ({ input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 })
const normalizeUsage = (input: WorkflowUsage): WorkflowUsage => ({
  input_tokens: Math.max(0, input.input_tokens),
  cache_read_tokens: Math.max(0, input.cache_read_tokens),
  cache_creation_tokens: Math.max(0, input.cache_creation_tokens),
  completion_tokens: Math.max(0, input.completion_tokens),
  total_tokens: Math.max(0, input.total_tokens),
})
const addUsage = (left: WorkflowUsage, right: WorkflowUsage): WorkflowUsage => ({
  input_tokens: left.input_tokens + right.input_tokens,
  cache_read_tokens: left.cache_read_tokens + right.cache_read_tokens,
  cache_creation_tokens: left.cache_creation_tokens + right.cache_creation_tokens,
  completion_tokens: left.completion_tokens + right.completion_tokens,
  total_tokens: left.total_tokens + right.total_tokens,
})
function canonical(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(canonical).join(',')}]`
  if (input && typeof input === 'object') return `{${Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(',')}}`
  return JSON.stringify(input)
}
const digest = (input: unknown): string => createHash('sha256').update(canonical(input)).digest('hex')
export const digestFoundationSemanticTerminal = digest
const assertDigest = (value: string, label: string): void => { if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a sha256 digest`) }

export function createFoundationSemanticTaskCollection(input: {
  revision: string
  phaseStartedAt: string
  tasks: readonly FoundationSemanticTask[]
}): FoundationSemanticTaskCollection {
  if (input.tasks.length !== FOUNDATION_SEMANTIC_MAX_TASKS) throw new Error('semantic review requires exactly ten tasks')
  if (new Set(input.tasks.map(item => item.taskId)).size !== input.tasks.length) throw new Error('semantic task IDs must be stable and unique')
  if (new Set(input.tasks.map(item => item.checkId)).size !== input.tasks.length) throw new Error('semantic check IDs must be stable and unique')
  for (const task of input.tasks) {
    if (task.revision !== input.revision || task.kind !== 'semantic' || !['fast', 'balanced'].includes(task.modelTier) || task.status !== 'pending' || task.attempt !== 0) throw new Error('invalid semantic task seed')
    assertDigest(task.packetDigest, 'semantic packet digest')
  }
  return { revision: input.revision, phaseStartedAt: input.phaseStartedAt, status: 'semantic_review', tasks: input.tasks.map(item => ({ ...item })), aggregateUsage: zeroUsage() }
}

function deadlineExceeded(startedAt: string, now: string, limit: number): boolean {
  const start = Date.parse(startedAt); const end = Date.parse(now)
  return Number.isFinite(start) && Number.isFinite(end) && end - start > limit
}

function assertTerminalBinding(task: FoundationSemanticRuntimeTask, input: FoundationSemanticTerminalAdmission): void {
  if (input.terminal.workerType !== 'foundation-semantic-reviewer') throw new Error('semantic terminal worker type mismatch')
  if (input.terminal.dispatchId !== input.dispatchId) throw new Error('semantic terminal dispatch mismatch')
  if (input.terminal.taskId !== input.taskId) throw new Error('semantic terminal task mismatch')
  if (input.terminal.revision !== input.revision) throw new Error('semantic terminal revision mismatch')
  if (input.terminal.packetDigest !== input.packetDigest) throw new Error('semantic terminal packet mismatch')
  if (task.dispatch?.workerType !== 'foundation-semantic-reviewer') throw new Error('semantic dispatch worker type mismatch')
}

function assertAdmittedSemanticSource(source: FoundationSemanticTask): void {
  if (
    source.status !== 'completed' ||
    !source.terminalDigest ||
    !/^[a-f0-9]{64}$/.test(source.terminalDigest) ||
    !source.usage ||
    source.durationMs === undefined ||
    !Number.isFinite(source.durationMs) ||
    source.durationMs < 0 ||
    source.dispatch?.status !== 'completed' ||
    !source.dispatch.terminalResult
  ) throw new Error('confirmation requires a completed semantic source with terminal, usage, duration, and dispatch evidence')
}

export function claimFoundationSemanticTasks(
  state: FoundationSemanticTaskCollection,
  input: { dispatchIdFor: (task: FoundationSemanticRuntimeTask) => string; now: string; configuredTiers: Partial<Record<FoundationSemanticTier, boolean>>; onlyTaskId?: string },
): FoundationSemanticTaskCollection {
  const tasks = state.tasks.map(task => {
    if (task.status !== 'pending' && task.status !== 'retryable') return task
    if (input.onlyTaskId && task.taskId !== input.onlyTaskId) return task
    const tierReady = input.configuredTiers[task.modelTier]
    const deep = task.kind === 'confirmation'
    const aggregate = deep ? (state.deepAggregateUsage?.total_tokens ?? 0) : state.aggregateUsage.total_tokens
    const expired = deadlineExceeded(deep ? (state.deepPhaseStartedAt ?? state.phaseStartedAt) : state.phaseStartedAt, input.now, deep ? FOUNDATION_DEEP_PHASE_DEADLINE_MS : FOUNDATION_SEMANTIC_PHASE_DEADLINE_MS)
    const capped = aggregate >= (deep ? FOUNDATION_DEEP_MAX_MODEL_TOKENS : FOUNDATION_SEMANTIC_MAX_MODEL_TOKENS)
    if (expired || capped || tierReady === false || tierReady === undefined) return { ...task, status: 'needs_action' as const, failureReason: capped ? `${deep ? 'deep' : 'semantic'} aggregate model token cap exceeded` : expired ? `${deep ? 'deep' : 'semantic'} review phase deadline exceeded` : `${task.modelTier} semantic model is not configured` }
    return task
  })
  let slots = Math.max(0, FOUNDATION_SEMANTIC_MAX_RUNNING - tasks.filter(task => task.status === 'running').length)
  return { ...state, tasks: tasks.map(task => {
    if (!slots || (task.status !== 'pending' && task.status !== 'retryable') || (input.onlyTaskId && task.taskId !== input.onlyTaskId)) return task
    const maxAttempts = task.kind === 'confirmation' ? FOUNDATION_DEEP_MAX_ATTEMPTS : FOUNDATION_SEMANTIC_MAX_ATTEMPTS
    if (task.attempt >= maxAttempts) return { ...task, status: 'needs_action' as const, failureReason: 'semantic task attempt cap exceeded' }
    const dispatchId = input.dispatchIdFor(task); if (!dispatchId.trim()) throw new Error('semantic dispatch ID is required')
    slots -= 1
    return { ...task, status: 'running' as const, attempt: (task.attempt + 1) as never, dispatch: { dispatchId, workerType: 'foundation-semantic-reviewer' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: task.taskId, revision: task.revision, status: 'running' as const, startedAt: input.now }, failureReason: undefined }
  }) }
}

export function admitFoundationSemanticTerminal(state: FoundationSemanticTaskCollection, input: FoundationSemanticTerminalAdmission): FoundationSemanticTerminalAdmissionResult {
  const task = state.tasks.find(item => item.taskId === input.taskId)
  if (!task) throw new Error('semantic task was not found')
  assertDigest(input.packetDigest, 'semantic packet digest')
  if (input.revision !== state.revision || input.revision !== task.revision || input.packetDigest !== task.packetDigest) throw new Error('semantic terminal binding mismatch')
  if (task.dispatch?.dispatchId !== input.dispatchId) throw new Error('semantic terminal dispatch mismatch')
  assertTerminalBinding(task, input)
  const terminalDigest = digest(input.terminal)
  if (task.status === 'completed') {
    if (task.terminalDigest === terminalDigest) return { state, idempotent: true, terminalDigest, accepted: true }
    throw new Error('conflicting semantic terminal replay')
  }
  if (task.status !== 'running') throw new Error('semantic task is not running')
  const measured = normalizeUsage(input.usage)
  const deep = task.kind === 'confirmation'
  const outputCap = deep ? FOUNDATION_DEEP_OUTPUT_MAX_TOKENS : FOUNDATION_SEMANTIC_OUTPUT_MAX_TOKENS
  const totalCap = deep ? FOUNDATION_DEEP_MAX_MODEL_TOKENS : FOUNDATION_SEMANTIC_MAX_MODEL_TOKENS
  const aggregate = deep ? addUsage(state.deepAggregateUsage ?? zeroUsage(), measured) : addUsage(state.aggregateUsage, measured)
  const expired = deadlineExceeded(deep ? (state.deepPhaseStartedAt ?? state.phaseStartedAt) : state.phaseStartedAt, input.now, deep ? FOUNDATION_DEEP_PHASE_DEADLINE_MS : FOUNDATION_SEMANTIC_PHASE_DEADLINE_MS)
  const failureReason = measured.completion_tokens > outputCap ? `semantic output token cap exceeded (${outputCap})` : aggregate.total_tokens > totalCap ? 'semantic aggregate model token cap exceeded' : expired ? 'semantic review phase deadline exceeded' : input.terminal.status === 'completed' ? undefined : 'semantic worker did not complete'
  const completed = !failureReason
  const nextTask = { ...task, status: completed ? 'completed' as const : failureReason && (failureReason.includes('cap') || failureReason.includes('deadline')) ? 'needs_action' as const : task.attempt < (deep ? FOUNDATION_DEEP_MAX_ATTEMPTS : FOUNDATION_SEMANTIC_MAX_ATTEMPTS) ? 'retryable' as const : 'needs_action' as const, terminalDigest, usage: measured, durationMs: Math.max(0, input.durationMs), failureReason, dispatch: task.dispatch ? { ...task.dispatch, status: completed ? 'completed' as const : 'failed' as const, finishedAt: input.now, terminalResult: input.terminal } : undefined }
  return { state: { ...state, tasks: state.tasks.map(item => item.taskId === task.taskId ? nextTask : item), ...(deep ? { deepAggregateUsage: aggregate } : { aggregateUsage: aggregate }) }, idempotent: false, terminalDigest, accepted: completed }
}

export function foundationSemanticTasksComplete(state: FoundationSemanticTaskCollection): boolean {
  const semanticCount = state.tasks.filter(task => task.kind === 'semantic').length
  return semanticCount === FOUNDATION_SEMANTIC_MAX_TASKS && state.tasks.every(task => task.status === 'completed' && task.terminalDigest && task.usage && task.durationMs !== undefined && task.dispatch?.status === 'completed') && state.tasks.every(task => task.status !== 'pending' && task.status !== 'running')
}

export function createFoundationConfirmationTask(input: { taskId: string; sourceTask: FoundationSemanticTask; admittedOutcome: 'PASS' | 'ISSUES' | 'UNDECIDABLE'; sourceSeverity: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' }): FoundationConfirmationTask {
  assertAdmittedSemanticSource(input.sourceTask)
  if (input.admittedOutcome !== 'UNDECIDABLE' && input.sourceSeverity !== 'BLOCKER') throw new Error('confirmation requires UNDECIDABLE or a current BLOCKER gate')
  assertDigest(input.sourceTask.packetDigest, 'confirmation packet digest')
  return { taskId: input.taskId, kind: 'confirmation', sourceTaskId: input.sourceTask.taskId, checkId: input.sourceTask.checkId, revision: input.sourceTask.revision, packetDigest: input.sourceTask.packetDigest, modelTier: 'strong', status: 'pending', attempt: 0 }
}

export function appendFoundationConfirmationTask(state: FoundationSemanticTaskCollection, input: { taskId: string; sourceTaskId: string; admittedResult: { outcome: 'PASS' | 'ISSUES' | 'UNDECIDABLE'; severity: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' }; now: string }): FoundationSemanticTaskCollection {
  if (!input.now.trim()) throw new Error('confirmation phase start time is required')
  if (state.tasks.some(task => task.taskId === input.taskId)) throw new Error('semantic task ID already exists')
  const source = state.tasks.find(task => task.taskId === input.sourceTaskId)
  if (!source || source.kind !== 'semantic') throw new Error('confirmation source task is not semantic')
  if (state.tasks.some(task => task.kind === 'confirmation' && task.sourceTaskId === source.taskId)) throw new Error('semantic confirmation source already admitted')
  const count = state.tasks.filter(task => task.kind === 'confirmation').length
  if (count >= FOUNDATION_DEEP_MAX_TASKS) throw new Error('semantic confirmation task limit exceeded')
  const confirmation = createFoundationConfirmationTask({ taskId: input.taskId, sourceTask: source, admittedOutcome: input.admittedResult.outcome, sourceSeverity: input.admittedResult.severity })
  return { ...state, tasks: [...state.tasks, confirmation], deepPhaseStartedAt: state.deepPhaseStartedAt ?? input.now }
}
