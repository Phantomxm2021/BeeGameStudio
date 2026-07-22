#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import {
  buildResourcePackObjectKey,
  createR2StorageDriver,
  resolveProjectStorageConfiguration,
  type StorageObjectLocator,
} from '../packages/beegame-storage-core/src/index'
import { fetchAllSupabaseRows } from './supabase-rest-pagination'
import { retryOperation } from './retry-operation'

type PackRow = {
  id: string
  created_by: string | null
  cover_path: string | null
  cover_storage_object_id: string | null
}
type ElementRow = {
  id: string
  pack_id: string
  path: string
  storage_object_id: string | null
}
type MigrationCandidate = {
  kind: 'resource_preview' | 'resource_element'
  packId: string
  ownerId: string
  logicalPath: string
  table: 'beegame_resource_packs' | 'beegame_resource_elements'
  rowId: string
  referenceColumn: 'cover_storage_object_id' | 'storage_object_id'
}

loadEnvFile('.env.local')
const apply = process.argv.includes('--apply')
const verbose = process.argv.includes('--verbose')
const limit = readPositiveIntegerArgument('--limit')
const requestTimeoutMs =
  readPositiveIntegerArgument('--request-timeout-ms') ?? 120_000
const configuration = resolveProjectStorageConfiguration(process.env)
if (configuration.provider !== 'r2')
  throw new Error('Set BEEGAME_PROJECT_STORAGE_PROVIDER=r2 before migration')
const supabaseUrl = requiredEnv('BEEGAME_SUPABASE_URL').replace(/\/+$/, '')
const serviceRoleKey = requiredEnv('BEEGAME_SUPABASE_SERVICE_ROLE_KEY')
const legacyBucket =
  process.env.BEEGAME_RESOURCE_STORAGE_BUCKET?.trim() ||
  'beegame-resource-packs'
const destinationBucket = configuration.buckets['resource-private']
const driver = createR2StorageDriver({
  ...configuration.r2,
  requestTimeoutMs,
})
const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
}

const packs = await fetchAllSupabaseRows<PackRow>({
  baseUrl: supabaseUrl,
  path: 'beegame_resource_packs?select=id,created_by,cover_path,cover_storage_object_id&archived_at=is.null&order=id.asc',
  headers,
  signal: AbortSignal.timeout(requestTimeoutMs),
})
const packOwners = new Map(
  packs.flatMap(pack =>
    pack.created_by ? ([[pack.id, pack.created_by]] as const) : [],
  ),
)
const elements = await fetchAllSupabaseRows<ElementRow>({
  baseUrl: supabaseUrl,
  path: 'beegame_resource_elements?select=id,pack_id,path,storage_object_id&order=id.asc',
  headers,
  signal: AbortSignal.timeout(requestTimeoutMs),
})
const candidates: MigrationCandidate[] = []
const ownerlessPackIds = new Set<string>()
let skippedOwnerlessElements = 0
for (const pack of packs) {
  if (pack.cover_storage_object_id || !pack.cover_path) continue
  if (!pack.created_by) {
    ownerlessPackIds.add(pack.id)
    continue
  }
  candidates.push({
    kind: 'resource_preview',
    packId: pack.id,
    ownerId: pack.created_by,
    logicalPath: pack.cover_path,
    table: 'beegame_resource_packs',
    rowId: pack.id,
    referenceColumn: 'cover_storage_object_id',
  })
}
for (const element of elements) {
  if (element.storage_object_id) continue
  const ownerId = packOwners.get(element.pack_id)
  if (!ownerId) {
    ownerlessPackIds.add(element.pack_id)
    skippedOwnerlessElements += 1
    continue
  }
  candidates.push({
    kind: 'resource_element',
    packId: element.pack_id,
    ownerId,
    logicalPath: element.path,
    table: 'beegame_resource_elements',
    rowId: element.id,
    referenceColumn: 'storage_object_id',
  })
}

