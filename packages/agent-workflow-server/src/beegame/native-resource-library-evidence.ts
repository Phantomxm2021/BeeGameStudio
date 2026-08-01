import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { normalizeResourceLibraryCall } from './native-resource-library-call'

type ResourceLibraryObservation = {
  version: 1
  sessionId: string
  turnId?: string
  toolUseID: string
  phase: 'started' | 'completed' | 'failed'
  action: string
  resourceContextDigest: string
  inputDigest: string
  outputDigest?: string
  outcome?: 'succeeded' | 'partial' | 'failed'
  acquiredCount?: number
  failedCount?: number
  requestedResourceIds?: string[]
  acquiredResourceIds?: string[]
  failedResourceIds?: string[]
  createdAt: string
}

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
  )
    return
  const output = stringValue(input.payload.output)
  const completion =
    input.eventType === 'tool.completed'
      ? classifyCompletion(normalized.validAction, output)
      : undefined
  appendObservation(input.dataRoot, input.sessionId, {
    version: 1,
    sessionId: input.sessionId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    toolUseID,
    phase:
      input.eventType === 'tool.started'
        ? 'started'
        : input.eventType === 'tool.completed'
          ? 'completed'
          : 'failed',
    action: normalized.validAction,
    resourceContextDigest: digestResourceContext(input.workspacePath),
    inputDigest: digest(normalized.input),
    ...(output ? { outputDigest: digest(output) } : {}),
    ...(completion
      ? {
          outcome: completion.outcome,
          acquiredCount: completion.acquiredCount,
          failedCount: completion.failedCount,
          ...(completion.acquiredResourceIds.length
            ? { acquiredResourceIds: completion.acquiredResourceIds }
            : {}),
          ...(completion.failedResourceIds.length
            ? { failedResourceIds: completion.failedResourceIds }
            : {}),
        }
      : input.eventType === 'tool.failed'
        ? { outcome: 'failed' as const }
        : {}),
    ...(normalized.validAction === 'import_resources'
      ? {
          requestedResourceIds: extractResourceIds(normalized.input.selections),
        }
      : {}),
    createdAt: input.createdAt.toISOString(),
  })
}

export type NativeResourceLibraryEvidenceState =
  | { state: 'missing' }
  | {
      state: 'stale' | 'current'
      actions: string[]
      failedActions: string[]
      successfulResourceCount: number
      failedResourceCount: number
      observedAt: string
    }

export function getObservedNativeResourceLibraryEvidence(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
}): NativeResourceLibraryEvidenceState {
  const observations = readObservations(input.dataRoot, input.sessionId).filter(
    observation =>
      observation.phase === 'completed' || observation.phase === 'failed',
  )
  if (!observations.length) return { state: 'missing' }
  const currentDigest = digestResourceContext(input.workspacePath)
  const current = observations.filter(
    observation => observation.resourceContextDigest === currentDigest,
  )
  const selected = current.length ? current : observations
  const latestByAction = new Map<string, ResourceLibraryObservation>()
  const latestResourceState = new Map<string, 'succeeded' | 'failed'>()
  for (const observation of selected) {
    latestByAction.set(observation.action, observation)
    if (observation.action !== 'import_resources') continue
    for (const id of observation.acquiredResourceIds ?? [])
      latestResourceState.set(id, 'succeeded')
    const failedIds = observation.failedResourceIds?.length
      ? observation.failedResourceIds
      : observation.phase === 'failed'
        ? (observation.requestedResourceIds ?? [])
        : []
    for (const id of failedIds) latestResourceState.set(id, 'failed')
  }
  const latestAcquisition = selected
    .filter(item => item.action === 'import_resources')
    .at(-1)
  const successfulResourceCount = latestResourceState.size
    ? [...latestResourceState.values()].filter(state => state === 'succeeded')
        .length
    : (latestAcquisition?.acquiredCount ?? 0)
  const failedResourceCount = latestResourceState.size
    ? [...latestResourceState.values()].filter(state => state === 'failed')
        .length
    : (latestAcquisition?.failedCount ?? 0)
  const unresolvedFailures = [...latestByAction.values()].filter(observation =>
    observation.action === 'import_resources'
      ? failedResourceCount > 0 ||
        observation.outcome === 'failed' ||
        observation.outcome === 'partial'
      : observation.outcome === 'failed',
  )
  return {
    state: current.length ? 'current' : 'stale',
    actions: [
      ...new Set(
        selected
          .filter(observation => observation.outcome !== 'failed')
          .map(observation => observation.action),
      ),
    ],
    failedActions: [
      ...new Set(unresolvedFailures.map(observation => observation.action)),
    ],
    successfulResourceCount,
    failedResourceCount,
    observedAt: selected.at(-1)!.createdAt,
  }
}

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

function classifyCompletion(action: string, output: string) {
  if (action !== 'import_resources')
    return {
      outcome: 'succeeded' as const,
      acquiredCount: 0,
      failedCount: 0,
      acquiredResourceIds: [] as string[],
      failedResourceIds: [] as string[],
    }
  const value = parseJson(output)
  const data = isRecord(value) && isRecord(value.data) ? value.data : value
  if (!isRecord(data))
    return {
      outcome: 'failed' as const,
      acquiredCount: 0,
      failedCount: 0,
      acquiredResourceIds: [] as string[],
      failedResourceIds: [] as string[],
    }
  const acquiredResourceIds = extractResourceIds(data.resources)
  const failedResourceIds = extractResourceIds(data.failures)
  const acquiredCount =
    finiteCount(data.verified_count) ?? acquiredResourceIds.length
  const failedCount = failedResourceIds.length
  return {
    outcome:
      acquiredCount > 0
        ? failedCount > 0
          ? ('partial' as const)
          : ('succeeded' as const)
        : ('failed' as const),
    acquiredCount,
    failedCount,
    acquiredResourceIds,
    failedResourceIds,
  }
}

function extractResourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return uniqueStrings(
    value.flatMap(item => (isRecord(item) ? [item.resource_id] : [])),
  )
}

function appendObservation(
  dataRoot: string,
  sessionId: string,
  observation: ResourceLibraryObservation,
): void {
  const path = join(
    dataRoot,
    'beegame-resource-library-evidence',
    `${sessionId}.jsonl`,
  )
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(observation)}\n`, 'utf8')
}

function readObservations(
  dataRoot: string,
  sessionId: string,
): ResourceLibraryObservation[] {
  const path = join(
    dataRoot,
    'beegame-resource-library-evidence',
    `${sessionId}.jsonl`,
  )
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap(line => {
      if (!line.trim()) return []
      try {
        const observation = JSON.parse(line) as ResourceLibraryObservation
        return observation.version === 1 && observation.sessionId === sessionId
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
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

function parseJson(value: string): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function finiteCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : undefined
}

function uniqueStrings(value: unknown[]): string[] {
  return [
    ...new Set(
      value.flatMap(item =>
        typeof item === 'string' && item.trim() ? [item.trim()] : [],
      ),
    ),
  ]
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
