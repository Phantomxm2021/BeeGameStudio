import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

type NativeToolObservation = {
  version: 1
  sessionId: string
  turnId?: string
  toolUseID: string
  parentToolUseID?: string
  toolName: string
  phase: 'started' | 'completed' | 'failed'
  createdAt: string
}

/**
 * Records native tool lifecycle facts exactly as Claude Code emitted them.
 * This is passive provenance: it never permits, blocks, starts, retries, or
 * otherwise controls a tool call.
 */
export function observeNativeToolProvenance(input: {
  dataRoot: string
  sessionId: string
  turnId?: string
  eventType: string
  payload?: unknown
  createdAt: Date
}): void {
  if (!isRecord(input.payload)) return
  const phase = input.eventType === 'tool.started'
    ? 'started'
    : input.eventType === 'tool.completed'
      ? 'completed'
      : input.eventType === 'tool.failed'
        ? 'failed'
        : undefined
  if (!phase) return
  const toolUseID = stringValue(input.payload.toolUseID)
  const toolName = stringValue(input.payload.toolName)
  if (!toolUseID || !toolName) return
  appendObservation(input.dataRoot, input.sessionId, {
    version: 1,
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID,
    ...(stringValue(input.payload.parentToolUseID)
      ? { parentToolUseID: stringValue(input.payload.parentToolUseID) }
      : {}),
    toolName,
    phase,
    createdAt: input.createdAt.toISOString(),
  })
}

export type NativeValidatorToolCapabilities = {
  executable: boolean
  runtime: boolean
  skill: boolean
}

/** Returns capabilities actually completed inside one native Agent call. */
export function getNativeValidatorToolCapabilities(input: {
  dataRoot: string
  sessionId: string
  validatorToolUseID: string
}): NativeValidatorToolCapabilities {
  const observations = readObservations(input.dataRoot, input.sessionId)
  const descendants = descendantToolUseIDs(observations, input.validatorToolUseID)
  const completed = observations.filter(observation =>
    observation.phase === 'completed' && descendants.has(observation.toolUseID)
  )
  return {
    executable: completed.some(observation => isExecutableTool(observation.toolName)),
    runtime: completed.some(observation => isRuntimeObservationTool(observation.toolName)),
    skill: completed.some(observation => observation.toolName === 'Skill'),
  }
}

/** Creates native-looking completed child calls for evidence unit tests. */
export function recordNativeValidatorToolCapabilitiesForTest(input: {
  dataRoot: string
  sessionId: string
  validatorToolUseID: string
}): void {
  for (const [index, toolName] of ['Bash', 'Skill', 'ExecuteExtraTool'].entries()) {
    const toolUseID = `${input.validatorToolUseID}-evidence-${index}`
    for (const eventType of ['tool.started', 'tool.completed']) {
      observeNativeToolProvenance({
        dataRoot: input.dataRoot,
        sessionId: input.sessionId,
        eventType,
        payload: {
          toolUseID,
          parentToolUseID: input.validatorToolUseID,
          toolName,
        },
        createdAt: new Date(),
      })
    }
  }
}

function descendantToolUseIDs(
  observations: NativeToolObservation[],
  rootToolUseID: string,
): Set<string> {
  const descendants = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const observation of observations) {
      if (!observation.parentToolUseID) continue
      if (
        observation.parentToolUseID !== rootToolUseID &&
        !descendants.has(observation.parentToolUseID)
      ) continue
      if (descendants.has(observation.toolUseID)) continue
      descendants.add(observation.toolUseID)
      changed = true
    }
  }
  return descendants
}

function isExecutableTool(toolName: string): boolean {
  return ![
    'Agent',
    'Glob',
    'Grep',
    'ProjectDeliveryContract',
    'Read',
    'ResourceLibrary',
    'SearchExtraTools',
    'Skill',
    'TaskOutput',
    'TodoWrite',
  ].includes(toolName)
}

function isRuntimeObservationTool(toolName: string): boolean {
  // ExecuteExtraTool is Claude Code's target-native capability bridge. Direct
  // MCP tools retain their stable machine prefix. Neither case binds BeeGame
  // to Web, Unity, Godot, Unreal, or a particular validator implementation.
  return toolName === 'ExecuteExtraTool' || toolName.startsWith('mcp__')
}

function appendObservation(
  dataRoot: string,
  sessionId: string,
  observation: NativeToolObservation,
): void {
  const path = evidencePath(dataRoot, sessionId)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(observation)}\n`, 'utf8')
}

function readObservations(dataRoot: string, sessionId: string): NativeToolObservation[] {
  const path = evidencePath(dataRoot, sessionId)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').flatMap(line => {
    if (!line.trim()) return []
    try {
      const observation = JSON.parse(line) as NativeToolObservation
      return observation.version === 1 && observation.sessionId === sessionId
        ? [observation]
        : []
    } catch {
      return []
    }
  })
}

function evidencePath(dataRoot: string, sessionId: string): string {
  return join(dataRoot, 'native-tool-provenance', `${sessionId}.jsonl`)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
