import { describe, expect, test } from 'bun:test'
import {
  canonicalizeCompleteGameDocumentMarkdown,
  renderCompleteGameDocument,
  validateCompleteGameDocumentMarkdown,
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
    executiveSummary: `This document owns the ${contract.discipline} production authority, principal decisions, implementation outcome, and completion definition.`,
    sections: contract.sections.map((section, index) => ({
      sectionId: section.sectionId,
      title: section.title,
      body: `Authoritative section body ${index + 1} with stable authority IDs, production requirements, implementation detail, and observable outcomes.`,
    })),
    productionMaterials: contract.productionMaterials.map(material => ({
      materialId: material.materialId,
      title: material.title,
      format: material.format,
      body:
        material.format === 'markdown_table'
          ? '| Field | Production Value |\n| --- | --- |\n| Owner | Discipline authority |'
          : material.format === 'mermaid'
            ? '```mermaid\ngraph TD\n  A[Start] --> B[Complete]\n```'
            : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#20242b"/><text x="16" y="32" fill="#ffffff">Production board</text></svg>',
    })),
    auditAppendix: {
      acceptanceCriteria: ['Every canonical section and production material is complete and implementation-ready.'],
      upstreamReferences: contract.allowedUpstreamPaths.slice(0, 1).map(
        upstreamPath => ({
          path: upstreamPath,
          authorityId: `${contract.path}.authority.1`,
        }),
      ),
      risks: [],
      openDecisions: [],
    },
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

  test('requires the summary, exact production materials, and acceptance criteria', () => {
    const path = 'docs/ART_DIRECTION.md'
    const value = completeSubmission(path)
    expect(() =>
      validateCompleteGameDocumentSubmission(path, {
        ...value,
        executiveSummary: '',
      }),
    ).toThrow(/summary|small/i)
    expect(() =>
      validateCompleteGameDocumentSubmission(path, {
        ...value,
        productionMaterials: value.productionMaterials.slice(1),
      }),
    ).toThrow(/material|order/i)
    expect(() =>
      validateCompleteGameDocumentSubmission(path, {
        ...value,
        auditAppendix: { ...value.auditAppendix, acceptanceCriteria: [] },
      }),
    ).toThrow(/acceptance|small/i)
  })

  test('rejects upstream references outside projected authority', () => {
    const path = 'docs/UI_UX_SPEC.md'
    const value = completeSubmission(path)
    expect(() =>
      validateCompleteGameDocumentSubmission(path, {
        ...value,
        auditAppendix: {
          ...value.auditAppendix,
          upstreamReferences: [
            {
              path: 'docs/AUDIO_DESIGN.md',
              authorityId: 'untrusted.authority',
            },
          ],
        },
      }),
    ).toThrow(/upstream|authority/i)
  })

  test('renders summary, production materials, and one audit appendix', () => {
    const path = 'docs/UI_UX_SPEC.md'
    const rendered = renderCompleteGameDocument(path, completeSubmission(path))
    expect(rendered).toContain('<!-- beegame-executive-summary -->')
    expect(rendered).toContain('<!-- beegame-production-materials -->')
    expect(rendered).toContain('<!-- beegame-audit-appendix -->')
    expect(rendered.match(/### Acceptance Criteria/g)?.length).toBe(1)
    expect(rendered).not.toContain('### Authoritative Decisions')
    expect(rendered).not.toContain('### Production Details')
    for (const material of getGameDocumentContract(path).productionMaterials)
      expect(rendered).toContain(`<!-- beegame-material:${material.materialId} -->`)
  })

  test('rejects a production material with the wrong mechanical format', () => {
    const path = 'docs/TECHNICAL_DESIGN.md'
    const value = completeSubmission(path)
    const rendered = renderCompleteGameDocument(path, value).replace(
      '```mermaid\ngraph TD\n  A[Start] --> B[Complete]\n```',
      'This diagram was intentionally omitted.',
    )
    expect(() => validateCompleteGameDocumentMarkdown(path, rendered)).toThrow(/format|mermaid/i)
  })

  test('rejects exact empty-template sentences', () => {
    const path = 'docs/GDD.md'
    const rendered = renderCompleteGameDocument(path, completeSubmission(path)).replace(
      'Every canonical section and production material is complete and implementation-ready.',
      'No unresolved section decisions.',
    )
    expect(() => validateCompleteGameDocumentMarkdown(path, rendered)).toThrow(/template|empty/i)
  })

  test('replaces model-authored front matter with service-owned metadata', () => {
    const path = 'docs/GDD.md'
    const body = renderCompleteGameDocument(path, completeSubmission(path))
    const authored = `---\ndocument_id: WRONG\nversion: 99.0.0\nupdated_at: 2099-01-01T00:00:00.000Z\n---\n${body}`

    const canonical = canonicalizeCompleteGameDocumentMarkdown(path, authored, {
      version: '1.0.0',
      updatedAt: '2026-08-11T04:30:00.000Z',
    })

    expect(canonical.startsWith(
      '---\ndocument_id: GDD\nversion: 1.0.0\nupdated_at: 2026-08-11T04:30:00.000Z\n---\n',
    )).toBe(true)
    expect(canonical).not.toContain('2099-01-01')
    expect(canonical).not.toContain('document_id: WRONG')
  })

  test('rejects repeated substantive blocks across document sections', () => {
    const path = 'docs/GDD.md'
    const value = completeSubmission(path)
    const repeated = 'This production authority paragraph is deliberately long enough to represent a substantive authored block. It must be defined once and referenced elsewhere instead of being copied into another section.'
    value.sections[0]!.body = repeated
    value.sections[1]!.body = repeated

    expect(() =>
      validateCompleteGameDocumentMarkdown(
        path,
        renderCompleteGameDocument(path, value),
      ),
    ).toThrow('repeats a substantive content block')
  })
})
