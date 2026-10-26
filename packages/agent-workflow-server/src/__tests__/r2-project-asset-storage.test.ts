import { describe, expect, test } from 'bun:test'
import type {
  ProjectStorageDriver,
  StorageObjectLocator,
} from '@bee-game-studio/beegame-storage-core'
import { createR2ProjectAssetStorage } from '../r2-project-asset-storage'

function createDriver(
  overrides: Partial<ProjectStorageDriver> = {},
): ProjectStorageDriver {
  return {
    provider: 'r2',
    putObject: async () => undefined,
    getObject: async () => undefined,
    createUploadUrl: async () => 'https://upload.test',
    createDownloadUrl: async () => 'https://download.test',
    headObject: async () => ({ byteSize: 4, metadata: {} }),
    deleteObject: async () => undefined,
    copyObject: async () => undefined,
    createMultipartUpload: async () => 'upload-id',
    createMultipartPartUploadUrl: async () => 'https://part.test',
    completeMultipartUpload: async () => undefined,
    abortMultipartUpload: async () => undefined,
    ...overrides,
  }
}

describe('R2 project asset storage', () => {
  test('persists a project-owned immutable R2 object and verifies its size', async () => {
    let metadataRow: Record<string, unknown> | undefined
    let uploaded: StorageObjectLocator | undefined
    const patches: Array<Record<string, unknown>> = []
    const storage = createR2ProjectAssetStorage({
      baseUrl: 'https://supabase.test',
      anonKey: 'anon-key',
      bucket: 'project-data',
      driver: createDriver({
        putObject: async locator => {
          uploaded = locator
        },
      }),
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (
          url.endsWith('/beegame_storage_objects') &&
          init?.method === 'POST'
        ) {
          metadataRow = JSON.parse(String(init.body)) as Record<string, unknown>
          return Response.json([metadataRow])
        }
        if (
          url.includes('/beegame_storage_objects?id=eq.') &&
          init?.method === 'PATCH'
        ) {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>
          patches.push(body)
          return Response.json([{ ...metadataRow, ...body }])
        }
        return new Response('Unexpected request', { status: 500 })
      },
    })

    const uri = await storage.uploadAssetFile({
      ownerId: '00000000-0000-0000-0000-000000000001',
      projectId: 'project-1',
      authToken: 'user-token',
      file: new File([new Uint8Array([1, 2, 3, 4])], 'scene.glb', {
        type: 'model/gltf-binary',
      }),
    })

    expect(uri).toMatch(/^r2-object:\/\/[0-9a-f-]+$/)
    expect(metadataRow).toEqual(
      expect.objectContaining({
        scope_type: 'project',
        scope_id: 'project-1',
        project_id: 'project-1',
        object_kind: 'game_asset',
        status: 'uploading',
      }),
    )
    expect(uploaded).toEqual(
      expect.objectContaining({
        provider: 'r2',
        bucketRole: 'project-private',
        bucket: 'project-data',
      }),
    )
    expect(patches.at(-1)).toEqual(
      expect.objectContaining({ status: 'ready', byte_size: 4 }),
    )
  })

  test('deletes only an R2 object owned by the requested project', async () => {
    const deleted: StorageObjectLocator[] = []
    const patches: Array<Record<string, unknown>> = []
    const row = {
      id: 'object-1',
      owner_user_id: 'owner-1',
      project_id: 'project-1',
      provider: 'r2',
      bucket_role: 'project-private',
      bucket: 'project-data',
      object_key: 'objects/object-1/payload',
      logical_path: 'uploads/object-1/scene.glb',
      original_filename: 'scene.glb',
      mime_type: 'model/gltf-binary',
      byte_size: 4,
      etag: null,
      status: 'ready',
      deleted_at: null,
    }
    const storage = createR2ProjectAssetStorage({
      baseUrl: 'https://supabase.test',
      anonKey: 'anon-key',
      bucket: 'project-data',
      driver: createDriver({
        deleteObject: async locator => {
          deleted.push(locator)
        },
      }),
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>
          patches.push(body)
          return Response.json([{ ...row, ...body }])
        }
        if (
          url.includes('owner_user_id=eq.owner-1') &&
          url.includes('project_id=eq.project-1')
        ) {
          return Response.json([row])
        }
        return Response.json([])
      },
    })

    await storage.deleteAssetFile({
      ownerId: 'owner-1',
      projectId: 'project-1',
      authToken: 'user-token',
      storageUri: 'r2-object://object-1',
    })

    expect(deleted).toEqual([
      {
        provider: 'r2',
        bucketRole: 'project-private',
        bucket: 'project-data',
        objectKey: 'objects/object-1/payload',
      },
    ])
    expect(patches.at(-1)).toEqual(
      expect.objectContaining({
        status: 'deleted',
        deleted_at: expect.any(String),
      }),
    )
  })

  test('deletes all active R2 objects owned by a project, including delivery objects', async () => {
    const deleted: StorageObjectLocator[] = []
    const patches: Array<{ id: string; body: Record<string, unknown> }> = []
    const rows = [
      {
        id: 'asset-1', owner_user_id: 'owner-1', project_id: 'project-1', provider: 'r2',
        bucket_role: 'project-private', bucket: 'project-data', object_key: 'objects/asset-1/payload',
        logical_path: 'uploads/asset-1/scene.glb', original_filename: 'scene.glb', mime_type: 'model/gltf-binary',
        byte_size: 4, etag: null, status: 'ready', deleted_at: null,
      },
      {
        id: 'deployment-1', owner_user_id: 'owner-1', project_id: 'project-1', provider: 'r2',
        bucket_role: 'delivery', bucket: 'delivery-data', object_key: 'deployments/deployment-1/manifest.json',
        logical_path: 'manifest.json', original_filename: 'manifest.json', mime_type: 'application/json',
        byte_size: 12, etag: null, status: 'ready', deleted_at: null,
      },
    ]
    const activeRows = [...rows]
    const storage = createR2ProjectAssetStorage({
      baseUrl: 'https://supabase.test', anonKey: 'anon-key', bucket: 'project-data', deliveryBucket: 'delivery-data', driver: createDriver({
        deleteObject: async locator => { deleted.push(locator) },
      }),
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (init?.method === 'PATCH') {
          const id = new URL(url).searchParams.get('id')?.replace('eq.', '') ?? ''
          const body = JSON.parse(String(init.body)) as Record<string, unknown>
          patches.push({ id, body })
          const rowIndex = activeRows.findIndex(row => row.id === id)
          const row = rowIndex >= 0 ? activeRows.splice(rowIndex, 1)[0] : undefined
          return Response.json(row ? [{ ...row, ...body }] : [])
        }
        if (url.includes('owner_user_id=eq.owner-1') && url.includes('project_id=eq.project-1'))
          return Response.json(activeRows)
        return Response.json([])
      },
    })

    await storage.deleteProjectFiles!({ ownerId: 'owner-1', projectId: 'project-1', authToken: 'user-token' })

    expect(deleted).toEqual([
      { provider: 'r2', bucketRole: 'project-private', bucket: 'project-data', objectKey: 'objects/asset-1/payload' },
      { provider: 'r2', bucketRole: 'delivery', bucket: 'delivery-data', objectKey: 'deployments/deployment-1/manifest.json' },
    ])
    expect(patches).toHaveLength(2)
    expect(patches.map(item => item.body.status)).toEqual(['deleted', 'deleted'])
  })

  test('repeats the first page until every project object is metadata-confirmed deleted', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      id: `asset-${String(index).padStart(3, '0')}`,
      owner_user_id: 'owner-1',
      project_id: 'project-1',
      provider: 'r2' as const,
      bucket_role: 'project-private' as const,
      bucket: 'project-data',
      object_key: `objects/asset-${index}/payload`,
      logical_path: null,
      original_filename: null,
      mime_type: 'application/octet-stream',
      byte_size: 1,
      etag: null,
      status: 'ready',
      deleted_at: null,
    }))
    const activeRows = [...rows]
    const deleted: StorageObjectLocator[] = []
    const queryUrls: string[] = []
    const storage = createR2ProjectAssetStorage({
      baseUrl: 'https://supabase.test',
      anonKey: 'anon-key',
      bucket: 'project-data',
      driver: createDriver({
        deleteObject: async locator => { deleted.push(locator) },
      }),
      fetchImpl: async (input, init) => {
        const url = String(input)
        if (!init?.method || init.method === 'GET') {
          queryUrls.push(url)
          if (url.includes('owner_user_id=eq.owner-1')) {
            return Response.json(activeRows.slice(0, 100))
          }
        }
        if (init?.method === 'PATCH') {
          const id = new URL(url).searchParams.get('id')?.replace('eq.', '') ?? ''
          const body = JSON.parse(String(init.body)) as Record<string, unknown>
          const rowIndex = activeRows.findIndex(row => row.id === id)
          const row = rowIndex >= 0 ? activeRows.splice(rowIndex, 1)[0] : undefined
          return Response.json(row ? [{ ...row, ...body }] : [])
        }
        return Response.json([])
      },
    })

    await storage.deleteProjectFiles!({
      ownerId: 'owner-1',
      projectId: 'project-1',
      authToken: 'user-token',
    })

    expect(deleted).toHaveLength(101)
    expect(activeRows).toHaveLength(0)
    expect(queryUrls).toHaveLength(3)
    expect(queryUrls.every(url => url.includes('&order=id.asc&limit=100&offset=0'))).toBe(true)
  })

  test('stops project cleanup when physical deletion fails before metadata is patched', async () => {
    let patchCalls = 0
    let queryCalls = 0
    const row = {
      id: 'asset-1',
      owner_user_id: 'owner-1',
      project_id: 'project-1',
      provider: 'r2' as const,
      bucket_role: 'project-private' as const,
      bucket: 'project-data',
      object_key: 'objects/asset-1/payload',
      logical_path: null,
      original_filename: null,
      mime_type: 'application/octet-stream',
      byte_size: 1,
      etag: null,
      status: 'ready',
      deleted_at: null,
    }
    const storage = createR2ProjectAssetStorage({
      baseUrl: 'https://supabase.test',
      anonKey: 'anon-key',
      bucket: 'project-data',
      driver: createDriver({
        deleteObject: async () => { throw new Error('R2 delete failed') },
      }),
      fetchImpl: async (_input, init) => {
        if (init?.method === 'PATCH') {
          patchCalls += 1
          return Response.json([row])
        }
        queryCalls += 1
        return Response.json([row])
      },
    })

    await expect(storage.deleteProjectFiles!({
      ownerId: 'owner-1',
      projectId: 'project-1',
      authToken: 'user-token',
    })).rejects.toThrow('R2 delete failed')
    expect(queryCalls).toBe(1)
    expect(patchCalls).toBe(0)
  })

  test('stops project cleanup when metadata does not confirm the deletion patch', async () => {
    let physicalDeletes = 0
    let patchCalls = 0
    const row = {
      id: 'asset-1',
      owner_user_id: 'owner-1',
      project_id: 'project-1',
      provider: 'r2' as const,
      bucket_role: 'project-private' as const,
      bucket: 'project-data',
      object_key: 'objects/asset-1/payload',
      logical_path: null,
      original_filename: null,
      mime_type: 'application/octet-stream',
      byte_size: 1,
      etag: null,
      status: 'ready',
      deleted_at: null,
    }
    const storage = createR2ProjectAssetStorage({
      baseUrl: 'https://supabase.test',
      anonKey: 'anon-key',
      bucket: 'project-data',
      driver: createDriver({
        deleteObject: async () => { physicalDeletes += 1 },
      }),
      fetchImpl: async (_input, init) => {
        if (init?.method === 'PATCH') {
          patchCalls += 1
          return Response.json([{ ...row }])
        }
        return Response.json([row])
      },
    })

    await expect(storage.deleteProjectFiles!({
      ownerId: 'owner-1',
      projectId: 'project-1',
      authToken: 'user-token',
    })).rejects.toThrow('metadata did not confirm deletion')
    expect(physicalDeletes).toBe(1)
    expect(patchCalls).toBe(1)
  })
})
