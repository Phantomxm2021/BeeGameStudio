import { describe, expect, test } from 'bun:test'
import { createInMemoryResourceRepository } from '../../../beegame-resource-core/src'
import { createBeeGameResourceServerApp } from '../app'

describe('resource authoring routes', () => {
  test('creates a draft Pack and its folders', async () => {
    const repository = createInMemoryResourceRepository({ packs: [], elements: [] })
    const app = createBeeGameResourceServerApp({ repository, currentUser: { id: 'admin', role: 'owner', permissions: ['resources.manage'] } })
    const packResponse = await app.fetch(new Request('http://resource.test/api/resource-packs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'pack-1', name: 'Forest', style: 'Painterly', dimension: 'agnostic', gameTypes: ['adventure'], categories: ['environment'] }),
    }))
    expect(packResponse.status).toBe(201)
    expect((await packResponse.json()).pack).toMatchObject({ id: 'pack-1', status: 'draft' })

    const folderResponse = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/folders', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'folder-1', name: 'Environment' }),
    }))
    expect(folderResponse.status).toBe(201)
    expect((await folderResponse.json()).folder).toMatchObject({ path: 'Environment' })
  })
})
