import { describe, expect, test } from 'bun:test'
import {
  buildGameIrEvidenceFragmentCatalog,
  resolveGameIrEvidenceFragment,
} from './projection-slices'

describe('Game IR evidence fragments', () => {
  const authority = {
    sectionIndex: [
      {
        documentPath: 'docs/GDD.md' as const,
        sectionId: 'actions',
        heading: 'Actions',
        startLine: 1,
        endLine: 6,
        digest: 'a'.repeat(64),
      },
    ],
    sectionBytes: {
      'docs/GDD.md#actions': [
        '## Actions',
        '',
        '| ID | Rule |',
        '| --- | --- |',
        '| `act_move` | Move once |',
        '| `act_wait` | Wait once |',
      ].join('\n'),
    },
  }

  test('projects exact unique source lines into stable short references', () => {
    const first = buildGameIrEvidenceFragmentCatalog(authority)
    const second = buildGameIrEvidenceFragmentCatalog(authority)

    expect(first).toEqual(second)
    expect(first.fragments.map(fragment => fragment.fragmentId)).toEqual([
      'e0.0',
      'e0.1',
      'e0.2',
      'e0.3',
      'e0.4',
    ])
    expect(first.modelSections).toEqual([
      {
        documentPath: 'docs/GDD.md',
        sectionId: 'actions',
        heading: 'Actions',
        evidenceFragments: [
          { fragmentId: 'e0.0', text: '## Actions' },
          { fragmentId: 'e0.1', text: '| ID | Rule |' },
          { fragmentId: 'e0.2', text: '| --- | --- |' },
          { fragmentId: 'e0.3', text: '| `act_move` | Move once |' },
          { fragmentId: 'e0.4', text: '| `act_wait` | Wait once |' },
        ],
      },
    ])
  })

  test('resolves only a catalog-owned reference to canonical source authority', () => {
    const catalog = buildGameIrEvidenceFragmentCatalog(authority)
    expect(resolveGameIrEvidenceFragment(catalog, 'e0.3')).toEqual({
      fragmentId: 'e0.3',
      documentPath: 'docs/GDD.md',
      sectionId: 'actions',
      excerpt: '| `act_move` | Move once |',
    })
    expect(() => resolveGameIrEvidenceFragment(catalog, 'e9.9')).toThrow(
      /fragment/i,
    )
  })

  test('does not expose ambiguous duplicate lines as evidence references', () => {
    const catalog = buildGameIrEvidenceFragmentCatalog({
      ...authority,
      sectionBytes: {
        'docs/GDD.md#actions': 'same\nsame\nunique',
      },
    })
    expect(catalog.fragments.map(fragment => fragment.excerpt)).toEqual([
      'unique',
    ])
  })
})
