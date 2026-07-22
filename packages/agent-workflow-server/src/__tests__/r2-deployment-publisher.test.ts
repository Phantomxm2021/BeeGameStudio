import { describe, expect, test } from 'bun:test'
import type {
  ProjectStorageDriver,
  StorageObjectLocator,
} from '@bee-game-studio/beegame-storage-core'
import { createR2DeploymentPublisher } from '../beegame/r2-deployment-publisher'

function metadataFetch(events: Array<Record<string, unknown>>): typeof fetch {
  const rows = new Map<string, Record<string, unknown>>()
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/beegame_storage_objects') && init?.method === 'POST') {
      const row = JSON.parse(String(init.body)) as Record<string, unknown>
      rows.set(String(row.id), row)
      events.push({ operation: 'create', ...row })
      return Response.json([row])
    }
    if (
      url.includes('/beegame_storage_objects?id=eq.') &&
      init?.method === 'PATCH'
    ) {
      const id = decodeURIComponent(url.split('id=eq.')[1] || '')
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      const row = { ...rows.get(id), ...body }
      rows.set(id, row)
      events.push({ operation: 'patch', id, ...body })
      return Response.json([row])
    }
    return new Response('Unexpected metadata request', { status: 500 })
  }) as typeof fetch
}

describe('R2 deployment publisher', () => {
  test('publishes immutable files and makes the deployment manifest the final object', async () => {
    const metadataEvents: Array<Record<string, unknown>> = []
    const uploads: Array<{ locator: StorageObjectLocator; bytes: Uint8Array }> =
      []
    const sizes = new Map<string, number>()
    const driver: ProjectStorageDriver = {
      provider: 'r2',
      putObject: async (locator, bytes) => {
        uploads.push({ locator, bytes })
        sizes.set(locator.objectKey, bytes.byteLength)
      },
      getObject: async () => undefined,
      createUploadUrl: async () => 'unused',
      createDownloadUrl: async () => 'unused',
      headObject: async locator => ({
        byteSize: sizes.get(locator.objectKey) ?? 0,
        metadata: {},
      }),
      deleteObject: async () => undefined,
      copyObject: async () => undefined,
      createMultipartUpload: async () => 'unused',
      createMultipartPartUploadUrl: async () => 'unused',
      completeMultipartUpload: async () => undefined,
      abortMultipartUpload: async () => undefined,
    }
    const publisher = createR2DeploymentPublisher({
      baseUrl: 'https://supabase.test',
      anonKey: 'anon-key',
      bucket: 'delivery-data',
      publicBaseUrl: 'https://games.test',
      driver,
      fetchImpl: metadataFetch(metadataEvents),
    })

    const result = await publisher.publishStaticDirectory({
      deploymentId: 'deploy-1',
      sessionId: 'session-1',
      userId: '00000000-0000-0000-0000-000000000001',
      projectId: 'project-1',
      workspacePath: '/workspace',
      outputDir: '/workspace/dist',
      artifactHash: 'artifact-sha',
      authToken: 'user-token',
      files: [
        {
          path: 'index.html',
          bytes: async () => new TextEncoder().encode('<main>game</main>'),
          text: async () => '<main>game</main>',
        },
        {
          path: 'assets/game.js',
          bytes: async () => new TextEncoder().encode('start()'),
          text: async () => 'start()',
        },
      ],
    })

    expect(uploads.map(item => item.locator.objectKey)).toEqual([
      'deployments/deploy-1/files/index.html',
      'deployments/deploy-1/files/assets/game.js',
      'deployments/deploy-1/manifest.json',
    ])
    expect(result).toEqual(
      expect.objectContaining({
        url: 'https://games.test/deployments/deploy-1/files/index.html',
        artifactPath: 'r2://delivery-data/deployments/deploy-1',
        manifestStorageObjectId: expect.any(String),
      }),
    )
    const manifest = JSON.parse(
      new TextDecoder().decode(uploads.at(-1)?.bytes),
    ) as { files: Array<{ path: string; sha256: string }> }
    expect(manifest.files.map(file => file.path)).toEqual([
      'index.html',
      'assets/game.js',
    ])
    expect(manifest.files.every(file => file.sha256.length === 64)).toBe(true)
    expect(metadataEvents.at(-1)).toEqual(
      expect.objectContaining({ operation: 'patch', status: 'ready' }),
    )
  })

  test('removes already uploaded objects when a later deployment file fails', async () => {
    const metadataEvents: Array<Record<string, unknown>> = []
    const deleted: string[] = []
    let uploadCount = 0
    const publisher = createR2DeploymentPublisher({
      baseUrl: 'https://supabase.test',
      anonKey: 'anon-key',
      bucket: 'delivery-data',
      publicBaseUrl: 'https://games.test',
      fetchImpl: metadataFetch(metadataEvents),
      driver: {
        provider: 'r2',
        putObject: async () => {
          uploadCount += 1
        },
        getObject: async () => undefined,
        createUploadUrl: async () => 'unused',
        createDownloadUrl: async () => 'unused',
        headObject: async () =>
          uploadCount === 1 ? { byteSize: 1, metadata: {} } : undefined,
        deleteObject: async locator => {
          deleted.push(locator.objectKey)
        },
        copyObject: async () => undefined,
        createMultipartUpload: async () => 'unused',
        createMultipartPartUploadUrl: async () => 'unused',
        completeMultipartUpload: async () => undefined,
        abortMultipartUpload: async () => undefined,
      },
    })

    await expect(
      publisher.publishStaticDirectory({
        deploymentId: 'deploy-2',
        sessionId: 'session-1',
        userId: '00000000-0000-0000-0000-000000000001',
        projectId: 'project-1',
        workspacePath: '/workspace',
        outputDir: '/workspace/dist',
        artifactHash: 'artifact-sha',
        authToken: 'user-token',
        files: [
          {
            path: 'index.html',
            bytes: async () => new Uint8Array([1]),
            text: async () => '',
          },
          {
            path: 'game.js',
            bytes: async () => new Uint8Array([2]),
            text: async () => '',
          },
        ],
      }),
    ).rejects.toThrow('verification failed')

    expect(deleted).toEqual(
      expect.arrayContaining([
        'deployments/deploy-2/files/index.html',
        'deployments/deploy-2/files/game.js',
      ]),
    )
    expect(metadataEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'patch', status: 'failed' }),
        expect.objectContaining({ operation: 'patch', status: 'deleted' }),
      ]),
    )
  })
})
