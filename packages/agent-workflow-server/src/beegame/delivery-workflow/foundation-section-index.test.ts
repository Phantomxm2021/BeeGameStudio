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
          'docs/GDD.md',
          '# Game\n\n<!-- beegame-section:vision -->\n## Vision\n\nPromise\n\n<!-- beegame-section:core_loop -->\n## Core Loop\n\nLoop\n',
        ],
      ]),
    })

    expect(index).toEqual([
      expect.objectContaining({
        documentPath: 'docs/GDD.md',
        sectionId: 'vision',
        heading: 'Vision',
        startLine: 4,
        endLine: 7,
      }),
      expect.objectContaining({
        documentPath: 'docs/GDD.md',
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
        ['docs/GDD.md', '# GDD\n\n## A\n\nbody\n'],
        ['docs/LEVEL_SCENE_DESIGN.md', '# Level\n\n## B\n\nbody\n'],
      ]),
    })
    const second = buildFoundationSectionIndex({
      documents: new Map([
        ['docs/LEVEL_SCENE_DESIGN.md', '# Level\n\n## B\n\nbody\n'],
        ['docs/GDD.md', '# GDD\n\n## A\n\nbody\n'],
      ]),
    })
    expect(digestSectionIndex(first)).toBe(digestSectionIndex(second))
  })
})
