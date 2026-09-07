import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  buildFoundationSectionIndex,
  digestSectionIndex,
} from '../domain/foundation-section-index'
import { getGameDocumentContract } from '../domain/game-document-contracts'

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
      '<!-- beegame-executive-summary -->',
      '## Executive Summary',
      '',
      'summary',
      ...contract.sections.flatMap(section => [
        `<!-- beegame-section:${section.sectionId} -->`,
        `## ${section.title}`,
        'body',
      ]),
      '## Unmarked Appendix',
      'appendix body',
      '<!-- beegame-production-materials -->',
      '## Production Materials',
      ...contract.productionMaterials.flatMap(material => [
        `<!-- beegame-material:${material.materialId} -->`,
        `### ${material.title}`,
        'material body',
      ]),
    ].join('\n')
    const index = buildFoundationSectionIndex({ documents: { 'docs/LEVEL_SCENE_DESIGN.md': markdown } })
    const production = index.find(section => section.sectionId === 'production_acceptance')!
    expect(markdown.split('\n').slice(production.startLine - 1, production.endLine).join('\n')).not.toContain('Unmarked Appendix')
    expect(production.endLine).toBe(markdown.split('\n').findIndex(line => line === '## Unmarked Appendix'))
  })

  test('indexes the executive summary and every production material as ordered digestable blocks', () => {
    const contract = getGameDocumentContract('docs/GDD.md')
    const lines = [
      '# GDD',
      '',
      '<!-- beegame-executive-summary -->',
      '## Executive Summary',
      '',
      'summary authority',
      '',
      ...contract.sections.flatMap(section => [
        `<!-- beegame-section:${section.sectionId} -->`,
        `## ${section.title}`,
        '',
        `authority ${section.sectionId}`,
        '',
      ]),
      '<!-- beegame-production-materials -->',
      '## Production Materials',
      '',
      ...contract.productionMaterials.flatMap(material => [
        `<!-- beegame-material:${material.materialId} -->`,
        `### ${material.title}`,
        '',
        `material ${material.materialId}`,
        '',
      ]),
      '<!-- beegame-audit-appendix -->',
      '## Audit Appendix',
      '',
      'audit metadata',
    ]
    const markdown = lines.join('\n')
    const index = buildFoundationSectionIndex({ documents: { 'docs/GDD.md': markdown } })
    const expectedIds = [
      'executive_summary',
      ...contract.sections.map(section => section.sectionId),
      ...contract.productionMaterials.map(material => `material.${material.materialId}`),
    ]
    expect(index.map(section => section.sectionId)).toEqual(expectedIds)

    for (const section of index) {
      const marker = section.sectionId === 'executive_summary'
        ? '<!-- beegame-executive-summary -->'
        : section.sectionId.startsWith('material.')
          ? `<!-- beegame-material:${section.sectionId.slice('material.'.length)} -->`
          : `<!-- beegame-section:${section.sectionId} -->`
      const markerLine = lines.indexOf(marker)
      expect(section.startLine).toBe(markerLine + 2)
      const nextMarker = lines.findIndex((line, lineIndex) =>
        lineIndex > markerLine && /^<!-- beegame-(?:executive-summary|section:|production-materials|material:|audit-appendix)/.test(line),
      )
      const endLine = nextMarker >= 0 ? nextMarker : lines.length
      expect(section.endLine).toBe(endLine)
      expect(section.digest).toBe(
        createHash('sha256').update(lines.slice(section.startLine - 1, endLine).join('\n')).digest('hex'),
      )
    }
  })

  test('rejects a canonical document with no executive summary or production-material markers', () => {
    const contract = getGameDocumentContract('docs/GDD.md')
    const markdown = [
      '# GDD',
      '',
      ...contract.sections.flatMap(section => [
        `<!-- beegame-section:${section.sectionId} -->`,
        `## ${section.title}`,
        '',
        `authority ${section.sectionId}`,
        '',
      ]),
    ].join('\n')
    expect(() => buildFoundationSectionIndex({ documents: { 'docs/GDD.md': markdown } })).toThrow(/derived|summary|material/i)
  })
})
