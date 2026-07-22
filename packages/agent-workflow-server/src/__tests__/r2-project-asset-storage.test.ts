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
})
