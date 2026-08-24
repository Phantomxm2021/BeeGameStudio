import { describe, expect, test } from 'bun:test'
import { runFoundationRuleChecks } from './foundation-audit-rules'
import type { FoundationFact } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'

const source = (sectionId: string): SectionRef => ({
  documentPath: 'docs/custom.md' as SectionRef['documentPath'],
  sectionId,
  heading: sectionId,
  startLine: 1,
  endLine: 2,
  digest: `${sectionId}`.padEnd(64, 'a').slice(0, 64),
})

const fact = (
  key: string,
  value: FoundationFact['value'],
  sectionId: string,
): FoundationFact => ({
  key,
  value,
  source: source(sectionId),
})

describe('foundation audit rules', () => {
  test('reports inconsistent numeric facts using a declarative rule', () => {
    const issues = runFoundationRuleChecks({
      sectionIndex: [source('balance'), source('technical')],
      factStore: [
        fact('players.max', 4, 'balance'),
        fact('technical.players.max', 8, 'technical'),
      ],
      numericRules: [
        {
          id: 'players.max-consistency',
          factKeys: ['players.max', 'technical.players.max'],
          relation: 'equal',
          sourceSectionId: 'balance',
          targetSectionId: 'technical',
        },
      ],
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      type: 'rule',
      severity: 'HIGH',
      source: source('balance'),
      target: source('technical'),
    })
  })

  test('reports a referenced entity that has no declared target fact', () => {
    const issues = runFoundationRuleChecks({
      sectionIndex: [source('level')],
      factStore: [fact('level.boss', 'Boss_A', 'level')],
      entityRules: [
        {
          id: 'level.boss-exists',
          sourceFactKey: 'level.boss',
          targetFactPrefix: 'asset.boss.',
          sourceSectionId: 'level',
        },
      ],
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      type: 'rule',
      severity: 'HIGH',
      source: source('level'),
    })
  })
})
