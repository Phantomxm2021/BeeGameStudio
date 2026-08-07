import { describe, expect, test } from 'bun:test'
import {
  buildElementUploadRow,
  createSupabaseResourceAuthoringHandlers as createAuthoringHandlers,
  createSupabaseResourceLifecycleHandlers as createLifecycleHandlers,
  createSupabaseResourceReinspectionHandler as createReinspectionHandler,
  createSupabaseResourceStorageInspector as createStorageInspector,
  sanitizeStorageBasename,
  toElementRow,
  toResourceElement,
} from '../index'
import type { R2ResourceStorage } from '../r2-resource-storage'

function storageStub(overrides: Partial<R2ResourceStorage> = {}): R2ResourceStorage {
  return {
    upload: async () => ({ storageObjectId: 'object-new' }),
    getFile: async () => undefined,
    createDownloadUrl: async (storageObjectId, packId) => `https://r2.test/${packId}/${storageObjectId}`,
    updateLogicalPath: async () => undefined,
    delete: async () => true,
    listPackObjects: async () => [],
    ...overrides,
  }
}

type AuthoringOptions = Parameters<typeof createAuthoringHandlers>[0]
type LifecycleOptions = Parameters<typeof createLifecycleHandlers>[0]

const createSupabaseResourceAuthoringHandlers = (
  options: Omit<AuthoringOptions, 'r2Storage'> & Partial<Pick<AuthoringOptions, 'r2Storage'>>,
) => createAuthoringHandlers({ r2Storage: storageStub(), ...options })
const createSupabaseResourceLifecycleHandlers = (
  options: Omit<LifecycleOptions, 'r2Storage'> & Partial<Pick<LifecycleOptions, 'r2Storage'>>,
) => createLifecycleHandlers({ r2Storage: storageStub(), ...options })
const createSupabaseResourceReinspectionHandler = (
  options: Omit<AuthoringOptions, 'r2Storage'> & Partial<Pick<AuthoringOptions, 'r2Storage'>>,
) => createReinspectionHandler({ r2Storage: storageStub(), ...options })
const createSupabaseResourceStorageInspector = (
  options: Omit<LifecycleOptions, 'r2Storage'> & Partial<Pick<LifecycleOptions, 'r2Storage'>>,
) => createStorageInspector({ r2Storage: storageStub(), ...options })

const packRow = { id: 'pack-1', name: 'Pack',
  styles: ['Stylized'], game_types: [], dimension: 'agnostic', primary_category: 'world-scene', categories: [], license: 'internal', version: '1.0.0', status: 'draft', cover_path: 'cover/new.png', cover_storage_object_id: 'object-cover' }

