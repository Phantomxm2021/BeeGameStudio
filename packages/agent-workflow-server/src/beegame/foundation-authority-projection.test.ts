import { describe, expect, test } from 'bun:test'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'
import {
  canonicalFoundationAuthorityProjectionBytes,
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
  test('projects only contracted Markdown section content in source order', () => {
    const targetPath = 'docs/UI_UX_SPEC.md'
    const input = sources(['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'])
    const result = projectFoundationAuthority({ targetPath, ...input })
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
    expect(serialized).not.toContain('Owned source content for')
    expect(serialized).not.toContain('Source materials are intentionally')
    expect(result.sources[0]?.sections[0]).not.toHaveProperty('content')
    expect(result.sources[0]?.sections[0]).not.toHaveProperty('contentLines')
    expect(serialized).not.toContain('"content":')
    expect(Buffer.byteLength(serialized)).toBeLessThan(8 * 1024)
    expect(
      Math.max(...serialized.split('\n').map(line => Buffer.byteLength(line))),
    ).toBeLessThan(4096)
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
        documents: incompleteDocuments,
      }),
    ).toThrow(/section.*missing/i)
  })

  test('indexes upstream authority for the active target section without proxying content', () => {
    const targetPath = 'docs/TECHNICAL_DESIGN.md'
    const input = sources([
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/BALANCE_DESIGN.md',
    ])
    const result = projectFoundationAuthority({
      targetPath,
      targetSectionIds: ['runtime_state'],
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
  })
})
