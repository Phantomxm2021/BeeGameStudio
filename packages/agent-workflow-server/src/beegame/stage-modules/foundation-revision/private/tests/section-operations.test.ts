import { expect, test } from 'bun:test'
import { applyFoundationRevisionSections, deriveRevisionPatchOperations } from '../markdown'
import { revisionBytesDigest } from '../json-digest'
import { deriveRevisionDocumentPatchOperation } from '../complete-document'
import { reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'
import { buildFoundationSectionIndex } from '../domain/foundation-section-index'

test('INSERT, DELETE and REPLACE operations bind exact section bytes and issue IDs', () => {
  const original = reviewFixtureDocuments()[0]!
  const sectionId = 'experience_pillars'
  const originalSection = buildFoundationSectionIndex({ documents: { [original.path]: original.content } }).find(ref => ref.sectionId === sectionId)!
  const heading = `## ${originalSection.heading}`
  const empty = applyFoundationRevisionSections({ documentPath: original.path, baseMarkdown: original.content,
    authorizedSectionIds: [sectionId], replacements: [{ sectionId, sectionMarkdown: heading }] }).markdown
  for (const kind of ['INSERT', 'DELETE', 'REPLACE'] as const) {
    const baseMarkdown = kind === 'INSERT' ? empty : original.content
    const stagedMarkdown = applyFoundationRevisionSections({ documentPath: original.path, baseMarkdown,
      authorizedSectionIds: [sectionId], replacements: [{ sectionId, sectionMarkdown: kind === 'DELETE' ? heading : `${heading}\n\nNew body.` }] }).markdown
    const actual = deriveRevisionPatchOperations({ documentPath: original.path, baseMarkdown, stagedMarkdown,
      authorizedSectionIds: [sectionId], issueIdsBySection: { [sectionId]: ['AUD-B', 'AUD-A'] } })
    expect(actual).toHaveLength(1)
    expect(actual[0]).toMatchObject({ scope: 'section', kind, documentPath: original.path, sectionId, issueIds: ['AUD-A', 'AUD-B'] })
    if (kind !== 'INSERT') expect(actual[0]!.beforeDigest).toMatch(/^[a-f0-9]{64}$/)
    if (kind !== 'DELETE') expect(actual[0]!.afterDigest).toMatch(/^[a-f0-9]{64}$/)
  }
})

test('whole-document REPLACE binds the original and repaired bytes to every format issue', () => {
  for (const original of reviewFixtureDocuments()) {
    const baseMarkdown = '# incomplete'
    const beforeDigest = revisionBytesDigest(baseMarkdown)
    const afterDigest = revisionBytesDigest(original.content)
    const issues = ['FORMAT-A', 'FORMAT-B'].map(id => ({ id, severity: 'BLOCKER' as const, type: 'schema' as const,
      source: { scope: 'document' as const, documentPath: original.path, digest: beforeDigest },
      reasonCode: 'DOCUMENT_FORMAT_INVALID' as const, expected: 'complete', actual: 'incomplete',
      remediation: { kind: 'patch' as const, scope: 'document' as const, documentPath: original.path } }))
    expect(deriveRevisionDocumentPatchOperation({ documentPath: original.path, baseMarkdown,
      stagedMarkdown: original.content, issues: [...issues].reverse() })).toEqual({ scope: 'document', kind: 'REPLACE',
      documentPath: original.path, issueIds: ['FORMAT-A', 'FORMAT-B'], beforeDigest, afterDigest })
  }
})
