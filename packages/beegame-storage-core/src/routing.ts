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
