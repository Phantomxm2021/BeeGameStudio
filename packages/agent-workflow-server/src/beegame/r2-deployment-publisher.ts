import { createHash } from 'node:crypto'
import {
  assertSafeObjectKey,
  createR2StorageDriver,
  resolveProjectStorageConfiguration,
  type ProjectStorageDriver,
  type StorageObjectLocator,
} from '@bee-game-studio/beegame-storage-core'
import type {
  BeeGameDeploymentFile,
  BeeGameDeploymentPublisher,
} from './deployment-manager'

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

type DeploymentStorageObjectRow = {
  id: string
  bucket: string
  object_key: string
}

type UploadedDeploymentObject = {
  id: string
  locator: StorageObjectLocator
}

export function createR2DeploymentPublisherFromEnv(
  env: Record<string, string | undefined> = process.env,
): BeeGameDeploymentPublisher | undefined {
  const configuration = resolveProjectStorageConfiguration(env)
  if (configuration.provider !== 'r2') return undefined
  const baseUrl = env.BEEGAME_SUPABASE_URL?.trim()
  const anonKey = (
    env.BEEGAME_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
  )?.trim()
  const publicBaseUrl = (
    env.BEEGAME_R2_DELIVERY_PUBLIC_BASE_URL ??
    env.BEEGAME_DEPLOYMENT_PUBLIC_BASE_URL ??
    ''
  ).trim()
  if (!baseUrl || !anonKey) {
    throw new Error(
      'R2 deployment publishing requires Supabase metadata configuration',
    )
  }
  if (!publicBaseUrl) {
    throw new Error('R2 deployment publishing requires a public delivery URL')
  }
  return createR2DeploymentPublisher({
    baseUrl,
    anonKey,
    bucket: configuration.buckets.delivery,
    publicBaseUrl,
    driver: createR2StorageDriver(configuration.r2),
  })
}

