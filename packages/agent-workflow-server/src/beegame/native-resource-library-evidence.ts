import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { normalizeResourceLibraryCall } from './native-resource-library-call'

type ResourceLibraryObservation = {
  version: 2
  sessionId: string
  turnId?: string
  toolUseID: string
  phase: 'started' | 'completed'
  action: string
  inputDigest: string
  outputDigest?: string
  createdAt: string
}

/**
 * Passive provenance only. It records which native exploration/integration
 * operation Claude Code chose to invoke, but never enforces a call sequence,
 * selects a resource, or changes the Agent task state.
 */
export function observeNativeResourceLibraryToolEvent(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
  turnId?: string
  eventType: string
  payload?: unknown
  createdAt: Date
}): void {
  if (!isRecord(input.payload)) return
  const toolName = stringValue(input.payload.toolName)
  const toolUseID = stringValue(input.payload.toolUseID)
  const toolInput = isRecord(input.payload.input) ? input.payload.input : {}
  const normalized = normalizeResourceLibraryCall(toolName, toolInput)
  if (!normalized?.validAction || !toolUseID) return
  if (input.eventType !== 'tool.started' && input.eventType !== 'tool.completed') return
  const output = stringValue(input.payload.output)
  appendObservation(input.dataRoot, input.sessionId, {
    version: 2,
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID,
    phase: input.eventType === 'tool.started' ? 'started' : 'completed',
    action: normalized.validAction,
    inputDigest: digest(normalized.input),
    ...(output ? { outputDigest: digest(output) } : {}),
    createdAt: input.createdAt.toISOString(),
  })
}

function appendObservation(dataRoot: string, sessionId: string, observation: ResourceLibraryObservation): void {
  const path = join(dataRoot, 'beegame-resource-library-evidence', `${sessionId}.jsonl`)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(observation)}\n`, 'utf8')
}

function digest(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
