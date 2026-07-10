import { describe, expect, test } from 'bun:test'
import { buildElementUploadRow, createSupabaseResourceLifecycleHandlers, sanitizeStorageBasename } from '../index'

const packRow = { id: 'pack-1', name: 'Pack', style: 'Stylized', game_types: [], dimension: 'agnostic', primary_category: 'world-scene', categories: [], license: 'internal', version: '1.0.0', status: 'draft', cover_path: 'cover/new.png' }

describe('Supabase resource lifecycle handlers', () => {
  test('paginates storage cleanup and only deletes objects inside the Pack prefix', async () => {
    const deleted: string[] = []
    const offsets: number[] = []
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('/object/list/')) {
          const { offset } = JSON.parse(String(init?.body)) as { offset: number }
          offsets.push(offset)
          return Response.json(offset === 0 ? Array.from({ length: 1000 }, (_, index) => ({ name: `assets/${index}.png` })) : [{ name: 'cover/end.png' }, { name: '../outside.png' }])
        }
        if (url.includes('/storage/v1/object/')) { deleted.push(url); return new Response(null, { status: 200 }) }
        return Response.json([])
      },
    })

    await expect(handlers.deleteResourcePack('pack-1')).resolves.toBe(true)
    expect(offsets).toEqual([0, 1000])
    expect(deleted).toHaveLength(1001)
    expect(deleted.some(url => url.includes('outside.png'))).toBe(false)
  })

  test('commits a cover replacement before deleting a safe old cover', async () => {
    const events: string[] = []
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('select=cover_path')) return Response.json([{ cover_path: 'cover/old.png' }])
        if (url.includes('/storage/v1/object/')) { events.push(init?.method === 'POST' ? 'upload' : 'delete') ; return new Response(null, { status: 200 }) }
        if (init?.method === 'PATCH') { events.push('patch'); return Response.json([packRow]) }
        throw new Error(`Unexpected request: ${url}`)
      },
    })
    const form = new FormData(); form.set('file', new File(['cover'], '../new.png', { type: 'image/png' }))

    await expect(handlers.uploadPackCover('pack-1', new Request('https://resource.test', { method: 'POST', body: form }))).resolves.toEqual(expect.objectContaining({ coverPath: 'cover/new.png' }))
    expect(events).toEqual(['upload', 'patch', 'delete'])
  })

  test('rolls back a newly uploaded cover when its database patch fails', async () => {
    const events: string[] = []
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('select=cover_path')) return Response.json([{ cover_path: '../../outside.png' }])
        if (url.includes('/storage/v1/object/')) { events.push(init?.method === 'POST' ? 'upload' : 'delete'); return new Response(null, { status: 200 }) }
        if (init?.method === 'PATCH') return new Response(null, { status: 500 })
        throw new Error(`Unexpected request: ${url}`)
      },
    })
    const form = new FormData(); form.set('file', new File(['cover'], 'new.png', { type: 'image/png' }))

    await expect(handlers.uploadPackCover('pack-1', new Request('https://resource.test', { method: 'POST', body: form }))).rejects.toThrow('cover update failed')
    expect(events).toEqual(['upload', 'delete'])
  })

  test('sanitizes cover basenames and rejects empty or traversal-only values', () => {
    expect(sanitizeStorageBasename('../new.png')).toBe('new.png')
    expect(sanitizeStorageBasename('nested\\new.png')).toBe('new.png')
    expect(() => sanitizeStorageBasename('../')).toThrow('Cover filename is invalid')
  })

  test('signs only an element found under its requested Pack', async () => {
    const signedRequests: string[] = []
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('element-1')) return Response.json([{ pack_id: 'pack-1', path: 'assets/item.glb' }])
        if (url.includes('/object/sign/')) { signedRequests.push(url); return Response.json({ signedURL: '/storage/v1/object/sign/beegame-resource-packs/pack-1/assets/item.glb?token=short' }) }
        return Response.json([])
      },
    })
    await expect(handlers.getElementResourceUrl('pack-1', 'element-1')).resolves.toContain('token=short')
    await expect(handlers.getElementResourceUrl('pack-1', 'missing')).rejects.toThrow('not found')
    expect(signedRequests).toHaveLength(1)
  })

  test('builds universal element upload specs and infers a conservative kind', () => {
    expect(buildElementUploadRow('pack-1', 'assets', new File(['mesh'], 'mesh.GLB', { type: 'model/gltf-binary' }))).toMatchObject({
      pack_id: 'pack-1', category: 'assets', kind: 'model', specs: { size: 4, mimeType: 'model/gltf-binary', extension: 'glb' },
    })
  })
})
