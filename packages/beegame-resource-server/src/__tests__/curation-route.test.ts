import { describe, expect, test } from 'bun:test'
import { createInMemoryResourceRepository } from '../../../beegame-resource-core/src'
import { createBeeGameResourceServerApp } from '../app'

function repositoryWithPendingCuration() {
  return createInMemoryResourceRepository({
    packs: [{
      id: 'curation-pack', name: 'Curation Pack', styles: ['stylized'], gameTypes: ['strategy'],
      dimension: '3D', primaryCategory: '3d-assets', categories: ['models'], license: 'internal', version: '1.0.0', status: 'published',
    }],
    elements: [
      {
        id: 'element-a', packId: 'curation-pack', name: 'Element A', path: 'models/a.glb', category: 'models', kind: 'model',
        assetKind: 'model', specs: { contentHash: 'a'.repeat(64) }, dependencies: [], status: 'ready',
        semanticSuggestion: { sourceContentHash: 'a'.repeat(64), usageTags: ['building'], styles: [], relations: [], evidence: [{ source: 'content_profile', reference: 'test', observation: 'confirmed folder policy' }], confidence: 'medium', generatedAt: '2026-01-01T00:00:00.000Z', generatorRevision: 'test' },
      },
      {
        id: 'element-b', packId: 'curation-pack', name: 'Element B', path: 'models/b.glb', category: 'models', kind: 'model',
        assetKind: 'model', specs: { contentHash: 'b'.repeat(64) }, dependencies: [], status: 'ready',
        semanticSuggestion: { sourceContentHash: 'b'.repeat(64), usageTags: ['building'], styles: [], relations: [], evidence: [{ source: 'content_profile', reference: 'test', observation: 'confirmed folder policy' }], confidence: 'medium', generatedAt: '2026-01-01T00:00:00.000Z', generatorRevision: 'test' },
      },
    ],
  })
}

describe('resource curation routes', () => {
  test('returns pending suggestions without exposing them through catalog search', async () => {
    const app = createBeeGameResourceServerApp({
      repository: repositoryWithPendingCuration(),
      currentUser: { id: 'admin', role: 'owner', permissions: ['resources.manage'] },
    })
    const queue = await app.fetch(new Request('http://resource.test/api/resource-packs/curation-pack/curation'))
    expect(queue.status).toBe(200)
    expect(await queue.json()).toEqual(expect.objectContaining({ usageTagOptions: expect.arrayContaining(['building']), items: expect.arrayContaining([expect.objectContaining({ id: 'element-a', semanticSuggestion: expect.any(Object) })]) }))
  })

  test('confirms a selected batch atomically and clears suggestions', async () => {
    const app = createBeeGameResourceServerApp({
      repository: repositoryWithPendingCuration(),
      currentUser: { id: 'admin', role: 'owner', permissions: ['resources.manage'] },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/curation-pack/curation/confirm', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decisions: [
        { elementId: 'element-a', usageTags: ['building'], sourceContentHash: 'a'.repeat(64), suggestionRevision: 'test' },
        { elementId: 'element-b', usageTags: ['environment'], sourceContentHash: 'b'.repeat(64), suggestionRevision: 'test' },
      ] }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ updatedElementIds: ['element-a', 'element-b'] }))
  })

  test('rejects a legacy shared-tag confirmation payload', async () => {
    const app = createBeeGameResourceServerApp({
      repository: repositoryWithPendingCuration(),
      currentUser: { id: 'admin', role: 'owner', permissions: ['resources.manage'] },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/curation-pack/curation/confirm', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ elementIds: ['element-a', 'element-b'], usageTags: ['building'] }),
    }))
    expect(response.status).toBe(400)
  })
})