if (ownerlessPackIds.size > 0) {
  console.error(
    `Migration blocked: ${ownerlessPackIds.size} Pack(s) have no owner, affecting ${skippedOwnerlessElements} element(s).`,
  )
  for (const packId of [...ownerlessPackIds].slice(0, 20))
    console.error(`- ${packId}`)
  if (ownerlessPackIds.size > 20)
    console.error(`- …and ${ownerlessPackIds.size - 20} more`)
  console.error(
    'Apply docs/beegame-resource-legacy-owner-backfill-migration.sql, then rerun this command.',
  )
  process.exit(1)
}

console.log(
  `${apply ? 'Applying' : 'Planning'} ${Math.min(limit ?? candidates.length, candidates.length)} of ${candidates.length} Resource Library object migration(s).`,
)
if (!apply) {
  const planned = candidates.slice(0, limit ?? 100)
  for (const candidate of planned)
    console.log(
      `- ${candidate.kind} ${candidate.packId}/${candidate.logicalPath}`,
    )
  if (candidates.length > planned.length)
    console.log(`- …and ${candidates.length - planned.length} more`)
  console.log('No data changed. Re-run with --apply to copy and cut over.')
  process.exit(0)
}

let migrated = 0
let failed = 0
for (const candidate of candidates.slice(0, limit ?? candidates.length)) {
  try {
    await migrateCandidate(candidate)
    migrated += 1
    if (verbose)
      console.log(`Migrated ${candidate.packId}/${candidate.logicalPath}`)
    else if (migrated % 25 === 0)
      console.log(`Migration progress: ${migrated} completed, ${failed} failed.`)
  } catch (error) {
    failed += 1
    console.error(
      `Failed ${candidate.packId}/${candidate.logicalPath}:`,
      error instanceof Error ? error.message : error,
    )
  }
}
console.log(`Migration finished: ${migrated} migrated, ${failed} failed.`)
if (failed > 0) process.exitCode = 1

