import { expect, test } from 'bun:test'
import { bindReviewDocuments, prepareFoundationReview } from '../prepare-review'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../test-fixtures/complete-game-document-fixture'

function documents() {
  return CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
    path, content: renderTestCompleteGameDocument(path, completeTestSubmission(path)),
  }))
}

test('snapshot order is canonical and content changes invalidate its binding', () => {
  const input = documents()
  const original = bindReviewDocuments(input)
  expect(bindReviewDocuments([...input].reverse())).toEqual(original)
  input[0]!.content += '\n'
  expect(bindReviewDocuments(input).digest).not.toBe(original.digest)
  expect(original.documents[0]!.content).not.toBe(input[0]!.content)
  expect(Object.isFrozen(original.documents[0])).toBe(true)
  expect(Object.isFrozen(original.documents)).toBe(true)
})

test('rejects missing, duplicate, unknown, aliased, non-text, and extra input fields', () => {
  const input = documents()
  for (const invalid of [
    input.slice(1), [...input, input[0]], [input[0], ...input.slice(0, -1)],
    [{ ...input[0], path: 'docs/../docs/GDD.md' }, ...input.slice(1)],
    [{ ...input[0], content: 42 }, ...input.slice(1)],
    [{ ...input[0], repaired: true }, ...input.slice(1)],
  ]) expect(() => bindReviewDocuments(invalid as never)).toThrow()
})

test('valid input prepares frozen fact work without claiming review completion', () => {
  const result = prepareFoundationReview(documents())
  expect(result.kind).toBe('facts_pending')
  if (result.kind !== 'facts_pending') throw new Error('unexpected format failure')
  expect(result.factPackets.length).toBeGreaterThan(0)
  expect(result.sectionIndex.length).toBeGreaterThan(8)
  expect(Object.isFrozen(result.extraction.facts)).toBe(true)
  expect(result.manifest.version).toBe('foundation-deterministic.v1')
  expect(prepareFoundationReview(documents())).toEqual(result)
})

test('malformed document yields format issues and no worker packets', () => {
  const input = documents()
  input[0]!.content = '# broken'
  const result = prepareFoundationReview(input)
  expect(result.kind).toBe('format_issues')
  if (result.kind !== 'format_issues') throw new Error('expected format failure')
  expect(result.formatIssues.length).toBeGreaterThan(0)
  expect('factPackets' in result).toBe(false)
  expect(Object.isFrozen(result.formatIssues[0])).toBe(true)
})
