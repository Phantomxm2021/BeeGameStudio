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
            ? Array.from({ length: 1000 }, (_, index) => ({ name: `assets/${index}.png`, id: `object-${index}` }))
            : page === 2 ? [{ name: 'cover/end.png', id: 'cover-end' }] : [])
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
        if (url.includes('/object/list/')) return Response.json([{ name: 'assets/item.glb', id: 'item' }])
        if (url.includes('/storage/v1/object/')) return new Response(null, { status: 500 })
        if (init?.method === 'DELETE') { deletedPack = true; return Response.json([]) }
        return Response.json([])
      },
    })

    await expect(handlers.deleteResourcePack('pack-1')).rejects.toThrow('storage deletion failed (500)')
    expect(deletedPack).toBe(false)
  })

  test('recursively clears nested virtual folders without deleting directory nodes', async () => {
    const deleted: string[] = []
    let deletedPack = false
    const prefixes: string[] = []
    let modelObjectListed = false
    let coverObjectListed = false
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('/object/list/')) {
          const { prefix } = JSON.parse(String(init?.body)) as { prefix: string }
          prefixes.push(prefix)
          if (prefix === 'pack-1/') return Response.json([{ name: 'models', id: null }, { name: 'cover', metadata: null }])
          if (prefix === 'pack-1/models/') return Response.json([{ name: 'characters', id: null }])
          if (prefix === 'pack-1/models/characters/' && !modelObjectListed) { modelObjectListed = true; return Response.json([{ name: 'knight.fbx', id: 'knight-object' }]) }
          if (prefix === 'pack-1/cover/' && !coverObjectListed) { coverObjectListed = true; return Response.json([{ name: 'preview.png', metadata: { size: 42 } }]) }
          return Response.json([])
        }
        if (url.includes('/storage/v1/object/')) { deleted.push(url); return new Response(null, { status: 200 }) }
        if (init?.method === 'DELETE') { deletedPack = true; return Response.json([packRow]) }
        throw new Error(`Unexpected request: ${url}`)
      },
    })

    await expect(handlers.deleteResourcePack('pack-1')).resolves.toBe(true)
    expect(prefixes).toEqual(expect.arrayContaining(['pack-1/', 'pack-1/models/', 'pack-1/models/characters/', 'pack-1/cover/']))
    expect(deleted).toHaveLength(2)
    expect(deleted.some(url => url.endsWith('/pack-1/models'))).toBe(false)
    expect(deletedPack).toBe(true)
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
      fetchImpl: async (input, init) => {
        if (String(input).includes('/object/sign/')) return Response.json({ signedURL: '/storage/v1/object/sign/beegame-resource-packs/pack-1/cover/new.png?token=cover' })
        if (init?.method === 'PATCH') return Response.json([{ ...packRow, element_count: 3 }])
        return Response.json([])
      },
    })

    await expect(handlers.updateResourcePack('pack-1', { gameTypes: ['puzzle'] })).resolves.toEqual(expect.objectContaining({
      gameTypes: [], primaryCategory: 'world-scene', coverPath: 'https://supabase.test/storage/v1/object/sign/beegame-resource-packs/pack-1/cover/new.png?token=cover', elementCount: 3,
    }))
  })

  test('keeps a signed cover URL after a later Pack metadata edit', async () => {
    let coverPath: string | null = null
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('select=cover_path')) return Response.json([{ cover_path: coverPath }])
        if (url.includes('/object/sign/')) return Response.json({ signedURL: `/storage/v1/object/sign/beegame-resource-packs/pack-1/${coverPath || 'cover/new.png'}?token=cover` })
        if (url.includes('/storage/v1/object/')) return new Response(null, { status: 200 })
        if (init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body)) as { cover_path?: string }
          if (body.cover_path) coverPath = body.cover_path
          return Response.json([{ ...packRow, cover_path: coverPath }])
        }
        throw new Error(`Unexpected request: ${url}`)
      },
    })
    const form = new FormData(); form.set('file', new File(['cover'], 'new.png', { type: 'image/png' }))

    await handlers.uploadPackCover('pack-1', new Request('https://resource.test', { method: 'POST', body: form }))
    const edited = await handlers.updateResourcePack('pack-1', { name: 'Renamed' })

    expect(edited.coverPath).toBe(`https://supabase.test/storage/v1/object/sign/beegame-resource-packs/pack-1/${coverPath}?token=cover`)
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

  test('normalizes Supabase production object-sign responses for element resource URLs', async () => {
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://project.supabase.co', serviceRoleKey: 'secret',
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('element-production')) return Response.json([{ pack_id: 'pack-1', path: 'assets/knight.glb' }])
        if (url.includes('element-storage-v1')) return Response.json([{ pack_id: 'pack-1', path: 'assets/castle.glb' }])
        if (url.includes('element-absolute')) return Response.json([{ pack_id: 'pack-1', path: 'assets/absolute.glb' }])
        if (url.includes('/object/sign/')) {
          return Response.json({ signedURL: url.includes('absolute.glb')
            ? 'https://signed.cdn.test/object/sign/beegame-resource-packs/pack-1/assets/absolute.glb?token=absolute'
            : url.includes('castle.glb')
              ? '/storage/v1/object/sign/beegame-resource-packs/pack-1/assets/castle.glb?token=existing'
              : '/object/sign/beegame-resource-packs/pack-1/assets/knight.glb?token=production' })
        }
        return Response.json([])
      },
    })

    await expect(handlers.getElementResourceUrl('pack-1', 'element-production')).resolves.toBe(
      'https://project.supabase.co/storage/v1/object/sign/beegame-resource-packs/pack-1/assets/knight.glb?token=production',
    )
    await expect(handlers.getElementResourceUrl('pack-1', 'element-storage-v1')).resolves.toBe(
      'https://project.supabase.co/storage/v1/object/sign/beegame-resource-packs/pack-1/assets/castle.glb?token=existing',
    )
    await expect(handlers.getElementResourceUrl('pack-1', 'element-absolute')).resolves.toBe(
      'https://signed.cdn.test/object/sign/beegame-resource-packs/pack-1/assets/absolute.glb?token=absolute',
    )
  })

  test('rejects unrelated relative signed URLs', async () => {
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('element-1')) return Response.json([{ pack_id: 'pack-1', path: 'assets/item.glb' }])
        if (url.includes('/object/sign/')) return Response.json({ signedURL: '/rest/v1/beegame_resource_packs' })
        return Response.json([])
      },
    })

    await expect(handlers.getElementResourceUrl('pack-1', 'element-1')).rejects.toThrow('unexpected relative URL')
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
