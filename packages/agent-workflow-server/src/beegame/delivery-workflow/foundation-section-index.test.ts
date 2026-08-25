import { describe, expect, test } from 'bun:test'
import {
  buildFoundationSectionIndex,
  digestSectionIndex,
} from './foundation-section-index'
import { getGameDocumentContract } from './game-document-contracts'

describe('foundation section index', () => {
  test('indexes canonical headings into stable line-bounded section references', () => {
    const index = buildFoundationSectionIndex({
      documents: new Map([
        [
          'docs/custom.md',
          '# Game\n\n<!-- beegame-section:vision -->\n## Vision\n\nPromise\n\n<!-- beegame-section:core_loop -->\n## Core Loop\n\nLoop\n',
        ],
      ]),
    })

    expect(index).toEqual([
      expect.objectContaining({
        documentPath: 'docs/custom.md',
        sectionId: 'vision',
        heading: 'Vision',
        startLine: 4,
        endLine: 7,
      }),
      expect.objectContaining({
        documentPath: 'docs/custom.md',
        sectionId: 'core_loop',
        heading: 'Core Loop',
        startLine: 9,
        endLine: 12,
      }),
    ])
  })

  test('produces the same digest for equivalent input order', () => {
    const first = buildFoundationSectionIndex({
      documents: new Map([
        ['docs/custom-a.md', '# GDD\n\n## A\n\nbody\n'],
        ['docs/custom-b.md', '# Level\n\n## B\n\nbody\n'],
      ]),
    })
    const second = buildFoundationSectionIndex({
      documents: new Map([
        ['docs/custom-b.md', '# Level\n\n## B\n\nbody\n'],
        ['docs/custom-a.md', '# GDD\n\n## A\n\nbody\n'],
      ]),
    })
    expect(digestSectionIndex(first)).toBe(digestSectionIndex(second))
  })

  test('rejects unknown or missing immutable contract section markers', () => {
    expect(() =>
      buildFoundationSectionIndex({
        documents: new Map([
          [
            'docs/GDD.md',
            '# GDD\n\n<!-- beegame-section:not_a_contract_section -->\n## Unknown\n\nbody\n',
          ],
        ]),
      }),
    ).toThrow('contract')
    expect(() =>
      buildFoundationSectionIndex({
        documents: new Map([['docs/GDD.md', '# GDD\n\n## Vision\n\nbody\n']]),
      }),
    ).toThrow('contract')
    expect(() =>
      buildFoundationSectionIndex({
        documents: new Map([
          [
            'docs/GDD.md',
            '# GDD\n\n<!-- beegame-section:vision -->\n## Vision and Product Promise\n\nbody\n<!-- beegame-section:vision -->\n## Vision and Product Promise\n\nbody\n',
          ],
        ]),
      }),
    ).toThrow('contract')
  })

  test('ends a marked contract section at an unmarked same-level appendix heading', () => {
    const contract = getGameDocumentContract('docs/LEVEL_SCENE_DESIGN.md')
    const markdown = [
      '# LEVEL',
      ...contract.sections.flatMap(section => [
        `<!-- beegame-section:${section.sectionId} -->`,
        `## ${section.title}`,
        'body',
      ]),
      '## Production Materials',
      'appendix body',
    ].join('\n')
    const index = buildFoundationSectionIndex({ documents: { 'docs/LEVEL_SCENE_DESIGN.md': markdown } })
    const production = index.find(section => section.sectionId === 'production_acceptance')!
    expect(markdown.split('\n').slice(production.startLine - 1, production.endLine).join('\n')).not.toContain('Production Materials')
    expect(production.endLine).toBe(markdown.split('\n').findIndex(line => line === '## Production Materials'))
  })
})
