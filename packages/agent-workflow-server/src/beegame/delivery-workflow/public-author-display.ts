import { type DocumentDisplayTask } from './document-display-tasks'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

export type PublicAuthorDisplay = {
  completed: boolean
  tasks: DocumentDisplayTask[]
}

const DIGEST = /^[a-f0-9]{64}$/u

export function projectPublicAuthorTiming(value: unknown):
  { currentCallElapsedMs: number; historicalElapsedMs: number } | undefined {
  if (!validAuthorLink(value) || !record(value.timing)) return undefined
  const { currentCallElapsedMs, historicalElapsedMs } = value.timing
  if (typeof currentCallElapsedMs !== 'number' || !Number.isFinite(currentCallElapsedMs) || currentCallElapsedMs < 0 ||
      typeof historicalElapsedMs !== 'number' || !Number.isFinite(historicalElapsedMs) || historicalElapsedMs < 0) return undefined
  return { currentCallElapsedMs, historicalElapsedMs }
}
const AUTHOR_STATUSES = [
  'starting',
  'running',
  'stopped',
  'needs_action',
  'failed',
  'completed',
] as const

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && DIGEST.test(value)
}

function validPublicHandle(value: unknown): boolean {
  if (!record(value)) return false
  return (
    value.protocolVersion === 1 &&
    value.producer === 'foundation-authoring' &&
    typeof value.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.id)
  )
}

function validPublicResult(value: unknown): boolean {
  if (!record(value)) return false
  if (
    value.protocolVersion !== 1 ||
    value.producer !== 'foundation-authoring' ||
    value.kind !== 'foundation_documents' ||
    !isDigest(value.resultId) ||
    !isDigest(value.inputDigest) ||
    !nonEmptyString(value.ownerId) ||
    !nonEmptyString(value.projectId) ||
    !isDigest(value.confirmedBriefDigest) ||
    !nonEmptyString(value.documentRevision) ||
    !nonEmptyString(value.workspaceRevision) ||
    !isDigest(value.receiptSetDigest) ||
    !Array.isArray(value.documents) ||
    value.documents.length !== CANONICAL_FOUNDATION_DOCUMENTS.length
  )
    return false
  return value.documents.every((document, index) => {
    if (!record(document)) return false
    return (
      document.path === CANONICAL_FOUNDATION_DOCUMENTS[index] &&
      isDigest(document.digest) &&
      Number.isInteger(document.byteLength) &&
      (document.byteLength as number) >= 0 &&
      nonEmptyString(document.artifactPath)
    )
  })
}

function validAuthorLink(value: unknown): value is Record<string, unknown> {
  if (!record(value)) return false
  if (
    value.protocolVersion !== 1 ||
    !nonEmptyString(value.requestId) ||
    !isDigest(value.inputDigest) ||
    !AUTHOR_STATUSES.includes(value.status as (typeof AUTHOR_STATUSES)[number])
  )
    return false
  if (value.handle !== undefined && !validPublicHandle(value.handle)) return false
  if (value.result !== undefined && !validPublicResult(value.result)) return false
  if (value.status === 'completed')
    return validPublicHandle(value.handle) && validPublicResult(value.result) &&
      record(value.result) && value.result.inputDigest === value.inputDigest
  if (['running', 'needs_action'].includes(value.status as string) &&
    !validPublicHandle(value.handle)) return false
  if (value.result !== undefined) return false
  return true
}

function aggregateStatus(status: (typeof AUTHOR_STATUSES)[number]): DocumentDisplayTask['status'] {
  if (status === 'stopped') return 'stopped'
  if (status === 'needs_action') return 'blocked'
  if (status === 'failed') return 'failed'
  return 'running'
}

/** A copied result supplies artifact display only, never a current Author lifecycle. */
export function projectPublicAuthorResultDisplay(value: unknown): PublicAuthorDisplay | undefined {
  if (!validPublicResult(value)) return undefined
  const result = value as { documents: Array<{ path: string }> }
  return { completed: true, tasks: result.documents.map(document => ({
    id: document.path, title: document.path, status: 'completed', attempt: 0, operation: 'write',
  })) }
}

/**
 * Projects only the public author lifecycle boundary. In particular, this
 * never reads workspace files or exposes per-document private author state.
 */
export function projectPublicAuthorDisplay(
  value: unknown,
): PublicAuthorDisplay | undefined {
  if (!validAuthorLink(value)) return undefined
  if (value.status === 'completed') {
    const result = value.result as {
      documents: Array<{ path: string }>
    }
    return {
      completed: true,
      tasks: result.documents.map(document => ({
        id: document.path,
        title: document.path,
        status: 'completed' as const,
        attempt: 0,
        operation: 'write' as const,
      })),
    }
  }
  return {
    completed: false,
    tasks: [{
      id: 'author:foundation',
      title: 'Foundation documents',
      status: aggregateStatus(value.status as (typeof AUTHOR_STATUSES)[number]),
      attempt: 0,
      operation: 'write',
    }],
  }
}
