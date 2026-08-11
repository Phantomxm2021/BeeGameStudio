import { describe, expect, test } from 'bun:test'
import {
  renderCompleteGameDocument,
  validateCompleteGameDocumentSubmission,
  type CompleteGameDocumentSubmission,
} from './complete-game-document'
import {
  getGameDocumentContract,
} from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'

function completeSubmission(
  path: FoundationDocumentPath,
): CompleteGameDocumentSubmission {
  const contract = getGameDocumentContract(path)
  return {
    title: contract.discipline,
    sections: contract.sections.map((section, index) => ({
      sectionId: section.sectionId,
      title: section.title,
      body: `Authoritative section body ${index + 1}.`,
      decisions: [
        {
          decisionId: `${section.sectionId}.decision.1`,
          statement: `Authoritative decision ${index + 1}.`,
          rationale: `Decision rationale ${index + 1}.`,
        },
      ],
      productionDetails: [
        {
          detailId: `${section.sectionId}.production.1`,
          statement: `Production detail ${index + 1}.`,
          owner: contract.discipline,
          acceptanceCriteria: [`Observable acceptance ${index + 1}.`],
        },
      ],
      upstreamReferences: contract.allowedUpstreamPaths.slice(0, 1).map(
        upstreamPath => ({
          path: upstreamPath,
          authorityId: `${section.sectionId}.authority.1`,
        }),
      ),
      risks: [],
      openDecisions: [],
    })),
  }
}

describe('complete game document submission', () => {
  test('accepts and deterministically renders every required section', () => {
    const path = 'docs/TECHNICAL_DESIGN.md'
    const parsed = validateCompleteGameDocumentSubmission(
      path,
      completeSubmission(path),
    )
    const first = renderCompleteGameDocument(path, parsed)
    const second = renderCompleteGameDocument(path, parsed)

    expect(first).toBe(second)
    for (const section of getGameDocumentContract(path).sections) {
      expect(first).toContain(`<!-- beegame-section:${section.sectionId} -->`)
      expect(first).toContain(`## ${section.title}`)
    }
  })

  test('rejects missing, duplicate, or out-of-order sections', () => {
    const path = 'docs/GDD.md'
    const value = completeSubmission(path)
    expect(() =>
      validateCompleteGameDocumentSubmission(path, {
        ...value,
        sections: value.sections.slice(1),
      }),
    ).toThrow(/section/i)
    expect(() =>
      validateCompleteGameDocumentSubmission(path, {
        ...value,
        sections: [value.sections[0]!, ...value.sections],
      }),
    ).toThrow(/section/i)
    expect(() =>
      validateCompleteGameDocumentSubmission(path, {
        ...value,
        sections: [...value.sections].reverse(),
      }),
    ).toThrow(/section|order/i)
  })

  test('rejects sections without decisions or production details', () => {
    const path = 'docs/ART_DIRECTION.md'
    const value = completeSubmission(path)
    expect(() =>
      validateCompleteGameDocumentSubmission(path, {
        ...value,
        sections: value.sections.map((section, index) =>
          index === 0 ? { ...section, decisions: [] } : section,
        ),
      }),
    ).toThrow(/decision/i)
    expect(() =>
      validateCompleteGameDocumentSubmission(path, {
        ...value,
        sections: value.sections.map((section, index) =>
          index === 0 ? { ...section, productionDetails: [] } : section,
        ),
      }),
    ).toThrow(/production/i)
  })

  test('rejects upstream references outside projected authority', () => {
    const path = 'docs/UI_UX_SPEC.md'
    const value = completeSubmission(path)
    expect(() =>
      validateCompleteGameDocumentSubmission(path, {
        ...value,
        sections: value.sections.map((section, index) =>
          index === 0
            ? {
                ...section,
                upstreamReferences: [
                  {
                    path: 'docs/AUDIO_DESIGN.md',
                    authorityId: 'untrusted.authority',
                  },
                ],
              }
            : section,
        ),
      }),
    ).toThrow(/upstream|authority/i)
  })
})
