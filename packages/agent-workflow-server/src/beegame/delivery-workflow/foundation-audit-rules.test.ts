import { describe, expect, test } from 'bun:test'
import {
  runDeterministicFoundationAudit,
  type DeterministicFoundationAuditInput,
} from './foundation-audit-check-definitions'
import type { FoundationFact } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'

const ref = (documentPath: string, sectionId: string): SectionRef => ({
  documentPath: documentPath as SectionRef['documentPath'],
  sectionId,
  heading: sectionId,
  startLine: 1,
  endLine: 2,
  digest: 'b'.repeat(64),
})
const fact = (
  key: string,
  value: FoundationFact['value'],
  source: SectionRef,
): FoundationFact => ({ key, value, source })

describe('deterministic foundation rules', () => {
  test('targets each later conflicting numeric fact in a 3-way comparison', () => {
    const balance = ref('docs/custom-balance.md', 'units_variables')
    const technical = ref('docs/custom-technical.md', 'performance')
    const level = ref('docs/custom-level.md', 'production_acceptance')
    const input: DeterministicFoundationAuditInput = {
      sectionIndex: [balance, technical, level],
      factStore: [
        fact('players.max.balance', 4, balance),
        fact('players.max.technical', 8, technical),
        fact('players.max.level', 9, level),
      ],
      numericRules: [
        {
          id: 'players.max-consistency',
          factKeys: [
            'players.max.balance',
            'players.max.technical',
            'players.max.level',
          ],
          relation: 'equal',
        },
      ],
    }
    const issues = runDeterministicFoundationAudit(input)
    expect(issues).toHaveLength(2)
    expect(issues.map(issue => issue.target?.sectionId).sort()).toEqual([
      'performance',
      'production_acceptance',
    ])
    expect(
      issues.every(issue => issue.fixSectionId === issue.target?.sectionId),
    ).toBe(true)
  })

  test('reports missing referenced entities at the source fact section', () => {
    const level = ref('docs/custom-level.md', 'encounters')
    const assets = ref('docs/custom-assets.md', 'inventory')
    const issues = runDeterministicFoundationAudit({
      sectionIndex: [level, assets],
      factStore: [fact('level.boss', 'Boss_A', level)],
      entityRules: [
        {
          id: 'level.boss-exists',
          sourceFactKey: 'level.boss',
          targetFactPrefix: 'asset.boss.',
        },
      ],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      source: level,
      fixDocument: level.documentPath,
      fixSectionId: level.sectionId,
    })
  })
})
