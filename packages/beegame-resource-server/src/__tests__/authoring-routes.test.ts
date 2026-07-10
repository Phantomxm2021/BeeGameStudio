import { describe, expect, test } from 'bun:test'
import { createInMemoryResourceRepository } from '../../../beegame-resource-core/src'
import { createBeeGameResourceServerApp } from '../app'

describe('resource authoring routes', () => {
  test('creates a draft Pack and its folders', async () => {
    const repository = createInMemoryResourceRepository({ packs: [], elements: [] })
    const app = createBeeGameResourceServerApp({ repository, currentUser: { id: 'admin', role: 'owner', permissions: ['resources.manage'] } })
    const packResponse = await app.fetch(new Request('http://resource.test/api/resource-packs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'pack-1', name: 'Forest', style: 'Painterly', dimension: 'agnostic', primaryCategory: 'world-scene', gameTypes: ['adventure'], categories: ['environment'] }),
    }))
    expect(packResponse.status).toBe(201)
    expect((await packResponse.json()).pack).toMatchObject({ id: 'pack-1', primaryCategory: 'world-scene', status: 'draft' })

    const folderResponse = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/folders', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'folder-1', name: 'Environment' }),
    }))
    expect(folderResponse.status).toBe(201)
    expect((await folderResponse.json()).folder).toMatchObject({ path: 'Environment' })
  })

  test('rejects Pack creation without a primary category', async () => {
    const app = createBeeGameResourceServerApp({ repository: createInMemoryResourceRepository({ packs: [], elements: [] }), currentUser: { id: 'admin', role: 'owner', permissions: ['resources.manage'] } })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'pack-1', name: 'Forest', style: 'Painterly', dimension: 'agnostic', gameTypes: ['adventure'], categories: ['environment'] }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: { code: 'invalid_pack', message: 'Pack primary category is unsupported' } })
  })

  test('rejects an unsupported Pack primary category', async () => {
    const app = createBeeGameResourceServerApp({ repository: createInMemoryResourceRepository({ packs: [], elements: [] }), currentUser: { id: 'admin', role: 'owner', permissions: ['resources.manage'] } })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'pack-1', name: 'Forest', style: 'Painterly', dimension: 'agnostic', primaryCategory: 'characters', gameTypes: ['adventure'], categories: ['environment'] }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: { code: 'invalid_pack', message: 'Pack primary category is unsupported' } })
  })
})
