import { describe, expect, test } from 'bun:test'
import type { PatchOperation } from './foundation-revision-stage'
import {
  analyzeFoundationImpact,
  type FoundationImpactAnalysis,
} from './foundation-impact-analysis'

const digest = 'a'.repeat(64)

function operation(
  documentPath: PatchOperation['documentPath'],
  sectionId: string,
  issueIds: string[],
  kind: PatchOperation['kind'] = 'REPLACE',
): PatchOperation {
  return {
    kind,
    documentPath,
    sectionId,
    issueIds,
    ...(kind === 'INSERT' || kind === 'REPLACE' ? { afterDigest: digest } : {}),
    ...(kind === 'DELETE' || kind === 'REPLACE' ? { beforeDigest: digest } : {}),
  }
}

describe('foundation revision impact analysis', () => {
  test('maps one changed owner section to its facts, consumers, contracts, and issues', () => {
    const result = analyzeFoundationImpact([
      operation('docs/GDD.md', 'rules_systems', ['AUD-RULES']),
    ])

    expect(result).toEqual({
      changedSections: [{ documentPath: 'docs/GDD.md', sectionId: 'rules_systems' }],
      factKeys: ['game.boss.count', 'game.resources'],
      contractIds: ['asset-boss-count-authority', 'ui-resources-authority'],
      checkIds: [
        'balance-resource-coverage',
        'boss-count-consistency',
        'ui-resource-coverage',
      ],
      issueIds: ['AUD-RULES'],
    } satisfies FoundationImpactAnalysis)
  })

  test('unions multiple sections and only includes contracts/checks touching their facts', () => {
    const result = analyzeFoundationImpact([
      operation('docs/GDD.md', 'rules_systems', ['AUD-RULES']),
      operation('docs/ASSET_PLAN.md', 'inventory', ['AUD-ASSET']),
    ])

    expect(result.changedSections).toEqual([
      { documentPath: 'docs/ASSET_PLAN.md', sectionId: 'inventory' },
      { documentPath: 'docs/GDD.md', sectionId: 'rules_systems' },
    ])
    expect(result.factKeys).toEqual([
      'asset.boss.count',
      'asset.covered_level_requirements',
      'asset.inventory_ids',
      'game.boss.count',
      'game.resources',
    ])
    expect(result.contractIds).toEqual([
      'asset-boss-count-authority',
      'asset-level-requirement-coverage',
      'ui-resources-authority',
    ])
    expect(result.checkIds).toEqual([
      'asset-inventory-coverage',
      'balance-resource-coverage',
      'boss-count-consistency',
      'level-asset-coverage',
      'ui-resource-coverage',
    ])
    expect(result.issueIds).toEqual(['AUD-ASSET', 'AUD-RULES'])
  })

  test('keeps a canonical section with no owned fact as section and issue impact only', () => {
    const result = analyzeFoundationImpact([
      operation('docs/GDD.md', 'experience_pillars', ['AUD-VISION']),
    ])

    expect(result).toEqual({
      changedSections: [{ documentPath: 'docs/GDD.md', sectionId: 'experience_pillars' }],
      factKeys: [],
      contractIds: [],
      checkIds: [],
      issueIds: ['AUD-VISION'],
    } satisfies FoundationImpactAnalysis)
  })

  test('is stable when operations and issue IDs are reordered', () => {
    const first = analyzeFoundationImpact([
      operation('docs/ASSET_PLAN.md', 'dependencies', ['AUD-Z', 'AUD-Y']),
      operation('docs/GDD.md', 'player_actions', ['AUD-X']),
    ])
    const second = analyzeFoundationImpact([
      operation('docs/GDD.md', 'player_actions', ['AUD-X']),
      operation('docs/ASSET_PLAN.md', 'dependencies', ['AUD-Y', 'AUD-Z']),
    ])
    expect(second).toEqual(first)
  })

  test('rejects unknown or duplicate operation identities and non-canonical sections', () => {
    expect(() => analyzeFoundationImpact([
      operation('docs/GDD.md', 'not_a_section', ['AUD-1']),
    ])).toThrow(/canonical|section/i)
    expect(() => analyzeFoundationImpact([
      operation('docs/GDD.md', 'vision', ['AUD-1']),
      operation('docs/GDD.md', 'vision', ['AUD-2']),
    ])).toThrow(/duplicate|identity/i)
    expect(() => analyzeFoundationImpact([
      { ...operation('docs/GDD.md', 'vision', ['AUD-1']), afterDigest: 'bad' },
    ])).toThrow(/digest/i)
  })

  test('rejects empty coverage but deduplicates one admitted issue spanning multiple changed sections', () => {
    expect(() => analyzeFoundationImpact([
      operation('docs/GDD.md', 'vision', []),
    ])).toThrow(/issue/i)
    const result = analyzeFoundationImpact([
      operation('docs/GDD.md', 'vision', ['AUD-1']),
      operation('docs/GDD.md', 'player_actions', ['AUD-1']),
    ])
    expect(result.changedSections).toEqual([
      { documentPath: 'docs/GDD.md', sectionId: 'player_actions' },
      { documentPath: 'docs/GDD.md', sectionId: 'vision' },
    ])
    expect(result.issueIds).toEqual(['AUD-1'])
  })

  test('does not accept caller-supplied graph, rules, or contracts', () => {
    expect(() => analyzeFoundationImpact({
      operations: [operation('docs/GDD.md', 'vision', ['AUD-1'])],
      contracts: [],
    } as never)).toThrow(/array|input|caller|contract/i)
  })
})
