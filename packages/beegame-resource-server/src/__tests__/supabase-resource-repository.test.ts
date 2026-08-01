import { describe, expect, test } from 'bun:test'
import { createSupabaseResourceRepository as createRepository } from '../supabase-resource-repository'

type RepositoryOptions = Parameters<typeof createRepository>[0]

function createSupabaseResourceRepository(
  options: Omit<RepositoryOptions, 'getStorageObjectUrl'> & Partial<Pick<RepositoryOptions, 'getStorageObjectUrl'>>,
) {
  return createRepository({ getStorageObjectUrl: async () => undefined, ...options })
}

describe('Supabase resource repository', () => {
  test('loads Pack summaries without exposing service credentials to callers', async () => {
    const requests: Request[] = []
    const repository = createSupabaseResourceRepository({
      baseUrl: 'https://supabase.test',
      serviceRoleKey: 'secret-key',
      fetchImpl: async request => {
        requests.push(request instanceof Request ? request : new Request(request))
        const url = request instanceof Request ? request.url : String(request)
        if (url.includes('beegame_resource_elements')) return Response.json([{ pack_id: 'pack-1' }, { pack_id: 'pack-1' }])
        return Response.json([{ id: 'pack-1', name: 'Example Pack',
            styles: ['Stylized'], game_types: ['adventure'], dimension: '2D', primary_category: '2d-art', categories: ['sprites'], license: 'internal', version: '1.0.0', status: 'published', element_count: 0 }])
      },
    })
    await expect(repository.listPacks()).resolves.toEqual([expect.objectContaining({ id: 'pack-1', primaryCategory: '2d-art', elementCount: 2 })])
    expect(requests[0]?.url).toContain('/rest/v1/beegame_resource_packs')
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer secret-key')
  })

  test('resolves Pack covers only through their R2 object identity', async () => {
    const requests: string[] = []
    const repository = createSupabaseResourceRepository({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret-key',
      getStorageObjectUrl: async (storageObjectId, packId) => `https://r2.test/${packId}/${storageObjectId}`,
      fetchImpl: async request => {
        const url = request instanceof Request ? request.url : String(request)
        requests.push(url)
        if (url.includes('beegame_resource_elements')) return Response.json([])
        return Response.json([{ id: 'pack-1', name: 'Example Pack',
            styles: ['Stylized'], game_types: [], dimension: '2D', primary_category: '2d-art', categories: [], license: 'internal', version: '1.0.0', status: 'draft', cover_path: 'old-cover.png', cover_storage_object_id: 'object-1', element_count: 0 }])
      },
    })

    await expect(repository.listPacks()).resolves.toEqual([expect.objectContaining({ coverPath: 'https://r2.test/pack-1/object-1' })])
    expect(requests.every(url => !url.includes('/storage/v1/'))).toBe(true)
  })

  test('rejects an unavailable R2 cover instead of opening another storage path', async () => {
    const repository = createSupabaseResourceRepository({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret-key',
      getStorageObjectUrl: async () => undefined,
      fetchImpl: async request => {
        const url = request instanceof Request ? request.url : String(request)
        if (url.includes('beegame_resource_elements')) return Response.json([])
        if (url.includes('beegame_resource_packs')) return Response.json([{ id: 'pack-1', name: 'Example Pack',
              styles: ['Stylized'], game_types: [], dimension: '2D', primary_category: '2d-art', categories: [], license: 'internal', version: '1.0.0', status: 'draft', cover_path: 'old-cover.png', cover_storage_object_id: 'object-not-ready', element_count: 0 }])
        return Response.json([])
      },
    })

    await expect(repository.listPacks()).rejects.toThrow('Resource Pack cover object is unavailable')
  })

  test('filters elements by Pack and category using encoded query values', async () => {
    const requests: Request[] = []
    const repository = createSupabaseResourceRepository({
      baseUrl: 'https://supabase.test/',
      serviceRoleKey: 'secret-key',
      fetchImpl: async request => {
        requests.push(request instanceof Request ? request : new Request(request))
        return Response.json([{ id: 'element-1', pack_id: 'pack-1', name: 'Item', path: 'sprites/item.png', category: 'sprites', kind: 'sprite', specs: {}, dependencies: [], status: 'ready' }])
      },
    })
    await repository.listElements('pack/1', 'sprites')
    expect(requests[0]?.url).toContain('pack_id=eq.pack%2F1')
    expect(requests[0]?.url).toContain('category=eq.sprites')
  })

  test('persists a Pack primary category using the database column contract', async () => {
    let createBody: Record<string, unknown> | undefined
    const repository = createSupabaseResourceRepository({
      baseUrl: 'https://supabase.test',
      serviceRoleKey: 'secret-key',
      fetchImpl: async (_request, init) => {
        createBody = JSON.parse(String(init?.body))
        return Response.json([{ id: 'pack-1', name: 'Example Pack',
            styles: ['Stylized'], game_types: ['adventure'], dimension: '2D', primary_category: 'ui-kit', categories: ['ui'], license: 'internal', version: '1.0.0', status: 'draft', element_count: 0 }])
      },
    })

    await repository.createPack({ id: 'pack-1', name: 'Example Pack',
        styles: ['Stylized'], gameTypes: ['adventure'], dimension: '2D', primaryCategory: 'ui-kit', categories: ['ui'], license: 'internal', version: '1.0.0', status: 'draft' }, { createdBy: '00000000-0000-0000-0000-000000000001' })

    expect(createBody).toMatchObject({ primary_category: 'ui-kit', created_by: '00000000-0000-0000-0000-000000000001' })
  })

  test('preserves Supabase mutation diagnostics for actionable schema failures', async () => {
    const repository = createSupabaseResourceRepository({
      baseUrl: 'https://supabase.test',
      serviceRoleKey: 'secret-key',
      fetchImpl: async () => Response.json({
        code: 'PGRST204',
        message: "Could not find the 'primary_category' column",
        hint: 'Reload the schema cache after applying the migration.',
      }, { status: 400 }),
    })
    await expect(repository.createPack({ id: 'pack-1', name: 'Example Pack',
        styles: ['Stylized'], gameTypes: ['adventure'], dimension: '2D', primaryCategory: 'ui-kit', categories: ['ui'], license: 'internal', version: '1.0.0', status: 'draft' }))
      .rejects.toThrow("[PGRST204] Could not find the 'primary_category' column")
  })

  test('treats an unapplied folders migration as an empty folder tree', async () => {
    const repository = createSupabaseResourceRepository({
      baseUrl: 'https://supabase.test',
      serviceRoleKey: 'secret-key',
      fetchImpl: async () => new Response(JSON.stringify({ code: 'PGRST205', message: 'relation does not exist' }), { status: 404 }),
    })
    await expect(repository.listFolders('pack-1')).resolves.toEqual([])
  })

  test('deletes a Pack and reports whether Supabase returned a deleted row', async () => {
    const requests: Request[] = []
    const repository = createSupabaseResourceRepository({
      baseUrl: 'https://supabase.test',
      serviceRoleKey: 'secret-key',
      fetchImpl: async (request, init) => {
        requests.push(request instanceof Request ? request : new Request(request, init))
        return Response.json([{ id: 'pack-1' }])
      },
    })

    await expect(repository.deletePack('pack-1')).resolves.toBe(true)
    expect(requests[0]?.method).toBe('DELETE')
    expect(requests[0]?.url).toContain('/rest/v1/beegame_resource_packs')
    expect(requests[0]?.url).toContain('id=eq.pack-1')
  })

  test('reports false when Supabase deletes no Pack rows', async () => {
    const repository = createSupabaseResourceRepository({
      baseUrl: 'https://supabase.test',
      serviceRoleKey: 'secret-key',
      fetchImpl: async () => Response.json([]),
    })

    await expect(repository.deletePack('missing')).resolves.toBe(false)
  })
})
