import { expect, test } from 'bun:test'
import { revisionCanonicalJson, revisionDigest } from '../json-digest'
// Test-only interoperability oracle, never part of the Revision dependency graph.
import { reviewerCanonicalJson, reviewerDigest } from '../../../foundation-reviewer/private/review-summary'

test('finite JSON preserves the existing public digest contract', () => {
  const shared = { x: '中文 😀', values: [1, null, false] }
  for (const value of [null, false, 1.5, -0, 'text', [], {}, { z: shared, a: shared }]) {
    expect(revisionCanonicalJson(value)).toBe(reviewerCanonicalJson(value))
    expect(revisionDigest(value)).toBe(reviewerDigest(value))
  }
  expect(revisionDigest({ b: 2, a: 1 })).toBe(revisionDigest({ a: 1, b: 2 }))
})

test('rejects ambiguous non-JSON values without reading accessors', () => {
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  const sparse = new Array(2)
  const values = [undefined, NaN, Infinity, 1n, () => 1, new Date(), cycle, sparse,
    [undefined], { x: undefined }, Object.assign([1], { extra: 2 }),
    { [Symbol('key')]: 1 }, Object.defineProperty({}, 'hidden', { value: 1 }),
    { get x() { throw new Error('must not evaluate accessor') } }]
  for (const value of values) expect(() => revisionCanonicalJson(value)).toThrow(/Revision/)
})
