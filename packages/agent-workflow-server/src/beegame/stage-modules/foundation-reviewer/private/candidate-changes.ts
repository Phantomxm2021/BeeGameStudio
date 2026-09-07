import { createHash } from 'node:crypto'
import { buildFoundationSectionIndex } from './domain/foundation-section-index'
import { validateCompleteGameDocumentMarkdown } from './domain/complete-game-document'
import type { FoundationReviewIssue } from './domain/foundation-issue-registry'
import type { PatchOperation } from './domain/patch-operations'
import { bindReviewDocuments, type ReviewDocumentInput } from './prepare-review'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

// Frozen comparison rule: only version and updated_at are service-owned.
// This is byte comparison, not metadata mutation or Revision execution.
function comparableMetadata(markdown: string): string {
  const lines = markdown.split('\n')
  if (lines[0]?.trim() !== '---') return markdown
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closing < 1) return markdown
  for (let index = 1; index < closing; index++) {
    const separator = lines[index]!.indexOf(':')
    if (separator < 1) continue
    const field = lines[index]!.slice(0, separator).trim()
    if (field === 'version' || field === 'updated_at') lines[index] = `${field}: <service-owned>`
  }
  return lines.join('\n')
}

function completeDocument(path: ReviewDocumentInput['path'], markdown: string) {
  const lines = markdown.split('\n')
  let body = markdown
  if (lines[0]?.trim() === '---') {
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    if (closing < 0) throw new Error('candidate document front matter is not closed')
    body = lines.slice(closing + 1).join('\n').trimStart()
  }
  if (!body.trim()) throw new Error('candidate document body must be non-empty')
  validateCompleteGameDocumentMarkdown(path, body)
}

/**
 * Reviewer independently verifies consumed candidate bytes against accepted
 * issue scope. It does not plan repairs, allocate candidates, or write content.
 * The caller supplies already validated source issues, never worker authority.
 */
export function verifyReviewerCandidateChanges(input: {
  baseDocuments: readonly ReviewDocumentInput[]
  candidateDocuments: readonly ReviewDocumentInput[]
  issues: readonly FoundationReviewIssue[]
}): PatchOperation[] {
  const base = bindReviewDocuments(input.baseDocuments)
  const candidate = bindReviewDocuments(input.candidateDocuments)
  if (!input.issues.length || new Set(input.issues.map(issue => issue.id)).size !== input.issues.length)
    throw new Error('candidate requires unique accepted repair issues')
  const operations: PatchOperation[] = []
  for (const before of base.documents) {
    const after = candidate.documents.find(doc => doc.path === before.path)!
    const issues = input.issues.filter(issue => issue.remediation.documentPath === before.path)
    if (!issues.length) {
      if (before.content !== after.content) throw new Error('candidate changed an unauthorized document')
      continue
    }
    if (before.digest === after.digest) throw new Error('candidate contains no repair progress')
    if (issues.some(issue => issue.remediation.scope === 'document')) {
      if (issues.some(issue => issue.remediation.scope !== 'document' || !('scope' in issue.source) ||
        issue.source.documentPath !== before.path || issue.source.digest !== before.digest || issue.reasonCode !== 'DOCUMENT_FORMAT_INVALID'))
        throw new Error('candidate document repair authority is inconsistent')
      completeDocument(before.path, after.content)
      operations.push({ scope: 'document', kind: 'REPLACE', documentPath: before.path,
        issueIds: issues.map(issue => issue.id).sort(order), beforeDigest: before.digest, afterDigest: after.digest })
      continue
    }
    const allowed = new Map<string, string[]>()
    for (const issue of issues) {
      if (issue.remediation.scope !== 'section') throw new Error('candidate section authority is inconsistent')
      for (const id of issue.remediation.sectionIds) allowed.set(id, [...(allowed.get(id) ?? []), issue.id].sort(order))
    }
    const parse = (content: string) => {
      const index = buildFoundationSectionIndex({ documents: { [before.path]: content } })
      const lines = content.split('\n')
      return index.map(ref => {
        const text = lines.slice(ref.startLine - 1, ref.endLine).join('\n')
        return { ref, text, body: text.split('\n').slice(1).join('\n').trim() }
      })
    }
    const left = parse(before.content)
    const right = parse(after.content)
    if (left.length !== right.length || left.some((section, i) => section.ref.sectionId !== right[i]!.ref.sectionId))
      throw new Error('candidate changed section markers or section order')
    const outside = (content: string, sections: ReturnType<typeof parse>) => {
      const lines = content.split('\n'), chunks: string[] = []
      let cursor = 0
      for (const { ref, text } of sections) {
        chunks.push(lines.slice(cursor, ref.startLine - 1).join('\n'))
        chunks.push(allowed.has(ref.sectionId) ? `\0${ref.sectionId}\0` : text)
        cursor = ref.endLine
      }
      chunks.push(lines.slice(cursor).join('\n'))
      return comparableMetadata(chunks.join('\n'))
    }
    if (outside(before.content, left) !== outside(after.content, right))
      throw new Error('candidate changed bytes outside authorized sections')
    for (let i = 0; i < left.length; i++) {
      const original = left[i]!, revised = right[i]!
      if (original.text === revised.text) continue
      const issueIds = allowed.get(original.ref.sectionId)
      if (!issueIds?.length) throw new Error('candidate changed an unauthorized section')
      const kind = !original.body && revised.body ? 'INSERT' : original.body && !revised.body ? 'DELETE' : 'REPLACE'
      operations.push({ scope: 'section', kind, documentPath: before.path, sectionId: original.ref.sectionId, issueIds,
        ...(kind !== 'INSERT' ? { beforeDigest: hash(original.text) } : {}),
        ...(kind !== 'DELETE' ? { afterDigest: hash(revised.text) } : {}) })
    }
  }
  const covered = new Set(operations.flatMap(operation => operation.issueIds))
  if (covered.size !== input.issues.length || input.issues.some(issue => !covered.has(issue.id)))
    throw new Error('candidate repair issue coverage is incomplete')
  return operations
}
