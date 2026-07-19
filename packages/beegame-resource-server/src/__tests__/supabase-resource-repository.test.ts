import { describe, expect, test } from 'bun:test'
import { createSupabaseResourceRepository } from '../supabase-resource-repository'

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
        return Response.json([{ id: 'pack-1', name: 'Example Pack', style: 'Stylized', game_types: ['adventure'], dimension: '2D', primary_category: '2d-art', categories: ['characters'], license: 'internal', version: '1.0.0', status: 'published', element_count: 0 }])
      },
    })
    await expect(repository.listPacks()).resolves.toEqual([expect.objectContaining({ id: 'pack-1', primaryCategory: '2d-art', elementCount: 2 })])
    expect(requests[0]?.url).toContain('/rest/v1/beegame_resource_packs')
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer secret-key')
  })

  test('normalizes relative signed Pack cover URLs before returning them to the browser', async () => {
    const repository = createSupabaseResourceRepository({
      baseUrl: 'https://supabase.test',
      serviceRoleKey: 'secret-key',
      fetchImpl: async request => {
        const url = request instanceof Request ? request.url : String(request)
        if (url.includes('beegame_resource_elements')) return Response.json([])
        if (url.includes('beegame_resource_packs')) return Response.json([{ id: 'pack-1', name: 'Example Pack', style: 'Stylized', game_types: [], dimension: '2D', primary_category: '2d-art', categories: [], license: 'internal', version: '1.0.0', status: 'draft', cover_path: 'preview.png', element_count: 0 }])
        return Response.json({ signedURL: '/object/sign/beegame-resource-packs/pack-1/preview.png?token=short-lived' })
      },
    })
    await expect(repository.listPacks()).resolves.toEqual([expect.objectContaining({
      coverPath: 'https://supabase.test/storage/v1/object/sign/beegame-resource-packs/pack-1/preview.png?token=short-lived',
    })])
  })

  test('does not duplicate a legacy Pack prefix when signing a cover path', async () => {
    const requests: string[] = []
    const repository = createSupabaseResourceRepository({
      baseUrl: 'https://supabase.test', serviceRoleKey: 'secret-key',
      fetchImpl: async request => {
        const url = request instanceof Request ? request.url : String(request)
        requests.push(url)
        if (url.includes('beegame_resource_elements')) return Response.json([])
        if (url.includes('beegame_resource_packs')) return Response.json([{ id: 'pack-1', name: 'Example Pack', style: 'Stylized', game_types: [], dimension: '2D', primary_category: '2d-art', categories: [], license: 'internal', version: '1.0.0', status: 'draft', cover_path: 'pack-1/preview.png', element_count: 0 }])
        return Response.json({ signedURL: 'https://cdn.test/preview.png' })
      },
    })
    await repository.listPacks()
    const signedRequest = requests.find(url => url.includes('/storage/v1/object/sign/'))
    expect(signedRequest).toContain('/pack-1/preview.png')
    expect(signedRequest).not.toContain('/pack-1/pack-1/')
  })

  test('filters elements by Pack and category using encoded query values', async () => {
    const requests: Request[] = []
    const repository = createSupabaseResourceRepository({
      baseUrl: 'https://supabase.test/',
      serviceRoleKey: 'secret-key',
      fetchImpl: async request => {
        requests.push(request instanceof Request ? request : new Request(request))
        return Response.json([{ id: 'element-1', pack_id: 'pack-1', name: 'Item', path: 'characters/item.png', category: 'characters', kind: 'sprite', specs: {}, dependencies: [], status: 'ready' }])
      },
    })
    await repository.listElements('pack/1', 'characters')
    expect(requests[0]?.url).toContain('pack_id=eq.pack%2F1')
    expect(requests[0]?.url).toContain('category=eq.characters')
  })

  test('derives exact structural dependencies for legacy Pack reads without mutating storage', async () => {
    const repository = createSupabaseResourceRepository({
      baseUrl: 'https://supabase.test',
      serviceRoleKey: 'secret-key',
      fetchImpl: async request => {
        const url = request instanceof Request ? request.url : String(request)
        if (url.includes('beegame_resource_elements')) return Response.json([
          { id: 'model', pack_id: 'pack-1', name: 'hero.fbx', path: 'Models/hero.fbx', category: 'models', kind: 'model', specs: { unresolvedTextureReferences: 'Textures\\base.png' }, dependencies: [], dependency_bindings: [], status: 'ready' },
          { id: 'texture', pack_id: 'pack-1', name: 'base.png', path: 'Textures/base.png', category: 'textures', kind: 'image', specs: {}, dependencies: [], status: 'ready' },
        ])
        return Response.json([])
      },
    })

    await expect(repository.listElements('pack-1')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'model',
        specs: expect.objectContaining({ externalReferences: '["Textures/base.png"]', unresolvedTextureReferences: '' }),
        dependencies: ['texture'],
        dependencyBindings: [{ referencePath: 'Textures/base.png', dependencyElementId: 'texture', kind: 'image' }],
      }),
    ]))
  })

  test('persists a Pack primary category using the database column contract', async () => {
    let createBody: Record<string, unknown> | undefined
    const repository = createSupabaseResourceRepository({
      baseUrl: 'https://supabase.test',
      serviceRoleKey: 'secret-key',
      fetchImpl: async (_request, init) => {
        createBody = JSON.parse(String(init?.body))
        return Response.json([{ id: 'pack-1', name: 'Example Pack', style: 'Stylized', game_types: ['adventure'], dimension: '2D', primary_category: 'ui-kit', categories: ['ui'], license: 'internal', version: '1.0.0', status: 'draft', element_count: 0 }])
      },
    })

    await repository.createPack({ id: 'pack-1', name: 'Example Pack', style: 'Stylized', gameTypes: ['adventure'], dimension: '2D', primaryCategory: 'ui-kit', categories: ['ui'], license: 'internal', version: '1.0.0', status: 'draft' }, { createdBy: '00000000-0000-0000-0000-000000000001' })

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
    await expect(repository.createPack({ id: 'pack-1', name: 'Example Pack', style: 'Stylized', gameTypes: ['adventure'], dimension: '2D', primaryCategory: 'ui-kit', categories: ['ui'], license: 'internal', version: '1.0.0', status: 'draft' }))
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
