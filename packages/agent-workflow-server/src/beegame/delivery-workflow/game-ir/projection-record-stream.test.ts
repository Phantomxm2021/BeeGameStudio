import { describe, expect, test } from 'bun:test'
import { parseGameIrProjectionRecordStream } from './projection-record-stream'

const node = (id: string, fragmentId: string, extra = '') =>
  JSON.stringify({
    record: 'node',
    sliceId: 'balance.slice.2',
    fragmentId,
    node: {
      id,
      kind: 'balance.formula',
      value: {},
      references: [],
      edges: [],
    },
  }) + extra

const done = () =>
  JSON.stringify({ record: 'done', sliceId: 'balance.slice.2' })

const parse = (text: string) =>
  parseGameIrProjectionRecordStream({
    expectedSliceId: 'balance.slice.2',
    text,
  })

describe('Game IR projection record stream', () => {
  test('returns the valid record prefix and exact diagnostic at the first bad line', () => {
    expect(parse(`${node('formula.a', 'e0.0')}\n{"record":"bad"}`)).toEqual({
      records: [
        expect.objectContaining({
          fragmentId: 'e0.0',
          node: expect.objectContaining({ id: 'formula.a' }),
        }),
      ],
      done: false,
      diagnostic: expect.stringMatching(/unknown record type/),
    })
  })

  test('assembles nodes and derives canonical evidence groups', () => {
    const result = parse(
      [
        node('formula.a', 'e2.1'),
        node('formula.b', 'e1.4'),
        node('formula.c', 'e2.1'),
        done(),
      ].join('\n'),
    )

    expect(result.done).toBe(true)
    expect(result.records.map(record => record.node.id)).toEqual([
      'formula.a',
      'formula.b',
      'formula.c',
    ])
    expect(result.records.map(record => record.fragmentId)).toEqual([
      'e2.1',
      'e1.4',
      'e2.1',
    ])
  })

  test('accepts an empty slice with only its done record', () => {
    expect(parse(done())).toEqual({ records: [], done: true })
  })

  test('accepts one trailing line ending but rejects internal blank lines', () => {
    expect(parse(`${done()}\n`)).toEqual({ records: [], done: true })
    expect(
      parse(`${node('formula.a', 'e0.0')}\n\n${done()}`),
    ).toMatchObject({ done: false, diagnostic: expect.stringMatching(/blank|empty/i) })
  })

  test('rejects malformed JSON and non-object records', () => {
    expect(parse('{')).toMatchObject({ done: false, diagnostic: expect.stringMatching(/json|record/i) })
    expect(parse(`[1]\n${done()}`)).toMatchObject({ done: false, diagnostic: expect.stringMatching(/object|record/i) })
  })

  test('rejects unknown fields on node and done records', () => {
    const nodeWithUnknownField = JSON.parse(
      node('formula.a', 'e0.0'),
    ) as Record<string, unknown>
    nodeWithUnknownField.extra = 1
    expect(parse(JSON.stringify(nodeWithUnknownField))).toMatchObject({ done: false, diagnostic: expect.stringMatching(/unknown|field|canonical/i) })
    expect(parse(`${done().slice(0, -1)},"extra":1}`)).toMatchObject({ done: false, diagnostic: expect.stringMatching(/unknown|field|canonical/i) })
  })

  test('rejects wrong slice IDs and empty fragment IDs', () => {
    expect(
      parse(
        node('formula.a', 'e0.0').replace('balance.slice.2', 'balance.slice.1'),
      ),
    ).toMatchObject({ done: false, diagnostic: expect.stringMatching(/slice/i) })
    expect(parse(`${node('formula.a', '')}\n${done()}`)).toMatchObject({ done: false, diagnostic: expect.stringMatching(/fragment/i) })
  })

  test('rejects missing, duplicate, and premature done records', () => {
    expect(parse(node('formula.a', 'e0.0'))).toMatchObject({ done: false, diagnostic: expect.stringMatching(/done|complete/i) })
    expect(parse(`${done()}\n${done()}`)).toMatchObject({ done: false, diagnostic: expect.stringMatching(/done|after|duplicate/i) })
    expect(parse(`${done()}\n${node('formula.a', 'e0.0')}`)).toMatchObject({ done: false, diagnostic: expect.stringMatching(/done|after/i) })
  })

  test('rejects duplicate or descending node IDs without repairing order', () => {
    expect(
      parse(
        `${node('formula.a', 'e0.0')}\n${node('formula.a', 'e0.1')}\n${done()}`,
      ),
    ).toMatchObject({ done: false, diagnostic: expect.stringMatching(/id|order|duplicate/i) })
    expect(
      parse(
        `${node('formula.b', 'e0.0')}\n${node('formula.a', 'e0.1')}\n${done()}`,
      ),
    ).toMatchObject({ done: false, diagnostic: expect.stringMatching(/id|order|ascending/i) })
  })

  test('rejects an invalid node identity before assembling a completion', () => {
    const invalid = JSON.stringify({
      record: 'node',
      sliceId: 'balance.slice.2',
      fragmentId: 'e0.0',
      node: {
        id: '',
        kind: 'balance.formula',
        value: {},
        references: [],
        edges: [],
      },
    })
    expect(parse(`${invalid}\n${done()}`)).toMatchObject({ done: false, diagnostic: expect.stringMatching(/node|id/i) })
  })

  test('uses code-unit ordering for non-ASCII node IDs and evidence groups', () => {
    const result = parse(
      [node('a', 'e2.0'), node('b', 'e10.0'), done()].join('\n'),
    )
    expect(result.records.map(record => record.fragmentId)).toEqual([
      'e2.0',
      'e10.0',
    ])
  })
})
