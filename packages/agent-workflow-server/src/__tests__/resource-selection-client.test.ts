import { describe, expect, test } from 'bun:test'
import { createResourceSelectionClient } from '../beegame/resource-selection-client'

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
            unclassifiedElementCount: 0,
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

  test('resolves exact resource identities through the sole acquisition endpoint', async () => {
    const client = createResourceSelectionClient({
      baseUrl: 'https://resource.invalid',
      serviceToken: 'token',
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe(
          'https://resource.invalid/api/resource-library/resolve',
        )
        expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
          catalogRevision: 'revision-a',
        }))
        return Response.json({
          selections: [
            {
              resourceId: 'resource-a',
              packId: 'pack-a',
              packVersion: '1.0.0',
              elementId: 'element-a',
              elementPath: 'model.glb',
              sourceUrl: 'https://download.invalid/model',
              sourceHash: 'a'.repeat(64),
              selectionReason: ['Observed target fit.'],
              dependencies: [],
            },
          ],
        })
      },
    })
    await expect(
      client.resolveResources('revision-a', [
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

  test('rejects an invalid match response instead of inventing metadata', async () => {
    const client = createResourceSelectionClient({
      baseUrl: 'https://resource.invalid',
      serviceToken: 'token',
      fetchImpl: async () => Response.json({ groups: [] }),
    })
    await expect(client.matchRequirements({ requirements: [], deliveryCapabilities: [] })).rejects.toThrow(
      'Resource requirement match response is invalid',
    )
  })
})

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
