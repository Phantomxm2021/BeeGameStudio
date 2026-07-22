import type {
  ProjectStorageDriver,
  StorageObjectLocator,
} from '@bee-game-studio/beegame-storage-core'
import {
  buildResourcePackObjectKey,
  sha256Hex,
} from '@bee-game-studio/beegame-storage-core'

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

type StorageObjectRow = {
  id: string
  owner_user_id: string
  pack_id: string | null
  provider: 'r2'
  bucket_role: 'resource-private'
  bucket: string
  object_key: string
  logical_path: string | null
  original_filename: string | null
  mime_type: string | null
  byte_size: number | null
  etag: string | null
  object_kind: string
  status: string
  metadata: Record<string, unknown> | null
  deleted_at: string | null
}

export type R2ResourceStorage = {
  upload(input: {
    packId: string
    logicalPath: string
    file: File
    objectKind: 'resource_element' | 'resource_preview'
  }): Promise<{ storageObjectId: string }>
  getFile(storageObjectId: string, packId: string): Promise<File | undefined>
  createDownloadUrl(
    storageObjectId: string,
    packId: string,
  ): Promise<string | undefined>
  updateLogicalPath(
    storageObjectId: string,
    packId: string,
    logicalPath: string,
  ): Promise<void>
  delete(storageObjectId: string, packId: string): Promise<boolean>
  listPackObjects(
    packId: string,
  ): Promise<Array<{ id: string; logicalPath?: string; status: string }>>
}

export function createR2ResourceStorage(options: {
  baseUrl: string
  serviceRoleKey: string
  bucket: string
  driver: ProjectStorageDriver
  fetchImpl?: FetchImplementation
}): R2ResourceStorage {
  if (options.driver.provider !== 'r2') {
    throw new Error('R2 Resource Storage requires an R2 driver')
  }
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const bucket = options.bucket.trim()
  if (!bucket) throw new Error('R2 Resource Storage bucket is required')
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
  }

  const request = async <T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> => {
    const response = await fetchImpl(`${baseUrl}/rest/v1/${path}`, {
      ...init,
      headers: { ...headers, ...init.headers },
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `Resource object metadata request failed (${response.status})${detail ? ` - ${detail}` : ''}`,
      )
    }
    return response.json() as Promise<T>
  }

  const findPackOwner = async (packId: string): Promise<string> => {
    const rows = await request<Array<{ created_by?: unknown }>>(
      `beegame_resource_packs?id=eq.${encodeURIComponent(packId)}&select=created_by&limit=1`,
    )
    const owner = rows[0]?.created_by
    if (typeof owner !== 'string' || !owner) {
      throw new Error('Resource Pack owner is missing')
    }
    return owner
  }

  const findObject = async (
    storageObjectId: string,
    packId: string,
  ): Promise<StorageObjectRow | undefined> => {
    const rows = await request<StorageObjectRow[]>(
      `beegame_storage_objects?id=eq.${encodeURIComponent(storageObjectId)}&pack_id=eq.${encodeURIComponent(packId)}&provider=eq.r2&deleted_at=is.null&select=*`,
    )
    return rows[0]
  }

  const findReadyObject = async (
    storageObjectId: string,
    packId: string,
  ): Promise<StorageObjectRow | undefined> => {
    const row = await findObject(storageObjectId, packId)
    return row?.status === 'ready' ? row : undefined
  }

  const locator = (row: StorageObjectRow): StorageObjectLocator => ({
    provider: 'r2',
    bucketRole: 'resource-private',
    bucket: row.bucket,
    objectKey: row.object_key,
  })

  const patchObject = async (
    id: string,
    body: Record<string, unknown>,
  ): Promise<void> => {
    await request<StorageObjectRow[]>(
      `beegame_storage_objects?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          prefer: 'return=representation',
        },
        body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }),
      },
    )
  }

  return {
    async upload(input) {
      const ownerId = await findPackOwner(input.packId)
      const id = crypto.randomUUID()
      const objectKey = buildResourcePackObjectKey(input.packId, id)
      const contentType = input.file.type || 'application/octet-stream'
      const bytes = new Uint8Array(await input.file.arrayBuffer())
      const checksum = sha256Hex(bytes)
      const row = (
        await request<StorageObjectRow[]>('beegame_storage_objects', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            prefer: 'return=representation',
          },
          body: JSON.stringify({
            id,
            scope_type: 'pack',
            scope_id: input.packId,
            owner_user_id: ownerId,
            pack_id: input.packId,
            provider: 'r2',
            bucket_role: 'resource-private',
            bucket,
            object_key: objectKey,
            logical_path: input.logicalPath,
            original_filename: input.file.name,
            mime_type: contentType,
            byte_size: input.file.size,
            checksum_algorithm: 'sha256',
            checksum_value: checksum,
            object_kind: input.objectKind,
            status: 'uploading',
            visibility: 'private',
          }),
        })
      )[0]
      if (!row)
        throw new Error('Resource object metadata creation returned no row')
      const objectLocator = locator(row)
      try {
        await options.driver.putObject(objectLocator, bytes, contentType, {
          'beegame-object-id': id,
          'beegame-sha256': checksum,
        })
        const head = await options.driver.headObject(objectLocator)
        if (!head || head.byteSize !== input.file.size) {
          throw new Error('R2 Resource object verification failed')
        }
        await patchObject(id, {
          status: 'ready',
          byte_size: head.byteSize,
          mime_type: head.contentType || contentType,
          etag: head.etag ?? null,
        })
        return { storageObjectId: id }
      } catch (error) {
        await patchObject(id, {
          status: 'failed',
          metadata: {
            failure:
              error instanceof Error ? error.message : 'Resource upload failed',
          },
        }).catch(() => undefined)
        await options.driver.deleteObject(objectLocator).catch(() => undefined)
        throw error
      }
    },
    async getFile(storageObjectId, packId) {
      const row = await findReadyObject(storageObjectId, packId)
      if (!row) return undefined
      const payload = await options.driver.getObject(locator(row))
      if (!payload) return undefined
      const body = new ArrayBuffer(payload.bytes.byteLength)
      new Uint8Array(body).set(payload.bytes)
      return new File(
        [body],
        row.original_filename || row.logical_path?.split('/').at(-1) || row.id,
        {
          type:
            payload.contentType || row.mime_type || 'application/octet-stream',
        },
      )
    },
    async createDownloadUrl(storageObjectId, packId) {
      const row = await findReadyObject(storageObjectId, packId)
      if (!row) return undefined
      return options.driver.createDownloadUrl({
        ...locator(row),
        expiresInSeconds: 300,
      })
    },
    async updateLogicalPath(storageObjectId, packId, logicalPath) {
      const row = await findReadyObject(storageObjectId, packId)
      if (!row) throw new Error('Ready R2 Resource object not found')
      await patchObject(row.id, { logical_path: logicalPath })
    },
    async delete(storageObjectId, packId) {
      const row = await findObject(storageObjectId, packId)
      if (!row) return false
      await options.driver.deleteObject(locator(row))
      await patchObject(row.id, {
        status: 'deleted',
        deleted_at: new Date().toISOString(),
      })
      return true
    },
    async listPackObjects(packId) {
      const rows = await request<StorageObjectRow[]>(
        `beegame_storage_objects?pack_id=eq.${encodeURIComponent(packId)}&provider=eq.r2&deleted_at=is.null&select=id,logical_path,status`,
      )
      return rows.map(row => ({
        id: row.id,
        ...(row.logical_path ? { logicalPath: row.logical_path } : {}),
        status: row.status,
      }))
    },
  }
}
