import { describe, expect, test } from 'vitest'
import { createResourceLibraryApi } from './resourceLibraryApi'

describe('resource library API', () => {
  test('creates a draft Pack from authoring metadata', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const api = createResourceLibraryApi(async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify({ pack: { id: 'pack-1', name: 'Forest', status: 'draft', elementCount: 0 } }), { status: 201 })
    })
    await expect(api.createPack({ name: 'Forest', style: 'Painterly', dimension: 'agnostic', gameTypes: ['adventure'], categories: ['environment'] })).resolves.toMatchObject({ id: 'pack-1' })
    expect(requests[0].url).toBe('/api/resource-packs')
    expect(requests[0].init?.method).toBe('POST')
  })

  test('lists Packs from the standalone resource service', async () => {
    const requests: string[] = []
    const api = createResourceLibraryApi(async input => {
      requests.push(String(input))
      return new Response(JSON.stringify({ packs: [{ id: 'pack-1', name: 'Example Pack', elementCount: 2 }] }), { status: 200 })
    })
    await expect(api.listPacks()).resolves.toEqual([{ id: 'pack-1', name: 'Example Pack', elementCount: 2 }])
    expect(requests[0]).toBe('/api/resource-packs')
  })

  test('encodes category filters when listing Pack elements', async () => {
    const requests: string[] = []
    const api = createResourceLibraryApi(async input => {
      requests.push(String(input))
      return new Response(JSON.stringify({ elements: [] }), { status: 200 })
    })
    await api.listElements('pack/1', 'characters')
    expect(requests[0]).toBe('/api/resource-packs/pack%2F1/elements?category=characters')
  })

  test('lists Pack folders through the authoring API', async () => {
    const api = createResourceLibraryApi(async () => new Response(JSON.stringify({ folders: [{ id: 'folder-1', packId: 'pack-1', name: 'Environment', path: 'Environment' }] }), { status: 200 }))
    await expect(api.listFolders('pack-1')).resolves.toHaveLength(1)
  })

  test('updates element semantic metadata', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const api = createResourceLibraryApi(async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify({ element: { id: 'element-1', packId: 'pack-1', name: 'Tree', path: 'Environment/Tree.glb', category: 'environment', kind: 'model', specs: {}, dependencies: [], status: 'ready' } }), { status: 200 })
    })
    await api.updateElement('pack-1', 'element-1', { category: 'environment', kind: 'model' })
    expect(requests[0].url).toBe('/api/resource-packs/pack-1/elements/element-1')
    expect(requests[0].init?.method).toBe('PATCH')
  })

  test('publishes a validated Pack', async () => {
    const requests: string[] = []
    const api = createResourceLibraryApi(async (input) => { requests.push(String(input)); return new Response(JSON.stringify({ pack: { id: 'pack-1', name: 'Forest', status: 'published', elementCount: 1 } }), { status: 200 }) })
    await expect(api.publishPack('pack-1')).resolves.toMatchObject({ status: 'published' })
    expect(requests[0]).toBe('/api/resource-packs/pack-1/publish')
  })

  test('turns a forbidden response into a typed error', async () => {
    const api = createResourceLibraryApi(async () => new Response(
      JSON.stringify({ error: { code: 'forbidden', message: 'No access' } }),
      { status: 403 },
    ))
    await expect(api.listPacks()).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })
})
