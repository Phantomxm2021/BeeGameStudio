import { describe, expect, test } from 'bun:test'
import {
  createFoundationAuthoritySidecar,
  type FoundationAuthoritySidecar,
} from './foundation-authority-sidecar'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'
import {
  canonicalFoundationAuthorityProjectionBytes,
  projectFoundationAuthority,
} from './foundation-authority-projection'

function bytewise(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

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

function sourceSidecar(
  path: FoundationDocumentPath,
  markdown: string,
): FoundationAuthoritySidecar {
  const prefix = path
    .slice('docs/'.length, -'.md'.length)
    .toLowerCase()
  return createFoundationAuthoritySidecar({
    documentPath: path,
    markdown,
    submission: {
      records: getGameDocumentContract(path).sections
        .map(section => ({
          authorityId: `${prefix}.${section.sectionId}.primary`,
          sectionId: section.sectionId,
          kind: 'fact' as const,
          state: 'confirmed' as const,
          source: 'confirmed_brief' as const,
          evidenceRefs: [],
          statement: `Confirmed ${section.sectionId} authority.`,
          responsibilityIds: [...section.responsibilityIds].sort(bytewise),
        }))
        .sort((left, right) => bytewise(left.authorityId, right.authorityId)),
    },
  })
}

function sources(paths: readonly FoundationDocumentPath[]) {
  const documents = new Map<FoundationDocumentPath, string>()
  const sidecars = new Map<FoundationDocumentPath, FoundationAuthoritySidecar>()
  for (const path of paths) {
    const markdown = sourceDocument(path)
    documents.set(path, markdown)
    sidecars.set(path, sourceSidecar(path, markdown))
  }
  return { documents, sidecars }
}

describe('foundation authority projection', () => {
  test('projects only contracted records in source and bytewise record order', () => {
    const targetPath = 'docs/UI_UX_SPEC.md'
    const input = sources(['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'])
    const result = projectFoundationAuthority({ targetPath, ...input })
    const selectedSections = new Set(
      getGameDocumentContract(targetPath).upstreamSections.flatMap(source =>
        source.sectionIds.map(sectionId => `${source.path}#${sectionId}`),
      ),
    )

    expect(result.targetPath).toBe(targetPath)
    expect(result.records.length).toBe(selectedSections.size)
    expect(
      result.records.every(record => {
        const sourcePath = record.authorityId.startsWith('gdd.')
          ? 'docs/GDD.md'
          : 'docs/LEVEL_SCENE_DESIGN.md'
        return selectedSections.has(`${sourcePath}#${record.sectionId}`)
      }),
    ).toBe(true)
    expect(result.records.some(record => record.sectionId === 'vision')).toBe(
      false,
    )
    expect(Object.keys(result.sourceDigests)).toEqual([
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
    ])
    expect(result.byteLength).toBe(
      new TextEncoder().encode(
        canonicalFoundationAuthorityProjectionBytes(result),
      ).byteLength,
    )
    expect(canonicalFoundationAuthorityProjectionBytes(result)).not.toContain(
      'Source materials are intentionally',
    )
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.records.every(Object.isFrozen)).toBe(true)
    expect(
      result.records.every(
        record => record.source === 'confirmed_brief' && record.evidenceRefs.length === 0,
      ),
    ).toBe(true)
  })

  test('rejects missing and stale sidecars before downstream work starts', () => {
    const targetPath = 'docs/LEVEL_SCENE_DESIGN.md'
    const input = sources(['docs/GDD.md'])
    expect(() =>
      projectFoundationAuthority({
        targetPath,
        documents: input.documents,
        sidecars: new Map(),
      }),
    ).toThrow(/sidecar.*missing/i)

    const staleDocuments = new Map(input.documents)
    staleDocuments.set('docs/GDD.md', `${staleDocuments.get('docs/GDD.md')}\nchanged`)
    expect(() =>
      projectFoundationAuthority({
        targetPath,
        documents: staleDocuments,
        sidecars: input.sidecars,
      }),
    ).toThrow(/digest/i)
  })
})
