import { describe, expect, test } from 'bun:test'
import { rankStructuredResourcePacks, searchResourcePacks } from '../structured-search'
import type { PackSummary } from '../types'

const packs: PackSummary[] = [
  { id: 'forest', name: 'Forest', style: 'Stylized', gameTypes: ['Adventure'], dimension: '3D', primaryCategory: 'world-scene', categories: ['environment'], license: 'internal', version: '1', status: 'published', tags: ['foliage', 'outdoor'], elementCount: 1 },
  { id: 'ui', name: 'UI', style: 'Minimal', gameTypes: ['Puzzle'], dimension: '2D', primaryCategory: 'ui-kit', categories: ['ui'], license: 'internal', version: '1', status: 'draft', tags: ['interface'], elementCount: 1 },
]

describe('structured resource Pack search', () => {
  test('applies metadata constraints without free-text inference', () => {
    expect(searchResourcePacks(packs, { dimensions: ['3D'], tags: ['OUTDOOR'], gameTypes: ['Adventure'], statuses: ['published'] }).map(pack => pack.id)).toEqual(['forest'])
    expect(searchResourcePacks(packs, { primaryCategories: ['ui-kit'], statuses: ['published'] })).toEqual([])
  })

  test('allows semantic ranking only after hard constraints have removed incompatible Packs', async () => {
    const ranked = await rankStructuredResourcePacks(packs, { dimensions: ['3D'] }, async () => new Map([['ui', 100], ['forest', 1]]))
    expect(ranked.map(pack => pack.id)).toEqual(['forest'])
  })
})
