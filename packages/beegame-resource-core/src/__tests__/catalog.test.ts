import { describe, expect, test } from 'bun:test'
import {
  browseResourceCatalogPacks,
  browseResourcePackElements,
  matchResourceRequirements,
} from '../catalog'
import type { ResourceElement, ResourcePack } from '../types'

const packs: ResourcePack[] = [
  {
    id: 'world-kit', name: 'World Kit', version: '1.0.0', status: 'published',
    styles: ['Stylized'], gameTypes: ['Adventure'], dimension: '3D', primaryCategory: '3d-assets',
    categories: ['models'], license: 'internal', tags: ['modular-world'],
  },
  {
    id: 'effects-kit', name: 'Effects Kit', version: '2.0.0', status: 'published',
    styles: ['Stylized'], gameTypes: ['Action'], dimension: 'agnostic', primaryCategory: 'vfx',
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
    expect(page.nextCursor).toStartWith('v3:')
    expect(browseResourceCatalogPacks(packs, elements, { limit: 1, cursor: page.nextCursor }).items).toHaveLength(1)
    expect(page.facets.assetKinds).toEqual(['model', 'vfx'])
    expect(page.facets.formats).toEqual(['glb', 'webm'])
  })

  test('keeps available facets when an exact authored filter has no matches', () => {
    const page = browseResourceCatalogPacks(packs, elements, {
      filters: { gameTypes: ['nonexistent-authored-value'] },
    })
    expect(page.items).toEqual([])
    expect(page.facets.gameTypes).toEqual(['Action', 'Adventure'])
    expect(page.facets.styles).toEqual(['Stylized'])
  })

  test('does not combine unrelated Pack elements into one false match', () => {
    const page = browseResourceCatalogPacks(packs, elements, {
      filters: {
        usageTags: ['terrain'],
        capabilities: ['connection-points'],
      },
    })

    expect(page.items).toEqual([])
  })

  test('keeps element exploration inside the Pack deliberately selected by the Agent', () => {
    const page = browseResourcePackElements(packs, elements, 'world-kit', {
      filters: { assetKinds: ['model'] },
      limit: 64,
    })

    expect(page.items.map(item => item.elementId)).toEqual(['ground', 'wall'])
    expect(new Set(page.items.map(item => item.packId))).toEqual(new Set(['world-kit']))
    expect(page.items.every(item => !('roleId' in item))).toBe(true)
    expect(page.items[0]?.technicalFacts).toEqual(expect.objectContaining({ boundsSizeY: 4, hasTextureCoordinates: true }))
  })

  test('exposes authored preview descriptors without signing source URLs', () => {
    const previewed = { ...elements[0]!, preview: { kind: 'model' as const, path: 'previews/ground.glb' } }
    const page = browseResourcePackElements(packs, [previewed, ...elements.slice(1)], 'world-kit', { limit: 64 })

    expect(page.items[0]).toEqual(expect.objectContaining({
      elementId: 'ground',
      preview: { kind: 'model', path: 'previews/ground.glb' },
    }))
    expect(JSON.stringify(page)).not.toContain('sourceUrl')
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

describe('bounded requirement matching', () => {
  test('matches only structured semantic facts and accepts explicit source conversion', () => {
    const fbx = element(
      'tower-model',
      'world-kit',
      'models/source.fbx',
      'models',
      'model',
      ['building', 'combat'],
      ['contains-materials'],
    )
    const result = matchResourceRequirements(packs, [...elements, fbx], {
      requirements: [
        {
          requirementId: 'requirement-a',
          profile: {
            dimensions: ['3D'],
            assetKinds: ['model'],
            usageTags: ['building'],
            capabilities: ['contains-materials'],
            styles: ['Stylized'],
          },
        },
      ],
      deliveryCapabilities: [
        {
          sourceFormat: 'fbx',
          disposition: 'convert',
          targetFormat: 'glb',
          adapterId: 'model-fbx-to-glb',
        },
      ],
      maxCandidatesPerRequirement: 4,
    })

    expect(result.groups).toEqual([
      expect.objectContaining({
        requirementId: 'requirement-a',
        status: 'matched',
        bundles: [expect.objectContaining({
          candidates: [expect.objectContaining({
            elementId: 'tower-model',
            delivery: {
              disposition: 'convert',
              sourceFormat: 'fbx',
              targetFormat: 'glb',
              adapterId: 'model-fbx-to-glb',
            },
          })],
        })],
      }),
    ])
  })

  test('returns direct OGG delivery and caps candidates deterministically', () => {
    const audioPack: ResourcePack = {
      id: 'audio-kit',
      name: 'Audio Kit',
      version: '1.0.0',
      status: 'published',
      styles: ['Stylized'],
      gameTypes: ['Strategy'],
      dimension: 'agnostic',
      primaryCategory: 'audio',
      categories: ['audio'],
      license: 'internal',
    }
    const audio = ['z', 'a', 'm'].map(id =>
      element(
        id,
        audioPack.id,
        `audio/${id}.ogg`,
        'audio',
        'audio-clip',
        ['sound-effect'],
        [],
      ),
    )
    const result = matchResourceRequirements([audioPack], audio, {
      requirements: [
        {
          requirementId: 'audio-feedback',
          profile: {
            dimensions: ['agnostic'],
            assetKinds: ['audio-clip'],
            usageTags: ['sound-effect'],
            capabilities: [],
            styles: [],
          },
        },
      ],
      deliveryCapabilities: [
        {
          sourceFormat: 'ogg',
          disposition: 'direct',
          targetFormat: 'ogg',
        },
      ],
      maxCandidatesPerRequirement: 2,
    })

    expect(result.groups[0]?.bundles.map(bundle => bundle.candidates[0]?.elementId)).toEqual(['a'])
    expect(result.groups[0]?.bundles[0]?.candidates[0]?.delivery.disposition).toBe(
      'direct',
    )
  })

  test('forms a bundle from multiple roots to cover separate obligations', () => {
    const model = element('bundle-model', 'world-kit', 'models/bundle.glb', 'models', 'model', ['building'], [])
    const texture = element('bundle-texture', 'world-kit', 'textures/bundle.png', 'textures', 'texture', ['building'], [])
    const result = matchResourceRequirements([packs[0]!], [model, texture], {
      requirements: [{
        requirementId: 'bundle-requirement',
        profile: {
          dimensions: ['3D'], assetKinds: ['model', 'texture'], usageTags: ['building'], capabilities: [], styles: ['Stylized'],
          coverage: [{ assetKinds: ['model'] }, { assetKinds: ['texture'] }],
        },
      }],
      deliveryCapabilities: [
        { sourceFormat: 'glb', disposition: 'direct', targetFormat: 'glb' },
        { sourceFormat: 'png', disposition: 'direct', targetFormat: 'png' },
      ],
    })

    expect(result.groups[0]?.status).toBe('matched')
    expect(result.groups[0]?.bundles[0]?.candidates.map(item => item.elementId)).toEqual(['bundle-model', 'bundle-texture'])
    expect(result.groups[0]?.bundles[0]?.coveredObligations).toEqual(['0', '1'])
  })

  test('does not force composition capabilities onto one candidate', () => {
    const model = element('capability-model', 'world-kit', 'models/capability.glb', 'models', 'model', ['building'], ['contains-materials'])
    const texture = element('capability-texture', 'world-kit', 'textures/capability.png', 'textures', 'texture', ['building'], ['contains-textures'])
    const result = matchResourceRequirements([packs[0]!], [model, texture], {
      requirements: [{
        requirementId: 'composed-asset',
        profile: {
          dimensions: ['3D'], assetKinds: ['model', 'texture'], usageTags: [],
          capabilities: ['contains-materials', 'contains-textures'], styles: ['Stylized'],
          coverage: [{ assetKinds: ['model'] }, { assetKinds: ['texture'] }],
        },
      }],
      deliveryCapabilities: [
        { sourceFormat: 'glb', disposition: 'direct', targetFormat: 'glb' },
        { sourceFormat: 'png', disposition: 'direct', targetFormat: 'png' },
      ],
    })

    expect(result.groups[0]?.status).toBe('matched')
    expect(result.groups[0]?.bundles[0]?.candidates.map(item => item.elementId)).toEqual(['capability-model', 'capability-texture'])
  })

  test('chooses the smallest complete coverage bundle deterministically', () => {
    const first = element('a-model', 'world-kit', 'models/first.glb', 'models', 'model', ['building'], [])
    const second = element('b-texture', 'world-kit', 'textures/second.png', 'textures', 'texture', ['building'], [])
    const complete = {
      ...element('z-complete-model', 'world-kit', 'models/complete.glb', 'models', 'model', ['building'], []),
      contentProfile: { packaging: 'self-contained' as const, components: [{ id: 'mesh:0', kind: 'mesh' as const }], inspection: { status: 'complete' as const, source: 'server' as const } },
    }
    const result = matchResourceRequirements([packs[0]!], [first, second, complete], {
      requirements: [{
        requirementId: 'smallest-bundle',
        profile: {
          dimensions: ['3D'], assetKinds: ['model'], usageTags: ['building'], capabilities: [], styles: ['Stylized'],
          coverage: [{ embeddedKinds: ['mesh'] }, { assetKinds: ['model'] }],
        },
      }],
      deliveryCapabilities: [{ sourceFormat: 'glb', disposition: 'direct', targetFormat: 'glb' }],
    })

    expect(result.groups[0]?.bundles[0]?.candidates.map(item => item.elementId)).toEqual(['z-complete-model'])
  })

  test('excludes non-selection-ready material and returns the sole no-match outcome', () => {
    const incomplete = element(
      'untagged-model',
      'world-kit',
      'models/untagged.glb',
      'models',
      'model',
      [],
      [],
    )
    const result = matchResourceRequirements(packs, [incomplete], {
      requirements: [
        {
          requirementId: 'environment-model',
          profile: {
            dimensions: ['3D'],
            assetKinds: ['model'],
            usageTags: ['environment'],
            capabilities: [],
            styles: ['Stylized'],
          },
        },
      ],
      deliveryCapabilities: [
        {
          sourceFormat: 'glb',
          disposition: 'direct',
          targetFormat: 'glb',
        },
      ],
    })

    expect(result.groups[0]).toEqual(
      expect.objectContaining({
        status: 'no-match',
        bundles: [],
      }),
    )
  })

  test('requires an exact external dependency binding before exposing a model candidate', () => {
    const texture = element('bound-texture', 'world-kit', 'textures/base.png', 'textures', 'texture', [], [])
    const model = {
      ...element('bound-model', 'world-kit', 'models/hero.fbx', 'models', 'model', ['building'], []),
      specs: { ...element('bound-model', 'world-kit', 'models/hero.fbx', 'models', 'model', ['building'], []).specs, externalReferences: JSON.stringify(['textures/base.png']) },
      dependencies: ['bound-texture'],
    }
    const request = {
      requirements: [{ requirementId: 'model', profile: {
        dimensions: ['3D'] as const, assetKinds: ['model'] as const, usageTags: ['building'] as const, capabilities: [], styles: ['Stylized'],
      } }],
      deliveryCapabilities: [
        { sourceFormat: 'fbx', disposition: 'convert' as const, targetFormat: 'glb' },
      ],
    }
    expect(matchResourceRequirements([packs[0]!], [model, texture], request).groups[0]?.status).toBe('no-match')
    expect(matchResourceRequirements([packs[0]!], [{
      ...model,
      dependencyBindings: [{ referencePath: 'textures/base.png', dependencyElementId: 'bound-texture' }],
    }, texture], request).groups[0]?.status).toBe('matched')
  })

  test('keeps the two-outcome wire result bounded when catalog administration has incomplete material', () => {
    const incomplete = Array.from({ length: 1_000 }, (_, index) =>
      element(
        `incomplete-${index}`,
        'world-kit',
        `models/incomplete-${index}.glb`,
        'models',
        'model',
        [],
        [],
      ),
    )
    const result = matchResourceRequirements(packs, incomplete, {
      requirements: [{
        requirementId: 'environment-model',
        profile: {
          dimensions: ['3D'], assetKinds: ['model'],
          usageTags: ['environment'], capabilities: [], styles: ['Stylized'],
        },
      }],
      deliveryCapabilities: [{
        sourceFormat: 'glb', disposition: 'direct', targetFormat: 'glb',
      }],
    })

    expect(result.groups[0]).toEqual(expect.objectContaining({
      status: 'no-match',
      bundles: [],
    }))
    expect(JSON.stringify(result).length).toBeLessThan(2_048)
  })

  test('does not expose incomplete catalog metadata as a third workflow state', () => {
    const incomplete = {
      ...element(
        'incomplete', 'world-kit', 'models/incomplete.glb',
        'models', 'model', ['environment'], [],
      ),
      assetKind: undefined,
      capabilities: undefined,
    }
    const result = matchResourceRequirements(packs, [incomplete], {
      requirements: [{
        requirementId: 'environment-model',
        profile: {
          dimensions: ['3D'], assetKinds: ['model'],
          usageTags: ['environment'], capabilities: ['modular'],
          styles: ['Stylized'],
        },
      }],
      deliveryCapabilities: [{
        sourceFormat: 'glb', disposition: 'direct', targetFormat: 'glb',
      }],
    })

    expect(result.groups[0]).toEqual(expect.objectContaining({
      status: 'no-match',
      bundles: [],
    }))
  })

  test('keeps a valid root when an unrelated root no longer meets readiness', () => {
    const valid = element(
      'valid-environment', 'world-kit', 'models/valid.glb',
      'models', 'model', ['environment'], [],
    )
    const invalidRoot = {
      ...element(
        'invalid-root', 'world-kit', 'models/invalid.glb',
        'models', 'model', ['prop'], [],
      ),
      specs: {},
    }
    const result = matchResourceRequirements(packs, [valid, invalidRoot], {
      requirements: [{
        requirementId: 'environment-model',
        profile: {
          dimensions: ['3D'], assetKinds: ['model'],
          usageTags: ['environment'], capabilities: [], styles: ['Stylized'],
        },
      }],
      deliveryCapabilities: [{
        sourceFormat: 'glb', disposition: 'direct', targetFormat: 'glb',
      }],
    })

    expect(result.groups[0]).toEqual(expect.objectContaining({
      requirementId: 'environment-model',
      status: 'matched',
      bundles: [expect.objectContaining({ candidates: [expect.objectContaining({ elementId: 'valid-environment' })] })],
    }))
  })

  test('does not use inherited Pack tags as candidate evidence', () => {
    const inherited = {
      ...element(
        'inherited-environment', 'world-kit', 'models/inherited.glb',
        'models', 'model', ['environment'], [],
      ),
      usageTagsMode: 'inherit' as const,
    }
    const result = matchResourceRequirements([packs[0]!], [inherited], {
      requirements: [{
        requirementId: 'environment-model',
        profile: {
          dimensions: ['3D'], assetKinds: ['model'],
          usageTags: ['environment'], capabilities: [], styles: ['Stylized'],
        },
      }],
      deliveryCapabilities: [{
        sourceFormat: 'glb', disposition: 'direct', targetFormat: 'glb',
      }],
    })

    expect(result.groups[0]).toEqual(expect.objectContaining({ status: 'no-match', bundles: [] }))
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
    specs: {
      contentHash: 'a'.repeat(64),
      ...(id === 'ground' ? { boundsSizeY: 4, hasTextureCoordinates: true } : {}),
    }, usageTags, capabilities, dependencies: [], status: 'ready',
  }
}
