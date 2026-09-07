import { createHash } from 'node:crypto'
import type { FoundationDocumentPath } from './types'

export type FoundationSectionPatchOperation = {
  scope: 'section'
  kind: 'INSERT' | 'REPLACE' | 'DELETE'
  documentPath: FoundationDocumentPath
  sectionId: string
  issueIds: string[]
  beforeDigest?: string
  afterDigest?: string
}

/**
 * A document repair has no trustworthy section boundary.  Keep its operation
 * in the same operation stream, but bind the complete before/after document
 * digests instead of inventing a section identifier.
 */
export type FoundationDocumentPatchOperation = {
  scope: 'document'
  kind: 'REPLACE'
  documentPath: FoundationDocumentPath
  issueIds: string[]
  beforeDigest: string
  afterDigest: string
}

export type PatchOperation = FoundationSectionPatchOperation | FoundationDocumentPatchOperation

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function comparePatchOperations(left: PatchOperation, right: PatchOperation): number {
  const document = left.documentPath.localeCompare(right.documentPath)
  if (document !== 0) return document
  const scope = left.scope.localeCompare(right.scope)
  if (scope !== 0) return scope
  const section = (left.scope === 'section' ? left.sectionId : '').localeCompare(
    right.scope === 'section' ? right.sectionId : '',
  )
  if (section !== 0) return section
  return stableJson(left).localeCompare(stableJson(right))
}

/** The mechanical, order-independent digest of validated patch operations. */
export function foundationPatchOperationsDigest(
  operations: readonly PatchOperation[],
): string {
  if (!Array.isArray(operations))
    throw new Error('foundation patch operations must be an array')
  return sha256(stableJson([...operations].sort(comparePatchOperations)))
}
