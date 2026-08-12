import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertOpenDecisionClosure,
  canonicalizeCompleteGameDocumentMarkdown,
  renderCompleteGameDocument,
  prepareCompleteGameDocumentArtifacts,
  resolveUpstreamAuthorityReferences,
  validateCompleteGameDocumentMarkdown,
  validateCompleteGameDocumentSubmission,
  type CompleteGameDocumentSubmission,
} from './complete-game-document'
import {
  getGameDocumentContract,
} from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'
import {
  authoritySidecarPath,
  canonicalFoundationAuthoritySidecarBytes,
  createFoundationAuthoritySidecar,
} from './foundation-authority-sidecar'

function bytewise(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function authorityRecords(path: FoundationDocumentPath) {
  const documentId = path.slice('docs/'.length, -'.md'.length).toLowerCase()
  return getGameDocumentContract(path).sections
    .map(section => ({
      authorityId: `${documentId}.${section.sectionId}.primary`,
      sectionId: section.sectionId,
      kind: 'fact' as const,
      state: 'confirmed' as const,
      source: 'confirmed_brief' as const,
      evidenceRefs: [],
      statement: `Confirmed authority for ${section.sectionId}.`,
      responsibilityIds: [...section.responsibilityIds].sort(bytewise),
    }))
    .sort((left, right) => bytewise(left.authorityId, right.authorityId))
}

async function writeAuthoritySource(
  workspacePath: string,
  path: FoundationDocumentPath,
): Promise<ReturnType<typeof createFoundationAuthoritySidecar>> {
  const markdown = `# ${path}\n\nDigest-bound authority source.\n`
  await mkdir(join(workspacePath, 'docs'), { recursive: true })
  await writeFile(join(workspacePath, path), markdown)
  const sidecar = createFoundationAuthoritySidecar({
    documentPath: path,
    markdown,
    submission: { records: authorityRecords(path) },
  })
  await writeFile(
    join(workspacePath, authoritySidecarPath(path)),
    canonicalFoundationAuthoritySidecarBytes(sidecar),
  )
  return sidecar
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

  test('externalizes inline SVG materials into deterministic artifact descriptors', () => {
    const path = 'docs/ART_DIRECTION.md'
    const submission = completeSubmission(path)
    const artifacts = prepareCompleteGameDocumentArtifacts(path, submission)
    const rendered = renderCompleteGameDocument(path, submission)

    expect(artifacts).toHaveLength(3)
    expect(artifacts[0]).toMatchObject({
      artifactId: 'visual-pillar-board',
      mediaType: 'image/svg+xml',
      path: 'docs/artifacts/art-direction/visual-pillar-board.svg',
    })
    expect(artifacts[0]!.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(rendered).not.toContain('<svg')
    expect(rendered).toContain(
      '![Palette Board](artifacts/art-direction/palette-board.svg)',
    )
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
              authorityId: 'untrusted.authority',
            },
          ],
        },
      }),
    ).toThrow(/upstream|authority/i)
  })

  test('resolves exact upstream authority IDs from digest-valid sidecars', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'upstream-authority-'))
    try {
      const sidecar = await writeAuthoritySource(workspacePath, 'docs/GDD.md')
      const authorityId = sidecar.records.find(
        record => record.sectionId === 'core_loop',
      )!.authorityId
      await expect(
        resolveUpstreamAuthorityReferences({
          workspacePath,
          targetPath: 'docs/UI_UX_SPEC.md',
          references: [{ path: 'docs/GDD.md', authorityId }],
        }),
      ).resolves.toEqual([{ path: 'docs/GDD.md', authorityId }])

      for (const invalidId of [
        'core_loop.primary',
        'gdd.core_loop',
        'gdd.core-loop.primary',
        'gdd.core_loop.not-present',
      ])
        await expect(
          resolveUpstreamAuthorityReferences({
            workspacePath,
            targetPath: 'docs/UI_UX_SPEC.md',
            references: [{ path: 'docs/GDD.md', authorityId: invalidId }],
          }),
        ).rejects.toThrow(new RegExp(`${invalidId.replaceAll('.', '\\.')}`, 'i'))

      await expect(
        resolveUpstreamAuthorityReferences({
          workspacePath,
          targetPath: 'docs/UI_UX_SPEC.md',
          references: [
            { path: 'docs/GDD.md', authorityId },
            { path: 'docs/GDD.md', authorityId },
          ],
        }),
      ).rejects.toThrow(/duplicate/i)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects upstream authority when the source document changed after its sidecar', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'upstream-authority-'))
    try {
      const sidecar = await writeAuthoritySource(workspacePath, 'docs/GDD.md')
      await writeFile(
        join(workspacePath, 'docs/GDD.md'),
        '# Changed source\n\nThe sidecar is now stale.\n',
      )
      await expect(
        resolveUpstreamAuthorityReferences({
          workspacePath,
          targetPath: 'docs/UI_UX_SPEC.md',
          references: [
            {
              path: 'docs/GDD.md',
              authorityId: sidecar.records[0]!.authorityId,
            },
          ],
        }),
      ).rejects.toThrow(/digest|stale/i)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('requires exact audit and authority open-decision closure', () => {
    const path = 'docs/GDD.md'
    const markdown = '# GDD\n\nDecision authority.\n'
    const records = authorityRecords(path)
    const decisionId = 'gdd.scope_risks.platform-target'
    const sidecar = createFoundationAuthoritySidecar({
      documentPath: path,
      markdown,
      submission: {
        records: records.map(record =>
          record.sectionId === 'scope_risks'
            ? {
                ...record,
                authorityId: decisionId,
                kind: 'open_decision' as const,
                state: 'deferred' as const,
                decision: {
                  owner: 'product',
                  neededBy: 'milestone.prototype',
                },
              }
            : record,
        ),
      },
    })
    const audit = {
      acceptanceCriteria: ['All contracted authority is inspectable.'],
      upstreamReferences: [],
      risks: [],
      openDecisions: [
        {
          decisionId,
          question: 'Which platform target is authoritative?',
          owner: 'product',
          neededBy: 'milestone.prototype',
        },
      ],
    }

    expect(() =>
      assertOpenDecisionClosure({
        audit,
        authority: sidecar,
        trustedScheduleAuthorityIds: new Set(),
      }),
    ).not.toThrow()
    expect(() =>
      assertOpenDecisionClosure({
        audit: { ...audit, openDecisions: [] },
        authority: sidecar,
        trustedScheduleAuthorityIds: new Set(),
      }),
    ).toThrow(/closure|missing|decision/i)
    expect(() =>
      assertOpenDecisionClosure({
        audit: {
          ...audit,
          openDecisions: [{ ...audit.openDecisions[0]!, owner: 'engineering' }],
        },
        authority: sidecar,
        trustedScheduleAuthorityIds: new Set(),
      }),
    ).toThrow(/owner|match/i)
    expect(() =>
      assertOpenDecisionClosure({
        audit: {
          ...audit,
          openDecisions: [
            { ...audit.openDecisions[0]!, neededBy: '2026-12-01' },
          ],
        },
        authority: sidecar,
        trustedScheduleAuthorityIds: new Set(),
      }),
    ).toThrow(/date|schedule|needed/i)
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
            authorityId: 'level_scene_design.camera_readability.primary',
          },
          {
            path: 'docs/GDD.md',
            authorityId: 'gdd.core_loop.primary',
          },
        ],
      },
    })

    expect(rendered).toContain('- `docs/GDD.md` — `gdd.core_loop.primary`')
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

  test('normalizes localized service-owned document layer headings', () => {
    const path = 'docs/GDD.md'
    const authored = renderCompleteGameDocument(path, completeSubmission(path))
      .replace('## Executive Summary', '\n## 摘要')
      .replace('## Production Materials', '\n## 生产资料')
      .replace('## Audit Appendix', '\n## 审计附录')

    const canonical = canonicalizeCompleteGameDocumentMarkdown(path, authored, {
      version: '1.0.0',
      updatedAt: '2026-08-11T04:30:00.000Z',
    })

    expect(canonical).toContain(
      '<!-- beegame-executive-summary -->\n## Executive Summary',
    )
    expect(canonical).toContain(
      '<!-- beegame-production-materials -->\n## Production Materials',
    )
    expect(canonical).toContain(
      '<!-- beegame-audit-appendix -->\n## Audit Appendix',
    )
  })

  test('normalizes blank lines between contract markers and exact headings', () => {
    const path = 'docs/GDD.md'
    const contract = getGameDocumentContract(path)
    let authored = renderCompleteGameDocument(path, completeSubmission(path))
    for (const section of contract.sections) {
      authored = authored.replace(
        `<!-- beegame-section:${section.sectionId} -->\n## ${section.title}`,
        `<!-- beegame-section:${section.sectionId} -->\n\n## ${section.title}`,
      )
    }
    for (const material of contract.productionMaterials) {
      authored = authored.replace(
        `<!-- beegame-material:${material.materialId} -->\n### ${material.title}`,
        `<!-- beegame-material:${material.materialId} -->\n\n### ${material.title}`,
      )
    }

    expect(() => canonicalizeCompleteGameDocumentMarkdown(path, authored, {
      version: '1.0.0',
      updatedAt: '2026-08-11T04:30:00.000Z',
    })).not.toThrow()
  })

  test('normalizes whitespace in known service-owned section and material markers', () => {
    const path = 'docs/GDD.md'
    const authored = renderCompleteGameDocument(path, completeSubmission(path))
      .replace(
        '<!-- beegame-section:vision -->',
        '<!-- beegame-section: vision -->',
      )
      .replace(
        '<!-- beegame-material:core-loop-diagram -->',
        '<!-- beegame-material: core-loop-diagram -->',
      )

    const canonical = canonicalizeCompleteGameDocumentMarkdown(path, authored, {
      version: '1.0.0',
      updatedAt: '2026-08-11T04:30:00.000Z',
    })
    expect(canonical).toContain('<!-- beegame-section:vision -->')
    expect(canonical).toContain(
      '<!-- beegame-material:core-loop-diagram -->',
    )
    expect(canonical).not.toContain('<!-- beegame-section: vision -->')
    expect(canonical).not.toContain(
      '<!-- beegame-material: core-loop-diagram -->',
    )

    expect(() =>
      canonicalizeCompleteGameDocumentMarkdown(
        path,
        authored.replace(
          '<!-- beegame-section: vision -->',
          '<!-- beegame-section:not-contracted -->',
        ),
        {
          version: '1.0.0',
          updatedAt: '2026-08-11T04:30:00.000Z',
        },
      ),
    ).toThrow(/section|order/i)
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
