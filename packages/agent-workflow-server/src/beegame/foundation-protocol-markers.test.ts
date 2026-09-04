import { describe, expect, test } from 'bun:test'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../__tests__/complete-game-document-fixture'
import { validateCompleteGameDocumentMarkdown } from './complete-game-document'
import { injectFoundationProtocolMarkers, stripFoundationProtocolMarkers } from './foundation-protocol-markers'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './delivery-workflow/types'

function rawGdd(): string {
  const marked = renderTestCompleteGameDocument(
    'docs/GDD.md',
    completeTestSubmission('docs/GDD.md'),
  )
  const withoutAudit = marked.split('<!-- beegame-audit-appendix -->')[0]!
  return withoutAudit
    .split('\n')
    .filter(line => !line.trim().startsWith('<!-- beegame-'))
    .join('\n')
}

describe('foundation protocol marker injection', () => {
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    test(`injects a validator-complete marker sequence for ${path}`, () => {
      const marked = renderTestCompleteGameDocument(
        path,
        completeTestSubmission(path),
      )
      const raw = marked
        .split('<!-- beegame-audit-appendix -->')[0]!
        .split('\n')
        .filter(line => !line.trim().startsWith('<!-- beegame-'))
        .join('\n')
      const result = injectFoundationProtocolMarkers(path, raw)
      expect(() => validateCompleteGameDocumentMarkdown(path, result)).not.toThrow()
    })
  }

  test('injects the complete service-owned marker sequence around exact canonical headings', () => {
    const result = injectFoundationProtocolMarkers('docs/GDD.md', rawGdd())
    expect(result).toContain(
      '<!-- beegame-executive-summary -->\n## Executive Summary',
    )
    expect(result).toContain(
      '<!-- beegame-section:vision -->\n## Vision and Product Promise',
    )
    expect(result).toContain(
      '<!-- beegame-material:core-loop-diagram -->\n### Core Loop Diagram',
    )
    expect(() =>
      validateCompleteGameDocumentMarkdown('docs/GDD.md', result),
    ).not.toThrow()
  })

  test('is idempotent for an already marked canonical document', () => {
    const once = injectFoundationProtocolMarkers('docs/GDD.md', rawGdd())
    expect(injectFoundationProtocolMarkers('docs/GDD.md', once)).toBe(once)
  })

  test('leaves an ambiguous or incomplete body unchanged for Stage 3', () => {
    const ambiguous = rawGdd().replace(
      '## Vision and Product Promise',
      '## Vision and Product Promise\n\nDuplicate body.\n\n## Vision and Product Promise',
    )
    const incomplete = rawGdd().replace(
      '## Vision and Product Promise',
      '## Product Vision',
    )
    expect(injectFoundationProtocolMarkers('docs/GDD.md', ambiguous)).toBe(
      ambiguous,
    )
    expect(injectFoundationProtocolMarkers('docs/GDD.md', incomplete)).toBe(
      incomplete,
    )
  })

  test('does not interpret canonical-looking headings inside fenced materials', () => {
    const raw = rawGdd().replace(
      '```mermaid',
      '```mermaid\n## Vision and Product Promise',
    )
    expect(injectFoundationProtocolMarkers('docs/GDD.md', raw)).not.toContain(
      '<!-- beegame-section:vision -->\n## Vision and Product Promise\n    ',
    )
    const marked = injectFoundationProtocolMarkers('docs/GDD.md', raw)
    expect(marked.match(/<!-- beegame-section:vision -->/g)).toHaveLength(1)
  })
})

test('strips only service-owned marker lines from revision model views', () => {
  const markdown = '<!-- beegame-section:vision -->\n## Vision\n\n<!-- keep-user-comment -->\nbody\n'
  expect(stripFoundationProtocolMarkers(markdown)).toBe('## Vision\n\n<!-- keep-user-comment -->\nbody\n')
})
