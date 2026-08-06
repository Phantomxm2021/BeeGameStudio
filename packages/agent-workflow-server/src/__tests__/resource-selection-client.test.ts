import { describe, expect, test } from 'bun:test'
import { createResourceSelectionClient } from '../beegame/resource-selection-client'

const facets = {
  dimensions: [],
  primaryCategories: [],
  categories: [],
  styles: [],
  gameTypes: [],
  packTags: [],
  usageTags: [],
  assetKinds: [],
  capabilities: [],
  formats: [],
}

describe('Resource selection service client', () => {
  test('matches all requirements through one strict bounded endpoint', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    const client = createResourceSelectionClient({
      baseUrl: 'https://resource.invalid',
      serviceToken: 'token',
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), body: JSON.parse(String(init?.body)) })
        return Response.json({
          catalogRevision: 'revision-a',
          groups: [{
            requirementId: 'visual.tower', status: 'matched',
            candidates: [{ ...catalogElement(), assetKind: 'model', delivery: {
              sourceFormat: 'fbx', disposition: 'convert', targetFormat: 'glb', adapterId: 'converter',
            } }],
            unclassifiedElementIds: [],
          }],
        })
      },
    })
    const request = {
      requirements: [{ requirementId: 'visual.tower', profile: {
        dimensions: ['3D'] as const, assetKinds: ['model'] as const,
        usageTags: ['building'] as const, capabilities: [], styles: ['stylized'],
      } }],
      deliveryCapabilities: [{ sourceFormat: 'fbx', disposition: 'convert' as const, targetFormat: 'glb', adapterId: 'converter' }],
      maxCandidatesPerRequirement: 8,
    }

    await expect(client.matchRequirements(request)).resolves.toEqual(
      expect.objectContaining({ catalogRevision: 'revision-a' }),
    )
    expect(requests).toEqual([{ url: 'https://resource.invalid/api/resource-catalog/matches', body: request }])
  })

  test('lists compact Packs through the Pack catalog endpoint', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    const client = createResourceSelectionClient({
      baseUrl: 'https://resource.invalid/',
      serviceToken: 'token',
      fetchImpl: async (input, init) => {
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
        })
        return Response.json({
          items: [catalogPack()],
          total: 1,
          facets,
        })
      },
    })
    await expect(
      client.listPacks({ filters: { dimensions: ['3D'] }, limit: 8 }),
    ).resolves.toEqual(expect.objectContaining({ total: 1 }))
    expect(requests).toEqual([
      {
        url: 'https://resource.invalid/api/resource-catalog/packs',
        body: { filters: { dimensions: ['3D'] }, limit: 8 },
      },
    ])
  })

  test('inspects only the selected Pack elements', async () => {
    const requests: string[] = []
    const client = createResourceSelectionClient({
      baseUrl: 'https://resource.invalid',
      serviceToken: 'token',
      fetchImpl: async input => {
        requests.push(String(input))
        return Response.json({ items: [catalogElement()], total: 1, facets })
      },
    })
    await expect(client.inspectPack('pack/a', { limit: 4 })).resolves.toEqual(
      expect.objectContaining({ total: 1 }),
    )
    expect(requests).toEqual([
      'https://resource.invalid/api/resource-catalog/packs/pack%2Fa/elements',
    ])
  })

  test('resolves exact resource identities through the sole acquisition endpoint', async () => {
    const client = createResourceSelectionClient({
      baseUrl: 'https://resource.invalid',
      serviceToken: 'token',
      fetchImpl: async input => {
        expect(String(input)).toBe(
          'https://resource.invalid/api/resource-library/resolve',
        )
        return Response.json({
          selections: [
            {
              resourceId: 'resource-a',
              packId: 'pack-a',
              packVersion: '1.0.0',
              elementId: 'element-a',
              elementPath: 'model.glb',
              sourceUrl: 'https://download.invalid/model',
              selectionReason: ['Observed target fit.'],
              dependencies: [],
            },
          ],
        })
      },
    })
    await expect(
      client.resolveResources([
        {
          resourceId: 'resource-a',
          packId: 'pack-a',
          expectedPackVersion: '1.0.0',
          elementId: 'element-a',
          selectionReason: ['Observed target fit.'],
        },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        resourceId: 'resource-a',
        packId: 'pack-a',
        elementId: 'element-a',
      }),
    ])
  })

  test('rejects an invalid Pack response instead of inventing metadata', async () => {
    const client = createResourceSelectionClient({
      baseUrl: 'https://resource.invalid',
      serviceToken: 'token',
      fetchImpl: async () => Response.json({ items: [], total: 0 }),
    })
    await expect(client.listPacks({})).rejects.toThrow(
      'Resource catalog response is invalid',
    )
  })
})

function catalogPack() {
  return {
    packId: 'pack-a',
    packVersion: '1.0.0',
    packName: 'Pack',
    dimension: '3D',
    primaryCategory: 'environment',
    styles: [],
    gameTypes: [],
    tags: [],
    usageTags: [],
    assetKinds: [],
    capabilities: [],
    formats: ['glb'],
    readyElementCount: 1,
  }
}

function catalogElement() {
  return {
    packId: 'pack-a',
    packVersion: '1.0.0',
    packName: 'Pack',
    packStyles: [],
    packGameTypes: [],
    elementId: 'element-a',
    elementName: 'Element',
    elementPath: 'model.glb',
    category: 'environment',
    usageTags: [],
    dimension: '3D',
    capabilities: [],
    relations: [],
    dependencyCount: 0,
  }
}
