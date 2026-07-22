import type { ProjectStorageBucketRole, StorageScopeType } from './types'

export type ProjectStorageRouteRequest = {
  scopeType: StorageScopeType
  objectKind: string
}

const PROJECT_KINDS = new Set([
  'game_asset',
  'project_attachment',
  'project_snapshot',
  'project_export',
])

const RESOURCE_KINDS = new Set([
  'resource_pack_file',
  'resource_element',
  'resource_dependency',
  'resource_preview',
])

const DELIVERY_KINDS = new Set([
  'build_artifact',
  'deployment_file',
  'deployment_manifest',
  'game_screenshot',
  'game_recording',
])

const LOG_KINDS = new Set(['build_log', 'agent_log', 'diagnostic_log'])

/**
 * Routes only the new game/project storage domain. Account, studio and
 * platform media deliberately stay on their existing Supabase path.
 */
export function resolveProjectStorageBucketRole(
  request: ProjectStorageRouteRequest,
): ProjectStorageBucketRole {
  const kind = request.objectKind.trim()
  if (!kind) throw new Error('Storage object kind is required')

  if (
    request.scopeType === 'user' ||
    request.scopeType === 'studio' ||
    request.scopeType === 'platform'
  ) {
    throw new Error(
      'Account-domain media is outside the project storage router',
    )
  }
  if (request.scopeType === 'pack' && RESOURCE_KINDS.has(kind))
    return 'resource-private'
  if (request.scopeType === 'deployment' && DELIVERY_KINDS.has(kind))
    return 'delivery'
  if (request.scopeType === 'session' && LOG_KINDS.has(kind))
    return 'log-private'
  if (request.scopeType === 'project') {
    if (PROJECT_KINDS.has(kind)) return 'project-private'
    if (DELIVERY_KINDS.has(kind)) return 'delivery'
    if (LOG_KINDS.has(kind)) return 'log-private'
  }
  throw new Error(
    `Unsupported project storage route: ${request.scopeType}/${kind}`,
  )
}

export function assertSafeObjectKey(objectKey: string): string {
  const normalized = objectKey.trim().replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || normalized.endsWith('/')) {
    throw new Error(
      'Storage object key must be a non-empty relative object key',
    )
  }
  const segments = normalized.split('/')
  if (
    segments.some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Storage object key contains an unsafe path segment')
  }
  if (normalized.includes('\0'))
    throw new Error('Storage object key contains a null byte')
  return normalized
}

/**
 * Keeps immutable Resource Library payloads physically grouped by Pack while
 * leaving the user-facing logical path in metadata. Folder renames therefore
 * do not require an R2 object move.
 */
export function buildResourcePackObjectKey(
  packId: string,
  storageObjectId: string,
): string {
  return `packs/${assertObjectKeySegment(packId, 'Pack id')}/objects/${assertObjectKeySegment(storageObjectId, 'Storage object id')}/payload`
}

function assertObjectKeySegment(value: string, label: string): string {
  const segment = value.trim()
  if (
    !segment ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.includes('\0')
  ) {
    throw new Error(`${label} is not a safe object key segment`)
  }
  return segment
}
