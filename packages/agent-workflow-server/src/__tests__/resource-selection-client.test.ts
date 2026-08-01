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
  test('browses the generic catalog without requirement binding', async () => {
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
          items: [],
          total: 0,
          facets,
          catalogRevision: 'a'.repeat(64),
          normalizedFilters: {},
        })
      },
    })
    await expect(
      client.browseCatalog({ filters: { dimensions: ['3D'] }, limit: 12 }),
    ).resolves.toEqual(
      expect.objectContaining({ total: 0, catalogRevision: 'a'.repeat(64) }),
    )
    expect(requests).toEqual([
      {
        url: 'https://resource.invalid/api/resource-catalog/elements',
        body: { filters: { dimensions: ['3D'] }, limit: 12 },
      },
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

  test('rejects an invalid catalog snapshot instead of inventing empty metadata', async () => {
    const client = createResourceSelectionClient({
      baseUrl: 'https://resource.invalid',
      serviceToken: 'token',
      fetchImpl: async () => Response.json({ items: [], total: 0 }),
    })
    await expect(client.browseCatalog({})).rejects.toThrow(
      'Resource catalog snapshot is invalid',
    )
  })
})
