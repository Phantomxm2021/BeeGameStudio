import { describe, expect, test } from 'bun:test'
import { createInMemoryResourceRepository } from '../../../beegame-resource-core/src'
import { createBeeGameResourceServerApp } from '../app'
import { toPackUpdateRow } from '../index'

describe('resource authoring routes', () => {
  test('maps Pack updates to the editable database columns only', () => {
    expect(toPackUpdateRow({
      name: 'Updated Pack', gameTypes: ['puzzle'], primaryCategory: 'ui-kit',
      internalOnly: true, coverPath: 'should-not-be-patched', id: 'another-pack',
    })).toEqual({ name: 'Updated Pack', game_types: ['puzzle'], primary_category: 'ui-kit' })
  })

  test('creates a new Pack before it contains any resource elements', async () => {
    const app = createBeeGameResourceServerApp({ repository: createInMemoryResourceRepository({ packs: [], elements: [] }), currentUser: { id: 'admin', role: 'owner', permissions: ['resources.manage'] } })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'empty-pack', name: 'Empty Pack', style: 'Painterly', dimension: 'agnostic', primaryCategory: 'world-scene', gameTypes: ['adventure'], categories: [] }),
    }))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ pack: expect.objectContaining({ id: 'empty-pack', primaryCategory: 'world-scene', categories: [] }) })
  })

  test('rejects a Pack whose contained element categories are not an array', async () => {
    const app = createBeeGameResourceServerApp({ repository: createInMemoryResourceRepository({ packs: [], elements: [] }), currentUser: { id: 'admin', role: 'owner', permissions: ['resources.manage'] } })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'invalid-categories-pack', name: 'Invalid Categories', style: 'Painterly', dimension: 'agnostic', primaryCategory: 'world-scene', gameTypes: ['adventure'], categories: 'environment' }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: { code: 'invalid_pack', message: 'Pack categories must be an array of supported values' } })
  })

  test('rejects a Pack with an unsupported contained element category', async () => {
    const app = createBeeGameResourceServerApp({ repository: createInMemoryResourceRepository({ packs: [], elements: [] }), currentUser: { id: 'admin', role: 'owner', permissions: ['resources.manage'] } })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'unsupported-categories-pack', name: 'Unsupported Categories', style: 'Painterly', dimension: 'agnostic', primaryCategory: 'world-scene', gameTypes: ['adventure'], categories: ['unknown'] }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: { code: 'invalid_pack', message: 'Pack categories must be an array of supported values' } })
  })

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
