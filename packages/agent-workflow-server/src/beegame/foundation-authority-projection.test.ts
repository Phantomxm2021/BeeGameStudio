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
        source.sectionIds.map(sectionId => `${source.path}#${sectionId}`),
      )

      expect(projected).toEqual(declared)
      expect(result.rangeCount).toBe(declared.length)
      expect(result.projectedLineCount).toBe(
        result.sources.reduce(
          (total, source) => total + source.content.split('\n').length,
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
        selectionScope: source.selectionScope,
        sectionIds: source.sectionIds,
      })),
    ).toEqual(
      getGameDocumentContract(targetPath).upstreamSections.map(source => ({
        path: source.path,
        selectionScope: 'sections',
        sectionIds: source.sectionIds,
      })),
    )
    expect(result.sources.every(source => /^[a-f0-9]{64}$/.test(source.documentDigest)))
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
    const serialized = canonicalFoundationAuthorityProjectionBytes(result)
    expect(serialized).toContain('Owned source content for')
    expect(serialized).not.toContain('Source materials are intentionally')
    for (const source of result.sources) {
      expect(source.selectionScope).toBe('sections')
      expect(source.contentDigest).toBe(createHash('sha256').update(source.content).digest('hex'))
      for (const sectionId of source.sectionIds)
        expect(source.content).toContain(`<!-- beegame-section:${sectionId} -->`)
    }
    expect(serialized).toContain('"content":')
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.sources.every(Object.isFrozen)).toBe(true)
    expect(result.sources.every(source => Object.isFrozen(source.sectionIds))).toBe(true)
  })

  test('rejects missing documents and uses one whole-document source when markers are incomplete', () => {
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
    const projected = projectFoundationAuthority({
      targetPath,
      availableUpstreamPaths: ['docs/GDD.md'],
      documents: incompleteDocuments,
    })
    expect(projected.sources).toHaveLength(1)
    expect(projected.sources[0]).toMatchObject({
      path: 'docs/GDD.md',
      selectionScope: 'document',
      sectionIds: getGameDocumentContract(targetPath).upstreamSections[0]!.sectionIds,
      content: incompleteDocuments.get('docs/GDD.md'),
    })
    expect(projected.rangeCount).toBe(1)
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
      source.sectionIds.map(sectionId => `${source.path}#${sectionId}`),
    )

    expect(result.targetSectionIds).toEqual(['runtime_state'])
    expect(projectedIds).toContain('docs/GDD.md#states_flow')
    expect(projectedIds).toContain('docs/LEVEL_SCENE_DESIGN.md#scene_states')
    expect(projectedIds).toContain('docs/GDD.md#player_actions')
    expect(projectedIds).toContain('docs/BALANCE_DESIGN.md#formulas')
    expect(
      result.sources.every(source =>
        source.sectionIds.every(sectionId =>
          source.content.includes(`Owned source content for ${sectionId}.`),
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

    expect(modelBytes).toContain(
      '<!-- beegame-authority-source:docs/GDD.md scope=sections -->',
    )
    expect(modelBytes).toContain(
      '<!-- beegame-authority-source-end:docs/GDD.md -->',
    )
    expect(modelBytes).not.toContain('"targetPath"')
    expect(modelBytes).not.toContain('"targetSectionIds"')
    expect(modelBytes).not.toContain('contentDigest')
    expect(modelBytes).not.toContain('documentDigest')
    expect(modelBytes).not.toContain('\\n')
    expect(modelBytes).toContain('Owned source content for')
  })

  test('uses fewer model bytes than the durable JSON projection', () => {
    const result = projectFoundationAuthority({
      targetPath: 'docs/UI_UX_SPEC.md',
      availableUpstreamPaths: ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
      ...sources(['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md']),
    })

    expect(
      new TextEncoder().encode(modelFoundationAuthorityProjectionBytes(result))
        .byteLength,
    ).toBeLessThan(
      new TextEncoder().encode(canonicalFoundationAuthorityProjectionBytes(result))
        .byteLength,
    )
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
