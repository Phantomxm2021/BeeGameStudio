import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { normalizeResourceLibraryCall } from './native-resource-library-call'

type ResourceLibraryObservation = {
  version: 3
  sessionId: string
  turnId?: string
  toolUseID: string
  phase: 'started' | 'completed' | 'failed'
  action: string
  resourceContextDigest: string
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
  if (
    input.eventType !== 'tool.started' &&
    input.eventType !== 'tool.completed' &&
    input.eventType !== 'tool.failed'
  ) return
  const output = stringValue(input.payload.output)
  appendObservation(input.dataRoot, input.sessionId, {
    version: 3,
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID,
    phase: input.eventType === 'tool.started'
      ? 'started'
      : input.eventType === 'tool.completed'
        ? 'completed'
        : 'failed',
    action: normalized.validAction,
    resourceContextDigest: digestResourceContext(input.workspacePath),
    inputDigest: digest(normalized.input),
    ...(output ? { outputDigest: digest(output) } : {}),
    createdAt: input.createdAt.toISOString(),
  })
}

export type NativeResourceLibraryEvidenceState =
  | { state: 'missing' }
  | { state: 'stale'; actions: string[]; observedAt: string }
  | { state: 'current'; actions: string[]; observedAt: string }

export function getObservedNativeResourceLibraryEvidence(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
}): NativeResourceLibraryEvidenceState {
  const observations = readObservations(input.dataRoot, input.sessionId)
    .filter(observation => observation.phase === 'completed')
  if (observations.length === 0) return { state: 'missing' }
  const currentDigest = digestResourceContext(input.workspacePath)
  const current = observations.filter(
    observation => observation.resourceContextDigest === currentDigest,
  )
  const selected = current.length ? current : observations
  return {
    state: current.length ? 'current' : 'stale',
    actions: [...new Set(selected.map(observation => observation.action))],
    observedAt: selected.at(-1)!.createdAt,
  }
}

/**
 * Resource exploration remains current while art direction, asset planning and
 * target capabilities remain current. Implementation files and imported file
 * inventory do not invalidate the earlier Pack exploration decision.
 */
export function digestResourceContext(workspacePath: string): string {
  const workspace = resolve(workspacePath)
  const hash = createHash('sha256')
  for (const relativePath of ['docs/ART_DIRECTION.md', 'docs/ASSET_PLAN.md']) {
    const path = join(workspace, relativePath)
    hash.update(relativePath)
    hash.update(existsSync(path) ? readFileSync(path) : '')
  }
  const manifestPath = join(workspace, 'assets', 'asset-manifest.json')
  hash.update('assets/asset-manifest.json#project_target')
  hash.update(readProjectTarget(manifestPath))
  return hash.digest('hex')
}

function appendObservation(dataRoot: string, sessionId: string, observation: ResourceLibraryObservation): void {
  const path = join(dataRoot, 'beegame-resource-library-evidence', `${sessionId}.jsonl`)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(observation)}\n`, 'utf8')
}

function readObservations(dataRoot: string, sessionId: string): ResourceLibraryObservation[] {
  const path = join(dataRoot, 'beegame-resource-library-evidence', `${sessionId}.jsonl`)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').flatMap(line => {
    if (!line.trim()) return []
    try {
      const observation = JSON.parse(line) as ResourceLibraryObservation
      return observation.version === 3 && observation.sessionId === sessionId
        ? [observation]
        : []
    } catch {
      return []
    }
  })
}

function readProjectTarget(path: string): string {
  if (!existsSync(path)) return ''
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return isRecord(manifest) ? stableJson(manifest.project_target) : ''
  } catch {
    return ''
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
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
