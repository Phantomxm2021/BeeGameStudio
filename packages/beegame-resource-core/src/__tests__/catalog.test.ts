import { describe, expect, test } from 'bun:test'
import { browseResourceCatalogPacks, browseResourcePackElements } from '../catalog'
import type { ResourceElement, ResourcePack } from '../types'

const packs: ResourcePack[] = [
  {
    id: 'world-kit', name: 'World Kit', version: '1.0.0', status: 'published',
    style: 'Stylized', gameTypes: ['Adventure'], dimension: '3D', primaryCategory: '3d-assets',
    categories: ['models'], license: 'internal', tags: ['modular-world'],
  },
  {
    id: 'effects-kit', name: 'Effects Kit', version: '2.0.0', status: 'published',
    style: 'Stylized', gameTypes: ['Action'], dimension: 'agnostic', primaryCategory: 'vfx',
    categories: ['vfx'], license: 'internal',
  },
]

const elements: ResourceElement[] = [
  element('ground', 'world-kit', 'models/ground.glb', 'models', 'model', ['terrain'], ['modular']),
  element('wall', 'world-kit', 'models/wall.glb', 'models', 'model', ['building'], ['modular', 'connection-points']),
  element('impact', 'effects-kit', 'effects/impact.webm', 'vfx', 'vfx', ['effect'], ['flipbook']),
]

describe('resource catalog browsing', () => {
  test('browses Packs without project roles and exposes facets for iterative discovery', () => {
    const page = browseResourceCatalogPacks(packs, elements, { limit: 1 })

    expect(page.total).toBe(2)
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toStartWith('v1:')
    expect(browseResourceCatalogPacks(packs, elements, { limit: 1, cursor: page.nextCursor }).items).toHaveLength(1)
    expect(page.facets.assetKinds).toEqual(['model', 'vfx'])
    expect(page.facets.formats).toEqual(['glb', 'webm'])
  })

  test('keeps element exploration inside the Pack deliberately selected by the Agent', () => {
    const page = browseResourcePackElements(packs, elements, 'world-kit', {
      filters: { assetKinds: ['model'] },
      limit: 64,
    })

    expect(page.items.map(item => item.elementId)).toEqual(['ground', 'wall'])
    expect(new Set(page.items.map(item => item.packId))).toEqual(new Set(['world-kit']))
    expect(page.items.every(item => !('roleId' in item))).toBe(true)
    expect(page.items[0]?.technicalFacts).toEqual({ boundsSizeY: 4, hasTextureCoordinates: true })
  })

  test('uses technical metadata as exact filters and excludes incomplete dependency roots', () => {
    const broken = {
      ...element('broken', 'world-kit', 'models/broken.glb', 'models', 'model', ['environment'], ['modular']),
      dependencies: ['missing'],
    }
    const page = browseResourcePackElements(packs, [...elements, broken], 'world-kit', {
      filters: { dimensions: ['3D'], capabilities: ['connection-points'], formats: ['glb'] },
    })

    expect(page.items).toEqual([expect.objectContaining({ elementId: 'wall' })])
  })
})

function element(
  id: string,
  packId: string,
  path: string,
  category: ResourceElement['category'],
  assetKind: NonNullable<ResourceElement['assetKind']>,
  usageTags: NonNullable<ResourceElement['usageTags']>,
  capabilities: NonNullable<ResourceElement['capabilities']>,
): ResourceElement {
  return {
    id, packId, name: id, path, category, kind: assetKind, assetKind,
    specs: id === 'ground' ? { boundsSizeY: 4, hasTextureCoordinates: true } : {}, usageTags, capabilities, dependencies: [], status: 'ready',
  }
}
