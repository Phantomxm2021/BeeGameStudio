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
  test('projects only contracted Markdown section references in source order', () => {
    const targetPath = 'docs/UI_UX_SPEC.md'
    const input = sources(['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'])
    const result = projectFoundationAuthority({ targetPath, ...input })
    const selectedSections = new Set(
      getGameDocumentContract(targetPath).upstreamSections.flatMap(source =>
        source.sectionIds.map(sectionId => `${source.path}#${sectionId}`),
      ),
    )

    expect(result.targetPath).toBe(targetPath)
    expect(
      result.sources.map(source => ({
        path: source.path,
        sectionIds: source.sectionIds,
      })),
    ).toEqual(
      getGameDocumentContract(targetPath).upstreamSections.map(source => ({
        path: source.path,
        sectionIds: source.sectionIds,
      })),
    )
    expect(result.sources.every(source => /^[a-f0-9]{64}$/.test(source.digest)))
      .toBe(true)
    expect(
      result.sources.flatMap(source =>
        source.sectionIds.map(sectionId => `${source.path}#${sectionId}`),
      ),
    ).toEqual(
      [...selectedSections],
    )
    expect(
      result.sources.every(source =>
        source.sectionIds.every(sectionId =>
          selectedSections.has(`${source.path}#${sectionId}`),
        ),
      ),
    ).toBe(true)
    expect(result.byteLength).toBe(
      new TextEncoder().encode(
        canonicalFoundationAuthorityProjectionBytes(result),
      ).byteLength,
    )
    expect(canonicalFoundationAuthorityProjectionBytes(result)).not.toContain(
      'Source materials are intentionally',
    )
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.sources.every(Object.isFrozen)).toBe(true)
    expect(result.sources.every(source => Object.isFrozen(source.sectionIds))).toBe(true)
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
})
