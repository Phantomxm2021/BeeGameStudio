import { describe, expect, test } from 'bun:test'
import {
  createFoundationFactStore,
  digestFactStore,
} from '../domain/foundation-fact-store'

const source = {
  documentPath: 'docs/GDD.md' as const,
  sectionId: 'vision',
  heading: 'Vision',
  startLine: 1,
  endLine: 2,
  digest: 'a'.repeat(64),
}
const evidence = {
  documentPath: 'docs/GDD.md' as const,
  sectionId: 'vision',
  startLine: 1,
  endLine: 1,
  digest: 'a'.repeat(64),
}
const actionsSource = {
  ...source,
  sectionId: 'player_actions',
}
const actionsEvidence = {
  ...evidence,
  sectionId: 'player_actions',
}

describe('foundation fact store', () => {
  test('rejects duplicate fact keys instead of silently choosing an authority', () => {
    expect(() =>
      createFoundationFactStore([
        { key: 'game.players.max', value: 4, source, evidence },
        { key: 'game.players.max', value: 5, source, evidence },
      ]),
    ).toThrow('duplicate foundation fact key')
  })

  test('uses canonical ordering for deterministic fact-store digests', () => {
    const first = createFoundationFactStore([
      { key: 'game.mechanics', value: ['move', 'attack'], source: actionsSource, evidence: actionsEvidence },
      { key: 'game.players.max', value: 4, source, evidence },
    ])
    const second = createFoundationFactStore([
      { key: 'game.players.max', value: 4, source, evidence },
      { key: 'game.mechanics', value: ['move', 'attack'], source: actionsSource, evidence: actionsEvidence },
    ])
    expect(digestFactStore(first)).toBe(digestFactStore(second))
  })
})