describe('Supabase resource lifecycle handlers', () => {
  test('reinspects an existing logical root while preserving authored component roles', async () => {
    let persisted: Record<string, unknown> | undefined
    const current = {
      id: 'element-root', pack_id: 'pack-1', name: 'hero.gltf', path: 'models/hero.gltf',
      category: 'models', kind: 'model', storage_object_id: 'object-root', specs: { source: 'captured' }, usage_tags: ['character'],
      asset_kind: null, capabilities: ['collision', 'contains-animations'], relations: [], dependencies: [], dependency_bindings: [], status: 'ready',
      content_profile: { packaging: 'self-contained', components: [{ id: 'animation-clip:0', kind: 'animation-clip', roles: ['locomotion'] }], inspection: { status: 'complete', source: 'admin' } },
    }
    const handler = createSupabaseResourceReinspectionHandler({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      r2Storage: storageStub({
        getFile: async () => new File([JSON.stringify({ meshes: [{}], skins: [{}], animations: [{}], materials: [{}] })], 'hero.gltf', { type: 'model/gltf+json' }),
      }),
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (init?.method === 'PATCH') {
          persisted = JSON.parse(String(init.body)) as Record<string, unknown>
          return Response.json([{ ...current, ...persisted }])
        }
        if (url.includes('select=id,path,kind')) return Response.json([current])
        return Response.json([current])
      },
    })

    const result = await handler('pack-1', 'element-root')

    expect(result).toEqual(expect.objectContaining({
      assetKind: 'model',
      capabilities: expect.arrayContaining(['collision', 'rigged', 'skinned', 'contains-animations', 'contains-materials']),
      contentProfile: expect.objectContaining({ components: expect.arrayContaining([
        expect.objectContaining({ id: 'animation-clip:0', roles: ['locomotion'] }),
      ]) }),
    }))
    expect(persisted?.specs).toEqual(expect.objectContaining({ source: 'captured', meshCount: 1, skinCount: 1, animationCount: 1 }))
  })

  test('persists deterministic model dependency bindings discovered during inspection', async () => {
    let persisted: Record<string, unknown> | undefined
    const current = {
      id: 'model', pack_id: 'pack-1', name: 'hero.fbx', path: 'Models/hero.fbx', storage_object_id: 'object-model', category: 'models', kind: 'model',
      specs: { unresolvedTextureReferences: 'Textures\\base.png' }, capabilities: [], relations: [], dependencies: [], dependency_bindings: [], status: 'ready',
    }
    const handler = createSupabaseResourceReinspectionHandler({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      r2Storage: storageStub({
        getFile: async () => new File(['Kaydara FBX Binary  \0\x1a\0'], 'hero.fbx', { type: 'application/octet-stream' }),
      }),
      modelProcessor: async () => ({ inspectionStatus: 'complete', unresolvedTextureReferences: 'Textures\\base.png' }),
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('select=id,path,kind')) return Response.json([
          { id: 'model', path: 'Models/hero.fbx', kind: 'model' },
          { id: 'texture', path: 'Textures/base.png', kind: 'image' },
        ])
        if (init?.method === 'PATCH') {
          persisted = JSON.parse(String(init.body)) as Record<string, unknown>
          return Response.json([{ ...current, ...persisted }])
        }
        return Response.json([current])
      },
    })

    await handler('pack-1', 'model')

    expect(persisted).toEqual(expect.objectContaining({
      dependencies: ['texture'],
      dependency_bindings: [{ referencePath: 'Textures/base.png', dependencyElementId: 'texture', kind: 'image' }],
    }))
    expect(persisted?.specs).toEqual(expect.objectContaining({ externalReferences: '["Textures/base.png"]', unresolvedTextureReferences: '' }))
  })

  test('recursively deletes a folder, its descendants, and their R2-backed elements', async () => {
    const storageDeletes: string[] = []
    const metadataDeletes: string[] = []
    const handlers = createSupabaseResourceAuthoringHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      r2Storage: storageStub({
        delete: async storageObjectId => { storageDeletes.push(storageObjectId); return true },
      }),
      fetchImpl: async (input, init) => {
        const url = String(input)
        if ((!init?.method || init.method === 'GET') && url.includes('beegame_resource_folders')) {
          return Response.json([
            { id: 'folder-root', pack_id: 'pack-1', name: 'models', path: 'models' },
            { id: 'folder-child', pack_id: 'pack-1', name: 'characters', parent_id: 'folder-root', path: 'models/characters' },
            { id: 'folder-other', pack_id: 'pack-1', name: 'audio', path: 'audio' },
          ])
        }
        if ((!init?.method || init.method === 'GET') && url.includes('beegame_resource_elements')) {
          return Response.json([
            { id: 'element-root', pack_id: 'pack-1', name: 'tree.glb', path: 'models/tree.glb', storage_object_id: 'object-tree' },
            { id: 'element-child', pack_id: 'pack-1', name: 'hero.glb', path: 'models/characters/hero.glb', storage_object_id: 'object-hero' },
            { id: 'element-other', pack_id: 'pack-1', name: 'theme.ogg', path: 'audio/theme.ogg', storage_object_id: 'object-theme' },
          ])
        }
        if (init?.method === 'DELETE' && url.includes('/rest/v1/')) {
          metadataDeletes.push(url)
          return Response.json([{ id: 'deleted' }])
        }
        throw new Error(`Unexpected request: ${url}`)
      },
    })

    await expect(handlers.deleteResourceFolder('pack-1', 'folder-root')).resolves.toBe(true)
    expect(storageDeletes).toEqual(expect.arrayContaining(['object-tree', 'object-hero']))
    expect(storageDeletes).toHaveLength(2)
    expect(metadataDeletes.filter(url => url.includes('beegame_resource_elements'))).toHaveLength(2)
    expect(metadataDeletes.filter(url => url.includes('beegame_resource_folders'))).toHaveLength(2)
    expect(metadataDeletes.some(url => url.includes('folder-child'))).toBe(true)
    expect(metadataDeletes.some(url => url.includes('folder-root'))).toBe(true)
  })

  test('treats an already absent R2 object as successful recursive folder cleanup', async () => {
    const handlers = createSupabaseResourceAuthoringHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      r2Storage: storageStub({ delete: async () => false }),
      fetchImpl: async (input, init) => {
        const url = String(input)
        if ((!init?.method || init.method === 'GET') && url.includes('beegame_resource_folders')) return Response.json([{ id: 'folder-root', pack_id: 'pack-1', name: 'models', path: 'models' }])
        if ((!init?.method || init.method === 'GET') && url.includes('beegame_resource_elements')) return Response.json([{ id: 'element-root', pack_id: 'pack-1', name: 'tree.glb', path: 'models/tree.glb', storage_object_id: 'object-tree' }])
        if (init?.method === 'DELETE' && url.includes('/rest/v1/')) return Response.json([{ id: 'deleted' }])
        throw new Error(`Unexpected request: ${url}`)
      },
    })

    await expect(handlers.deleteResourceFolder('pack-1', 'folder-root')).resolves.toBe(true)
  })

  test('reports missing and orphaned R2 objects without mutating either side', async () => {
    const inspector = createSupabaseResourceStorageInspector({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      r2Storage: storageStub({
        listPackObjects: async () => [
          { id: 'cover', logicalPath: 'cover/preview.png', status: 'ready' },
          { id: 'model', logicalPath: 'models/tree.glb', status: 'ready' },
          { id: 'unused', logicalPath: 'unused.txt', status: 'ready' },
        ],
      }),
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('beegame_resource_packs')) return Response.json([{ cover_path: 'cover/preview.png' }])
        if (url.includes('beegame_resource_elements')) return Response.json([{ path: 'models/tree.glb' }, { path: 'textures/tree.png' }])
        return new Response(null, { status: 500 })
      },
    })
    await expect(inspector('pack-1')).resolves.toEqual({ missingPaths: ['textures/tree.png'], orphanPaths: ['unused.txt'] })
  })

  test('deletes every R2 object before deleting Pack metadata', async () => {
    const events: string[] = []
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      r2Storage: storageStub({
        listPackObjects: async () => [
          { id: 'object-model', logicalPath: 'models/item.glb', status: 'ready' },
          { id: 'object-cover', logicalPath: 'cover/preview.png', status: 'ready' },
        ],
        delete: async objectId => { events.push(`delete:${objectId}`); return true },
      }),
      fetchImpl: async (_input, init) => {
        if (init?.method === 'DELETE') { events.push('delete:metadata'); return Response.json([packRow]) }
        return Response.json([])
      },
    })

    await expect(handlers.deleteResourcePack('pack-1')).resolves.toBe(true)
    expect(events).toEqual(['delete:object-model', 'delete:object-cover', 'delete:metadata'])
  })

  test('does not delete Pack metadata when R2 cleanup fails', async () => {
    let deletedPack = false
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      r2Storage: storageStub({
        listPackObjects: async () => [{ id: 'object-model', logicalPath: 'models/item.glb', status: 'ready' }],
        delete: async () => { throw new Error('R2 deletion failed') },
      }),
      fetchImpl: async (_input, init) => {
        if (init?.method === 'DELETE') deletedPack = true
        return Response.json([])
      },
    })

    await expect(handlers.deleteResourcePack('pack-1')).rejects.toThrow('R2 deletion failed')
    expect(deletedPack).toBe(false)
  })

  test('commits an R2 cover replacement before deleting the prior object', async () => {
    const events: string[] = []
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      r2Storage: storageStub({
        upload: async () => { events.push('upload'); return { storageObjectId: 'object-new' } },
        createDownloadUrl: async () => 'https://r2.test/pack-1/object-new',
        delete: async objectId => { events.push(`delete:${objectId}`); return true },
      }),
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('select=cover_path')) return Response.json([{ cover_path: 'cover/old.png', cover_storage_object_id: 'object-old' }])
        if (init?.method === 'PATCH') { events.push('patch'); return Response.json([packRow]) }
        throw new Error(`Unexpected request: ${url}`)
      },
    })
    const form = new FormData(); form.set('file', new File(['cover'], '../new.png', { type: 'image/png' }))

    await expect(handlers.uploadPackCover('pack-1', new Request('https://resource.test', { method: 'POST', body: form }))).resolves.toEqual(expect.objectContaining({ coverPath: 'https://r2.test/pack-1/object-new' }))
    expect(events).toEqual(['upload', 'patch', 'delete:object-old'])
  })

  test('rolls back a newly uploaded cover when its database patch fails', async () => {
    const events: string[] = []
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      r2Storage: storageStub({
        upload: async () => { events.push('upload'); return { storageObjectId: 'object-new' } },
        createDownloadUrl: async () => 'https://r2.test/pack-1/object-new',
        delete: async objectId => { events.push(`delete:${objectId}`); return true },
      }),
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('select=cover_path')) return Response.json([{ cover_storage_object_id: 'object-old' }])
        if (init?.method === 'PATCH') return new Response(null, { status: 500 })
        throw new Error(`Unexpected request: ${url}`)
      },
    })
    const form = new FormData(); form.set('file', new File(['cover'], 'new.png', { type: 'image/png' }))

    await expect(handlers.uploadPackCover('pack-1', new Request('https://resource.test', { method: 'POST', body: form }))).rejects.toThrow('cover update failed')
    expect(events).toEqual(['upload', 'delete:object-new'])
  })

  test('maps lifecycle mutation rows to the public camelCase contract', async () => {
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      fetchImpl: async (input, init) => {
        if (init?.method === 'PATCH') return Response.json([{ ...packRow, element_count: 3 }])
        return Response.json([])
      },
    })

    await expect(handlers.updateResourcePack('pack-1', { gameTypes: ['puzzle'] })).resolves.toEqual(expect.objectContaining({
      gameTypes: [], primaryCategory: 'world-scene', coverPath: 'https://r2.test/pack-1/object-cover', elementCount: 3,
    }))
  })

  test('keeps the R2 cover identity after a later Pack metadata edit', async () => {
    let coverPath: string | null = null
    let coverStorageObjectId: string | null = null
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      r2Storage: storageStub({
        upload: async () => ({ storageObjectId: 'object-new' }),
        createDownloadUrl: async (storageObjectId, packId) => `https://r2.test/${packId}/${storageObjectId}`,
      }),
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (url.includes('select=cover_path')) return Response.json([{
          cover_path: coverPath,
          cover_storage_object_id: coverStorageObjectId,
        }])
        if (init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body)) as {
            cover_path?: string
            cover_storage_object_id?: string
          }
          if (body.cover_path) coverPath = body.cover_path
          if (body.cover_storage_object_id) coverStorageObjectId = body.cover_storage_object_id
          return Response.json([{
            ...packRow,
            cover_path: coverPath,
            cover_storage_object_id: coverStorageObjectId,
          }])
        }
        throw new Error(`Unexpected request: ${url}`)
      },
    })
    const form = new FormData(); form.set('file', new File(['cover'], 'new.png', { type: 'image/png' }))

    await handlers.uploadPackCover('pack-1', new Request('https://resource.test', { method: 'POST', body: form }))
    const edited = await handlers.updateResourcePack('pack-1', { name: 'Renamed' })

    expect(edited.coverPath).toBe('https://r2.test/pack-1/object-new')
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

  test('creates an R2 URL only for an element found under its requested Pack', async () => {
    const downloadRequests: string[] = []
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      r2Storage: storageStub({
        createDownloadUrl: async (storageObjectId, packId) => {
          downloadRequests.push(`${packId}:${storageObjectId}`)
          return `https://r2.test/${packId}/${storageObjectId}`
        },
      }),
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('element-1')) return Response.json([{
          pack_id: 'pack-1',
          path: 'assets/item.glb',
          storage_object_id: 'object-item',
        }])
        return Response.json([])
      },
    })
    await expect(handlers.getElementResourceUrl('pack-1', 'element-1')).resolves.toBe(
      'https://r2.test/pack-1/object-item',
    )
    await expect(handlers.getElementResourceUrl('pack-1', 'missing')).rejects.toThrow('not found')
    expect(downloadRequests).toEqual(['pack-1:object-item'])
  })

  test('rejects an element whose R2 object is unavailable', async () => {
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      r2Storage: storageStub({ createDownloadUrl: async () => undefined }),
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('element-1')) return Response.json([{
          pack_id: 'pack-1',
          path: 'assets/item.glb',
          storage_object_id: 'object-item',
        }])
        return Response.json([])
      },
    })

    await expect(handlers.getElementResourceUrl('pack-1', 'element-1')).rejects.toThrow(
      'storage object is unavailable',
    )
  })

  test('rejects an element without an R2 storage identity', async () => {
    let requestedDownload = false
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret',
      r2Storage: storageStub({
        createDownloadUrl: async () => {
          requestedDownload = true
          return 'https://r2.test/unexpected'
        },
      }),
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('element-1')) return Response.json([{ pack_id: 'pack-1', path: 'assets/item.glb' }])
        return Response.json([])
      },
    })

    await expect(handlers.getElementResourceUrl('pack-1', 'element-1')).rejects.toThrow(
      'storage object is required',
    )
    expect(requestedDownload).toBe(false)
  })

  test('builds universal element upload specs and infers a conservative kind', () => {
    expect(buildElementUploadRow('pack-1', 'assets', new File(['mesh'], 'mesh.GLB', { type: 'model/gltf-binary' }))).toMatchObject({
      pack_id: 'pack-1', category: 'assets', kind: 'model', preview: { kind: 'model', path: 'assets/mesh.GLB' }, specs: { size: 4, mimeType: 'model/gltf-binary', extension: 'glb', previewStatus: 'ready' },
    })
  })

  test('maps an element mutation row to the public camelCase contract', () => {
    expect(toResourceElement({
      id: 'element-1', pack_id: 'pack-1', name: 'hero.glb', path: 'models/hero.glb',
      category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready',
      style_override: 'stylized', dimension_override: '3D', usage_tags: ['character'],
      semantic_suggestion: { usageTags: ['building'], styles: [], relations: [], evidence: ['confirmed folder policy'], confidence: 'high', generatedAt: '2026-01-01T00:00:00.000Z', generatorRevision: 'test' },
    })).toEqual(expect.objectContaining({ packId: 'pack-1', styleOverride: 'stylized', dimensionOverride: '3D', usageTags: ['character'], semanticSuggestion: expect.objectContaining({ usageTags: ['building'] }) }))
  })

  test('preserves null to clear an element style override', () => {
    expect(toElementRow({ styleOverride: null, usageTags: ['character'] })).toEqual({ style_override: null, usage_tags: ['character'], usage_tags_mode: 'override' })
  })
})
