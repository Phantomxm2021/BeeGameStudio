import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { normalizeResourceLibraryCall } from './native-resource-library-call'

type ResourceLibraryObservation = {
  version: 4
  sessionId: string
  turnId?: string
  toolUseID: string
  phase: 'started' | 'completed' | 'failed'
  action: string
  resourceContextDigest: string
  inputDigest: string
  outputDigest?: string
  outcome?: 'succeeded' | 'partial' | 'failed'
  importedCount?: number
  failedCount?: number
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
  const completion = input.eventType === 'tool.completed'
    ? classifyCompletion(normalized.validAction, output)
    : undefined
  appendObservation(input.dataRoot, input.sessionId, {
    version: 4,
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
    ...(completion ? {
      outcome: completion.outcome,
      ...(completion.importedCount !== undefined ? { importedCount: completion.importedCount } : {}),
      ...(completion.failedCount !== undefined ? { failedCount: completion.failedCount } : {}),
    } : input.eventType === 'tool.failed'
      ? { outcome: 'failed' as const }
      : {}),
    createdAt: input.createdAt.toISOString(),
  })
}

export type NativeResourceLibraryEvidenceState =
  | { state: 'missing' }
  | { state: 'stale'; actions: string[]; failedActions: string[]; successfulImportCount: number; failedImportCount: number; observedAt: string }
  | { state: 'current'; actions: string[]; failedActions: string[]; successfulImportCount: number; failedImportCount: number; observedAt: string }

export function getObservedNativeResourceLibraryEvidence(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
}): NativeResourceLibraryEvidenceState {
  const observations = readObservations(input.dataRoot, input.sessionId)
    .filter(observation =>
      observation.phase === 'completed' || observation.phase === 'failed'
    )
  if (observations.length === 0) return { state: 'missing' }
  const currentDigest = digestResourceContext(input.workspacePath)
  const current = observations.filter(
    observation => observation.resourceContextDigest === currentDigest,
  )
  const selected = current.length ? current : observations
  const succeeded = selected.filter(observation => observation.outcome !== 'failed')
  return {
    state: current.length ? 'current' : 'stale',
    actions: [...new Set(succeeded.map(observation => observation.action))],
    failedActions: [...new Set(selected.filter(observation => observation.outcome === 'failed').map(observation => observation.action))],
    successfulImportCount: selected.reduce((total, observation) => total + (observation.importedCount ?? 0), 0),
    failedImportCount: selected.reduce((total, observation) => total + (observation.failedCount ?? 0), 0),
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
      return observation.version === 4 && observation.sessionId === sessionId
        ? [observation]
        : []
    } catch {
      return []
    }
  })
}

function classifyCompletion(
  action: string,
  output: string,
): { outcome: 'succeeded' | 'partial' | 'failed'; importedCount?: number; failedCount?: number } {
  if (action !== 'import_elements') return { outcome: 'succeeded' }
  const value = parseJson(output)
  const data = isRecord(value) && isRecord(value.data) ? value.data : value
  if (!isRecord(data)) return { outcome: 'failed', importedCount: 0 }
  const importedCount = finiteCount(data.imported_count) ?? (Array.isArray(data.imported) ? data.imported.length : 0)
  const failedCount = finiteCount(data.failed_count) ?? countFailureIds(data.failures)
  return {
    outcome: importedCount > 0
      ? failedCount > 0 ? 'partial' : 'succeeded'
      : 'failed',
    importedCount,
    failedCount,
  }
}

function parseJson(value: string): unknown {
  if (!value) return undefined
  try { return JSON.parse(value) as unknown } catch { return undefined }
}

function finiteCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function countFailureIds(value: unknown): number {
  if (!Array.isArray(value)) return 0
  return value.reduce((total, item) => {
    if (!isRecord(item) || !Array.isArray(item.import_ids)) return total
    return total + item.import_ids.length
  }, 0)
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
