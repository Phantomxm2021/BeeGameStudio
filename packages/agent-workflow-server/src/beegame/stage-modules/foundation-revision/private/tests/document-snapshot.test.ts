import { expect, test } from 'bun:test'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { bindRevisionDocuments, type RevisionDocumentInput } from '../document-snapshot'
import { createHash } from 'node:crypto'

const fixture = () => CANONICAL_FOUNDATION_DOCUMENTS.map((path, index) => ({ path, content: `# 文档 ${index}\r\n\n正文 😀\n` }))

test('canonical bytes and set digest match the existing public handoff encoding', () => {
  const input = fixture().reverse()
  const actual = bindRevisionDocuments(input)
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')
  const expected = fixture().map(document => ({ ...document, digest: hash(document.content), byteLength: Buffer.byteLength(document.content) }))
  expect(actual.documentSetDigest).toBe(hash(JSON.stringify(expected.map(document => [document.path, document.digest]))))
  expect(actual.documents).toEqual(expected)
  expect(actual).toEqual(bindRevisionDocuments([...input].reverse()))
  input[0]!.content = 'caller mutation'
  expect(actual.documents.some(document => document.content === 'caller mutation')).toBe(false)
  expect(Object.isFrozen(actual)).toBe(true)
  expect(Object.isFrozen(actual.documents)).toBe(true)
  expect(actual.documents.every(Object.isFrozen)).toBe(true)
})

test('does not normalize upstream newline bytes or perform content review', () => {
  const input = fixture()
  const original = bindRevisionDocuments(input)
  input[0]!.content = input[0]!.content.replaceAll('\r\n', '\n')
  expect(bindRevisionDocuments(input).documentSetDigest).not.toBe(original.documentSetDigest)
  input[0]!.content = ''
  expect(bindRevisionDocuments(input).documents[0]!.byteLength).toBe(0)
})

test('rejects missing, duplicate, foreign, enriched and accessor documents', () => {
  const input = fixture()
  const bad: unknown[] = [input.slice(1), [...input.slice(1), input[1]],
    [{ ...input[0], path: '../GDD.md' }, ...input.slice(1)],
    [{ ...input[0], digest: '0'.repeat(64) }, ...input.slice(1)],
    [{ path: input[0]!.path, get content() { throw new Error('must not evaluate accessor') } }, ...input.slice(1)],
    [Object.defineProperty({ ...input[0] }, 'secret', { value: 'hidden' }), ...input.slice(1)],
  ]
  for (const value of bad) expect(() => bindRevisionDocuments(value as RevisionDocumentInput[])).toThrow(/Revision/)
})
