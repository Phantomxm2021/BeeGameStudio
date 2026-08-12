import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  renderCompleteGameDocument,
  resolveUpstreamAuthorityReferences,
  validateCompleteGameDocumentMarkdown,
  validateCompleteGameDocumentSubmission,
  type CompleteGameDocumentSubmission,
} from './complete-game-document'
import {
  getGameDocumentContract,
} from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'
async function writeDocumentSource(
  workspacePath: string,
  path: FoundationDocumentPath,
): Promise<void> {
  const markdown = [
    `# ${path}`,
    ...getGameDocumentContract(path).sections.flatMap(section => [
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      `Document authority for ${section.sectionId}.`,
    ]),
  ].join('\n')
  await mkdir(join(workspacePath, 'docs'), { recursive: true })
  await writeFile(join(workspacePath, path), markdown)
}

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
    productionMaterials: contract.productionMaterials.map(material =>
      material.format === 'evidence_register'
        ? {
            materialId: material.materialId,
            title: material.title,
            format: material.format,
            entries: [
              {
                evidenceId: `${material.materialId}.pending`,
                category: 'search_direction' as const,
                displayName: 'Pending reference direction',
                purpose: 'Record a production need before source selection.',
                state: 'source_not_selected' as const,
                evidenceRefs: [],
              },
            ],
          }
        : {
            materialId: material.materialId,
            title: material.title,
            format: material.format,
            body:
              material.format === 'markdown_table'
                ? '| Field | Production Value |\n| --- | --- |\n| Owner | Discipline authority |'
                : material.format === 'mermaid'
                  ? '```mermaid\ngraph TD\n  A[Start] --> B[Complete]\n```'
                  : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#20242b"/><text x="16" y="32" fill="#ffffff">Production board</text></svg>',
          },
    ),
    auditAppendix: {
      acceptanceCriteria: ['Every canonical section and production material is complete and implementation-ready.'],
      upstreamReferences: contract.upstreamSections.slice(0, 1).map(
        source => ({
          path: source.path,
          sectionId: source.sectionIds[0]!,
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

  test('rejects section-owned H1/H2, skipped levels, and normalized duplicate headings', () => {
    const path = 'docs/GDD.md'
    const base = completeSubmission(path)
    for (const body of [
      '# Model title',
      '## Model section',
      '### Allowed\n##### Skipped',
    ])
      expect(() =>
        validateCompleteGameDocumentSubmission(path, {
          ...base,
          sections: base.sections.map((section, index) =>
            index === 0 ? { ...section, body } : section,
          ),
        }),
      ).toThrow(/heading|level/i)

    expect(() =>
      validateCompleteGameDocumentSubmission(path, {
        ...base,
        sections: base.sections.map((section, index) => ({
          ...section,
          body:
            index === 0
              ? '###  Production   Rule '
              : index === 1
                ? '#### production rule'
                : section.body,
        })),
      }),
    ).toThrow(/duplicate|heading/i)
  })

  test('renders one compact canonical table of contents', () => {
    const path = 'docs/GDD.md'
    const rendered = renderCompleteGameDocument(path, completeSubmission(path))
    expect(rendered.match(/## Table of Contents/g)).toHaveLength(1)
    expect(rendered).toContain('- [Executive Summary](#executive-summary)')
    for (const section of getGameDocumentContract(path).sections)
      expect(rendered).toContain(
        `- [${section.title}](#${section.title
          .toLowerCase()
          .replaceAll(/[^a-z0-9\s-]/g, '')
          .replaceAll(/\s+/g, '-')})`,
      )
  })

  test('keeps SVG production material inside the sole Markdown authority', () => {
    const path = 'docs/ART_DIRECTION.md'
    const submission = completeSubmission(path)
    const rendered = renderCompleteGameDocument(path, submission)

    expect(rendered).toContain('<svg')
    expect(rendered).not.toContain('docs/artifacts/')
    expect(rendered).not.toContain('artifacts/art-direction/')
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

  test('accepts a non-empty acceptance criteria matrix', () => {
    const path = 'docs/GDD.md'
    const authored = renderCompleteGameDocument(path, completeSubmission(path))
      .replace(
        '- Every canonical section and production material is complete and implementation-ready.',
        '| Acceptance ID | Condition | Evidence |\n| --- | --- | --- |\n| AC-01 | Core loop is complete | Playthrough log |',
      )

    expect(validateCompleteGameDocumentMarkdown(path, authored)).toBe(
      `${authored.trim()}\n`,
    )
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
              sectionId: 'untrusted_section',
            },
          ],
        },
      }),
    ).toThrow(/upstream|authority/i)
  })

  test('resolves exact upstream Markdown section references', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'upstream-authority-'))
    try {
      await writeDocumentSource(workspacePath, 'docs/GDD.md')
      const sectionId = 'core_loop'
      await expect(
        resolveUpstreamAuthorityReferences({
          workspacePath,
          targetPath: 'docs/UI_UX_SPEC.md',
          references: [{ path: 'docs/GDD.md', sectionId }],
        }),
      ).resolves.toEqual([{ path: 'docs/GDD.md', sectionId }])

      for (const invalidId of ['vision', 'not-present'])
        await expect(
          resolveUpstreamAuthorityReferences({
            workspacePath,
            targetPath: 'docs/UI_UX_SPEC.md',
            references: [{ path: 'docs/GDD.md', sectionId: invalidId }],
          }),
        ).rejects.toThrow(new RegExp(`${invalidId.replaceAll('.', '\\.')}`, 'i'))

      await expect(
        resolveUpstreamAuthorityReferences({
          workspacePath,
          targetPath: 'docs/UI_UX_SPEC.md',
          references: [
            { path: 'docs/GDD.md', sectionId },
            { path: 'docs/GDD.md', sectionId },
          ],
        }),
      ).rejects.toThrow(/duplicate/i)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects an upstream reference when its Markdown section is missing', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'upstream-authority-'))
    try {
      await writeDocumentSource(workspacePath, 'docs/GDD.md')
      await writeFile(
        join(workspacePath, 'docs/GDD.md'),
        '# Changed source\n\nThe required section is absent.\n',
      )
      await expect(
        resolveUpstreamAuthorityReferences({
          workspacePath,
          targetPath: 'docs/UI_UX_SPEC.md',
          references: [
            {
              path: 'docs/GDD.md',
              sectionId: 'core_loop',
            },
          ],
        }),
      ).rejects.toThrow(/section.*does not exist/i)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
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

  test('renders upstream authority in canonical bytewise order', () => {
    const path = 'docs/UI_UX_SPEC.md'
    const value = completeSubmission(path)
    const rendered = renderCompleteGameDocument(path, {
      ...value,
      auditAppendix: {
        ...value.auditAppendix,
        upstreamReferences: [
          {
            path: 'docs/LEVEL_SCENE_DESIGN.md',
            sectionId: 'camera_readability',
          },
          {
            path: 'docs/GDD.md',
            sectionId: 'core_loop',
          },
        ],
      },
    })

    expect(rendered).toContain('- `docs/GDD.md` — section `core_loop`')
    expect(rendered.indexOf('`docs/GDD.md`')).toBeLessThan(
      rendered.indexOf('`docs/LEVEL_SCENE_DESIGN.md`'),
    )
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

  test('renders evidence registers from structured unverified entries', () => {
    const path = 'docs/ASSET_PLAN.md'
    const value = completeSubmission(path)
    const structured = {
      ...value,
      productionMaterials: value.productionMaterials.map(material =>
        material.materialId === 'license-register'
          ? {
              materialId: material.materialId,
              title: material.title,
              format: 'evidence_register',
              entries: [
                {
                  evidenceId: 'asset.source.pending',
                  category: 'production_asset',
                  displayName: 'Pending production source',
                  purpose: 'Record the intended production need before selection.',
                  state: 'source_not_selected',
                  evidenceRefs: [],
                },
              ],
            }
          : material,
      ),
    }

    const rendered = renderCompleteGameDocument(
      path,
      validateCompleteGameDocumentSubmission(path, structured),
    )
    expect(rendered).toContain('source not selected')
    expect(rendered).not.toContain('commercial use verified')
  })

  test('wraps raw Mermaid source with canonical fences', () => {
    const path = 'docs/UI_UX_SPEC.md'
    const value = completeSubmission(path)
    const raw = {
      ...value,
      productionMaterials: value.productionMaterials.map(material =>
        material.format === 'mermaid'
          ? { ...material, body: 'graph TD\n  A --> B' }
          : material,
      ),
    }
    const rendered = renderCompleteGameDocument(
      path,
      validateCompleteGameDocumentSubmission(path, raw),
    )

    expect(rendered).toContain('```mermaid\ngraph TD\n  A --> B\n```')
  })

  test('rejects exact empty-template sentences', () => {
    const path = 'docs/GDD.md'
    const rendered = renderCompleteGameDocument(path, completeSubmission(path)).replace(
      'Every canonical section and production material is complete and implementation-ready.',
      'No unresolved section decisions.',
    )
    expect(() => validateCompleteGameDocumentMarkdown(path, rendered)).toThrow(/template|empty/i)
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