export function createR2DeploymentPublisher(options: {
  baseUrl: string
  anonKey: string
  bucket: string
  publicBaseUrl: string
  driver: ProjectStorageDriver
  fetchImpl?: FetchImplementation
}): BeeGameDeploymentPublisher {
  if (options.driver.provider !== 'r2') {
    throw new Error('R2 deployment publisher requires an R2 driver')
  }
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, '')
  const bucket = options.bucket.trim()
  if (!bucket) throw new Error('R2 delivery bucket is required')
  if (!publicBaseUrl) throw new Error('R2 public delivery URL is required')
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
        `Deployment storage metadata request failed (${response.status})${detail ? ` - ${detail}` : ''}`,
      )
    }
    return response.json() as Promise<T>
  }

  const patchObject = async (
    id: string,
    authToken: string,
    body: Record<string, unknown>,
  ): Promise<void> => {
    await request<DeploymentStorageObjectRow[]>(
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

  const createAndUpload = async (input: {
    ownerId: string
    projectId: string
    deploymentId: string
    logicalPath: string
    objectKey: string
    objectKind: 'deployment_file' | 'deployment_manifest'
    contentType: string
    bytes: Uint8Array
    checksum: string
    authToken: string
  }): Promise<UploadedDeploymentObject> => {
    const id = crypto.randomUUID()
    const objectKey = assertSafeObjectKey(input.objectKey)
    const row = (
      await request<DeploymentStorageObjectRow[]>(
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
            scope_id: input.deploymentId,
            owner_user_id: input.ownerId,
            project_id: input.projectId,
            provider: 'r2',
            bucket_role: 'delivery',
            bucket,
            object_key: objectKey,
            logical_path: input.logicalPath,
            original_filename: input.logicalPath.split('/').at(-1) || null,
            mime_type: input.contentType,
            byte_size: input.bytes.byteLength,
            checksum_algorithm: 'sha256',
            checksum_value: input.checksum,
            object_kind: input.objectKind,
            status: 'uploading',
            visibility: 'public',
            metadata: { deployment_id: input.deploymentId },
          }),
        },
      )
    )[0]
    if (!row) {
      throw new Error('Deployment storage metadata creation returned no row')
    }
    const locator: StorageObjectLocator = {
      provider: 'r2',
      bucketRole: 'delivery',
      bucket: row.bucket,
      objectKey: row.object_key,
    }
    try {
      await options.driver.putObject(locator, input.bytes, input.contentType, {
        'beegame-object-id': id,
        'beegame-sha256': input.checksum,
      })
      const head = await options.driver.headObject(locator)
      if (!head || head.byteSize !== input.bytes.byteLength) {
        throw new Error('R2 deployment object verification failed')
      }
      await patchObject(id, input.authToken, {
        status: 'ready',
        byte_size: head.byteSize,
        mime_type: head.contentType || input.contentType,
        etag: head.etag ?? null,
      })
      return { id, locator }
    } catch (error) {
      await patchObject(id, input.authToken, {
        status: 'failed',
        metadata: {
          deployment_id: input.deploymentId,
          failure:
            error instanceof Error
              ? error.message
              : 'Deployment object upload failed',
        },
      }).catch(() => undefined)
      await options.driver.deleteObject(locator).catch(() => undefined)
      throw error
    }
  }

  return {
    async publishStaticDirectory(input) {
      if (!input.userId || !input.projectId) {
        throw new Error(
          'R2 deployment publishing requires project and user ownership',
        )
      }
      if (!input.authToken) {
        throw new Error('R2 deployment publishing requires authentication')
      }
      const uploaded: UploadedDeploymentObject[] = []
      const manifestFiles: Array<{
        path: string
        byteSize: number
        contentType: string
        sha256: string
      }> = []
      try {
        for (const file of input.files) {
          const bytes = await file.bytes()
          const checksum = sha256(bytes)
          const contentType = contentTypeForDeploymentFile(file)
          const object = await createAndUpload({
            ownerId: input.userId,
            projectId: input.projectId,
            deploymentId: input.deploymentId,
            logicalPath: file.path,
            objectKey: `deployments/${input.deploymentId}/files/${file.path}`,
            objectKind: 'deployment_file',
            contentType,
            bytes,
            checksum,
            authToken: input.authToken,
          })
          uploaded.push(object)
          manifestFiles.push({
            path: file.path,
            byteSize: bytes.byteLength,
            contentType,
            sha256: checksum,
          })
        }
        const manifestBytes = new TextEncoder().encode(
          `${JSON.stringify(
            {
              version: 1,
              deploymentId: input.deploymentId,
              projectId: input.projectId,
              artifactHash: input.artifactHash,
              files: manifestFiles,
            },
            null,
            2,
          )}\n`,
        )
        const manifest = await createAndUpload({
          ownerId: input.userId,
          projectId: input.projectId,
          deploymentId: input.deploymentId,
          logicalPath: 'manifest.json',
          objectKey: `deployments/${input.deploymentId}/manifest.json`,
          objectKind: 'deployment_manifest',
          contentType: 'application/json; charset=utf-8',
          bytes: manifestBytes,
          checksum: sha256(manifestBytes),
          authToken: input.authToken,
        })
        uploaded.push(manifest)
        return {
          url: `${publicBaseUrl}/deployments/${input.deploymentId}/files/index.html`,
          artifactPath: `r2://${bucket}/deployments/${input.deploymentId}`,
          manifestStorageObjectId: manifest.id,
          message: 'Static deployment published as an immutable R2 version',
        }
      } catch (error) {
        for (const object of uploaded.reverse()) {
          await options.driver
            .deleteObject(object.locator)
            .catch(() => undefined)
          await patchObject(object.id, input.authToken, {
            status: 'deleted',
            deleted_at: new Date().toISOString(),
          }).catch(() => undefined)
        }
        throw error
      }
    },
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function contentTypeForDeploymentFile(file: BeeGameDeploymentFile): string {
  const path = file.path.toLowerCase()
  if (path.endsWith('.html')) return 'text/html; charset=utf-8'
  if (path.endsWith('.js') || path.endsWith('.mjs')) {
    return 'text/javascript; charset=utf-8'
  }
  if (path.endsWith('.css')) return 'text/css; charset=utf-8'
  if (path.endsWith('.json')) return 'application/json; charset=utf-8'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.wasm')) return 'application/wasm'
  if (path.endsWith('.mp3')) return 'audio/mpeg'
  if (path.endsWith('.ogg')) return 'audio/ogg'
  if (path.endsWith('.wav')) return 'audio/wav'
  if (path.endsWith('.glb')) return 'model/gltf-binary'
  if (path.endsWith('.gltf')) return 'model/gltf+json'
  return 'application/octet-stream'
}
