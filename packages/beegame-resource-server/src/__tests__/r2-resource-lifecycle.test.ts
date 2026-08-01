import { describe, expect, test } from 'bun:test'
import {
  createSupabaseResourceAuthoringHandlers,
  createSupabaseResourceLifecycleHandlers,
} from '../index'
import type { R2ResourceStorage } from '../r2-resource-storage'

function storageStub(
  overrides: Partial<R2ResourceStorage> = {},
): R2ResourceStorage {
  return {
    upload: async () => ({ storageObjectId: 'object-new' }),
    getFile: async () => undefined,
    createDownloadUrl: async () => undefined,
    updateLogicalPath: async () => undefined,
    delete: async () => false,
    listPackObjects: async () => [],
    ...overrides,
  }
}

describe('R2 Resource Library lifecycle', () => {
  test('rejects an unavailable R2 object without opening another storage path', async () => {
    const handlers = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://supabase.test',
      serviceRoleKey: 'secret',
      r2Storage: storageStub(),
      fetchImpl: async input => {
        const url = String(input)
        if (url.includes('beegame_resource_elements')) {
          return Response.json([
            {
              pack_id: 'pack-1',
              path: 'models/item.glb',
              storage_object_id: 'object-missing',
            },
          ])
        }
        return Response.json([])
      },
    })

    await expect(
      handlers.getElementResourceUrl('pack-1', 'element-1'),
    ).rejects.toThrow('Resource element storage object is unavailable')
  })

  test('renames an R2 element by changing only its logical path', async () => {
    const updates: string[] = []
    const current = {
      id: 'element-1',
      pack_id: 'pack-1',
      name: 'old.glb',
      path: 'models/old.glb',
      storage_object_id: 'object-1',
      category: 'models',
      kind: 'model',
      specs: {},
      dependencies: [],
      status: 'ready',
    }
    const handlers = createSupabaseResourceAuthoringHandlers({
      baseUrl: 'https://supabase.test',
      serviceRoleKey: 'secret',
      r2Storage: storageStub({
        updateLogicalPath: async (_storageObjectId, _packId, logicalPath) => {
          updates.push(logicalPath)
        },
      }),
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (!init?.method || init.method === 'GET')
          return Response.json([current])
        if (init.method === 'PATCH')
          return Response.json([
            { ...current, name: 'new.glb', path: 'models/new.glb' },
          ])
        return Response.json([])
      },
    })

    await handlers.updateResourceElement('pack-1', 'element-1', {
      name: 'new.glb',
      path: 'models/new.glb',
    })
    expect(updates).toEqual(['models/new.glb'])
  })
})
