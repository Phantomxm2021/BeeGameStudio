import { describe, expect, test } from 'vitest'
import { createResourceLibraryApi } from './resourceLibraryApi'

describe('resource library API', () => {
  test('creates a draft Pack from authoring metadata', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const api = createResourceLibraryApi(async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify({ pack: { id: 'pack-1', name: 'Forest', status: 'draft', elementCount: 0 } }), { status: 201 })
    })
    await expect(api.createPack({ name: 'Forest',
        styles: ['Painterly'], dimension: 'agnostic', primaryCategory: 'ui-kit', gameTypes: ['adventure'], categories: [] })).resolves.toMatchObject({ id: 'pack-1' })
    expect(requests[0].url).toBe('/api/resource-packs')
    expect(requests[0].init?.method).toBe('POST')
    expect(JSON.parse(String(requests[0].init?.body))).toMatchObject({ primaryCategory: 'ui-kit', categories: [] })
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
    await api.listElements('pack/1', 'sprites')
    expect(requests[0]).toBe(
      '/api/resource-packs/pack%2F1/elements?category=sprites',
    )
  })

  test('encodes folder path filters separately from category', async () => {
    const requests: string[] = []
    const api = createResourceLibraryApi(async input => { requests.push(String(input)); return new Response(JSON.stringify({ elements: [] }), { status: 200 }) })
    await api.listElements('pack-1', undefined, 'kenney_food-kit')
    expect(requests[0]).toBe('/api/resource-packs/pack-1/elements?folderPath=kenney_food-kit')
  })

  test('lists Pack folders through the authoring API', async () => {
    const api = createResourceLibraryApi(async () => new Response(JSON.stringify({ folders: [{ id: 'folder-1', packId: 'pack-1', name: 'Environment', path: 'Environment' }] }), { status: 200 }))
    await expect(api.listFolders('pack-1')).resolves.toHaveLength(1)
  })

  test('updates element semantic metadata', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const api = createResourceLibraryApi(async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify({ element: { id: 'element-1', packId: 'pack-1', name: 'Tree', path: 'Models/Tree.glb', category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready' } }), { status: 200 })
    })
    await api.updateElement('pack-1', 'element-1', { category: 'models', kind: 'model' })
    expect(requests[0].url).toBe('/api/resource-packs/pack-1/elements/element-1')
    expect(requests[0].init?.method).toBe('PATCH')
  })

  test('publishes a validated Pack', async () => {
    const requests: string[] = []
    const api = createResourceLibraryApi(async (input) => { requests.push(String(input)); return new Response(JSON.stringify({ pack: { id: 'pack-1', name: 'Forest', status: 'published', elementCount: 1 } }), { status: 200 }) })
    await expect(api.publishPack('pack-1')).resolves.toMatchObject({ status: 'published' })
    expect(requests[0]).toBe('/api/resource-packs/pack-1/publish')
  })

  test('deletes a Pack through the lifecycle endpoint', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const api = createResourceLibraryApi(async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(null, { status: 204 })
    })

    await expect(api.deletePack('pack/1')).resolves.toBeUndefined()

    expect(requests[0].url).toBe('/api/resource-packs/pack%2F1')
    expect(requests[0].init?.method).toBe('DELETE')
  })

  test('uploads a Pack cover as multipart form data', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const api = createResourceLibraryApi(async (input, init) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify({ pack: { id: 'pack-1', name: 'Forest', elementCount: 0 } }), { status: 200 })
    })
    const file = new File(['cover'], 'cover.png', { type: 'image/png' })

    await expect(api.uploadPackCover('pack-1', file)).resolves.toMatchObject({ id: 'pack-1' })

    expect(requests[0].url).toBe('/api/resource-packs/pack-1/cover')
    expect(requests[0].init?.method).toBe('POST')
    expect(requests[0].init?.body).toBeInstanceOf(FormData)
    expect((requests[0].init?.body as FormData).get('file')).toBe(file)
    expect(requests[0].init?.headers).toBeUndefined()
  })

  test('gets the signed URL for an element resource', async () => {
    const requests: string[] = []
    const api = createResourceLibraryApi(async input => {
      requests.push(String(input))
      return new Response(JSON.stringify({ url: 'https://signed.example/file' }), { status: 200 })
    })

    await expect(api.getElementResourceUrl('pack/1', 'element/1')).resolves.toBe('https://signed.example/file')

    expect(requests[0]).toBe('/api/resource-packs/pack%2F1/elements/element%2F1/resource-url')
  })

  test('turns a forbidden response into a typed error', async () => {
    const api = createResourceLibraryApi(async () => new Response(
      JSON.stringify({ error: { code: 'forbidden', message: 'No access' } }),
      { status: 403 },
    ))
    await expect(api.listPacks()).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })
})