async function migrateCandidate(candidate: MigrationCandidate): Promise<void> {
  const sourcePath = legacyPackObjectPath(
    candidate.packId,
    candidate.logicalPath,
  )
  const sourceId = deterministicUuid(`supabase:${legacyBucket}:${sourcePath}`)
  const destinationId = deterministicUuid(`r2:${sourceId}`)
  const jobId = deterministicUuid(`migration:${sourceId}:${destinationId}`)
  const destinationKey = buildResourcePackObjectKey(
    candidate.packId,
    destinationId,
  )
  const sourceResponse = await stage('Supabase source download', () =>
    retryOperation(async () => {
    const response = await fetch(
      `${supabaseUrl}/storage/v1/object/${encodeURIComponent(legacyBucket)}/${encodeObjectPath(sourcePath)}`,
      { headers, signal: AbortSignal.timeout(requestTimeoutMs) },
    )
    if (!response.ok)
      throw new Error(`Supabase source download failed (${response.status})`)
    return response
    }),
  )
  const bytes = new Uint8Array(await sourceResponse.arrayBuffer())
  const contentType =
    sourceResponse.headers.get('content-type') || 'application/octet-stream'
  const checksum = createHash('sha256').update(bytes).digest('hex')

  await upsertStorageObject({
    id: sourceId,
    scope_type: 'pack',
    scope_id: candidate.packId,
    owner_user_id: candidate.ownerId,
    pack_id: candidate.packId,
    provider: 'supabase',
    bucket: legacyBucket,
    object_key: sourcePath,
    logical_path: candidate.logicalPath,
    original_filename: candidate.logicalPath.split('/').at(-1) || null,
    mime_type: contentType,
    byte_size: bytes.byteLength,
    checksum_algorithm: 'sha256',
    checksum_value: checksum,
    object_kind: candidate.kind,
    status: 'ready',
    visibility: 'private',
  })
  await upsertStorageObject({
    id: destinationId,
    scope_type: 'pack',
    scope_id: candidate.packId,
    owner_user_id: candidate.ownerId,
    pack_id: candidate.packId,
    provider: 'r2',
    bucket_role: 'resource-private',
    bucket: destinationBucket,
    object_key: destinationKey,
    logical_path: candidate.logicalPath,
    original_filename: candidate.logicalPath.split('/').at(-1) || null,
    mime_type: contentType,
    byte_size: bytes.byteLength,
    checksum_algorithm: 'sha256',
    checksum_value: checksum,
    object_kind: candidate.kind,
    status: 'uploading',
    visibility: 'private',
  })
  await upsertMigrationJob(jobId, sourceId, destinationId)
  await patchMigrationJob(jobId, {
    status: 'copying',
    attempts: 1,
    started_at: new Date().toISOString(),
    last_error: null,
  })

  const locator: StorageObjectLocator = {
    provider: 'r2',
    bucketRole: 'resource-private',
    bucket: destinationBucket,
    objectKey: destinationKey,
  }
  try {
    await stage('R2 destination upload', () =>
      retryOperation(() =>
        driver.putObject(locator, bytes, contentType, {
          'beegame-object-id': destinationId,
          'beegame-sha256': checksum,
        }),
      ),
    )
    const head = await stage('R2 destination verification', () =>
      retryOperation(() => driver.headObject(locator)),
    )
    if (!head || head.byteSize !== bytes.byteLength)
      throw new Error('R2 destination verification failed')
    await patchStorageObject(destinationId, {
      status: 'ready',
      byte_size: head.byteSize,
      mime_type: head.contentType || contentType,
      etag: head.etag ?? null,
    })
    await patchMigrationJob(jobId, {
      status: 'ready_to_cutover',
      verified_at: new Date().toISOString(),
    })
    await patchBusinessReference(candidate, destinationId)
    await patchMigrationJob(jobId, {
      status: 'cutover_complete',
      cutover_at: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Migration failed'
    await patchStorageObject(destinationId, {
      status: 'failed',
      metadata: { failure: message },
    }).catch(() => undefined)
    await patchMigrationJob(jobId, {
      status: 'copy_failed',
      last_error: message,
    }).catch(() => undefined)
    throw error
  }
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return retryOperation(async () => {
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(requestTimeoutMs),
      headers: { ...headers, ...init.headers },
    })
    if (!response.ok)
      throw new Error(
        `Supabase metadata request failed (${response.status}): ${await response.text()}`,
      )
    const text = await response.text()
    return (text ? JSON.parse(text) : undefined) as T
  })
}

async function stage<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw new Error(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

async function upsertStorageObject(
  row: Record<string, unknown>,
): Promise<void> {
  await rest('beegame_storage_objects?on_conflict=id', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  })
}
async function patchStorageObject(
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  await rest(`beegame_storage_objects?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }),
  })
}
async function upsertMigrationJob(
  id: string,
  sourceId: string,
  destinationId: string,
): Promise<void> {
  await rest('beegame_storage_migration_jobs?on_conflict=id', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      id,
      source_storage_object_id: sourceId,
      destination_storage_object_id: destinationId,
      status: 'queued',
    }),
  })
}
async function patchMigrationJob(
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  await rest(`beegame_storage_migration_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }),
  })
}
async function patchBusinessReference(
  candidate: MigrationCandidate,
  storageObjectId: string,
): Promise<void> {
  await rest(
    `${candidate.table}?id=eq.${encodeURIComponent(candidate.rowId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify({
        [candidate.referenceColumn]: storageObjectId,
        updated_at: new Date().toISOString(),
      }),
    },
  )
}

function legacyPackObjectPath(packId: string, logicalPath: string): string {
  const normalized = logicalPath.replaceAll('\\', '/').replace(/^\/+/, '')
  return normalized === packId || normalized.startsWith(`${packId}/`)
    ? normalized
    : `${packId}/${normalized}`
}
function deterministicUuid(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
function encodeObjectPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}
function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function readPositiveIntegerArgument(name: string): number | undefined {
  const prefix = `${name}=`
  const raw = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`)
  return value
}
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator === -1) continue
    const key = trimmed.slice(0, separator).trim()
    if (!key || process.env[key] !== undefined) continue
    process.env[key] = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')
  }
}
