import { describe, expect, test } from 'bun:test'
import { createResourceSelectionClient } from '../beegame/resource-selection-client'

describe('resource exploration client', () => {
  test('sends the service token and returns an unsigned catalog page', async () => {
    const client = createResourceSelectionClient({ baseUrl: 'http://resource.test/', serviceToken: 'token', fetchImpl: async (url, init) => {
      expect(String(url)).toEndWith('/api/resource-catalog/packs/pack/elements')
      expect(new Headers(init?.headers).get('x-beegame-resource-service-token')).toBe('token')
      return Response.json({
        items: [{ packId: 'pack', packVersion: '1', packName: 'Nature Kit', packStyle: 'Stylized', packStyles: ['Stylized'], packGameTypes: ['Adventure'], elementId: 'oak', elementName: 'Oak Tree', elementPath: 'oak.glb', category: 'models', usageTags: ['vegetation'], dimension: '3D', assetKind: 'model', capabilities: [], technicalFacts: { boundsSizeY: 6, hasNormals: true }, relations: [], dependencyCount: 0 }],
        total: 1,
        facets: facets(),
      })
    } })
    await expect(client.browsePackElements('pack', { filters: { formats: ['glb'] } })).resolves.toEqual(expect.objectContaining({
      items: [expect.objectContaining({ elementId: 'oak', elementName: 'Oak Tree', packName: 'Nature Kit', usageTags: ['vegetation'], technicalFacts: { boundsSizeY: 6, hasNormals: true } })],
    }))
  })

  test('requests signed URLs only after explicit selection', async () => {
    const client = createResourceSelectionClient({ baseUrl: 'http://resource.test/', serviceToken: 'token', fetchImpl: async (url) => {
      expect(String(url)).toEndWith('/api/resource-imports/resolve')
      return Response.json({ selections: [{
        importId: 'tree', packId: 'pack', packVersion: '1',
        elementId: 'oak', elementPath: 'oak.glb', sourceUrl: 'https://signed',
        technicalFacts: { boundsSizeY: 6, hasNormals: true },
        selectionReason: ['Primary vegetation kit'], dependencies: [],
      }] })
    } })
    await expect(client.resolveSelections([{ importId: 'tree', packId: 'pack', expectedPackVersion: '1', elementId: 'oak', selectionReason: ['Primary vegetation kit'] }])).resolves.toEqual([
      expect.objectContaining({ importId: 'tree', sourceUrl: 'https://signed', technicalFacts: { boundsSizeY: 6, hasNormals: true } }),
    ])
  })

  test('retries a structured transient transport failure', async () => {
    let calls = 0
    const client = createResourceSelectionClient({
      baseUrl: 'http://resource.test/',
      serviceToken: 'token',
      transportRetryDelayMs: 0,
      fetchImpl: async () => {
        calls += 1
        if (calls === 1) {
          throw Object.assign(new Error('transport unavailable'), {
            cause: { code: 'CERTIFICATE_VERIFY_FAILED' },
          })
        }
        return Response.json({ items: [], total: 0, facets: facets() })
      },
    })

    await expect(client.browsePacks({})).resolves.toMatchObject({ items: [] })
    expect(calls).toBe(2)
  })

  test('does not retry an unclassified application failure', async () => {
    let calls = 0
    const client = createResourceSelectionClient({
      baseUrl: 'http://resource.test/',
      serviceToken: 'token',
      transportRetryDelayMs: 0,
      fetchImpl: async () => {
        calls += 1
        throw new Error('request rejected')
      },
    })

    await expect(client.browsePacks({})).rejects.toThrow('request rejected')
    expect(calls).toBe(1)
  })
})

function facets() {
  return { dimensions: ['3D'], primaryCategories: ['3d-assets'], categories: ['models'], styles: ['Stylized'], gameTypes: ['Adventure'], packTags: [], usageTags: ['vegetation'], assetKinds: ['model'], capabilities: [], formats: ['glb'] }
}
