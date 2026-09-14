import { expect, test } from 'bun:test'
import { sealReviewedDocument } from '../reviewed-document-metadata'

const source = [
  '---',
  'document_id: GDD',
  'version: 1.2.3',
  'updated_at: 2026-09-13T01:33:19.408Z',
  '---',
  '# Original',
].join('\n')

test('a reviewed content change advances service metadata exactly once', () => {
  const result = sealReviewedDocument({
    sourceContent: source,
    reviewedContent: source.replace('version: 1.2.3', 'version: 9.9.9').replace('# Original', '# Corrected'),
    reviewedAt: '2026-09-14T02:00:00.000Z',
  })
  expect(result).toContain('version: 1.2.4')
  expect(result).toContain('updated_at: 2026-09-14T02:00:00.000Z')
  expect(result).toContain('# Corrected')
})

test('metadata-only model edits are discarded without creating a new version', () => {
  const result = sealReviewedDocument({
    sourceContent: source,
    reviewedContent: source.replace('version: 1.2.3', 'version: 8.0.0').replace(
      'updated_at: 2026-09-13T01:33:19.408Z',
      'updated_at: 2030-01-01T00:00:00.000Z',
    ),
    reviewedAt: '2026-09-14T02:00:00.000Z',
  })
  expect(result).toBe(source)
})

test('unchanged documents retain their exact source bytes', () => {
  expect(sealReviewedDocument({
    sourceContent: source,
    reviewedContent: source,
    reviewedAt: '2026-09-14T02:00:00.000Z',
  })).toBe(source)
})

test('a non-advancing review timestamp is rejected', () => {
  expect(() => sealReviewedDocument({
    sourceContent: source,
    reviewedContent: source.replace('# Original', '# Corrected'),
    reviewedAt: '2026-09-13T01:33:19.408Z',
  })).toThrow('updated_at must advance')
})
