import { describe, expect, test } from 'bun:test'
import type { FoundationFact } from './foundation-fact-store'
import {
  FOUNDATION_AUDIT_CHECK_DEFINITIONS,
  runFoundationAuditChecks,
  type FoundationAuditCheckInput,
} from './foundation-audit-check-definitions'
import type { SectionRef } from './foundation-section-index'

const ref = (
  documentPath: SectionRef['documentPath'],
  sectionId: string,
): SectionRef => ({
  documentPath,
  sectionId,
  heading: sectionId,
  startLine: 1,
  endLine: 2,
  digest: 'a'.repeat(64),
})

const fact = (
  source: SectionRef,
  key: string,
  value: FoundationFact['value'],
): FoundationFact => ({
  key,
  value,
  source,
})

describe('foundation audit check definitions', () => {
  test('exposes explicit stable check identities', () => {
    expect(
      FOUNDATION_AUDIT_CHECK_DEFINITIONS.map(definition => definition.id),
    ).toEqual([
      'schema.required-section-facts',
      'schema.fact-types',
      'rule.numeric-consistency',
      'rule.referenced-entities',
      'contract.upstream-sections',
    ])
  })

  test('runs all deterministic checks without a worker or dispatch port', () => {
    const source = ref(
      'docs/custom.md' as SectionRef['documentPath'],
      'settings',
    )
    const input: FoundationAuditCheckInput = {
      sectionIndex: [source],
      factStore: [fact(source, 'custom.settings', 'ok')],
      schema: {
        requiredFacts: [
          { key: 'custom.missing', source, expectedType: 'string' },
        ],
      },
    }

    const issues = runFoundationAuditChecks(input)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      type: 'schema',
      severity: 'BLOCKER',
      fixDocument: source.documentPath,
      fixSectionId: source.sectionId,
    })
  })

  test('reports a wrong fact type against an explicit schema definition', () => {
    const source = ref(
      'docs/custom.md' as SectionRef['documentPath'],
      'settings',
    )
    const issues = runFoundationAuditChecks({
      sectionIndex: [source],
      factStore: [fact(source, 'custom.settings', 42)],
      schema: {
        factTypes: [{ key: 'custom.settings', source, expectedType: 'string' }],
      },
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      type: 'schema',
      severity: 'BLOCKER',
      actual: 'fact custom.settings has type number',
    })
  })
})
