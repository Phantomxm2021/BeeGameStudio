import { describe, expect, test } from 'bun:test'
import type {
  ProjectStorageDriver,
  StorageObjectLocator,
} from '@bee-game-studio/beegame-storage-core'
import { createR2ResourceStorage } from '../r2-resource-storage'

function createDriver(
  overrides: Partial<ProjectStorageDriver> = {},
): ProjectStorageDriver {
  return {
    provider: 'r2',
    putObject: async () => undefined,
    getObject: async () => undefined,
    createUploadUrl: async () => 'https://upload.test',
    createDownloadUrl: async () => 'https://download.test',
    headObject: async () => ({ byteSize: 3, metadata: {} }),
    deleteObject: async () => undefined,
    copyObject: async () => undefined,
    createMultipartUpload: async () => 'upload-id',
    createMultipartPartUploadUrl: async () => 'https://part.test',
    completeMultipartUpload: async () => undefined,
    abortMultipartUpload: async () => undefined,
    ...overrides,
  }
}

function createMetadataFetch(events: Array<Record<string, unknown>>) {
  let storedRow: Record<string, unknown> | undefined
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/beegame_resource_packs?')) {
      return Response.json([
        { created_by: '00000000-0000-0000-0000-000000000001' },
      ])
    }
    if (url.endsWith('/beegame_storage_objects') && init?.method === 'POST') {
      storedRow = JSON.parse(String(init.body)) as Record<string, unknown>
      events.push({ operation: 'create', ...storedRow })
      return Response.json([storedRow])
    }
    if (
      url.includes('/beegame_storage_objects?id=eq.') &&
      init?.method === 'PATCH'
    ) {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      storedRow = { ...storedRow, ...body }
      events.push({ operation: 'patch', ...body })
      return Response.json([storedRow])
    }
    return new Response('Unexpected metadata request', { status: 500 })
  }
}

describe('R2 Resource Storage', () => {
  test('persists an immutable physical key separately from the logical Pack path', async () => {
    const events: Array<Record<string, unknown>> = []
    let uploadedLocator: StorageObjectLocator | undefined
    const storage = createR2ResourceStorage({
      baseUrl: 'https://supabase.test',
      serviceRoleKey: 'service-role',
      bucket: 'resource-data',
      fetchImpl: createMetadataFetch(events),
      driver: createDriver({
        putObject: async locator => {
          uploadedLocator = locator
        },
      }),
    })

    const result = await storage.upload({
      packId: 'pack-1',
      logicalPath: 'models/characters/hero.glb',
      file: new File([new Uint8Array([1, 2, 3])], 'hero.glb', {
        type: 'model/gltf-binary',
      }),
      objectKind: 'resource_element',
    })

    expect(typeof result.storageObjectId).toBe('string')
    expect(uploadedLocator).toEqual({
      provider: 'r2',
      bucketRole: 'resource-private',
      bucket: 'resource-data',
      objectKey: `packs/pack-1/objects/${result.storageObjectId}/payload`,
    })
    expect(events[0]).toEqual(
      expect.objectContaining({
        operation: 'create',
        logical_path: 'models/characters/hero.glb',
        original_filename: 'hero.glb',
        status: 'uploading',
      }),
    )
    expect(events.at(-1)).toEqual(
      expect.objectContaining({ operation: 'patch', status: 'ready' }),
    )
  })

  test('marks metadata failed and removes an unverifiable R2 object', async () => {
    const events: Array<Record<string, unknown>> = []
    const deleted: StorageObjectLocator[] = []
    const storage = createR2ResourceStorage({
      baseUrl: 'https://supabase.test',
      serviceRoleKey: 'service-role',
      bucket: 'resource-data',
      fetchImpl: createMetadataFetch(events),
      driver: createDriver({
        headObject: async () => ({ byteSize: 2, metadata: {} }),
        deleteObject: async locator => {
          deleted.push(locator)
        },
      }),
    })

    await expect(
      storage.upload({
        packId: 'pack-1',
        logicalPath: 'audio/hit.wav',
        file: new File([new Uint8Array([1, 2, 3])], 'hit.wav'),
        objectKind: 'resource_element',
      }),
    ).rejects.toThrow('verification failed')
    expect(events.at(-1)).toEqual(
      expect.objectContaining({ operation: 'patch', status: 'failed' }),
    )
    expect(deleted).toHaveLength(1)
  })
})
