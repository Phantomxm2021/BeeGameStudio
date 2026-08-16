import { describe, expect, test } from 'bun:test'
import {
  FOUNDATION_DOCUMENT_LANES,
  foundationDocumentLane,
} from './foundation-document-lanes'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

describe('foundation document lanes', () => {
  test('partitions the eight canonical documents exactly once', () => {
    const paths = FOUNDATION_DOCUMENT_LANES.flatMap(lane => lane.ownedPaths)

    expect(FOUNDATION_DOCUMENT_LANES.map(lane => lane.id)).toEqual([
      'core-design',
      'technical-assets',
      'presentation',
    ])
    expect(new Set(paths)).toEqual(new Set(CANONICAL_FOUNDATION_DOCUMENTS))
    expect(new Set(paths).size).toBe(CANONICAL_FOUNDATION_DOCUMENTS.length)
    for (const lane of FOUNDATION_DOCUMENT_LANES)
      expect(lane.ownedPaths).toEqual(
        CANONICAL_FOUNDATION_DOCUMENTS.filter(path =>
          lane.ownedPaths.includes(path),
        ),
      )
    expect(FOUNDATION_DOCUMENT_LANES.every(Object.isFrozen)).toBe(true)
    expect(
      FOUNDATION_DOCUMENT_LANES.every(lane => Object.isFrozen(lane.ownedPaths)),
    ).toBe(true)
  })

  test('resolves one owner for every canonical document and rejects unknown paths', () => {
    expect(foundationDocumentLane('docs/GDD.md').id).toBe('core-design')
    expect(foundationDocumentLane('docs/ASSET_PLAN.md').id).toBe(
      'technical-assets',
    )
    expect(foundationDocumentLane('docs/AUDIO_DESIGN.md').id).toBe(
      'presentation',
    )
    expect(() => foundationDocumentLane('docs/UNKNOWN.md' as never)).toThrow(
      'foundation document lane is missing',
    )
  })
})
