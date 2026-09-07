import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath } from './domain/types'
import { revisionBytesDigest } from './json-digest'

export type RevisionDocumentInput = Readonly<{ path: FoundationDocumentPath; content: string }>
export type RevisionDocument = Readonly<RevisionDocumentInput & { digest: string; byteLength: number }>

/** Captures upstream bytes, not upstream state. No path is read or written. */
export function bindRevisionDocuments(input: readonly RevisionDocumentInput[]) {
  if (!Array.isArray(input) || input.length !== CANONICAL_FOUNDATION_DOCUMENTS.length)
    throw new Error('Revision requires exactly eight canonical documents')
  const byPath = new Map<FoundationDocumentPath, string>()
  for (const entry of input) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
      Object.getPrototypeOf(entry) !== Object.prototype || Object.getOwnPropertySymbols(entry).length ||
      Object.getOwnPropertyNames(entry).sort().join('\0') !== 'content\0path' ||
      Object.values(Object.getOwnPropertyDescriptors(entry)).some(descriptor => !('value' in descriptor) || !descriptor.enumerable) ||
      !CANONICAL_FOUNDATION_DOCUMENTS.includes(entry.path) || typeof entry.content !== 'string')
      throw new Error('Revision canonical document is invalid')
    if (byPath.has(entry.path)) throw new Error('Revision canonical document is duplicated')
    byPath.set(entry.path, entry.content)
  }
  const documents: readonly RevisionDocument[] = Object.freeze(CANONICAL_FOUNDATION_DOCUMENTS.map(path => {
    const content = byPath.get(path)
    if (content === undefined) throw new Error('Revision canonical document is missing')
    return Object.freeze({ path, content, digest: revisionBytesDigest(content), byteLength: Buffer.byteLength(content, 'utf8') })
  }))
  // This tuple encoding is the existing public document-set contract.
  const documentSetDigest = revisionBytesDigest(JSON.stringify(documents.map(({ path, digest }) => [path, digest])))
  return Object.freeze({ documentSetDigest, documents })
}
