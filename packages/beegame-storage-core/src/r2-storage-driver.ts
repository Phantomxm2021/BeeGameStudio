import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { assertSafeObjectKey } from './routing'
import type {
  CompleteMultipartUploadPart,
  CreateDownloadUrlInput,
  CreateMultipartUploadInput,
  CreateUploadUrlInput,
  ProjectStorageDriver,
  StorageObjectHead,
  StorageObjectLocator,
  StorageObjectPayload,
} from './types'

type S3Sender = Pick<S3Client, 'send'>
type Presign = typeof getSignedUrl

export type R2StorageDriverConfig = {
  accountId?: string
  endpoint?: string
  accessKeyId: string
  secretAccessKey: string
  requestTimeoutMs?: number
  client?: S3Sender
  presign?: Presign
}

export function resolveR2StorageDriverConfig(
  env: Record<string, string | undefined>,
): R2StorageDriverConfig {
  const accountId = env.BEEGAME_R2_ACCOUNT_ID?.trim()
  const endpoint = env.BEEGAME_R2_ENDPOINT?.trim()
  const accessKeyId = env.BEEGAME_R2_ACCESS_KEY_ID?.trim()
  const secretAccessKey = env.BEEGAME_R2_SECRET_ACCESS_KEY?.trim()
  const missing = [
    !accountId && !endpoint
      ? 'BEEGAME_R2_ACCOUNT_ID or BEEGAME_R2_ENDPOINT'
      : undefined,
    !accessKeyId ? 'BEEGAME_R2_ACCESS_KEY_ID' : undefined,
    !secretAccessKey ? 'BEEGAME_R2_SECRET_ACCESS_KEY' : undefined,
  ].filter((value): value is string => Boolean(value))
  if (missing.length)
    throw new Error(
      `R2 storage configuration is incomplete: ${missing.join(', ')}`,
    )
  return {
    ...(accountId ? { accountId } : {}),
    ...(endpoint ? { endpoint } : {}),
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
  }
}

