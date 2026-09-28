import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

type Usage = {
  inputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  outputTokens: number
  upstreamCostUsd: number
}

export type DeliveryPhaseMetrics = {
  phase: string
  startedAt: string
  endedAt?: string
  wallMs: number
  activeTurnMs: number
  completedTurns: number
  stoppedTurns: number
  incompleteTurns: number
  toolStarts: number
  toolFailures: number
  toolFailuresByName: Record<string, number>
  usage: Usage
  upstreamCostUsdIsComplete: boolean
  modelCreditsMicro?: number
  turnsUsingStreamFallback: number
  turnsWithoutModelUsage: number
}

export type DeliveryPhaseReport = {
  phases: DeliveryPhaseMetrics[]
  unattributed: {
    toolStarts: number
    toolFailures: number
    toolFailuresByName: Record<string, number>
    completedTurns: number
    stoppedTurns: number
    turnsUsingStreamFallback: number
    turnsWithoutModelUsage: number
    usage: Usage
    upstreamCostUsdIsComplete: boolean
    modelCreditsMicro?: number
  }
  billing?: {
    eventCount: number
    totalModelCreditsMicro: number
    unattributedModelCreditsMicro: number
    duplicateEventsSkipped: number
    phaseMismatchCount: number
  }
  limits: string[]
}

export type DeliveryBillingEvent = {
  id: string
  turnId?: string
  projectId?: string
  creditsMicro: number
  metadata?: Record<string, unknown>
}

type Event = {
  type?: unknown
  createdAt?: unknown
  turnId?: unknown
  payload?: unknown
}

const emptyUsage = (): Usage => ({
  inputTokens: 0, cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0, outputTokens: 0, upstreamCostUsd: 0,
})

const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
const nonnegative = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
const timestamp = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : undefined
}

function modelUsage(value: unknown): Map<string, Usage> | undefined {
  const record = object(value)
  if (!record) return undefined
  const result = new Map<string, Usage>()
  for (const [model, raw] of Object.entries(record)) {
    const usage = object(raw)
    if (!usage) continue
    result.set(model, {
      inputTokens: nonnegative(usage.inputTokens ?? usage.input_tokens),
      cacheReadInputTokens: nonnegative(usage.cacheReadInputTokens ?? usage.cache_read_input_tokens),
      cacheCreationInputTokens: nonnegative(usage.cacheCreationInputTokens ?? usage.cache_creation_input_tokens),
      outputTokens: nonnegative(usage.outputTokens ?? usage.output_tokens),
      upstreamCostUsd: nonnegative(usage.costUSD),
    })
  }
  return result.size ? result : undefined
}

function streamUsage(value: unknown): Usage | undefined {
  const usage = object(value)
  if (!usage) return undefined
  return {
    inputTokens: nonnegative(usage.input_tokens),
    cacheReadInputTokens: nonnegative(usage.cache_read_input_tokens),
    cacheCreationInputTokens: nonnegative(usage.cache_creation_input_tokens),
    outputTokens: nonnegative(usage.output_tokens),
    upstreamCostUsd: 0,
  }
}

function addUsage(target: Usage, source: Usage): void {
  target.inputTokens += source.inputTokens
  target.cacheReadInputTokens += source.cacheReadInputTokens
  target.cacheCreationInputTokens += source.cacheCreationInputTokens
  target.outputTokens += source.outputTokens
  target.upstreamCostUsd += source.upstreamCostUsd
}

function usageDifference(current: Usage, previous?: Usage): Usage {
  if (!previous || usageCounterReset(current, previous)) return { ...current }
  return {
    inputTokens: current.inputTokens - previous.inputTokens,
    cacheReadInputTokens: current.cacheReadInputTokens - previous.cacheReadInputTokens,
    cacheCreationInputTokens: current.cacheCreationInputTokens - previous.cacheCreationInputTokens,
    outputTokens: current.outputTokens - previous.outputTokens,
    upstreamCostUsd: Math.max(0, current.upstreamCostUsd - previous.upstreamCostUsd),
  }
}

