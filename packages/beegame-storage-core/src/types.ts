export type StorageProvider = 'supabase' | 'r2'

export type StorageScopeType =
  | 'user'
  | 'studio'
  | 'platform'
  | 'project'
  | 'pack'
  | 'deployment'
  | 'session'

export type ProjectStorageBucketRole =
  | 'project-private'
  | 'resource-private'
  | 'delivery'
  | 'log-private'

export type StorageObjectStatus =
  | 'pending'
  | 'uploading'
  | 'verifying'
  | 'ready'
  | 'failed'
  | 'deleted'

export type StorageObjectVisibility =
  | 'private'
  | 'project'
  | 'organization'
  | 'public'

export type StorageObjectLocator = {
  provider: StorageProvider
  bucketRole?: ProjectStorageBucketRole
  bucket: string
  objectKey: string
}

export type StorageObjectHead = {
  byteSize: number
  contentType?: string
  etag?: string
  metadata: Record<string, string>
}

export type StorageObjectPayload = StorageObjectHead & {
  bytes: Uint8Array
}

export type CreateUploadUrlInput = StorageObjectLocator & {
  contentType: string
  expiresInSeconds: number
}

export type CreateDownloadUrlInput = StorageObjectLocator & {
  expiresInSeconds: number
  downloadFilename?: string
}

export type CreateMultipartUploadInput = StorageObjectLocator & {
  contentType: string
  metadata?: Record<string, string>
}

export type CompleteMultipartUploadPart = {
  partNumber: number
  etag: string
}

export interface ProjectStorageDriver {
  readonly provider: StorageProvider
  putObject(
    locator: StorageObjectLocator,
    bytes: Uint8Array,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<void>
  getObject(
    locator: StorageObjectLocator,
  ): Promise<StorageObjectPayload | undefined>
  createUploadUrl(input: CreateUploadUrlInput): Promise<string>
  createDownloadUrl(input: CreateDownloadUrlInput): Promise<string>
  headObject(
    locator: StorageObjectLocator,
  ): Promise<StorageObjectHead | undefined>
  deleteObject(locator: StorageObjectLocator): Promise<void>
  copyObject(
    source: StorageObjectLocator,
    destination: StorageObjectLocator,
  ): Promise<void>
  createMultipartUpload(input: CreateMultipartUploadInput): Promise<string>
  createMultipartPartUploadUrl(
    locator: StorageObjectLocator,
    uploadId: string,
    partNumber: number,
    expiresInSeconds: number,
  ): Promise<string>
  completeMultipartUpload(
    locator: StorageObjectLocator,
    uploadId: string,
    parts: CompleteMultipartUploadPart[],
  ): Promise<void>
  abortMultipartUpload(
    locator: StorageObjectLocator,
    uploadId: string,
  ): Promise<void>
}
