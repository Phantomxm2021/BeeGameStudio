import { describe, expect, test } from 'bun:test'
import { runFoundationContractChecks } from './foundation-audit-contracts'
import type { FoundationFact } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'

const source = (
  documentPath: SectionRef['documentPath'],
  sectionId: string,
): SectionRef => ({
  documentPath,
  sectionId,
  heading: sectionId,
  startLine: 1,
  endLine: 2,
  digest: 'b'.repeat(64),
})

describe('foundation audit contracts', () => {
  test('reports a cross-document contract when its target section is absent', () => {
    const gdd = source('docs/GDD.md', 'core_loop')
    const technical = source('docs/TECHNICAL_DESIGN.md', 'architecture')
    const issues = runFoundationContractChecks({
      sectionIndex: [gdd, technical],
      factStore: [
        { key: 'GDD.core_loop', value: 'loop', source: gdd },
        {
          key: 'TECHNICAL_DESIGN.architecture',
          value: 'architecture',
          source: technical,
        },
      ] satisfies FoundationFact[],
      contractBindings: [
        {
          id: 'gdd-loop-to-technical-architecture',
          sourceFactKey: 'GDD.core_loop',
          targetFactKey: 'TECHNICAL_DESIGN.runtime_state',
          relation: 'exists',
          targetDocumentPath: 'docs/TECHNICAL_DESIGN.md',
          targetSectionId: 'architecture',
        },
      ],
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      type: 'contract',
      severity: 'HIGH',
      source: gdd,
      target: technical,
      fixDocument: technical.documentPath,
      fixSectionId: technical.sectionId,
    })
  })
})