function usageCounterReset(current: Usage, previous: Usage): boolean {
  return current.inputTokens < previous.inputTokens ||
    current.cacheReadInputTokens < previous.cacheReadInputTokens ||
    current.cacheCreationInputTokens < previous.cacheCreationInputTokens ||
    current.outputTokens < previous.outputTokens
}

function subtractStreamFallback(current: Usage, fallback: Usage): void {
  current.inputTokens = Math.max(0, current.inputTokens - fallback.inputTokens)
  current.cacheReadInputTokens = Math.max(0, current.cacheReadInputTokens - fallback.cacheReadInputTokens)
  current.cacheCreationInputTokens = Math.max(0, current.cacheCreationInputTokens - fallback.cacheCreationInputTokens)
  current.outputTokens = Math.max(0, current.outputTokens - fallback.outputTokens)
}

/** Diagnostic projection only. It never changes delivery state or Agent dispatch. */
export function summarizeDeliveryEvents(
  events: readonly Event[],
  billingEvents?: readonly DeliveryBillingEvent[],
): DeliveryPhaseReport {
  const phases: DeliveryPhaseMetrics[] = []
  const unattributed: DeliveryPhaseReport['unattributed'] = {
    toolStarts: 0, toolFailures: 0, completedTurns: 0,
    toolFailuresByName: {} as Record<string, number>,
    stoppedTurns: 0,
    turnsUsingStreamFallback: 0, turnsWithoutModelUsage: 0, usage: emptyUsage(),
    upstreamCostUsdIsComplete: true,
  }
  const limits = [
    'Wall time includes pauses and user wait; active turn time ends at completion or a recorded stop.',
    'Model usage is the delta of final cumulative result snapshots, not a sum of streaming usage events.',
    'A turn without a result uses the last usage snapshot per streamed message; this may omit unavailable subagent usage.',
    'Upstream USD is diagnostic, not BGS credits; credits must come from the billing ledger.',
  ]
  const startedTurns = new Map<string, { at: number; phase?: DeliveryPhaseMetrics }>()
  const finalUsageByTurn = new Map<string, Map<string, Usage>>()
  const incompleteCostByTurn = new Set<string>()
  const phaseByTurn = new Map<string, DeliveryPhaseMetrics | undefined>()
  const activeMessageByStream = new Map<string, string>()
  const streamMessagesByTurn = new Map<string, Map<string, Usage>>()
  let currentPhase: DeliveryPhaseMetrics | undefined
  let lastTime: number | undefined

  for (const event of events) {
    const at = timestamp(event.createdAt)
    if (at === undefined) continue
    lastTime = Math.max(lastTime ?? at, at)
    const payload = object(event.payload)
    if (event.type === 'system.status' && payload?.subtype === 'delivery_phase' &&
        typeof payload.phase === 'string') {
      if (currentPhase && at >= Date.parse(currentPhase.startedAt)) {
        currentPhase.endedAt = new Date(at).toISOString()
        currentPhase.wallMs = at - Date.parse(currentPhase.startedAt)
      }
      currentPhase = {
        phase: payload.phase, startedAt: new Date(at).toISOString(),
        wallMs: 0, activeTurnMs: 0, completedTurns: 0, stoppedTurns: 0,
        incompleteTurns: 0, toolStarts: 0, toolFailures: 0,
        toolFailuresByName: {},
        usage: emptyUsage(), upstreamCostUsdIsComplete: true,
        turnsUsingStreamFallback: 0, turnsWithoutModelUsage: 0,
      }
      phases.push(currentPhase)
      continue
    }
    const turnId = typeof event.turnId === 'string' ? event.turnId : undefined
    if (event.type === 'turn.started' && turnId) {
      startedTurns.set(turnId, { at, phase: currentPhase })
      phaseByTurn.set(turnId, currentPhase)
    } else if (event.type === 'turn.completed' && turnId) {
      const start = startedTurns.get(turnId)
      const phase = start?.phase
      if (phase) {
        phase.completedTurns++
        phase.activeTurnMs += Math.max(0, at - start.at)
      } else unattributed.completedTurns++
      startedTurns.delete(turnId)
    } else if (event.type === 'session.stopped') {
      const targets = turnId ? [turnId] : [...startedTurns.keys()]
      for (const id of targets) {
        const start = startedTurns.get(id)
        if (!start) continue
        const bucket = start.phase ?? unattributed
        bucket.stoppedTurns++
        if (start.phase) start.phase.activeTurnMs += Math.max(0, at - start.at)
        startedTurns.delete(id)
      }
    } else if (event.type === 'tool.started') {
      const phase = turnId ? phaseByTurn.get(turnId) : currentPhase
      if (phase) phase.toolStarts++
      else unattributed.toolStarts++
    } else if (event.type === 'tool.failed') {
      const phase = turnId ? phaseByTurn.get(turnId) : currentPhase
      const bucket = phase ?? unattributed
      bucket.toolFailures++
      const name = typeof payload?.toolName === 'string' && payload.toolName.length <= 80
        ? payload.toolName : 'unknown'
      bucket.toolFailuresByName[name] = (bucket.toolFailuresByName[name] ?? 0) + 1
    } else if (event.type === 'result' && turnId) {
      const usage = modelUsage(payload?.modelUsage)
      if (usage) {
        finalUsageByTurn.set(turnId, usage)
        const models = object(payload?.modelUsage)
        if (Object.values(models ?? {}).some(model => {
          const cost = object(model)?.costUSD
          return typeof cost !== 'number' || !Number.isFinite(cost)
        })) incompleteCostByTurn.add(turnId)
        else incompleteCostByTurn.delete(turnId)
      }
    } else if (event.type === 'usage' && turnId && payload?.type === 'stream_event') {
      const streamEvent = object(payload.event)
      const parent = typeof payload.parent_tool_use_id === 'string' ? payload.parent_tool_use_id : 'root'
      const agent = typeof payload.nativeTraceAgentId === 'string' ? payload.nativeTraceAgentId : 'root'
      const streamKey = turnId + ':' + parent + ':' + agent
      if (streamEvent?.type === 'message_start') {
        const message = object(streamEvent.message)
        if (typeof message?.id === 'string') activeMessageByStream.set(streamKey, message.id)
        const usage = streamUsage(message?.usage)
        if (typeof message?.id === 'string' && usage) {
          const snapshots = streamMessagesByTurn.get(turnId) ?? new Map<string, Usage>()
          snapshots.set(message.id, usage)
          streamMessagesByTurn.set(turnId, snapshots)
        }
      } else if (streamEvent?.type === 'message_delta') {
        const messageId = activeMessageByStream.get(streamKey)
        const usage = streamUsage(streamEvent.usage)
        if (messageId && usage) {
          const snapshots = streamMessagesByTurn.get(turnId) ?? new Map<string, Usage>()
          snapshots.set(messageId, usage)
          streamMessagesByTurn.set(turnId, snapshots)
        }
      }
    }
  }
  if (currentPhase && lastTime !== undefined && !currentPhase.endedAt)
    currentPhase.wallMs = Math.max(0, lastTime - Date.parse(currentPhase.startedAt))
  for (const { phase } of startedTurns.values())
    if (phase) phase.incompleteTurns++

  const previousByModel = new Map<string, Usage>()
  let pendingStreamFallback = emptyUsage()
  let hasPendingStreamFallback = false
  for (const [turnId, phase] of phaseByTurn) {
    const snapshot = finalUsageByTurn.get(turnId)
    const bucket = phase ?? unattributed
    if (incompleteCostByTurn.has(turnId)) bucket.upstreamCostUsdIsComplete = false
    if (!snapshot) {
      bucket.upstreamCostUsdIsComplete = false
      const streamed = streamMessagesByTurn.get(turnId)
      if (streamed?.size) {
        bucket.turnsUsingStreamFallback++
        for (const message of streamed.values()) {
          addUsage(bucket.usage, message)
          addUsage(pendingStreamFallback, message)
        }
        hasPendingStreamFallback = true
      } else bucket.turnsWithoutModelUsage++
      continue
    }
    const delta = emptyUsage()
    let counterReset = false
    let comparableModel = false
    for (const [model, current] of snapshot) {
      const previous = previousByModel.get(model)
      if (previous) comparableModel = true
      if (previous && usageCounterReset(current, previous)) counterReset = true
      addUsage(delta, usageDifference(current, previous))
      previousByModel.set(model, current)
    }
    if (hasPendingStreamFallback) {
      // The next cumulative result in the same epoch includes the stopped
      // turn. Its message-level fallback has already been attributed there.
      if (!counterReset && (comparableModel || previousByModel.size === snapshot.size))
        subtractStreamFallback(delta, pendingStreamFallback)
      bucket.upstreamCostUsdIsComplete = false
      pendingStreamFallback = emptyUsage()
      hasPendingStreamFallback = false
    }
    addUsage(bucket.usage, delta)
  }
  if (startedTurns.size) limits.push('Open turns without a terminal event have no final active duration.')
  if ([...phaseByTurn.keys()].some(id => !finalUsageByTurn.has(id)))
    limits.push('Some turns lack a final cumulative result; stream fallback is provisional and may undercount.')
  if ([...phaseByTurn.keys()].some(id => !finalUsageByTurn.has(id) && !streamMessagesByTurn.get(id)?.size))
    limits.push('Some turns have no usable model usage; token totals are incomplete.')
  if (!billingEvents) return { phases, unattributed, limits }
  for (const phase of phases) phase.modelCreditsMicro = 0
  unattributed.modelCreditsMicro = 0
  const projectIds = new Set(billingEvents.map(event => event.projectId).filter(Boolean))
  if (projectIds.size > 1) throw new Error('Billing events contain multiple projects')
  const seen = new Set<string>()
  let eventCount = 0, totalModelCreditsMicro = 0
  let duplicateEventsSkipped = 0, phaseMismatchCount = 0
  for (const event of billingEvents) {
    if (!event.id || !Number.isSafeInteger(event.creditsMicro) || event.creditsMicro < 0)
      throw new Error('Invalid billing event ID or creditsMicro')
    if (seen.has(event.id)) { duplicateEventsSkipped++; continue }
    seen.add(event.id); eventCount++
    totalModelCreditsMicro += event.creditsMicro
    const phase = event.turnId ? phaseByTurn.get(event.turnId) : undefined
    const bucket = phase ?? unattributed
    bucket.modelCreditsMicro = (bucket.modelCreditsMicro ?? 0) + event.creditsMicro
    if (phase && typeof event.metadata?.deliveryPhase === 'string' &&
        event.metadata.deliveryPhase !== phase.phase) phaseMismatchCount++
  }
  limits.push('Billing input must be project-filtered /api/usage/events data; these are model usage credits, not image-generation charges.')
  if (unattributed.modelCreditsMicro)
    limits.push('Some billing events have no matching project turn and remain unattributed.')
  if (phaseMismatchCount)
    limits.push('Billing metadata disagrees with the recorded phase for some turns; inspect those events before cost comparison.')
  return {
    phases, unattributed,
    billing: { eventCount, totalModelCreditsMicro,
      unattributedModelCreditsMicro: unattributed.modelCreditsMicro,
      duplicateEventsSkipped, phaseMismatchCount },
    limits,
  }
}

export async function readDeliveryPhaseReport(
  workspacePath: string, billingEvents?: readonly DeliveryBillingEvent[],
): Promise<DeliveryPhaseReport> {
  const file = join(workspacePath, '.beegame', 'chat', 'project-events.jsonl')
  const events: Event[] = []
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  let index = 0
  for await (const line of lines) {
    index++
    if (!line.trim()) continue
    let event: Event
    try { event = JSON.parse(line) as Event }
    catch { throw new Error('Invalid project event JSON at line ' + index) }
    if (['system.status', 'turn.started', 'turn.completed', 'session.stopped',
      'tool.started', 'tool.failed', 'result', 'usage'].includes(String(event.type)))
      events.push(event)
  }
  return summarizeDeliveryEvents(events, billingEvents)
}
