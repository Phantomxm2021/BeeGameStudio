import { describe, expect, test } from 'bun:test'
import { runDeterministicFoundationAudit } from './foundation-audit-check-definitions'
import type { FoundationFact } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'

const ref = (documentPath: string, sectionId: string): SectionRef => ({
  documentPath: documentPath as SectionRef['documentPath'],
  sectionId,
  heading: sectionId,
  startLine: 1,
  endLine: 2,
  digest: 'd'.repeat(64),
})
const fact = (
  key: string,
  value: FoundationFact['value'],
  source: SectionRef,
): FoundationFact => ({ key, value, source })

describe('foundation issue registry admission', () => {
  test('derives IDs without caller IDs and keeps them stable across display/severity/fix changes', () => {
    const source = ref('docs/custom.md', 'settings')
    const first = runDeterministicFoundationAudit({
      sectionIndex: [source],
      factStore: [],
      schema: {
        requiredFacts: [
          { key: 'custom.missing', source, expectedType: 'string' },
        ],
      },
    })[0]!
    const second = runDeterministicFoundationAudit({
      sectionIndex: [source],
      factStore: [],
      schema: {
        requiredFacts: [
          {
            key: 'custom.missing',
            source,
            expectedType: 'string',
            severity: 'LOW',
          },
        ],
      },
    })[0]!
    expect(first.id).toBe(second.id)
    expect(first.id).toMatch(/^AUD-[A-F0-9]{24}$/)
  })

  test('keeps distinct conflicts distinct and exact repeated runs deterministic', () => {
    const source = ref('docs/custom.md', 'settings')
    const input = {
      sectionIndex: [source],
      factStore: [fact('custom.a', 1, source), fact('custom.b', 2, source)],
      numericRules: [
        {
          id: 'a-vs-b',
          facts: [
            { key: 'custom.a', source, expectedType: 'number' as const },
            { key: 'custom.b', source, expectedType: 'number' as const },
          ],
          relation: 'equal' as const,
        },
      ],
    }
    const first = runDeterministicFoundationAudit(input)
    const second = runDeterministicFoundationAudit(input)
    expect(first).toHaveLength(1)
    expect(new Set(first.map(issue => issue.id)).size).toBe(first.length)
    expect(first).toEqual(second)
  })

  test('does not admit a caller-supplied issue ID surface', () => {
    const source = ref('docs/custom.md', 'settings')
    expect(() =>
      runDeterministicFoundationAudit({
        sectionIndex: [source],
        factStore: [],
        schema: {
          requiredFacts: [
            {
              key: 'custom.missing',
              source,
              expectedType: 'string',
              id: 'caller-id',
            } as never,
          ],
        },
      }),
    ).toThrow('id')
    expect(() =>
      runDeterministicFoundationAudit({
        sectionIndex: [source],
        factStore: [],
        schema: {
          requiredFacts: [
            { key: 'custom.duplicate', source, expectedType: 'string' },
            { key: 'custom.duplicate', source, expectedType: 'string' },
          ],
        },
      }),
    ).toThrow('duplicate audit issue identity')
  })
})
