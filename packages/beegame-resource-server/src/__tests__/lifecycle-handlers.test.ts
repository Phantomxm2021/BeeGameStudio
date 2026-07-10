import { describe, expect, test } from 'bun:test'
import { buildElementUploadRow, createSupabaseResourceLifecycleHandlers, sanitizeStorageBasename, toElementRow, toResourceElement } from '../index'

const packRow = { id: 'pack-1', name: 'Pack', style: 'Stylized', game_types: [], dimension: 'agnostic', primary_category: 'world-scene', categories: [], license: 'internal', version: '1.0.0', status: 'draft', cover_path: 'cover/new.png' }

describe('Supabase resource lifecycle handlers', () => {
  test('restarts storage listing after deletion so shifted objects are not skipped', async () => {
    const deleted: string[] = []
    const offsets: number[] = []
    let page = 0
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('/object/list/')) {
          const { offset } = JSON.parse(String(init?.body)) as { offset: number }
          offsets.push(offset)
          page += 1
          return Response.json(page === 1
            ? Array.from({ length: 1000 }, (_, index) => ({ name: `assets/${index}.png` }))
            : page === 2 ? [{ name: 'cover/end.png' }] : [])
        }
        if (url.includes('/storage/v1/object/')) { deleted.push(url); return new Response(null, { status: 200 }) }
        if (init?.method === 'DELETE') return Response.json([packRow])
        return Response.json([])
      },
    })

    await expect(handlers.deleteResourcePack('pack-1')).resolves.toBe(true)
    expect(offsets).toEqual([0, 0, 0])
    expect(deleted).toHaveLength(1001)
  })

  test('halts deletion rather than looping over an unsafe legacy storage object', async () => {
    let deletedPack = false
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('/object/list/')) return Response.json([{ name: '../legacy-object' }])
        if (init?.method === 'DELETE') deletedPack = true
        return Response.json([])
      },
    })

    await expect(handlers.deleteResourcePack('pack-1')).rejects.toThrow('unsafe resource storage entry')
    expect(deletedPack).toBe(false)
  })

  test('does not delete the Pack record if an object cleanup fails', async () => {
    let deletedPack = false
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('/object/list/')) return Response.json([{ name: 'assets/item.glb' }])
        if (url.includes('/storage/v1/object/')) return new Response(null, { status: 500 })
        if (init?.method === 'DELETE') { deletedPack = true; return Response.json([]) }
        return Response.json([])
      },
    })

    await expect(handlers.deleteResourcePack('pack-1')).rejects.toThrow('storage deletion failed (500)')
    expect(deletedPack).toBe(false)
  })

  test('commits a cover replacement before deleting a safe old cover', async () => {
    const events: string[] = []
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('select=cover_path')) return Response.json([{ cover_path: 'cover/old.png' }])
        if (url.includes('/object/sign/')) return Response.json({ signedURL: '/storage/v1/object/sign/beegame-resource-packs/pack-1/cover/new.png?token=cover' })
        if (url.includes('/storage/v1/object/')) { events.push(init?.method === 'POST' ? 'upload' : 'delete') ; return new Response(null, { status: 200 }) }
        if (init?.method === 'PATCH') { events.push('patch'); return Response.json([packRow]) }
        throw new Error(`Unexpected request: ${url}`)
      },
    })
    const form = new FormData(); form.set('file', new File(['cover'], '../new.png', { type: 'image/png' }))

    await expect(handlers.uploadPackCover('pack-1', new Request('https://resource.test', { method: 'POST', body: form }))).resolves.toEqual(expect.objectContaining({ coverPath: 'https://supabase.test/storage/v1/object/sign/beegame-resource-packs/pack-1/cover/new.png?token=cover' }))
    expect(events).toEqual(['upload', 'patch', 'delete'])
  })

  test('rolls back a newly uploaded cover when its database patch fails', async () => {
    const events: string[] = []
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('select=cover_path')) return Response.json([{ cover_path: '../../outside.png' }])
        if (url.includes('/object/sign/')) return Response.json({ signedURL: '/storage/v1/object/sign/beegame-resource-packs/pack-1/cover/new.png?token=cover' })
        if (url.includes('/storage/v1/object/')) { events.push(init?.method === 'POST' ? 'upload' : 'delete'); return new Response(null, { status: 200 }) }
        if (init?.method === 'PATCH') return new Response(null, { status: 500 })
        throw new Error(`Unexpected request: ${url}`)
      },
    })
    const form = new FormData(); form.set('file', new File(['cover'], 'new.png', { type: 'image/png' }))

    await expect(handlers.uploadPackCover('pack-1', new Request('https://resource.test', { method: 'POST', body: form }))).rejects.toThrow('cover update failed')
    expect(events).toEqual(['upload', 'delete'])
  })

  test('maps lifecycle mutation rows to the public camelCase contract', async () => {
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async (_input, init) => {
        if (init?.method === 'PATCH') return Response.json([{ ...packRow, element_count: 3 }])
        return Response.json([])
      },
    })

    await expect(handlers.updateResourcePack('pack-1', { gameTypes: ['puzzle'] })).resolves.toEqual(expect.objectContaining({
      gameTypes: [], primaryCategory: 'world-scene', coverPath: 'cover/new.png', elementCount: 3,
    }))
  })

  test('reports an absent Pack mutation instead of mapping an undefined row', async () => {
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async () => Response.json([]),
    })

    await expect(handlers.updateResourcePack('missing', { name: 'Missing' })).rejects.toThrow('Resource Pack not found')
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

  test('rejects unsafe element paths before requesting a signed URL', async () => {
    let requestedSignature = false
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('element-1')) return Response.json([{ pack_id: 'pack-1', path: '../outside.glb' }])
        if (url.includes('/object/sign/')) requestedSignature = true
        return Response.json({ signedURL: '/unexpected' })
      },
    })

    await expect(handlers.getElementResourceUrl('pack-1', 'element-1')).rejects.toThrow('path is invalid')
    expect(requestedSignature).toBe(false)
  })

  test('builds universal element upload specs and infers a conservative kind', () => {
    expect(buildElementUploadRow('pack-1', 'assets', new File(['mesh'], 'mesh.GLB', { type: 'model/gltf-binary' }))).toMatchObject({
      pack_id: 'pack-1', category: 'assets', kind: 'model', specs: { size: 4, mimeType: 'model/gltf-binary', extension: 'glb' },
    })
  })

  test('maps an element mutation row to the public camelCase contract', () => {
    expect(toResourceElement({
      id: 'element-1', pack_id: 'pack-1', name: 'hero.glb', path: 'models/hero.glb',
      category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready',
      style_override: 'stylized', dimension_override: '3D',
    })).toEqual(expect.objectContaining({ packId: 'pack-1', styleOverride: 'stylized', dimensionOverride: '3D' }))
  })

  test('preserves null to clear an element style override', () => {
    expect(toElementRow({ styleOverride: null })).toEqual({ style_override: null })
  })
})
