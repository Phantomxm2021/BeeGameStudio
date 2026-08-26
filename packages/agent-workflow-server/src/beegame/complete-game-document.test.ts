import { describe, expect, test } from 'bun:test'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../__tests__/complete-game-document-fixture'
import { validateCompleteGameDocumentMarkdown } from './complete-game-document'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './delivery-workflow/types'

describe('native complete game document validation', () => {
  test('accepts every complete canonical Markdown document', () => {
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
      expect(validateCompleteGameDocumentMarkdown(path, markdown)).toBe(markdown)
    }
  })

  test('accepts a complete document above the compact authoring target', () => {
    const path = 'docs/LEVEL_SCENE_DESIGN.md'
    const submission = completeTestSubmission(path)
    const oversized = renderTestCompleteGameDocument(path, {
      ...submission,
      executiveSummary: `Concrete production authority ${'x'.repeat(50_000)}`,
    })
    expect(validateCompleteGameDocumentMarkdown(path, oversized)).toBe(oversized)
  })

  test('accepts normal Markdown blank lines between canonical markers and headings', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(
      path,
      completeTestSubmission(path),
    ).replaceAll(/(<!-- beegame-(?:executive-summary|section:[^>]+|production-materials|material:[^>]+|audit-appendix) -->)\n/g, '$1\n\n')

    expect(validateCompleteGameDocumentMarkdown(path, markdown)).toBe(
      markdown.trimEnd() + '\n',
    )
  })

  test('rejects missing, duplicate, out-of-order, and author-injected mechanical headings', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const firstMarker = markdown.match(/<!-- beegame-section:[^>]+ -->/)?.[0]
    expect(firstMarker).toBeTruthy()
    expect(() =>
      validateCompleteGameDocumentMarkdown(path, markdown.replace(firstMarker!, '')),
    ).toThrow(/sections|structure/i)
    expect(() =>
      validateCompleteGameDocumentMarkdown(
        path,
        markdown.replace(firstMarker!, `${firstMarker}\n${firstMarker}`),
      ),
    ).toThrow(/sections|structure/i)
    expect(() =>
      validateCompleteGameDocumentMarkdown(
        path,
        markdown.replace('## Executive Summary', '## Injected Section\n\n## Executive Summary'),
      ),
    ).toThrow(/mechanical headings/i)
  })

  test('rejects missing or malformed production materials', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    expect(() =>
      validateCompleteGameDocumentMarkdown(
        path,
        markdown.replace('```mermaid', '```text'),
      ),
    ).toThrow(/format|mermaid/i)
    const artPath = 'docs/ART_DIRECTION.md'
    const artMarkdown = renderTestCompleteGameDocument(
      artPath,
      completeTestSubmission(artPath),
    )
    expect(() =>
      validateCompleteGameDocumentMarkdown(
        artPath,
        artMarkdown.replace(/<svg[^]*?<\/svg>/, 'external.svg'),
      ),
    ).toThrow(/format|svg/i)
  })

  test('requires actionable acceptance criteria', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    expect(() =>
      validateCompleteGameDocumentMarkdown(
        path,
        markdown.replace(/### Acceptance Criteria[^]*$/, '### Acceptance Criteria\n'),
      ),
    ).toThrow(/acceptance criteria/i)
  })

  test('scopes repeated authored headings to their owning section', () => {
    const path = 'docs/GDD.md'
    const submission = completeTestSubmission(path)
    const repeatedAcrossSections = renderTestCompleteGameDocument(path, {
      ...submission,
      sections: submission.sections.map((section, index) => ({
        ...section,
        body:
          index < 2
            ? `${section.body}\n\n### Acceptance Criteria\n\n- Observable section outcome ${index + 1}.`
            : section.body,
      })),
    })
    const repeatedInsideSection = renderTestCompleteGameDocument(path, {
      ...submission,
      sections: submission.sections.map((section, index) => ({
        ...section,
        body:
          index === 0
            ? `${section.body}\n\n### Acceptance Criteria\n\n- First observable outcome.\n\n### Acceptance Criteria\n\n- Duplicate heading in one section.`
            : section.body,
      })),
    })

    expect(
      validateCompleteGameDocumentMarkdown(path, repeatedAcrossSections),
    ).toBe(repeatedAcrossSections)
    expect(() =>
      validateCompleteGameDocumentMarkdown(path, repeatedInsideSection),
    ).toThrow(/heading is duplicated/i)
  })

  test('accepts a human document with the mechanical audit externalized', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(
      path,
      completeTestSubmission(path),
    ).replace(/\n<!-- beegame-audit-appendix -->[^]*$/, '\n')

    expect(validateCompleteGameDocumentMarkdown(path, markdown)).toBe(
      `${markdown.trimEnd()}\n`,
    )
  })

  test('rejects empty-template prose and repeated substantive content', () => {
    const path = 'docs/GDD.md'
    const submission = completeTestSubmission(path)
    const empty = renderTestCompleteGameDocument(path, {
      ...submission,
      executiveSummary: 'No known section-specific risks.',
    })
    expect(() => validateCompleteGameDocumentMarkdown(path, empty)).toThrow(/template/i)

    const repeated = 'A concrete production paragraph '.repeat(9)
    const duplicated = renderTestCompleteGameDocument(path, {
      ...submission,
      executiveSummary: repeated,
      sections: submission.sections.map((section, index) => ({
        ...section,
        body: index < 2 ? repeated : section.body,
      })),
    })
    expect(() => validateCompleteGameDocumentMarkdown(path, duplicated)).toThrow(/repeats/i)
  })
})
