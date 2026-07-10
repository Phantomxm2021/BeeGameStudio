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
        return Response.json([{ id: 'pack-1', name: 'Example Pack', style: 'Stylized', game_types: ['adventure'], dimension: '2D', categories: ['characters'], license: 'internal', version: '1.0.0', status: 'published', element_count: 2 }])
      },
    })
    await expect(repository.listPacks()).resolves.toEqual([expect.objectContaining({ id: 'pack-1', elementCount: 2 })])
    expect(requests[0]?.url).toContain('/rest/v1/beegame_resource_packs')
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer secret-key')
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
})
