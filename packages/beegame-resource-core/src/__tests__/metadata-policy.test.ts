import { describe, expect, test } from 'bun:test'
import { resolveResourceElementMetadata } from '../metadata-policy'
import type { ResourceElement, ResourceFolder, ResourcePack } from '../types'

const pack: ResourcePack = {
  id: 'pack', name: 'Pack',
  styles: ['Stylized'], gameTypes: ['action'], dimension: '3D',
  primaryCategory: 'mixed', categories: ['models'], license: 'internal', version: '1.0.0', status: 'published',
  elementDefaults: { usageTags: ['prop'] },
}
const element: ResourceElement = {
  id: 'asset', packId: 'pack', name: 'asset.glb', path: 'models/characters/asset.glb',
  category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready',
}
const folders: ResourceFolder[] = [
  { id: 'models', packId: 'pack', name: 'models', path: 'models', elementDefaults: { usageTags: ['environment'] } },
  { id: 'characters', packId: 'pack', name: 'characters', parentId: 'models', path: 'models/characters', elementDefaults: { usageTags: ['character'] } },
]

describe('resource metadata policy', () => {
  test('uses the closest explicit folder policy before Pack defaults', () => {
    expect(resolveResourceElementMetadata(pack, folders, element)).toEqual(expect.objectContaining({ usageTags: ['character'], usageTagsSource: 'folder' }))
  })

  test('keeps an explicit element override above inherited policy', () => {
    expect(resolveResourceElementMetadata(pack, folders, { ...element, usageTags: ['weapon-equipment'], usageTagsMode: 'override' }))
      .toEqual(expect.objectContaining({ usageTags: ['weapon-equipment'], usageTagsSource: 'element' }))
  })

  test('supports a deliberate manual-only element without inheriting', () => {
    expect(resolveResourceElementMetadata(pack, folders, { ...element, usageTagsMode: 'manual-only' }))
      .toEqual(expect.objectContaining({ usageTags: [], usageTagsSource: 'none' }))
  })

  test('falls back to Pack defaults when no folder policy applies', () => {
    expect(resolveResourceElementMetadata(pack, [], element)).toEqual(expect.objectContaining({ usageTags: ['prop'], usageTagsSource: 'pack' }))
  })
})
