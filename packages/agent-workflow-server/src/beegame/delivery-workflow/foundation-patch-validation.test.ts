import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  createFoundationFactStore,
  digestFactStore,
  type FoundationFact,
} from './foundation-fact-store'
import { rebuildFoundationImpactedFacts } from './foundation-patch-validation'
import type { FoundationImpactAnalysis } from './foundation-impact-analysis'
import type { SectionRef } from './foundation-section-index'

const visionText = '# Vision\n## Vision\nplayers.max: 4\n'
const actionsText = '# Actions\n## Actions\nauthored controls describe movement and attack\n'
const vision: SectionRef = {
  documentPath: 'docs/GDD.md',
  sectionId: 'vision',
  heading: 'Vision',
  startLine: 1,
  endLine: 3,
  digest: createHash('sha256').update('# Vision\n## Vision').digest('hex'),
}
const actions: SectionRef = {
  documentPath: 'docs/GDD.md',
  sectionId: 'player_actions',
  heading: 'Actions',
  startLine: 1,
  endLine: 3,
  digest: createHash('sha256').update('# Actions\n## Actions').digest('hex'),
}

function impact(factKeys: string[]): FoundationImpactAnalysis {
  return {
    changedSections: factKeys.includes('game.mechanics') ? [
      { documentPath: 'docs/GDD.md', sectionId: 'player_actions' },
    ] : [
      { documentPath: 'docs/GDD.md', sectionId: 'vision' },
    ],
    factKeys: factKeys as FoundationImpactAnalysis['factKeys'],
    contractIds: [],
    checkIds: [],
    issueIds: ['issue-1'],
  }
}

function fact(
  key: FoundationFact['key'],
  value: FoundationFact['value'],
  source: SectionRef,
  line: string,
): FoundationFact {
  return {
    key,
    value,
    source,
    evidence: {
      documentPath: source.documentPath,
      sectionId: source.sectionId,
      startLine: 3,
      endLine: 3,
      digest: createHash('sha256').update(line).digest('hex'),
    },
  }
}

describe('incremental foundation fact rebuilding', () => {
  test('replaces only impacted facts and preserves unrelated fact objects', () => {
    const unrelated = fact('game.mechanics', ['old'], actions, 'mechanics: [old]')
    const committed = createFoundationFactStore([
      fact('game.players.max', 2, vision, 'players.max: 2'),
      unrelated,
    ])
    const result = rebuildFoundationImpactedFacts({
      committedFactStore: committed,
      documents: { 'docs/GDD.md': visionText },
      sectionIndex: [vision],
      impact: impact(['game.players.max']),
      revision: 'revision-2',
      phase: 'admit' as const,
      results: [],
    })

    expect(result.packets).toEqual([])
    expect(result.factStore.find(item => item.key === 'game.players.max')?.value).toBe(4)
    expect(result.factStore.find(item => item.key === 'game.mechanics')).toEqual(unrelated)
  })

  test('builds unresolved packets and merges only validator-admitted results', () => {
    const committed = createFoundationFactStore([
      fact('game.mechanics', ['old'], actions, 'mechanics: [old]'),
    ])
    const input = {
      committedFactStore: committed,
      documents: { 'docs/GDD.md': actionsText },
      sectionIndex: [actions],
      impact: impact(['game.mechanics']),
      revision: 'revision-2',
      phase: 'admit' as const,
    }
    const result = rebuildFoundationImpactedFacts({
      ...input,
      results: [{
        key: 'game.mechanics',
        status: 'present' as const,
        value: ['move', 'attack'],
        evidence: {
          documentPath: 'docs/GDD.md',
          sectionId: 'player_actions',
          startLine: 3,
          endLine: 3,
          digest: createHash('sha256').update('authored controls describe movement and attack').digest('hex'),
        },
      }],
    })

    expect(result.packets[0]?.keys).toEqual(['game.mechanics'])
    expect(result.factStore.find(item => item.key === 'game.mechanics')?.value).toEqual(['move', 'attack'])
  })

  test('plans unresolved packets without pretending they were admitted', () => {
    const result = rebuildFoundationImpactedFacts({
      committedFactStore: createFoundationFactStore([]),
      documents: { 'docs/GDD.md': actionsText },
      sectionIndex: [actions],
      impact: impact(['game.mechanics']),
      revision: 'revision-2',
      phase: 'plan',
    })

    expect(result.packets).toHaveLength(1)
    expect(result.factStore).toEqual([])
  })

  test('returns the canonical store without workers when impact is empty', () => {
    const committed = createFoundationFactStore([
      fact('game.players.max', 2, vision, 'players.max: 2'),
    ])
    const result = rebuildFoundationImpactedFacts({
      committedFactStore: committed,
      documents: {},
      sectionIndex: [],
      impact: { ...impact([]), changedSections: [], factKeys: [] },
      revision: 'revision-2',
      phase: 'admit' as const,
      results: [],
    })

    expect(result.packets).toEqual([])
    expect(result.factStore).toEqual(committed)
    expect(result.extraction.normalizedFactDigest).toBe(digestFactStore([]))
  })

  test('rejects missing, extra, duplicate, and mis-scoped results', () => {
    const input = {
      committedFactStore: createFoundationFactStore([]),
      documents: { 'docs/GDD.md': actionsText },
      sectionIndex: [actions],
      impact: impact(['game.mechanics']),
      revision: 'revision-2',
      phase: 'admit' as const,
    }
    expect(() => rebuildFoundationImpactedFacts({ ...input, results: [] })).toThrow(/missing|result/i)
    const valid = {
      key: 'game.mechanics' as const,
      status: 'present' as const,
      value: ['move'],
      evidence: {
        documentPath: 'docs/GDD.md' as const,
        sectionId: 'player_actions',
        startLine: 3,
        endLine: 3,
        digest: createHash('sha256').update('authored controls describe movement and attack').digest('hex'),
      },
    }
    expect(() => rebuildFoundationImpactedFacts({ ...input, results: [valid, valid] })).toThrow(/duplicate|exactly/i)
    expect(() => rebuildFoundationImpactedFacts({ ...input, results: [{ ...valid, key: 'game.players.max' as const }] })).toThrow(/outside|assigned|unknown/i)
    expect(() => rebuildFoundationImpactedFacts({
      ...input,
      results: [{ ...valid, evidence: { ...valid.evidence, sectionId: 'vision' } }],
    })).toThrow(/scope|evidence|indexed/i)
  })
})
