import { createHash } from 'node:crypto'
import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath } from './domain/types'
import { auditFoundationDocumentFormats } from './domain/foundation-document-format-review'
import { buildFoundationSectionIndex } from './domain/foundation-section-index'
import { extractNormalizedFoundationFacts, buildFoundationFactPackets } from './domain/foundation-fact-extraction'
import { FOUNDATION_AUDIT_PRODUCTION_MANIFEST } from './domain/foundation-audit-production-manifest'

export type ReviewDocumentInput = Readonly<{ path: FoundationDocumentPath; content: string }>
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item)
    Object.freeze(value)
  }
  return value
}

/** Copies exact canonical bytes before any audit; never reads project files. */
export function bindReviewDocuments(input: readonly ReviewDocumentInput[]) {
  if (!Array.isArray(input) || input.length !== CANONICAL_FOUNDATION_DOCUMENTS.length)
    throw new Error('review input requires exactly eight canonical documents')
  const documents = new Map<FoundationDocumentPath, string>()
  for (const entry of input) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
      Object.keys(entry).sort().join('\0') !== 'content\0path' ||
      !CANONICAL_FOUNDATION_DOCUMENTS.includes(entry.path) || typeof entry.content !== 'string')
      throw new Error('invalid canonical review document')
    if (documents.has(entry.path)) throw new Error('duplicate canonical review document')
    documents.set(entry.path, entry.content)
  }
  const snapshot = CANONICAL_FOUNDATION_DOCUMENTS.map(path => {
    const content = documents.get(path)
    if (content === undefined) throw new Error(`missing canonical review document: ${path}`)
    return { path, content, digest: sha256(content) }
  })
  return freeze({
    schema: 'foundation-review-input.v1' as const,
    digest: sha256(JSON.stringify(snapshot.map(({ path, digest }) => [path, digest]))),
    documents: snapshot,
  })
}

/** Private preparation only: unresolved facts are NOT a completed review. */
export function prepareFoundationReview(input: readonly ReviewDocumentInput[]) {
  const snapshot = bindReviewDocuments(input)
  const documents = new Map(snapshot.documents.map(({ path, content }) => [path, content]))
  const formatIssues = auditFoundationDocumentFormats({ documents })
  if (formatIssues.length > 0)
    return freeze({ kind: 'format_issues' as const, snapshot, formatIssues })
  const sectionIndex = buildFoundationSectionIndex({ documents })
  const extraction = extractNormalizedFoundationFacts({ documents, sectionIndex })
  const factPackets = buildFoundationFactPackets({
    revision: snapshot.digest, documents, sectionIndex, unresolvedKeys: extraction.unresolvedKeys,
  })
  return freeze({
    kind: 'facts_pending' as const, snapshot, sectionIndex, extraction, factPackets,
    manifest: structuredClone(FOUNDATION_AUDIT_PRODUCTION_MANIFEST),
  })
}
