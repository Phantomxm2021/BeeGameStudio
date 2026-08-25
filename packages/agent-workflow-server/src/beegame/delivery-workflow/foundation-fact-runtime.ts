import { createHash } from 'node:crypto'
import type { DispatchRecord, WorkflowUsage } from './types'
import { FOUNDATION_FACT_CATALOG_OWNER_SECTIONS } from './foundation-fact-definitions'
import { estimateStructuredPayloadTokens, foundationFactBusinessPayload } from './structured-output-admission'

export const FOUNDATION_FACT_MAX_TASKS = FOUNDATION_FACT_CATALOG_OWNER_SECTIONS.length
export const FOUNDATION_FACT_MAX_RUNNING = 4

export function foundationFactOutputTokenLimit(factKeyCount: number): number {
  if (!Number.isInteger(factKeyCount) || factKeyCount < 1)
    throw new Error('foundation fact key count must be a positive integer')
  return Math.min(4_096, 768 + 256 * factKeyCount)
}

export type FoundationFactTaskStatus =
  | 'pending'
  | 'running'
  | 'retryable'
  | 'completed'
  | 'needs_action'

export type FoundationFactTask = {
  taskId: string
  kind: 'document-facts'
  revision: string
  packetDigest: string
  factKeyCount: number
  modelTier: 'fast'
  status: FoundationFactTaskStatus
  attempt: number
  dispatch?: DispatchRecord
  terminalDigest?: string
  receiptPath?: string
  receiptDigest?: string
  usage?: WorkflowUsage
  durationMs?: number
  failureReason?: string
}

export type FoundationFactTaskCollection = {
  revision: string
  phaseStartedAt: string
  status: 'extracting_facts' | 'facts_staged' | 'derived_committed'
  tasks: FoundationFactTask[]
  aggregateUsage: WorkflowUsage
  committed?: {
    manifestPath: string
    manifestDigest: string
    markerPath: string
    markerDigest: string
    derivedPath: string
  }
}

export type FoundationFactTerminal = {
  workerType: 'foundation-fact-extractor'
  status: 'completed' | 'failed' | 'blocked'
  runId: string
  dispatchId: string
  revision: string
  taskId: string
  packetDigest: string
  results: unknown[]
  [key: string]: unknown
}

export type FoundationFactTerminalAdmission = {
  taskId: string
  dispatchId: string
  revision: string
  packetDigest: string
  terminal: FoundationFactTerminal
  usage: WorkflowUsage
  durationMs: number
  now: string
}

export type FoundationFactTerminalAdmissionResult = {
  state: FoundationFactTaskCollection
  idempotent: boolean
  terminalDigest: string
  accepted: boolean
}

function digest(value: unknown): string {
  const canonical = (item: unknown): string => Array.isArray(item)
    ? `[${item.map(canonical).join(',')}]`
    : item && typeof item === 'object'
      ? `{${Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`
      : JSON.stringify(item)
  return createHash('sha256').update(canonical(value)).digest('hex')
}

export function digestFoundationFactTerminal(value: FoundationFactTerminal): string {
  return digest(value)
}

function usage(value: WorkflowUsage): WorkflowUsage {
  return {
    input_tokens: Math.max(0, value.input_tokens),
    cache_read_tokens: Math.max(0, value.cache_read_tokens),
    cache_creation_tokens: Math.max(0, value.cache_creation_tokens),
    completion_tokens: Math.max(0, value.completion_tokens),
    total_tokens: Math.max(0, value.total_tokens),
  }
}

function addUsage(left: WorkflowUsage, right: WorkflowUsage): WorkflowUsage {
  return {
    input_tokens: left.input_tokens + right.input_tokens,
    cache_read_tokens: left.cache_read_tokens + right.cache_read_tokens,
    cache_creation_tokens: left.cache_creation_tokens + right.cache_creation_tokens,
    completion_tokens: left.completion_tokens + right.completion_tokens,
    total_tokens: left.total_tokens + right.total_tokens,
  }
}

