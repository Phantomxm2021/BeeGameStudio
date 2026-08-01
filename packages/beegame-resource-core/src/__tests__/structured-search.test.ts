import { describe, expect, test } from 'bun:test'
import { searchResourcePacks } from '../structured-search'
import type { PackSummary } from '../types'

const packs: PackSummary[] = [
  { id: 'forest', name: 'Forest',
    styles: ['Stylized'], gameTypes: ['Adventure'], dimension: '3D', primaryCategory: 'world-scene', categories: ['scenes'], license: 'internal', version: '1', status: 'published', tags: ['foliage', 'outdoor'], elementCount: 1 },
  { id: 'ui', name: 'UI',
    styles: ['Minimal'], gameTypes: ['Puzzle'], dimension: '2D', primaryCategory: 'ui-kit', categories: ['ui'], license: 'internal', version: '1', status: 'draft', tags: ['interface'], elementCount: 1 },
]

describe('structured resource Pack search', () => {
  test('applies metadata constraints without free-text inference', () => {
    expect(searchResourcePacks(packs, { dimensions: ['3D'], tags: ['OUTDOOR'], gameTypes: ['Adventure'], statuses: ['published'] }).map(pack => pack.id)).toEqual(['forest'])
    expect(searchResourcePacks(packs, { primaryCategories: ['ui-kit'], statuses: ['published'] })).toEqual([])
  })
})
