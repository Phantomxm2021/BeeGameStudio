import { describe, expect, test } from 'bun:test'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../test-fixtures/complete-game-document-fixture'
import { auditFoundationDocumentFormats } from '../domain/foundation-document-format-review'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'

function validDocuments(): Map<string, string> {
  return new Map(
    CANONICAL_FOUNDATION_DOCUMENTS.map(path => [
      path,
      renderTestCompleteGameDocument(path, completeTestSubmission(path)),
    ]),
  )
}

describe('foundation document format review', () => {
  test('accepts all canonical documents that satisfy their declared format', () => {
    expect(auditFoundationDocumentFormats({ documents: validDocuments() })).toEqual([])
  })

  test('consolidates every format defect in one document-scoped issue', () => {
    const documents = validDocuments()
    const malformed = [
      '---',
      'document_id: GDD',
      '# unclosed front matter and no canonical body',
    ].join('\n')
    documents.set('docs/GDD.md', malformed)
    documents.set(
      'docs/ART_DIRECTION.md',
      documents.get('docs/ART_DIRECTION.md')!.replace(
        '| Field | Value |',
        'not a visual-language table',
      ),
    )

    const issues = auditFoundationDocumentFormats({ documents })

    expect(issues).toHaveLength(2)
    expect(issues.map(issue => issue.source.documentPath)).toEqual([
      'docs/GDD.md',
      'docs/ART_DIRECTION.md',
    ])
    for (const issue of issues) {
      expect(Object.keys(issue).sort()).toEqual([
        'actual',
        'expected',
        'id',
        'reasonCode',
        'remediation',
        'severity',
        'source',
        'type',
      ])
      expect(issue.id).toMatch(/^AUD-[A-F0-9]{24}$/)
      expect(issue.type).toBe('contract')
      expect(issue.severity).toBe('BLOCKER')
      expect(issue.reasonCode).toBe('DOCUMENT_FORMAT_INVALID')
      expect(issue.source).toMatchObject({ scope: 'document' })
      expect(Object.keys(issue.source).sort()).toEqual([
        'digest',
        'documentPath',
        'scope',
      ])
      expect(issue.remediation).toEqual({
        kind: 'patch',
        scope: 'document',
        documentPath: issue.source.documentPath,
      })
      expect(issue.actual).toContain('MARKDOWN_FORMAT_INVALID')
      expect('sectionId' in issue.source).toBe(false)
    }
    expect(issues[0]!.actual).toContain('FRONT_MATTER_INVALID')
  })

  test('localizes a format defect to its proven canonical block', () => {
    const documents = validDocuments()
    documents.set(
      'docs/TECHNICAL_DESIGN.md',
      documents.get('docs/TECHNICAL_DESIGN.md')!.replace(
        '| authority | complete |',
        '| authority | complete',
      ),
    )

    const issue = auditFoundationDocumentFormats({ documents })[0]!

    expect(issue.source).toMatchObject({
      documentPath: 'docs/TECHNICAL_DESIGN.md',
      sectionId: 'material.save-recovery-table',
    })
    expect(issue.remediation).toEqual({
      kind: 'patch',
      scope: 'section',
      documentPath: 'docs/TECHNICAL_DESIGN.md',
      sectionIds: ['material.save-recovery-table'],
    })
    expect(issue.actual).toContain('Markdown table pipes are uneven')
  })

  test('is deterministic under document input ordering and returns the same review shape', () => {
    const documents = validDocuments()
    const malformed = documents.get('docs/GDD.md')!.replace(
      '## Executive Summary',
      '## Wrong Summary Heading',
    )
    documents.set('docs/GDD.md', malformed)
    const first = auditFoundationDocumentFormats({ documents })
    const reversed = new Map([...documents.entries()].reverse())
    const second = auditFoundationDocumentFormats({ documents: reversed })

    expect(second).toEqual(first)
    expect(second[0]!.source.digest).toBe(
      first[0]!.source.digest,
    )
    expect(second[0]!.id).toBe(first[0]!.id)
  })

  test('changes issue identity when the malformed document bytes change', () => {
    const documents = validDocuments()
    const firstBody = documents.get('docs/GDD.md')!.replace(
      '## Executive Summary',
      '## Wrong Summary Heading',
    )
    documents.set('docs/GDD.md', firstBody)
    const first = auditFoundationDocumentFormats({ documents })[0]!
    documents.set('docs/GDD.md', `${firstBody}\n`)
    const second = auditFoundationDocumentFormats({ documents })[0]!

    expect(second.source.digest).not.toBe(first.source.digest)
    expect(second.id).not.toBe(first.id)
  })

  test('requires the complete canonical document set before reviewing', () => {
    const documents = validDocuments()
    documents.delete('docs/GDD.md')
    expect(() => auditFoundationDocumentFormats({ documents })).toThrow(
      /missing.*GDD/i,
    )
  })
})
