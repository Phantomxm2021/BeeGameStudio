import { createHash } from 'node:crypto'
import type { DispatchRecord, WorkflowUsage } from './types'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST, type FoundationSemanticResult } from './foundation-semantic-audit'
import { estimateStructuredPayloadTokens, foundationSemanticBusinessPayload } from './structured-output-admission'

export const FOUNDATION_SEMANTIC_MAX_TASKS = 10
export const FOUNDATION_SEMANTIC_MAX_RUNNING = 4
export const FOUNDATION_SEMANTIC_MAX_ATTEMPTS = 2
export const FOUNDATION_SEMANTIC_OUTPUT_MAX_TOKENS = 2_048
export const FOUNDATION_DEEP_MAX_TASKS = 4
export const FOUNDATION_DEEP_MAX_ATTEMPTS = 1
export const FOUNDATION_DEEP_OUTPUT_MAX_TOKENS = 2_048

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
function assertTimestamp(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a valid timestamp`)
}

function assertUsage(input: WorkflowUsage): void {
  const fields: (keyof WorkflowUsage)[] = ['input_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'completion_tokens', 'total_tokens']
  for (const field of fields) {
    if (!Number.isFinite(input[field]) || input[field] < 0) throw new Error(`semantic usage ${field} must be finite and non-negative`)
  }
  if (input.total_tokens < input.input_tokens + input.completion_tokens) throw new Error('semantic usage total_tokens is inconsistent')
}

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
  assertTimestamp(input.phaseStartedAt, 'semantic phaseStartedAt')
  if (input.tasks.length !== FOUNDATION_SEMANTIC_MAX_TASKS) throw new Error('semantic review requires exactly ten tasks')
  if (new Set(input.tasks.map(item => item.taskId)).size !== input.tasks.length) throw new Error('semantic task IDs must be stable and unique')
  if (new Set(input.tasks.map(item => item.checkId)).size !== input.tasks.length) throw new Error('semantic check IDs must be stable and unique')
  for (const task of input.tasks) {
    if (task.revision !== input.revision || task.kind !== 'semantic' || !['fast', 'balanced'].includes(task.modelTier) || task.status !== 'pending' || task.attempt !== 0) throw new Error('invalid semantic task seed')
    assertDigest(task.packetDigest, 'semantic packet digest')
  }
  return { revision: input.revision, phaseStartedAt: input.phaseStartedAt, status: 'semantic_review', tasks: input.tasks.map(item => ({ ...item })), aggregateUsage: zeroUsage() }
}

function assertAdmittedResult(value: FoundationSemanticResult): FoundationSemanticResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('admitted semantic result is invalid')
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const allowed = ['checkId', 'issues', 'outcome', 'packetIdentity', 'reason']
  if (keys.some(key => !allowed.includes(key)) || typeof value.checkId !== 'string' || !value.checkId.trim() || typeof value.packetIdentity !== 'string' || !/^[a-f0-9]{64}$/.test(value.packetIdentity) || !['PASS', 'ISSUES', 'UNDECIDABLE'].includes(value.outcome)) throw new Error('admitted semantic result identity or outcome is invalid')
  return value
}

function assertTerminalBinding(task: FoundationSemanticRuntimeTask, input: FoundationSemanticTerminalAdmission): void {
  if (input.terminal.workerType !== 'foundation-semantic-reviewer') throw new Error('semantic terminal worker type mismatch')
  if (input.terminal.dispatchId !== input.dispatchId) throw new Error('semantic terminal dispatch mismatch')
  if (input.terminal.taskId !== input.taskId) throw new Error('semantic terminal task mismatch')
  if (input.terminal.revision !== input.revision) throw new Error('semantic terminal revision mismatch')
  if (input.terminal.packetDigest !== input.packetDigest) throw new Error('semantic terminal packet mismatch')
  if (task.dispatch?.workerType !== 'foundation-semantic-reviewer') throw new Error('semantic dispatch worker type mismatch')
}

function assertAdmittedSemanticSource(source: FoundationSemanticTask, result: FoundationSemanticResult): FoundationSemanticResult {
  const admitted = assertAdmittedResult(result)
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
  assertUsage(source.usage)
  if (source.terminalDigest !== digest(source.dispatch.terminalResult)) throw new Error('confirmation source terminal digest does not match dispatch evidence')
  if (admitted.checkId !== source.checkId) throw new Error('confirmation result check identity does not match source')
  if (admitted.packetIdentity !== source.packetDigest) throw new Error('confirmation result packet identity does not match source')
  const terminalOutcome = source.dispatch.terminalResult.outcome
  if (!['PASS', 'ISSUES', 'UNDECIDABLE'].includes(String(terminalOutcome))) throw new Error('confirmation source terminal outcome is invalid')
  if (admitted.outcome !== terminalOutcome) throw new Error('confirmation result outcome does not match admitted terminal')
  const declaration = FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.find(check => check.checkId === source.checkId)
  if (!declaration) throw new Error('confirmation source check is not in the semantic manifest')
  if (admitted.outcome !== 'UNDECIDABLE' && declaration.severity !== 'BLOCKER') throw new Error('confirmation requires UNDECIDABLE or a manifest BLOCKER gate')
  return admitted
}

export function claimFoundationSemanticTasks(
  state: FoundationSemanticTaskCollection,
  input: { dispatchIdFor: (task: FoundationSemanticRuntimeTask) => string; now: string; configuredTiers: Partial<Record<FoundationSemanticTier, boolean>>; onlyTaskId?: string },
): FoundationSemanticTaskCollection {
  assertTimestamp(state.phaseStartedAt, 'semantic phaseStartedAt')
  assertTimestamp(input.now, 'semantic now')
  assertUsage(state.aggregateUsage)
  if (state.deepPhaseStartedAt !== undefined) assertTimestamp(state.deepPhaseStartedAt, 'deepPhaseStartedAt')
  if (state.deepAggregateUsage !== undefined) assertUsage(state.deepAggregateUsage)
  const tasks = state.tasks.map(task => {
    if (task.status !== 'pending' && task.status !== 'retryable') return task
    if (input.onlyTaskId && task.taskId !== input.onlyTaskId) return task
    const tierReady = input.configuredTiers[task.modelTier]
    const deep = task.kind === 'confirmation'
    if (tierReady === false || tierReady === undefined) return { ...task, status: 'needs_action' as const, failureReason: `${task.modelTier} semantic model is not configured` }
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
  assertTimestamp(state.phaseStartedAt, 'semantic phaseStartedAt')
  assertTimestamp(input.now, 'semantic now')
  assertUsage(state.aggregateUsage)
  if (state.deepPhaseStartedAt !== undefined) assertTimestamp(state.deepPhaseStartedAt, 'deepPhaseStartedAt')
  if (state.deepAggregateUsage !== undefined) assertUsage(state.deepAggregateUsage)
  const task = state.tasks.find(item => item.taskId === input.taskId)
  if (!task) throw new Error('semantic task was not found')
  assertDigest(input.packetDigest, 'semantic packet digest')
  if (input.revision !== state.revision || input.revision !== task.revision || input.packetDigest !== task.packetDigest) throw new Error('semantic terminal binding mismatch')
  if (task.dispatch?.dispatchId !== input.dispatchId) throw new Error('semantic terminal dispatch mismatch')
  assertTerminalBinding(task, input)
  if (task.kind === 'confirmation') assertTimestamp(state.deepPhaseStartedAt ?? '', 'deepPhaseStartedAt')
  const terminalDigest = digest(input.terminal)
  if (task.status === 'completed') {
    if (task.terminalDigest === terminalDigest) return { state, idempotent: true, terminalDigest, accepted: true }
    throw new Error('conflicting semantic terminal replay')
  }
  if (task.status !== 'running') throw new Error('semantic task is not running')
  assertUsage(input.usage)
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) throw new Error('semantic durationMs must be finite and non-negative')
  const measured = normalizeUsage(input.usage)
  const deep = task.kind === 'confirmation'
  const outputCap = deep ? FOUNDATION_DEEP_OUTPUT_MAX_TOKENS : FOUNDATION_SEMANTIC_OUTPUT_MAX_TOKENS
  const aggregate = deep ? addUsage(state.deepAggregateUsage ?? zeroUsage(), measured) : addUsage(state.aggregateUsage, measured)
  const outputTokens = estimateStructuredPayloadTokens(foundationSemanticBusinessPayload(input.terminal))
  const failureReason = outputTokens > outputCap ? `semantic output token cap exceeded (${outputCap})` : input.terminal.status === 'completed' ? undefined : 'semantic worker did not complete'
  const completed = !failureReason
  const nextTask = { ...task, status: completed ? 'completed' as const : failureReason.includes('output token cap') ? 'needs_action' as const : task.attempt < (deep ? FOUNDATION_DEEP_MAX_ATTEMPTS : FOUNDATION_SEMANTIC_MAX_ATTEMPTS) ? 'retryable' as const : 'needs_action' as const, terminalDigest, usage: measured, durationMs: Math.max(0, input.durationMs), failureReason, dispatch: task.dispatch ? { ...task.dispatch, status: completed ? 'completed' as const : 'failed' as const, finishedAt: input.now, terminalResult: input.terminal } : undefined }
  return { state: { ...state, tasks: state.tasks.map(item => item.taskId === task.taskId ? nextTask : item), ...(deep ? { deepAggregateUsage: aggregate } : { aggregateUsage: aggregate }) }, idempotent: false, terminalDigest, accepted: completed }
}

export function foundationSemanticTasksComplete(state: FoundationSemanticTaskCollection): boolean {
  const semanticCount = state.tasks.filter(task => task.kind === 'semantic').length
  return semanticCount === FOUNDATION_SEMANTIC_MAX_TASKS && state.tasks.every(task => task.status === 'completed' && task.terminalDigest && task.usage && task.durationMs !== undefined && task.dispatch?.status === 'completed') && state.tasks.every(task => task.status !== 'pending' && task.status !== 'running')
}

export function createFoundationConfirmationTask(input: { taskId: string; sourceTask: FoundationSemanticTask; result: FoundationSemanticResult }): FoundationConfirmationTask {
  assertAdmittedSemanticSource(input.sourceTask, input.result)
  assertDigest(input.sourceTask.packetDigest, 'confirmation packet digest')
  return { taskId: input.taskId, kind: 'confirmation', sourceTaskId: input.sourceTask.taskId, checkId: input.sourceTask.checkId, revision: input.sourceTask.revision, packetDigest: input.sourceTask.packetDigest, modelTier: 'strong', status: 'pending', attempt: 0 }
}

export function appendFoundationConfirmationTask(state: FoundationSemanticTaskCollection, input: { taskId: string; sourceTaskId: string; admittedResult: FoundationSemanticResult; now: string }): FoundationSemanticTaskCollection {
  assertTimestamp(state.phaseStartedAt, 'semantic phaseStartedAt')
  assertTimestamp(input.now, 'deepPhaseStartedAt')
  assertUsage(state.aggregateUsage)
  if (state.deepAggregateUsage !== undefined) assertUsage(state.deepAggregateUsage)
  if (state.deepPhaseStartedAt !== undefined) assertTimestamp(state.deepPhaseStartedAt, 'deepPhaseStartedAt')
  if (!input.now.trim()) throw new Error('confirmation phase start time is required')
  if (state.tasks.some(task => task.taskId === input.taskId)) throw new Error('semantic task ID already exists')
  const source = state.tasks.find(task => task.taskId === input.sourceTaskId)
  if (!source || source.kind !== 'semantic') throw new Error('confirmation source task is not semantic')
  if (state.tasks.some(task => task.kind === 'confirmation' && task.sourceTaskId === source.taskId)) throw new Error('semantic confirmation source already admitted')
  const count = state.tasks.filter(task => task.kind === 'confirmation').length
  if (count >= FOUNDATION_DEEP_MAX_TASKS) throw new Error('semantic confirmation task limit exceeded')
  const confirmation = createFoundationConfirmationTask({ taskId: input.taskId, sourceTask: source, result: input.admittedResult })
  return { ...state, tasks: [...state.tasks, confirmation], deepPhaseStartedAt: state.deepPhaseStartedAt ?? input.now }
}
