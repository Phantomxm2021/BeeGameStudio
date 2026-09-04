import { describe, expect, test } from 'bun:test'
import {
  runDeterministicFoundationAudit,
  type DeterministicFoundationAuditInput,
} from './foundation-audit-check-definitions'
import type { FoundationFact } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'
import { GAME_DOCUMENT_CONTRACTS } from './game-document-contracts'

const ref = (documentPath: string, sectionId: string): SectionRef => ({
  documentPath: documentPath as SectionRef['documentPath'],
  sectionId,
  heading: sectionId,
  startLine: 1,
  endLine: 2,
  digest: 'b'.repeat(64),
})
const canonicalIndex = (sections: readonly SectionRef[]): SectionRef[] => {
  const required = Object.values(GAME_DOCUMENT_CONTRACTS).flatMap(contract => [
    ...contract.sections.map(section => [contract.path, section.sectionId] as const),
    ...contract.upstreamSections.flatMap(projection => projection.sectionIds.map(sectionId => [projection.path, sectionId] as const)),
  ])
  const seen = new Set(sections.map(section => `${section.documentPath}#${section.sectionId}`))
  const extras: SectionRef[] = []
  for (const [path, sectionId] of required) {
    const key = `${path}#${sectionId}`
    if (seen.has(key)) continue
    seen.add(key)
    extras.push(ref(path, sectionId))
  }
  return [...sections, ...extras]
}
const fact = (
  key: string,
  value: FoundationFact['value'],
  source: SectionRef,
): FoundationFact => ({
  key,
  value,
  source,
  evidence: {
    documentPath: source.documentPath,
    sectionId: source.sectionId,
    startLine: source.startLine,
    endLine: source.endLine,
    digest: 'd'.repeat(64),
  },
})

