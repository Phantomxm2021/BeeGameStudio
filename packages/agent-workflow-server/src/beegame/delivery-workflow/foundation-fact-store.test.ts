import { describe, expect, test } from 'bun:test'
import {
  createFoundationFactStore,
  digestFactStore,
} from './foundation-fact-store'

describe('foundation fact store', () => {
  const source = {
    documentPath: 'docs/GDD.md' as const,
    sectionId: 'vision',
    heading: 'Vision',
    startLine: 1,
    endLine: 2,
    digest: 'a'.repeat(64),
  }

  test('rejects duplicate fact keys instead of silently choosing an authority', () => {
    expect(() =>
      createFoundationFactStore([
        { key: 'GDD.vision', value: 'first', source },
        { key: 'GDD.vision', value: 'second', source },
      ]),
    ).toThrow('duplicate foundation fact key')
  })

  test('uses canonical ordering for deterministic fact-store digests', () => {
    const first = createFoundationFactStore([
      { key: 'GDD.core_loop', value: ['move', 'attack'], source },
      { key: 'GDD.max_players', value: 4, source },
    ])
    const second = createFoundationFactStore([
      { key: 'GDD.max_players', value: 4, source },
      { key: 'GDD.core_loop', value: ['move', 'attack'], source },
    ])
    expect(digestFactStore(first)).toBe(digestFactStore(second))
  })
})