function assertDigest(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a sha256 digest`)
}

export function createFoundationFactTaskCollection(input: {
  revision: string
  phaseStartedAt: string
  packets: readonly Pick<FoundationFactTask, 'taskId' | 'kind' | 'revision' | 'packetDigest' | 'factKeyCount' | 'modelTier' | 'status' | 'attempt'>[]
}): FoundationFactTaskCollection {
  if (!input.revision.trim()) throw new Error('foundation fact revision is required')
  if (input.packets.length > FOUNDATION_FACT_MAX_TASKS)
    throw new Error(`foundation fact extraction has at most ${FOUNDATION_FACT_MAX_TASKS} tasks`)
  if (new Set(input.packets.map(packet => packet.taskId)).size !== input.packets.length)
    throw new Error('foundation fact task IDs must be stable and unique')
  const tasks = input.packets.map(packet => {
    assertDigest(packet.packetDigest, 'foundation fact packet digest')
    foundationFactOutputTokenLimit(packet.factKeyCount)
    if (packet.revision !== input.revision) throw new Error('foundation fact task revision is stale')
    if (packet.kind !== 'document-facts' || packet.modelTier !== 'fast')
      throw new Error('foundation fact task has an invalid kind or model tier')
    return { ...packet }
  })
  return {
    revision: input.revision,
    phaseStartedAt: input.phaseStartedAt,
    status: tasks.length ? 'extracting_facts' : 'facts_staged',
    tasks,
    aggregateUsage: { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
}

export function claimFoundationFactTasks(
  state: FoundationFactTaskCollection,
  input: { dispatchIdFor: (task: FoundationFactTask) => string; now: string; onlyTaskId?: string; modelReady?: boolean },
): FoundationFactTaskCollection {
  const modelUnavailable = input.modelReady === false
  if (modelUnavailable)
    return {
      ...state,
      tasks: state.tasks.map(task =>
        task.status === 'pending' || task.status === 'retryable'
          ? { ...task, status: 'needs_action', failureReason: 'foundation fact fast model is not configured' }
          : task,
      ),
    }
  const running = state.tasks.filter(task => task.status === 'running').length
  let slots = Math.max(0, FOUNDATION_FACT_MAX_RUNNING - running)
  const tasks = state.tasks.map(task => {
    if (slots <= 0 || (task.status !== 'pending' && task.status !== 'retryable') || (input.onlyTaskId && task.taskId !== input.onlyTaskId)) return task
    if (task.attempt >= 2)
      return { ...task, status: 'needs_action' as const, failureReason: 'foundation fact task attempt cap exceeded' }
    const dispatchId = input.dispatchIdFor(task)
    if (!dispatchId.trim()) throw new Error('foundation fact dispatch ID is required')
    slots -= 1
    return {
      ...task,
      status: 'running' as const,
      attempt: task.attempt + 1,
      dispatch: {
        dispatchId,
        workerType: 'foundation-fact-extractor' as const,
        phase: 'DOCUMENT_REVIEW' as const,
        taskId: task.taskId,
        revision: task.revision,
        status: 'running' as const,
        startedAt: input.now,
      },
      failureReason: undefined,
    }
  })
  return { ...state, tasks }
}

export function admitFoundationFactTerminal(
  state: FoundationFactTaskCollection,
  input: FoundationFactTerminalAdmission,
): FoundationFactTerminalAdmissionResult {
  const task = state.tasks.find(candidate => candidate.taskId === input.taskId)
  if (!task) throw new Error('foundation fact task was not found')
  assertDigest(input.packetDigest, 'foundation fact packet digest')
  if (input.revision !== state.revision || input.revision !== task.revision)
    throw new Error('foundation fact terminal revision mismatch')
  if (input.packetDigest !== task.packetDigest)
    throw new Error('foundation fact terminal packet digest mismatch')
  if (task.dispatch?.dispatchId !== input.dispatchId)
    throw new Error('foundation fact terminal dispatch mismatch')
  const terminalDigest = digest(input.terminal)
  if (task.status === 'completed') {
    if (task.terminalDigest === terminalDigest) return { state, idempotent: true, terminalDigest, accepted: true }
    throw new Error('conflicting foundation fact terminal replay')
  }
  if (task.status !== 'running') throw new Error('foundation fact task is not running')
  const measuredUsage = usage(input.usage)
  const outputTokens = estimateStructuredPayloadTokens(foundationFactBusinessPayload(input.terminal))
  const failureReason = outputTokens > foundationFactOutputTokenLimit(task.factKeyCount)
    ? 'foundation fact output token cap exceeded'
    : input.terminal.status === 'completed' ? undefined : 'foundation fact worker did not complete'
  const completed = !failureReason
  const nextTask: FoundationFactTask = {
    ...task,
    status: completed ? 'completed' : failureReason === 'foundation fact output token cap exceeded' ? 'needs_action' : task.attempt < 2 ? 'retryable' : 'needs_action',
    terminalDigest,
    usage: measuredUsage,
    durationMs: Math.max(0, input.durationMs),
    failureReason,
    ...(completed ? { receiptPath: `.beegame/audit/foundation/${state.revision}/staging/receipts/${task.taskId}.json`, receiptDigest: digest({ taskId: task.taskId, packetDigest: task.packetDigest, terminalDigest }) } : {}),
    dispatch: task.dispatch ? { ...task.dispatch, status: completed ? 'completed' : 'failed', finishedAt: input.now, terminalResult: input.terminal } : undefined,
  }
  const next = {
    ...state,
    tasks: state.tasks.map(candidate => candidate.taskId === task.taskId ? nextTask : candidate),
    aggregateUsage: addUsage(state.aggregateUsage, measuredUsage),
  }
  return { state: next, idempotent: false, terminalDigest, accepted: completed }
}

export function foundationFactTasksComplete(state: FoundationFactTaskCollection): boolean {
  return state.tasks.every(task => task.status === 'completed' && task.receiptPath && task.receiptDigest) &&
    state.tasks.every(task => task.status !== 'pending' && task.status !== 'running')
}
