import { describe, expect, test } from 'bun:test'
import { createInMemoryResourceRepository } from '../../../beegame-resource-core/src'
import { createBeeGameResourceServerApp } from '../app'

const repository = createInMemoryResourceRepository({
  packs: [{
    id: 'pack-1', name: 'Example Pack', style: 'Stylized', gameTypes: ['adventure'],
    dimension: '2D', categories: ['characters'], license: 'internal', version: '1.0.0', status: 'published',
  }],
  elements: [{
    id: 'element-1', packId: 'pack-1', name: 'Character Idle', path: 'characters/idle.png',
    category: 'characters', kind: 'sprite-sheet', preview: { kind: 'image', path: 'previews/idle.png' },
    specs: { width: 256, height: 256 }, dependencies: [], status: 'ready',
  }],
})

describe('resource service app', () => {
  test('allows browser cross-origin requests and preflight checks', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
    })
    const preflight = await app.fetch(new Request('http://resource.test/api/resource-packs', { method: 'OPTIONS' }))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*')
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs'))
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('lists Pack summaries for an Admin user', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ packs: [expect.objectContaining({ id: 'pack-1', elementCount: 1 })] })
  })

  test('accepts an Admin Pack import through the multipart route', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      importResourcePack: async (request) => {
        expect((await request.formData()).get('file')).toBeTruthy()
        return { id: 'imported-pack', name: 'Imported Pack' }
      },
    })
    const form = new FormData()
    form.set('file', new File(['zip'], 'pack.zip', { type: 'application/zip' }))
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/import', { method: 'POST', body: form }))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ pack: { id: 'imported-pack', name: 'Imported Pack' } })
  })

  test('rejects a non-admin user', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'viewer-1', role: 'viewer', permissions: [] },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs'))
    expect(response.status).toBe(403)
  })

  test('returns elements with an explicit category filter', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/elements?category=characters'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ elements: [expect.objectContaining({ id: 'element-1' })] })
  })

  test('filters elements by folder path without treating it as a category', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/elements?folderPath=characters'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ elements: [expect.objectContaining({ id: 'element-1' })] })
  })

  test('keeps CORS headers when a folder repository read fails', async () => {
    const failingRepository = { ...repository, listFolders: async () => { throw new Error('folders unavailable') } }
    const app = createBeeGameResourceServerApp({
      repository: failingRepository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/folders'))
    expect(response.status).toBe(500)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.json()).toEqual({ error: { code: 'resource_read_failed', message: 'folders unavailable' } })
  })

  test('returns 404 for an unknown Pack', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/missing'))
    expect(response.status).toBe(404)
  })
})
