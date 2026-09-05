import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../../types'
import { buildFoundationSemanticPacket, type FoundationSemanticPacket } from '../../foundation-semantic-audit'
import type { FoundationReviewIssue, AuditIssue } from '../../foundation-issue-registry'

export function requireSectionAuditIssues(
  issues: readonly FoundationReviewIssue[],
): AuditIssue[] {
  if (issues.some(issue => 'scope' in issue.source))
    throw new Error('document-format issues cannot enter section semantic review')
  return issues as AuditIssue[]
}

function sectionBytes(documents: ReadonlyMap<string, string>, ref: { documentPath: string; startLine: number; endLine: number }): string {
  const document = documents.get(ref.documentPath)
  if (document === undefined) throw new Error(`semantic section document is missing: ${ref.documentPath}`)
  return document.split('\n').slice(ref.startLine - 1, ref.endLine).join('\n')
}

export async function buildSemanticPacketFor(input: {
  workspacePath: string
  revision: string
  checkId: string
  sectionIndex: readonly import('../../foundation-section-index').SectionRef[]
  factStore: readonly import('../../foundation-fact-store').FoundationFact[]
  deterministicReviewDigest: string
  deterministicIssuePrefix: readonly import('../../foundation-issue-registry').AuditIssue[]
  documentDigests: readonly { path: string; digest: string }[]
}): Promise<FoundationSemanticPacket> {
  const documents = new Map(await Promise.all(CANONICAL_FOUNDATION_DOCUMENTS.map(async path => [path, await readFile(join(input.workspacePath, path), 'utf8')] as const)))
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const expected = input.documentDigests.find(item => item.path === path)?.digest
    const actual = createHash('sha256').update(documents.get(path)!).digest('hex')
    if (!expected || expected !== actual) throw new Error(`semantic audit source changed after commit: ${path}`)
  }
  const bytes = Object.fromEntries(input.sectionIndex.map(ref => [`${ref.documentPath}#${ref.sectionId}`, sectionBytes(documents, ref)]))
  return buildFoundationSemanticPacket({ revision: input.revision, checkId: input.checkId, sectionIndex: input.sectionIndex, sectionBytes: bytes, factStore: input.factStore, deterministicReviewDigest: input.deterministicReviewDigest, deterministicIssuePrefix: input.deterministicIssuePrefix })
}

