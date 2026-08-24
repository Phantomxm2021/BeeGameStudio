import { describe, expect, test } from 'bun:test'
import { runDeterministicFoundationAudit } from './foundation-audit-check-definitions'
import type { FoundationFact } from './foundation-fact-store'
import type { SectionRef } from './foundation-section-index'
import { getGameDocumentContract } from './game-document-contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

const ref = (documentPath: string, sectionId: string): SectionRef => ({
  documentPath: documentPath as SectionRef['documentPath'],
  sectionId,
  heading: sectionId,
  startLine: 1,
  endLine: 2,
  digest: 'c'.repeat(64),
})
const fact = (
  key: string,
  value: FoundationFact['value'],
  source: SectionRef,
): FoundationFact => ({ key, value, source })

function completeFoundationFixture(overrides: readonly FoundationFact[] = []) {
  const sectionIndex = CANONICAL_FOUNDATION_DOCUMENTS.flatMap(path =>
    getGameDocumentContract(path).sections.map(section =>
      ref(path, section.sectionId),
    ),
  )
  const facts = sectionIndex.map(section => {
    const documentId = section.documentPath.slice(
      section.documentPath.lastIndexOf('/') + 1,
      -3,
    )
    return fact(`${documentId}.${section.sectionId}`, 'stable', section)
  })
  return {
    sectionIndex,
    factStore: facts.map(
      candidate =>
        overrides.find(item => item.key === candidate.key) ?? candidate,
    ),
  }
}

describe('mandatory immutable foundation contracts', () => {
  test('rejects a reverse or unrelated caller binding instead of skipping it', () => {
    const gdd = ref('docs/GDD.md', 'core_loop')
    const level = ref('docs/LEVEL_SCENE_DESIGN.md', 'world_structure')
    const fixture = completeFoundationFixture()
    expect(() =>
      runDeterministicFoundationAudit({
        sectionIndex: fixture.sectionIndex,
        factStore: fixture.factStore,
        contractBindings: [
          {
            id: 'reverse',
            sourceFactKey: 'GDD.core_loop',
            targetFactKey: 'LEVEL_SCENE_DESIGN.world_structure',
            relation: 'exists',
            source: gdd,
            target: level,
          },
        ],
      }),
    ).toThrow('immutable contract graph')
  })

  test('does not allow callers to disable immutable graph checks', () => {
    const fixture = completeFoundationFixture()
    expect(() =>
      runDeterministicFoundationAudit({
        sectionIndex: fixture.sectionIndex,
        factStore: fixture.factStore,
        disableContracts: true,
      } as never),
    ).toThrow('unknown')
  })

  test('reports an allowed cross-document contract mismatch with exact fact locations', () => {
    const level = ref('docs/LEVEL_SCENE_DESIGN.md', 'world_structure')
    const gdd = ref('docs/GDD.md', 'core_loop')
    const fixture = completeFoundationFixture([
      fact('LEVEL_SCENE_DESIGN.world_structure', 'world-a', level),
      fact('GDD.core_loop', 'world-b', gdd),
    ])
    const issues = runDeterministicFoundationAudit({
      sectionIndex: fixture.sectionIndex,
      factStore: fixture.factStore,
      contractBindings: [
        {
          id: 'level-to-gdd-loop',
          sourceFactKey: 'LEVEL_SCENE_DESIGN.world_structure',
          targetFactKey: 'GDD.core_loop',
          relation: 'equal',
          source: level,
          target: gdd,
        },
      ],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      source: level,
      target: gdd,
      fixDocument: gdd.documentPath,
      fixSectionId: gdd.sectionId,
    })
  })

  test('always checks immutable upstream graph edges when a referenced section is absent', () => {
    const fixture = completeFoundationFixture()
    const sectionIndex = fixture.sectionIndex.filter(
      section =>
        !(
          section.documentPath === 'docs/GDD.md' &&
          section.sectionId === 'core_loop'
        ),
    )
    const factStore = fixture.factStore.filter(
      factValue => factValue.key !== 'GDD.core_loop',
    )
    expect(() =>
      runDeterministicFoundationAudit({ sectionIndex, factStore }),
    ).toThrow('does not provide exact local source section')
  })
})
