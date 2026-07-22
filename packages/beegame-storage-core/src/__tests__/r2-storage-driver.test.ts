import { describe, expect, test } from 'bun:test'
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import {
  createR2StorageDriver,
  resolveR2StorageDriverConfig,
} from '../r2-storage-driver'

describe('R2 storage driver', () => {
  test('requires explicit server-side credentials', () => {
    expect(() => resolveR2StorageDriverConfig({})).toThrow(
      'BEEGAME_R2_ACCOUNT_ID or BEEGAME_R2_ENDPOINT',
    )
    expect(
      resolveR2StorageDriverConfig({
        BEEGAME_R2_ACCOUNT_ID: 'account',
        BEEGAME_R2_ACCESS_KEY_ID: 'access',
        BEEGAME_R2_SECRET_ACCESS_KEY: 'secret',
      }),
    ).toEqual({
      accountId: 'account',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
    })
  })

  test('accepts an operation timeout without changing explicit credentials', () => {
    const driver = createR2StorageDriver({
      endpoint: 'https://r2.test',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      requestTimeoutMs: 1_000,
      client: { send: async () => ({}) } as never,
    })
    expect(driver.provider).toBe('r2')
  })

  test('signs a single object operation and preserves the requested content type', async () => {
    let observedCommand: unknown
    const driver = createR2StorageDriver({
      endpoint: 'https://r2.test',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      client: { send: async () => ({}) } as never,
      presign: (async (_client: unknown, command: unknown) => {
        observedCommand = command
        return 'https://signed.test/object'
      }) as never,
    })
    await expect(
      driver.createUploadUrl({
        provider: 'r2',
        bucket: 'assets',
        objectKey: 'objects/id/file.glb',
        contentType: 'model/gltf-binary',
        expiresInSeconds: 300,
      }),
    ).resolves.toBe('https://signed.test/object')
    expect(observedCommand).toBeInstanceOf(PutObjectCommand)
    expect((observedCommand as PutObjectCommand).input).toEqual({
      Bucket: 'assets',
      Key: 'objects/id/file.glb',
      ContentType: 'model/gltf-binary',
    })
  })

  test('uses the Cloudflare account endpoint in path style without an empty-body checksum', async () => {
    const driver = createR2StorageDriver({
      accountId: '0123456789abcdef',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
    })
    const signed = new URL(
      await driver.createUploadUrl({
        provider: 'r2',
        bucket: 'beegame-project-private',
        objectKey: 'objects/id/payload.bin',
        contentType: 'application/octet-stream',
        expiresInSeconds: 120,
      }),
    )

    expect(signed.hostname).toBe(
      '0123456789abcdef.r2.cloudflarestorage.com',
    )
    expect(signed.pathname).toBe(
      '/beegame-project-private/objects/id/payload.bin',
    )
    expect(signed.searchParams.has('x-amz-checksum-crc32')).toBe(false)
    expect(signed.searchParams.has('x-amz-sdk-checksum-algorithm')).toBe(false)
  })

  test('returns undefined for a missing object', async () => {
    const driver = createR2StorageDriver({
      endpoint: 'https://r2.test',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      client: {
        send: async (command: unknown) => {
          expect(command).toBeInstanceOf(HeadObjectCommand)
          throw { name: 'NotFound', $metadata: { httpStatusCode: 404 } }
        },
      } as never,
      presign: (async () => 'unused') as never,
    })
    await expect(
      driver.headObject({
        provider: 'r2',
        bucket: 'assets',
        objectKey: 'objects/missing',
      }),
    ).resolves.toBeUndefined()
  })
})
