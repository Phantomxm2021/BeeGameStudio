import {
  createR2StorageDriver,
  resolveProjectStorageConfiguration,
  sha256Hex,
  type ProjectStorageDriver,
  type StorageObjectLocator,
} from '@bee-game-studio/beegame-storage-core'
/*
 * The active Claude Code workspace remains on its isolated filesystem. This
 * adapter persists only project-owned file copies in R2.
 */

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

type ProjectStorageObjectRow = {
  id: string
  owner_user_id: string
  project_id: string | null
  provider: 'r2'
  bucket_role: 'project-private'
  bucket: string
  object_key: string
  logical_path: string | null
  original_filename: string | null
  mime_type: string | null
  byte_size: number | null
  etag: string | null
  status: string
  deleted_at: string | null
}

export type ProjectAssetStorage = {
  uploadAssetFile(input: {
    ownerId: string
    projectId: string
    authToken: string
    file: File
  }): Promise<string>
  deleteAssetFile(input: {
    ownerId: string
    projectId: string
    authToken: string
    storageUri: string
  }): Promise<void>
}

const R2_OBJECT_URI_PREFIX = 'r2-object://'

export function createR2ProjectAssetStorageFromEnv(
  env: Record<string, string | undefined> = process.env,
): ProjectAssetStorage | undefined {
  const configuration = resolveProjectStorageConfiguration(env)
  if (configuration.provider !== 'r2') return undefined
  const baseUrl = env.BEEGAME_SUPABASE_URL?.trim()
  const anonKey = (
    env.BEEGAME_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
  )?.trim()
  if (!baseUrl || !anonKey) {
    throw new Error(
      'R2 project asset storage requires Supabase metadata configuration',
    )
  }
  return createR2ProjectAssetStorage({
    baseUrl,
    anonKey,
    bucket: configuration.buckets['project-private'],
    driver: createR2StorageDriver(configuration.r2),
  })
}

export function createR2ProjectAssetStorage(options: {
  baseUrl: string
  anonKey: string
  bucket: string
  driver: ProjectStorageDriver
  fetchImpl?: FetchImplementation
}): ProjectAssetStorage {
  if (options.driver.provider !== 'r2') {
    throw new Error('R2 project asset storage requires an R2 driver')
  }
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const bucket = options.bucket.trim()
  if (!bucket) throw new Error('R2 project asset bucket is required')
  const fetchImpl = options.fetchImpl ?? fetch
  const request = async <T>(
    path: string,
    authToken: string,
    init: RequestInit = {},
  ): Promise<T> => {
    const response = await fetchImpl(`${baseUrl}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: options.anonKey,
        authorization: `Bearer ${authToken}`,
        ...init.headers,
      },
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `Project storage metadata request failed (${response.status})${detail ? ` - ${detail}` : ''}`,
      )
    }
    return response.json() as Promise<T>
  }

  const patchObject = async (
    id: string,
    authToken: string,
    body: Record<string, unknown>,
  ): Promise<void> => {
    await request<ProjectStorageObjectRow[]>(
      `beegame_storage_objects?id=eq.${encodeURIComponent(id)}`,
      authToken,
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

  const locator = (row: ProjectStorageObjectRow): StorageObjectLocator => ({
    provider: 'r2',
    bucketRole: 'project-private',
    bucket: row.bucket,
    objectKey: row.object_key,
  })

  return {
    async uploadAssetFile(input) {
      const id = crypto.randomUUID()
      const contentType = input.file.type || 'application/octet-stream'
      const bytes = new Uint8Array(await input.file.arrayBuffer())
      const checksum = sha256Hex(bytes)
      const row = (
        await request<ProjectStorageObjectRow[]>(
          'beegame_storage_objects',
          input.authToken,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              prefer: 'return=representation',
            },
            body: JSON.stringify({
              id,
              scope_type: 'project',
              scope_id: input.projectId,
              owner_user_id: input.ownerId,
              project_id: input.projectId,
              provider: 'r2',
              bucket_role: 'project-private',
              bucket,
              object_key: `objects/${id}/payload`,
              logical_path: `uploads/${id}/${input.file.name}`,
              original_filename: input.file.name,
              mime_type: contentType,
              byte_size: input.file.size,
              checksum_algorithm: 'sha256',
              checksum_value: checksum,
              object_kind: 'game_asset',
              status: 'uploading',
              visibility: 'project',
            }),
          },
        )
      )[0]
      if (!row)
        throw new Error('Project storage metadata creation returned no row')
      try {
        await options.driver.putObject(locator(row), bytes, contentType, {
          'beegame-object-id': id,
          'beegame-sha256': checksum,
        })
        const head = await options.driver.headObject(locator(row))
        if (!head || head.byteSize !== input.file.size) {
          throw new Error('R2 project asset verification failed')
        }
        await patchObject(id, input.authToken, {
          status: 'ready',
          byte_size: head.byteSize,
          mime_type: head.contentType || contentType,
          etag: head.etag ?? null,
        })
        return `${R2_OBJECT_URI_PREFIX}${id}`
      } catch (error) {
        await patchObject(id, input.authToken, {
          status: 'failed',
          metadata: {
            failure:
              error instanceof Error
                ? error.message
                : 'Project asset upload failed',
          },
        }).catch(() => undefined)
        await options.driver.deleteObject(locator(row)).catch(() => undefined)
        throw error
      }
    },

    async deleteAssetFile(input) {
      if (!input.storageUri.startsWith(R2_OBJECT_URI_PREFIX)) return
      const id = input.storageUri.slice(R2_OBJECT_URI_PREFIX.length).trim()
      if (!id) return
      const rows = await request<ProjectStorageObjectRow[]>(
        `beegame_storage_objects?id=eq.${encodeURIComponent(id)}&owner_user_id=eq.${encodeURIComponent(input.ownerId)}&project_id=eq.${encodeURIComponent(input.projectId)}&provider=eq.r2&deleted_at=is.null&select=*`,
        input.authToken,
      )
      const row = rows[0]
      if (!row) return
      await options.driver.deleteObject(locator(row))
      await patchObject(row.id, input.authToken, {
        status: 'deleted',
        deleted_at: new Date().toISOString(),
      })
    },
  }
}
