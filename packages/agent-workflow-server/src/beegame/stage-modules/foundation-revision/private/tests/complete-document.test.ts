import { expect, test } from 'bun:test'
import { deriveRevisionDocumentPatchOperation, validateFoundationRevisionCompleteDocument } from '../complete-document'
import { revisionBytesDigest } from '../json-digest'
import type { RevisionInitialSource } from '../initial-source'
import { reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'

test('all eight whole-document gates accept complete bodies and reject malformed structure', () => {
  for (const doc of reviewFixtureDocuments()) {
    expect(() => validateFoundationRevisionCompleteDocument(doc.path, doc.content)).not.toThrow()
    expect(() => validateFoundationRevisionCompleteDocument(doc.path, `---\nversion: 2\nupdated_at: today\n---\n${doc.content}`)).not.toThrow()
    for (const content of ['', '# incomplete', '---\nnot closed', '---\nversion: 2\n---\n',
      doc.content.replace('## Executive Summary', '## Wrong Summary'),
      doc.content.replace('<!-- beegame-production-materials -->', ''),
      doc.content + '\n[foreign](docs/unknown.md)'])
      expect(() => validateFoundationRevisionCompleteDocument(doc.path, content)).toThrow()
  }
})

test('document operation binds original bytes and exact format issue scope without signing an audit', () => {
  const doc = reviewFixtureDocuments()[0]!
  const baseMarkdown = '# broken'
  const issue: RevisionInitialSource['issues'][number]['issue'] = {
    id: 'format-1', type: 'schema', severity: 'BLOCKER', expected: 'complete', actual: 'incomplete',
    reasonCode: 'DOCUMENT_FORMAT_INVALID',
    source: { scope: 'document', documentPath: doc.path, digest: revisionBytesDigest(baseMarkdown) },
    remediation: { kind: 'patch', scope: 'document', documentPath: doc.path },
  }
  const input = { documentPath: doc.path, baseMarkdown, stagedMarkdown: doc.content, issues: [issue] }
  expect(deriveRevisionDocumentPatchOperation(input)).toEqual({ scope: 'document', kind: 'REPLACE',
    documentPath: doc.path, issueIds: ['format-1'], beforeDigest: revisionBytesDigest(baseMarkdown), afterDigest: revisionBytesDigest(doc.content) })
  expect(() => deriveRevisionDocumentPatchOperation({ ...input, issues: [] })).toThrow('authority')
  expect(() => deriveRevisionDocumentPatchOperation({ ...input, issues: [issue, issue] })).toThrow('authority')
  expect(() => deriveRevisionDocumentPatchOperation({ ...input, baseMarkdown: '# other' })).toThrow('authority')
  expect(() => deriveRevisionDocumentPatchOperation({ ...input, stagedMarkdown: baseMarkdown })).toThrow('no repair progress')
  expect(() => deriveRevisionDocumentPatchOperation({ ...input, stagedMarkdown: '# still broken' })).toThrow()
  expect(() => deriveRevisionDocumentPatchOperation({ ...input, issues: [{ ...issue,
    remediation: { ...issue.remediation, documentPath: 'docs/LEVEL_SCENE_DESIGN.md' } }] })).toThrow('authority')
})