describe('deterministic foundation rules', () => {
  test('targets each later conflicting numeric fact in a 3-way comparison', () => {
    const balance = ref('docs/BALANCE_DESIGN.md', 'units_variables')
    const technical = ref('docs/TECHNICAL_DESIGN.md', 'performance')
    const level = ref('docs/LEVEL_SCENE_DESIGN.md', 'production_acceptance')
    const input: DeterministicFoundationAuditInput = {
      sectionIndex: canonicalIndex([balance, technical, level]),
      factStore: [
        fact('players.max.balance', 4, balance),
        fact('players.max.technical', 8, technical),
        fact('players.max.level', 9, level),
      ],
      numericRules: [
        {
          id: 'players.max-consistency',
          facts: [
            {
              key: 'players.max.balance',
              source: balance,
              expectedType: 'number',
            },
            {
              key: 'players.max.technical',
              source: technical,
              expectedType: 'number',
            },
            { key: 'players.max.level', source: level, expectedType: 'number' },
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
      issues.every(issue => issue.remediation.kind === 'patch' && issue.remediation.sectionIds[0] === issue.target?.sectionId),
    ).toBe(true)
  })

  test('reports a missing later numeric fact as a schema issue at its declaration', () => {
    const first = ref('docs/GDD.md', 'values')
    const later = ref('docs/BALANCE_DESIGN.md', 'values')
    const issues = runDeterministicFoundationAudit({
      sectionIndex: canonicalIndex([first, later]),
      factStore: [fact('values.first', 1, first)],
      numericRules: [
        {
          id: 'values-equal',
          facts: [
            { key: 'values.first', source: first, expectedType: 'number' },
            { key: 'values.later', source: later, expectedType: 'number' },
          ],
          relation: 'equal',
        },
      ],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      type: 'schema',
      source: later,
      remediation: { kind: 'patch', scope: 'section', documentPath: later.documentPath, sectionIds: [later.sectionId] },
    })
  })

  test('reports a nonnumeric later numeric fact as a schema issue at its declaration', () => {
    const first = ref('docs/GDD.md', 'values')
    const later = ref('docs/BALANCE_DESIGN.md', 'values')
    const issues = runDeterministicFoundationAudit({
      sectionIndex: canonicalIndex([first, later]),
      factStore: [
        fact('values.first', 1, first),
        fact('values.later', 'one', later),
      ],
      numericRules: [
        {
          id: 'values-equal',
          facts: [
            { key: 'values.first', source: first, expectedType: 'number' },
            { key: 'values.later', source: later, expectedType: 'number' },
          ],
          relation: 'equal',
        },
      ],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      type: 'schema',
      source: later,
      remediation: { kind: 'patch', scope: 'section', documentPath: later.documentPath, sectionIds: [later.sectionId] },
    })
  })

  test('suppresses numeric evaluation when the first declared fact has the wrong type', () => {
    const first = ref('docs/GDD.md', 'values')
    const later = ref('docs/BALANCE_DESIGN.md', 'values')
    const issues = runDeterministicFoundationAudit({
      sectionIndex: canonicalIndex([first, later]),
      factStore: [
        fact('values.first', 'one', first),
        fact('values.later', 1, later),
      ],
      numericRules: [
        {
          id: 'values-equal',
          facts: [
            { key: 'values.first', source: first, expectedType: 'number' },
            { key: 'values.later', source: later, expectedType: 'number' },
          ],
          relation: 'equal',
        },
      ],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.type).toBe('schema')
  })

  test('suppresses entity evaluation when its declared source has the wrong type', () => {
    const source = ref('docs/LEVEL_SCENE_DESIGN.md', 'encounters')
    const issues = runDeterministicFoundationAudit({
      sectionIndex: canonicalIndex([source]),
      factStore: [fact('level.boss', 7, source)],
      entityRules: [
        {
          id: 'level.boss-exists',
          source: { key: 'level.boss', source, expectedType: 'string' },
          targetFactPrefix: 'asset.boss.',
        },
      ],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.type).toBe('schema')
  })

  test('evaluates valid declarations while suppressing invalid declarations', () => {
    const validFirst = ref('docs/GDD.md', 'values')
    const validLater = ref('docs/BALANCE_DESIGN.md', 'values')
    const invalidFirst = ref('docs/LEVEL_SCENE_DESIGN.md', 'values')
    const invalidLater = ref('docs/TECHNICAL_DESIGN.md', 'values')
    const issues = runDeterministicFoundationAudit({
      sectionIndex: canonicalIndex([validFirst, validLater, invalidFirst, invalidLater]),
      factStore: [
        fact('valid.first', 1, validFirst),
        fact('valid.later', 2, validLater),
        fact('invalid.first', 'one', invalidFirst),
        fact('invalid.later', 2, invalidLater),
      ],
      numericRules: [
        {
          id: 'valid-equal',
          facts: [
            { key: 'valid.first', source: validFirst, expectedType: 'number' },
            { key: 'valid.later', source: validLater, expectedType: 'number' },
          ],
          relation: 'equal',
        },
        {
          id: 'invalid-equal',
          facts: [
            {
              key: 'invalid.first',
              source: invalidFirst,
              expectedType: 'number',
            },
            {
              key: 'invalid.later',
              source: invalidLater,
              expectedType: 'number',
            },
          ],
          relation: 'equal',
        },
      ],
    })
    expect(issues).toHaveLength(2)
    expect(issues.map(issue => issue.type).sort()).toEqual(['rule', 'schema'])
  })

  test('reports a missing entity source fact as a schema issue at its declaration', () => {
    const source = ref('docs/LEVEL_SCENE_DESIGN.md', 'encounters')
    const issues = runDeterministicFoundationAudit({
      sectionIndex: canonicalIndex([source]),
      factStore: [],
      entityRules: [
        {
          id: 'level.boss-exists',
          source: { key: 'level.boss', source, expectedType: 'string' },
          targetFactPrefix: 'asset.boss.',
        },
      ],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      type: 'schema',
      source,
      remediation: { kind: 'patch', scope: 'section', documentPath: source.documentPath, sectionIds: [source.sectionId] },
    })
  })

  test('reports missing referenced entities at the source fact section', () => {
    const level = ref('docs/LEVEL_SCENE_DESIGN.md', 'encounters')
    const assets = ref('docs/ASSET_PLAN.md', 'inventory')
    const issues = runDeterministicFoundationAudit({
      sectionIndex: canonicalIndex([level, assets]),
      factStore: [fact('level.boss', 'Boss_A', level)],
      entityRules: [
        {
          id: 'level.boss-exists',
          source: { key: 'level.boss', source: level, expectedType: 'string' },
          targetFactPrefix: 'asset.boss.',
        },
      ],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      source: level,
      remediation: { kind: 'patch', scope: 'section', documentPath: level.documentPath, sectionIds: [level.sectionId] },
    })
  })
})
