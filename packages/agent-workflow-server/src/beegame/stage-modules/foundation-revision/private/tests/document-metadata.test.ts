import { expect, test } from 'bun:test'
import { advanceRevisionDocumentMetadata } from '../document-metadata'

const base = [
  '---',
  'document_id: GDD',
  'version: 2.4.9',
  'updated_at: 2026-08-13T01:00:00.000+08:00',
  '---',
  '# GDD',
  '',
  'Original body',
].join('\n')

test('advances only changed documents with deterministic patch metadata', () => {
  const revised = advanceRevisionDocumentMetadata({
    baseMarkdown: base,
    candidateMarkdown: base.replace('Original body', 'Revised body'),
    updatedAt: '2026-08-13T01:02:03.004Z',
  })
  expect(revised).toContain('version: 2.4.10')
  expect(revised).toContain('updated_at: 2026-08-13T01:02:03.004Z')
  expect(revised).toContain('Revised body')
})

test('uses the durable attempt timestamp when supplied and replays that exact pair', () => {
  const revised = advanceRevisionDocumentMetadata({
    baseMarkdown: base,
    candidateMarkdown: base.replace('Original body', 'Attempt repair'),
    updatedAt: '2026-08-13T01:02:03.004Z',
  })
  expect(revised).toContain('version: 2.4.10')
  expect(revised).toContain('updated_at: 2026-08-13T01:02:03.004Z')
  expect(advanceRevisionDocumentMetadata({
    baseMarkdown: base,
    candidateMarkdown: revised,
    updatedAt: '2026-08-13T01:02:03.004Z',
  })).toBe(revised)
})

test('preserves unchanged and exact retained predecessor bytes', () => {
  expect(advanceRevisionDocumentMetadata({ baseMarkdown: base, candidateMarkdown: base })).toBe(base)
  const first = base.replace('Original body', 'First repair').replace('version: 2.4.9', 'version: 2.4.10')
    .replace('2026-08-13T01:00:00.000+08:00', '2026-08-12T17:00:00.001Z')
  expect(advanceRevisionDocumentMetadata({ baseMarkdown: base, candidateMarkdown: first, previousCandidateMarkdown: first })).toBe(first)
})

test('rejects forged metadata and metadata-only progress', () => {
  const changed = base.replace('Original body', 'Revised body')
  expect(() => advanceRevisionDocumentMetadata({
    baseMarkdown: base,
    candidateMarkdown: changed.replace('2.4.9', '9.9.9'),
    updatedAt: '2026-08-13T01:02:03.004Z',
  })).toThrow(/service-owned metadata/i)
  expect(() => advanceRevisionDocumentMetadata({
    baseMarkdown: base,
    candidateMarkdown: base.replace('2.4.9', '2.4.10'),
    updatedAt: '2026-08-13T01:02:03.004Z',
  })).toThrow(/without document progress/i)
})

test('preserves legacy sources that have no service-owned metadata', () => {
  const candidate = '# GDD\n\nRevised body'
  expect(advanceRevisionDocumentMetadata({
    baseMarkdown: '# GDD\n\nOriginal body',
    candidateMarkdown: candidate,
  })).toBe(candidate)
})

test('rejects incomplete metadata once a source advertises the service contract', () => {
  expect(() => advanceRevisionDocumentMetadata({
    baseMarkdown: '---\nversion: 2.4.9\n---\n# GDD\n\nOriginal body',
    candidateMarkdown: '---\nversion: 2.4.9\n---\n# GDD\n\nRevised body',
  })).toThrow(/service metadata|updated_at/i)
})