export function createR2StorageDriver(
  config: R2StorageDriverConfig,
): ProjectStorageDriver {
  const endpoint = (
    config.endpoint?.trim() ||
    `https://${config.accountId?.trim()}.r2.cloudflarestorage.com`
  ).replace(/\/+$/, '')
  if (!config.endpoint && !config.accountId?.trim())
    throw new Error('R2 account id or endpoint is required')
  if (!config.accessKeyId.trim() || !config.secretAccessKey.trim())
    throw new Error('R2 API credentials are required')
  const clientConfig: S3ClientConfig = {
    region: 'auto',
    endpoint,
    // Cloudflare's account endpoint is path-style. Allowing the AWS SDK to
    // rewrite it as <bucket>.<account>.r2... produces hosts that are not
    // consistently routable and makes presigned URLs fail before R2 sees them.
    forcePathStyle: true,
    // The browser supplies the body after the PUT URL is signed. Do not let the
    // SDK bind an empty-body CRC32 checksum into that signature.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    ...(config.requestTimeoutMs
      ? {
          requestHandler: new NodeHttpHandler({
            connectionTimeout: Math.min(config.requestTimeoutMs, 10_000),
            requestTimeout: config.requestTimeoutMs,
            socketTimeout: config.requestTimeoutMs,
            throwOnRequestTimeout: true,
          }),
        }
      : {}),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  }
  const client = config.client ?? new S3Client(clientConfig)
  const presign = config.presign ?? getSignedUrl

  const checked = (locator: StorageObjectLocator) => {
    if (locator.provider !== 'r2')
      throw new Error('R2 driver cannot operate on a non-R2 locator')
    const bucket = locator.bucket.trim()
    if (!bucket) throw new Error('R2 bucket is required')
    return { bucket, key: assertSafeObjectKey(locator.objectKey) }
  }

  return {
    provider: 'r2',
    async putObject(locator, bytes, contentType, metadata) {
      const { bucket, key } = checked(locator)
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          Metadata: metadata,
        }),
      )
    },
    async getObject(
      locator: StorageObjectLocator,
    ): Promise<StorageObjectPayload | undefined> {
      const { bucket, key } = checked(locator)
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        )
        if (!result.Body) return undefined
        return {
          bytes: await result.Body.transformToByteArray(),
          byteSize: Number(result.ContentLength ?? 0),
          ...(result.ContentType ? { contentType: result.ContentType } : {}),
          ...(result.ETag ? { etag: result.ETag.replace(/^"|"$/g, '') } : {}),
          metadata: result.Metadata ?? {},
        }
      } catch (error) {
        if (isNotFound(error)) return undefined
        throw error
      }
    },
    async createUploadUrl(input: CreateUploadUrlInput) {
      const { bucket, key } = checked(input)
      return await presign(
        client as S3Client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: input.contentType,
        }),
        { expiresIn: validExpiry(input.expiresInSeconds) },
      )
    },
    async createDownloadUrl(input: CreateDownloadUrlInput) {
      const { bucket, key } = checked(input)
      return await presign(
        client as S3Client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(input.downloadFilename
            ? {
                ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(input.downloadFilename)}`,
              }
            : {}),
        }),
        { expiresIn: validExpiry(input.expiresInSeconds) },
      )
    },
    async headObject(
      locator: StorageObjectLocator,
    ): Promise<StorageObjectHead | undefined> {
      const { bucket, key } = checked(locator)
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        )
        return {
          byteSize: Number(result.ContentLength ?? 0),
          ...(result.ContentType ? { contentType: result.ContentType } : {}),
          ...(result.ETag ? { etag: result.ETag.replace(/^"|"$/g, '') } : {}),
          metadata: result.Metadata ?? {},
        }
      } catch (error) {
        if (isNotFound(error)) return undefined
        throw error
      }
    },
    async deleteObject(locator: StorageObjectLocator) {
      const { bucket, key } = checked(locator)
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
    async copyObject(
      source: StorageObjectLocator,
      destination: StorageObjectLocator,
    ) {
      const sourceLocation = checked(source)
      const destinationLocation = checked(destination)
      await client.send(
        new CopyObjectCommand({
          Bucket: destinationLocation.bucket,
          Key: destinationLocation.key,
          CopySource: encodeCopySource(
            sourceLocation.bucket,
            sourceLocation.key,
          ),
        }),
      )
    },
    async createMultipartUpload(input: CreateMultipartUploadInput) {
      const { bucket, key } = checked(input)
      const result = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ContentType: input.contentType,
          Metadata: input.metadata,
        }),
      )
      if (!result.UploadId)
        throw new Error('R2 did not return a multipart upload id')
      return result.UploadId
    },
    async createMultipartPartUploadUrl(
      locator,
      uploadId,
      partNumber,
      expiresInSeconds,
    ) {
      const { bucket, key } = checked(locator)
      if (!uploadId.trim()) throw new Error('Multipart upload id is required')
      if (
        !Number.isInteger(partNumber) ||
        partNumber < 1 ||
        partNumber > 10_000
      )
        throw new Error('Multipart part number is invalid')
      return await presign(
        client as S3Client,
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: validExpiry(expiresInSeconds) },
      )
    },
    async completeMultipartUpload(
      locator,
      uploadId,
      parts: CompleteMultipartUploadPart[],
    ) {
      const { bucket, key } = checked(locator)
      if (!uploadId.trim()) throw new Error('Multipart upload id is required')
      const normalized = normalizeParts(parts)
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: normalized.map(part => ({
              ETag: part.etag,
              PartNumber: part.partNumber,
            })),
          },
        }),
      )
    },
    async abortMultipartUpload(locator, uploadId) {
      const { bucket, key } = checked(locator)
      if (!uploadId.trim()) throw new Error('Multipart upload id is required')
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        }),
      )
    },
  }
}

function validExpiry(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 604_800)
    throw new Error('Presigned URL expiry must be between 1 and 604800 seconds')
  return value
}

function normalizeParts(
  parts: CompleteMultipartUploadPart[],
): CompleteMultipartUploadPart[] {
  if (!parts.length)
    throw new Error('Multipart upload requires at least one completed part')
  const sorted = [...parts].sort(
    (left, right) => left.partNumber - right.partNumber,
  )
  if (
    sorted.some(
      (part, index) =>
        !Number.isInteger(part.partNumber) ||
        part.partNumber < 1 ||
        !part.etag.trim() ||
        (index > 0 && part.partNumber === sorted[index - 1]?.partNumber),
    )
  ) {
    throw new Error('Multipart upload parts are invalid')
  }
  return sorted
}

function encodeCopySource(bucket: string, key: string): string {
  return `/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as {
    name?: unknown
    $metadata?: { httpStatusCode?: unknown }
  }
  return (
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey' ||
    candidate.$metadata?.httpStatusCode === 404
  )
}
