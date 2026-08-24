import { describe, expect, test } from 'bun:test'
import {
  buildFoundationSectionIndex,
  digestSectionIndex,
} from './foundation-section-index'

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
})
