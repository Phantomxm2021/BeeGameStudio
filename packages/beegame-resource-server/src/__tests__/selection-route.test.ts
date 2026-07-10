import { describe, expect, test } from 'bun:test'
import { createInMemoryResourceRepository } from '@bee-game-studio/beegame-resource-core'
import { createBeeGameResourceServerApp } from '../app'

describe('resource selection route', () => {
  test('returns signed published resource selections for valid requirements', async () => {
    const repository = createInMemoryResourceRepository({
      packs: [{ id: 'fantasy', name: 'Fantasy', style: 'Fantasy', gameTypes: ['RPG'], dimension: '3D', primaryCategory: '3d-assets', categories: ['models'], license: 'internal', version: '1.0.0', status: 'published' }],
      elements: [{ id: 'oak', packId: 'fantasy', name: 'Oak', path: 'models/oak.glb', category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready' }],
    })
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin', role: 'owner' },
      getElementResourceUrl: async () => 'https://storage.example/signed-oak',
    })

    const response = await app.fetch(new Request('http://resource.test/api/resource-selections', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requirements: [{ slotId: 'environment.tree', category: 'models', dimension: '3D', acceptedFormats: ['glb'], styles: ['Fantasy'] }] }),
    }))

    expect(response.status).toBe(200)
    expect((await response.json()).selections).toEqual([expect.objectContaining({ packId: 'fantasy', elementId: 'oak', sourceUrl: 'https://storage.example/signed-oak' })])
  })

  test('does not return a draft Pack element', async () => {
    const repository = createInMemoryResourceRepository({
      packs: [{ id: 'draft', name: 'Draft', style: 'Fantasy', gameTypes: ['RPG'], dimension: '3D', primaryCategory: '3d-assets', categories: ['models'], license: 'internal', version: '1.0.0', status: 'draft' }],
      elements: [{ id: 'oak', packId: 'draft', name: 'Oak', path: 'models/oak.glb', category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready' }],
    })
    const app = createBeeGameResourceServerApp({ repository, currentUser: { id: 'admin', role: 'owner' }, getElementResourceUrl: async () => 'unexpected' })

    const response = await app.fetch(new Request('http://resource.test/api/resource-selections', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requirements: [{ slotId: 'tree', category: 'models' }] }),
    }))

    expect((await response.json()).selections).toEqual([])
  })
})
