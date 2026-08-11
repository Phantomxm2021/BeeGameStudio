import { describe, expect, test } from 'bun:test'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'
import { projectFoundationAuthority } from './foundation-authority-projection'

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
    'Source materials are intentionally outside the section projection.',
  ].join('\n')
}

describe('foundation authority projection', () => {
  test('projects only explicitly contracted upstream sections in stable order', () => {
    const targetPath = 'docs/UI_UX_SPEC.md'
    const documents = new Map<FoundationDocumentPath, string>([
      ['docs/GDD.md', sourceDocument('docs/GDD.md')],
      ['docs/LEVEL_SCENE_DESIGN.md', sourceDocument('docs/LEVEL_SCENE_DESIGN.md')],
    ])
    const result = projectFoundationAuthority({ targetPath, documents })
    const expected = getGameDocumentContract(targetPath).upstreamSections.flatMap(
      source => source.sectionIds.map(sectionId => `${source.path}#${sectionId}`),
    )
    expect(result.map(item => `${item.path}#${item.sectionId}`)).toEqual(expected)
    expect(result.every(item => item.content.includes(`## `))).toBe(true)
    expect(result.some(item => item.content.includes('Source materials are intentionally'))).toBe(false)
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.every(Object.isFrozen)).toBe(true)
  })

  test('rejects missing, duplicate, and out-of-order source markers', () => {
    const targetPath = 'docs/LEVEL_SCENE_DESIGN.md'
    const valid = sourceDocument('docs/GDD.md')
    const marker = '<!-- beegame-section:experience_pillars -->'
    expect(() =>
      projectFoundationAuthority({ targetPath, documents: new Map() }),
    ).toThrow(/missing/i)
    expect(() =>
      projectFoundationAuthority({
        targetPath,
        documents: new Map([['docs/GDD.md', `${valid}\n${marker}`]]),
      }),
    ).toThrow(/duplicate|order/i)
    expect(() =>
      projectFoundationAuthority({
        targetPath,
        documents: new Map([['docs/GDD.md', valid.replace(marker, '').concat(`\n${marker}`)]]),
      }),
    ).toThrow(/order/i)
  })
})
