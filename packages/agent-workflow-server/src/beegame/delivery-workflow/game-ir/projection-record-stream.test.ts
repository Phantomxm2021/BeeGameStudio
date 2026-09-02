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
  test('assembles nodes and derives canonical evidence groups', () => {
    const result = parse(
      [
        node('formula.a', 'e2.1'),
        node('formula.b', 'e1.4'),
        node('formula.c', 'e2.1'),
        done(),
      ].join('\n'),
    )

    expect(result).toEqual({
      status: 'completed',
      sliceId: 'balance.slice.2',
      semantic: {
        nodes: [
          expect.objectContaining({ id: 'formula.a' }),
          expect.objectContaining({ id: 'formula.b' }),
          expect.objectContaining({ id: 'formula.c' }),
        ],
        sourceEvidenceGroups: [
          { fragmentId: 'e1.4', nodeIds: ['formula.b'] },
          { fragmentId: 'e2.1', nodeIds: ['formula.a', 'formula.c'] },
        ],
      },
    })
  })

  test('accepts an empty slice with only its done record', () => {
    expect(parse(done())).toEqual({
      status: 'completed',
      sliceId: 'balance.slice.2',
      semantic: { nodes: [], sourceEvidenceGroups: [] },
    })
  })

  test('accepts one trailing line ending but rejects internal blank lines', () => {
    expect(parse(`${done()}\n`)).toMatchObject({ status: 'completed' })
    expect(() => parse(`${node('formula.a', 'e0.0')}\n\n${done()}`)).toThrow(
      /blank|empty/i,
    )
  })

  test('rejects malformed JSON and non-object records', () => {
    expect(() => parse('{')).toThrow(/json|record/i)
    expect(() => parse(`[1]\n${done()}`)).toThrow(/object|record/i)
  })

  test('rejects unknown fields on node and done records', () => {
    const nodeWithUnknownField = JSON.parse(
      node('formula.a', 'e0.0'),
    ) as Record<string, unknown>
    nodeWithUnknownField.extra = 1
    expect(() => parse(JSON.stringify(nodeWithUnknownField))).toThrow(
      /unknown|field|canonical/i,
    )
    expect(() => parse(`${done().slice(0, -1)},"extra":1}`)).toThrow(
      /unknown|field|canonical/i,
    )
  })

  test('rejects wrong slice IDs and empty fragment IDs', () => {
    expect(() =>
      parse(
        node('formula.a', 'e0.0').replace('balance.slice.2', 'balance.slice.1'),
      ),
    ).toThrow(/slice/i)
    expect(() => parse(`${node('formula.a', '')}\n${done()}`)).toThrow(
      /fragment/i,
    )
  })

  test('rejects missing, duplicate, and premature done records', () => {
    expect(() => parse(node('formula.a', 'e0.0'))).toThrow(/done|complete/i)
    expect(() => parse(`${done()}\n${done()}`)).toThrow(/done|after|duplicate/i)
    expect(() => parse(`${done()}\n${node('formula.a', 'e0.0')}`)).toThrow(
      /done|after/i,
    )
  })

  test('rejects duplicate or descending node IDs without repairing order', () => {
    expect(() =>
      parse(
        `${node('formula.a', 'e0.0')}\n${node('formula.a', 'e0.1')}\n${done()}`,
      ),
    ).toThrow(/id|order|duplicate/i)
    expect(() =>
      parse(
        `${node('formula.b', 'e0.0')}\n${node('formula.a', 'e0.1')}\n${done()}`,
      ),
    ).toThrow(/id|order|ascending/i)
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
    expect(() => parse(`${invalid}\n${done()}`)).toThrow(/node|id/i)
  })

  test('uses code-unit ordering for non-ASCII node IDs and evidence groups', () => {
    const result = parse(
      [node('a', 'e2.0'), node('b', 'e10.0'), done()].join('\n'),
    )
    expect(
      result.semantic.sourceEvidenceGroups.map(group => group.fragmentId),
    ).toEqual(['e10.0', 'e2.0'])
  })
})
