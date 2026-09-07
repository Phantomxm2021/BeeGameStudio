import { validateCompleteGameDocumentMarkdown } from './domain/complete-game-document'
import type { FoundationDocumentPath } from './domain/types'
import { revisionBytesDigest } from './json-digest'
import type { FoundationDocumentPatchOperation } from './markdown'
import type { RevisionInitialSource } from './initial-source'

/** Frozen whole-document repair body gate; never rewrites the submitted bytes. */
export function validateFoundationRevisionCompleteDocument(
  documentPath: FoundationDocumentPath,
  markdown: string,
): string {
  if (typeof markdown !== 'string' || !markdown.trim())
    throw new Error('document revision staged document must be non-empty')
  const lines = markdown.split('\n')
  let body = markdown
  if (lines[0]?.trim() === '---') {
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    if (closing < 0)
      throw new Error('document revision staged document front matter is not closed')
    body = lines.slice(closing + 1).join('\n').trimStart()
  }
  if (!body.trim())
    throw new Error('document revision staged document body must be non-empty')
  return validateCompleteGameDocumentMarkdown(documentPath, body)
}

/** Private byte derivation from already admitted public issues, not worker claims. */
export function deriveRevisionDocumentPatchOperation(input: {
  documentPath: FoundationDocumentPath
  baseMarkdown: string
  stagedMarkdown: string
  issues: readonly RevisionInitialSource['issues'][number]['issue'][]
}): FoundationDocumentPatchOperation {
  const beforeDigest = revisionBytesDigest(input.baseMarkdown)
  const afterDigest = revisionBytesDigest(input.stagedMarkdown)
  if (!input.issues.length || new Set(input.issues.map(issue => issue.id)).size !== input.issues.length ||
    input.issues.some(issue => issue.remediation.scope !== 'document' || issue.remediation.documentPath !== input.documentPath ||
      !('scope' in issue.source) || issue.source.scope !== 'document' || issue.source.documentPath !== input.documentPath ||
      issue.source.digest !== beforeDigest || issue.reasonCode !== 'DOCUMENT_FORMAT_INVALID' ||
      (issue.type !== 'schema' && issue.type !== 'contract')))
    throw new Error('Revision document repair authority mismatch')
  if (beforeDigest === afterDigest) throw new Error('Revision document contains no repair progress')
  validateFoundationRevisionCompleteDocument(input.documentPath, input.stagedMarkdown)
  return { scope: 'document', kind: 'REPLACE', documentPath: input.documentPath,
    issueIds: input.issues.map(issue => issue.id).sort(), beforeDigest, afterDigest }
}
