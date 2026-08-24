import { describe, expect, test } from 'bun:test'
import {
  runDeterministicFoundationAudit,
  type DeterministicFoundationAuditInput,
} from './foundation-audit-check-definitions'
import type { FoundationFact } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'

const ref = (
  documentPath: string,
  sectionId: string,
  line = 1,
): SectionRef => ({
  documentPath: documentPath as SectionRef['documentPath'],
  sectionId,
  heading: sectionId,
  startLine: line,
  endLine: line + 1,
  digest: 'a'.repeat(64),
})

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

describe('deterministic foundation audit compiler', () => {
  test('reports a missing required fact at its declared exact section', () => {
    const source = ref('docs/custom.md', 'settings')
    const issues = runDeterministicFoundationAudit({
      sectionIndex: [source],
      factStore: [],
      schema: {
        requiredFacts: [
          { key: 'custom.settings', source, expectedType: 'string' },
        ],
      },
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      type: 'schema',
      fixDocument: source.documentPath,
      fixSectionId: source.sectionId,
    })
  })

  test('reports a wrong fact type and accepts no worker or dispatch port', () => {
    const source = ref('docs/custom.md', 'settings')
    const issues = runDeterministicFoundationAudit({
      sectionIndex: [source],
      factStore: [fact('custom.settings', 42, source)],
      schema: {
        factTypes: [{ key: 'custom.settings', source, expectedType: 'string' }],
      },
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      type: 'schema',
      actual: 'fact custom.settings has type number',
    })
  })

  test('returns zero issues for a validated passing input', () => {
    const source = ref('docs/custom.md', 'settings')
    expect(
      runDeterministicFoundationAudit({
        sectionIndex: [source],
        factStore: [fact('custom.settings', 'ok', source)],
      }),
    ).toEqual([])
  })

  test('rejects missing section indexes and malformed nested input before checking', () => {
    expect(() =>
      runDeterministicFoundationAudit({
        factStore: [],
      } as unknown as DeterministicFoundationAuditInput),
    ).toThrow('section index')
    const malformed = { ...ref('docs/custom.md', 'settings'), startLine: 0 }
    expect(() =>
      runDeterministicFoundationAudit({
        sectionIndex: [malformed],
        factStore: [],
      }),
    ).toThrow('SectionRef')
  })

  test('rejects duplicate facts and a fact source that is not the indexed SectionRef', () => {
    const source = ref('docs/custom.md', 'settings')
    expect(() =>
      runDeterministicFoundationAudit({
        sectionIndex: [source],
        factStore: [
          fact('custom.settings', 'first', source),
          fact('custom.settings', 'second', source),
        ],
      }),
    ).toThrow('duplicate fact key')
    expect(() =>
      runDeterministicFoundationAudit({
        sectionIndex: [source],
        factStore: [
          fact('custom.settings', 'wrong', { ...source, heading: 'Other' }),
        ],
      }),
    ).toThrow('fact source')
  })

  test('does not expose helper check or registry bypass functions', async () => {
    expect(Object.keys(await import('./foundation-audit-rules'))).toEqual([
      'collectRuleDrafts',
    ])
    expect(Object.keys(await import('./foundation-audit-contracts')).sort()).toEqual([
      'collectContractDrafts',
    ])
    expect(Object.keys(await import('./foundation-issue-registry'))).toEqual([])
  })
})
