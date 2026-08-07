import { describe, expect, test } from 'bun:test'
import { resolveEffectiveResourceMetadata } from '../metadata-policy'
import type { ResourceElement } from '../types'

const element: ResourceElement = {
  id: 'asset', packId: 'pack', name: 'asset.glb', path: 'models/characters/asset.glb',
  category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready',
}
describe('resource metadata policy', () => {
  test('does not turn Pack or folder defaults into element semantic tags', () => {
    expect(resolveEffectiveResourceMetadata(element)).toEqual(expect.objectContaining({
      usageTags: [],
      usageTagsMode: 'inherit',
      usageTagsSource: 'none',
    }))
  })

  test('keeps explicit element tags as the effective semantic metadata', () => {
    expect(resolveEffectiveResourceMetadata({ ...element, usageTags: ['weapon-equipment'], usageTagsMode: 'override' }))
      .toEqual(expect.objectContaining({ usageTags: ['weapon-equipment'], usageTagsSource: 'element' }))
  })

  test('supports a deliberate manual-only element without inheriting', () => {
    expect(resolveEffectiveResourceMetadata({ ...element, usageTagsMode: 'manual-only' }))
      .toEqual(expect.objectContaining({ usageTags: [], usageTagsSource: 'none' }))
  })

  test('keeps an unclassified element untagged', () => {
    expect(resolveEffectiveResourceMetadata(element)).toEqual(expect.objectContaining({
      usageTags: [],
      usageTagsMode: 'inherit',
      usageTagsSource: 'none',
    }))
  })
})
