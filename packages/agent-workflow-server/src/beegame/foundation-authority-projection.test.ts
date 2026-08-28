import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './delivery-workflow/types'
import {
  canonicalFoundationAuthorityProjectionBytes,
  modelFoundationAuthorityProjectionBytes,
  parseFoundationAuthorityProjectionBytes,
  projectFoundationAuthority,
} from './foundation-authority-projection'

function sourceDocument(path: FoundationDocumentPath): string {
  const contract = getGameDocumentContract(path)
  return [
    `# ${contract.discipline}`,
    '',
    ...contract.sections.flatMap(section => [
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      `Owned source content for ${section.sectionId}.`,
      '',
    ]),
    '<!-- beegame-production-materials -->',
    '## Production Materials',
    'Source materials are intentionally outside the authority projection.',
  ].join('\n')
}

function sources(paths: readonly FoundationDocumentPath[]) {
  const documents = new Map<FoundationDocumentPath, string>()
  for (const path of paths) {
    const markdown = sourceDocument(path)
    documents.set(path, markdown)
  }
  return { documents }
}

describe('foundation authority projection', () => {
  test('keeps every downstream projection equal to its declared selector matrix', () => {
    for (const targetPath of CANONICAL_FOUNDATION_DOCUMENTS.slice(1)) {
      const contract = getGameDocumentContract(targetPath)
      const input = sources(contract.upstreamSections.map(source => source.path))
      const result = projectFoundationAuthority({
        targetPath,
        availableUpstreamPaths: contract.upstreamSections.map(source => source.path),
        ...input,
      })
      const declared = contract.upstreamSections.flatMap(source =>
        source.sectionIds.map(sectionId => `${source.path}#${sectionId}`),
      )
      const projected = result.sources.flatMap(source =>
        source.sections.map(section => `${source.path}#${section.sectionId}`),
      )

      expect(projected).toEqual(declared)
      expect(result.rangeCount).toBe(declared.length)
      expect(result.projectedLineCount).toBe(
        result.sources.reduce(
          (total, source) =>
            total + source.sections.reduce((sum, section) => sum + section.lineCount, 0),
          0,
        ),
      )
      const serialized = canonicalFoundationAuthorityProjectionBytes(result)
      expect(serialized).toContain('Owned source content for')
      expect(serialized).not.toContain('Source materials are intentionally')
    }
  })

  test('projects only contracted Markdown section content in source order', () => {
    const targetPath = 'docs/UI_UX_SPEC.md'
    const input = sources(['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'])
    const result = projectFoundationAuthority({
      targetPath,
      availableUpstreamPaths: ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
      ...input,
    })
    const selectedSections = new Set(
      getGameDocumentContract(targetPath).upstreamSections.flatMap(source =>
        source.sectionIds.map(sectionId => `${source.path}#${sectionId}`),
      ),
    )

    expect(result.targetPath).toBe(targetPath)
    expect(result.targetSectionIds).toEqual(
      getGameDocumentContract(targetPath).sections.map(
        section => section.sectionId,
      ),
    )
    expect(
      result.sources.map(source => ({
        path: source.path,
        sections: source.sections.map(section => ({
          sectionId: section.sectionId,
          startLine: section.startLine,
          lineCount: section.lineCount,
        })),
      })),
    ).toEqual(
      getGameDocumentContract(targetPath).upstreamSections.map(source => ({
        path: source.path,
        sections: source.sectionIds.map(sectionId => {
          const sourceIndex = getGameDocumentContract(
            source.path,
          ).sections.findIndex(section => section.sectionId === sectionId)
          return {
            sectionId,
            startLine: 3 + sourceIndex * 4,
            lineCount: 4,
          }
        }),
      })),
    )
    expect(result.sources.every(source => /^[a-f0-9]{64}$/.test(source.digest)))
      .toBe(true)
    expect(
      result.sources.flatMap(source =>
        source.sections.map(section => `${source.path}#${section.sectionId}`),
      ),
    ).toEqual(
      [...selectedSections],
    )
    expect(
      result.sources.every(source =>
        source.sections.every(section =>
          selectedSections.has(`${source.path}#${section.sectionId}`),
        ),
      ),
    ).toBe(true)
    expect(result.byteLength).toBe(
      new TextEncoder().encode(
        canonicalFoundationAuthorityProjectionBytes(result),
      ).byteLength,
    )
    const serialized = canonicalFoundationAuthorityProjectionBytes(result)
    expect(serialized).toContain('Owned source content for')
    expect(serialized).not.toContain('Source materials are intentionally')
    for (const source of result.sources) {
      const sourceMarkdown = input.documents.get(source.path)!
      for (const selected of source.sections) {
        const exactSourceRange = sourceMarkdown
          .split('\n')
          .slice(
            selected.startLine - 1,
            selected.startLine - 1 + selected.lineCount,
          )
          .join('\n')
        expect(selected.content).toBe(exactSourceRange)
        expect(selected.digest).toBe(
          createHash('sha256').update(exactSourceRange).digest('hex'),
        )
        expect(selected.content).toContain(
          `<!-- beegame-section:${selected.sectionId} -->`,
        )
      }
    }
    expect(serialized).toContain('"content":')
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.sources.every(Object.isFrozen)).toBe(true)
    expect(result.sources.every(source => Object.isFrozen(source.sections))).toBe(true)
    expect(
      result.sources.every(source => source.sections.every(Object.isFrozen)),
    ).toBe(true)
  })

  test('rejects missing documents or missing contracted sections', () => {
    const targetPath = 'docs/LEVEL_SCENE_DESIGN.md'
    const input = sources(['docs/GDD.md'])
    expect(() =>
      projectFoundationAuthority({
        targetPath,
        availableUpstreamPaths: ['docs/GDD.md'],
        documents: new Map(),
      }),
    ).toThrow(/document.*missing/i)

    const incompleteDocuments = new Map(input.documents)
    const missingSectionId = getGameDocumentContract(targetPath)
      .upstreamSections[0]!.sectionIds[0]!
    incompleteDocuments.set(
      'docs/GDD.md',
      incompleteDocuments.get('docs/GDD.md')!.replace(
        `<!-- beegame-section:${missingSectionId} -->`,
        '<!-- removed-section -->',
      ),
    )
    expect(() =>
      projectFoundationAuthority({
        targetPath,
        availableUpstreamPaths: ['docs/GDD.md'],
        documents: incompleteDocuments,
      }),
    ).toThrow(/section.*missing/i)
  })

  test('projects only currently available contracted authority for an early draft', () => {
    const targetPath = 'docs/BALANCE_DESIGN.md'
    const input = sources(['docs/GDD.md'])
    const result = projectFoundationAuthority({
      targetPath,
      availableUpstreamPaths: ['docs/GDD.md'],
      ...input,
    })

    expect(result.sources.map(source => source.path)).toEqual(['docs/GDD.md'])
    expect(() =>
      projectFoundationAuthority({
        targetPath,
        availableUpstreamPaths: ['docs/UI_UX_SPEC.md'],
        ...input,
      }),
    ).toThrow(/available upstream authority.*contract/i)
  })

  test('projects exact upstream authority for the active target section', () => {
    const targetPath = 'docs/TECHNICAL_DESIGN.md'
    const input = sources([
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/BALANCE_DESIGN.md',
    ])
    const result = projectFoundationAuthority({
      targetPath,
      targetSectionIds: ['runtime_state'],
      availableUpstreamPaths: [
        'docs/GDD.md',
        'docs/LEVEL_SCENE_DESIGN.md',
        'docs/BALANCE_DESIGN.md',
      ],
      ...input,
    })
    const projectedIds = result.sources.flatMap(source =>
      source.sections.map(section => `${source.path}#${section.sectionId}`),
    )

    expect(result.targetSectionIds).toEqual(['runtime_state'])
    expect(projectedIds).toContain('docs/GDD.md#states_flow')
    expect(projectedIds).toContain('docs/LEVEL_SCENE_DESIGN.md#scene_states')
    expect(projectedIds).toContain('docs/GDD.md#player_actions')
    expect(projectedIds).toContain('docs/BALANCE_DESIGN.md#formulas')
    expect(
      result.sources.every(source =>
        source.sections.every(section =>
          section.content.includes(`Owned source content for ${section.sectionId}.`),
        ),
      ),
    ).toBe(true)
  })

  test('keeps transport verification metadata out of the model-facing projection', () => {
    const result = projectFoundationAuthority({
      targetPath: 'docs/UI_UX_SPEC.md',
      availableUpstreamPaths: ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
      ...sources(['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md']),
    })
    const modelBytes = modelFoundationAuthorityProjectionBytes(result)
    const model = JSON.parse(modelBytes) as Record<string, unknown>

    expect(model.targetPath).toBe('docs/UI_UX_SPEC.md')
    expect(model).not.toHaveProperty('byteLength')
    expect(model).not.toHaveProperty('rangeCount')
    expect(model).not.toHaveProperty('projectedLineCount')
    expect(model).not.toHaveProperty('symbols')
    for (const source of model.sources as Array<Record<string, unknown>>) {
      expect(source).not.toHaveProperty('digest')
      for (const section of source.sections as Array<Record<string, unknown>>) {
        expect(section).toHaveProperty('sectionId')
        expect(section).toHaveProperty('content')
        expect(section).not.toHaveProperty('startLine')
        expect(section).not.toHaveProperty('lineCount')
        expect(section).not.toHaveProperty('digest')
      }
    }
    expect(modelBytes).toContain('Owned source content for')
  })

  test('treats a missing available upstream selection as no available authority', () => {
    const result = projectFoundationAuthority({
      targetPath: 'docs/BALANCE_DESIGN.md',
      ...sources(['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md']),
    })

    expect(result.sources).toEqual([])
  })

  test('rejects the removed semantic symbols projection track', () => {
    const result = projectFoundationAuthority({
      targetPath: 'docs/LEVEL_SCENE_DESIGN.md',
      availableUpstreamPaths: ['docs/GDD.md'],
      ...sources(['docs/GDD.md']),
    })
    const obsolete = {
      ...JSON.parse(canonicalFoundationAuthorityProjectionBytes(result)),
      symbols: [],
    }

    expect(() => parseFoundationAuthorityProjectionBytes(
      `${JSON.stringify(obsolete, null, 2)}\n`,
    )).toThrow()
  })

})
