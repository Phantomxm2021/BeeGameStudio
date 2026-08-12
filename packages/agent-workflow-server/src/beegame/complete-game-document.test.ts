import { describe, expect, test } from 'bun:test'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../__tests__/complete-game-document-fixture'
import { validateCompleteGameDocumentMarkdown } from './complete-game-document'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './delivery-workflow/types'

describe('native complete game document validation', () => {
  test('accepts every complete canonical Markdown document written on disk', () => {
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      const markdown = renderTestCompleteGameDocument(
        path,
        completeTestSubmission(path),
      )
      expect(validateCompleteGameDocumentMarkdown(path, markdown)).toBe(markdown)
    }
  })

  test('rejects missing, duplicate, and out-of-order canonical sections', () => {
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
