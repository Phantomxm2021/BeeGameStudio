import { describe, expect, test } from 'vitest'
import { createResourceLibraryApi } from './resourceLibraryApi'

describe('resource library API', () => {
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

  test('turns a forbidden response into a typed error', async () => {
    const api = createResourceLibraryApi(async () => new Response(
      JSON.stringify({ error: { code: 'forbidden', message: 'No access' } }),
      { status: 403 },
    ))
    await expect(api.listPacks()).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })
})
