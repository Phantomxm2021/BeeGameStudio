#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs'
import {
  createR2StorageDriver,
  resolveProjectStorageConfiguration,
  sha256Hex,
  type ProjectStorageBucketRole,
} from '../packages/beegame-storage-core/src/index'
import { fetchAllSupabaseRows } from './supabase-rest-pagination'
import { retryOperation } from './retry-operation'

type StorageObjectRow = {
  id: string
  bucket_role: ProjectStorageBucketRole
  bucket: string
  object_key: string
  byte_size: number | null
  checksum_algorithm: string | null
  checksum_value: string | null
  status: string
  metadata: Record<string, unknown> | null
}

type MigrationJobRow = { source_storage_object_id: string }
type SourceStorageObjectRow = {
  provider: string
  bucket: string
  object_key: string
  mime_type: string | null
  byte_size: number | null
  checksum_value: string | null
}

loadEnvFile('.env.local')
const apply = process.argv.includes('--apply')
const repairMissing = process.argv.includes('--repair-missing')
const deepLimit = readPositiveIntegerArgument('--deep-limit') ?? 0
const requestTimeoutMs =
  readPositiveIntegerArgument('--request-timeout-ms') ?? 120_000
const configuration = resolveProjectStorageConfiguration(process.env)
if (configuration.provider !== 'r2')
  throw new Error(
    'Set BEEGAME_PROJECT_STORAGE_PROVIDER=r2 before reconciliation',
  )
const supabaseUrl = requiredEnv('BEEGAME_SUPABASE_URL').replace(/\/+$/, '')
const serviceRoleKey = requiredEnv('BEEGAME_SUPABASE_SERVICE_ROLE_KEY')
const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
}
const driver = createR2StorageDriver({
  ...configuration.r2,
  requestTimeoutMs,
})
const objects = await fetchAllSupabaseRows<StorageObjectRow>({
  baseUrl: supabaseUrl,
  path: 'beegame_storage_objects?provider=eq.r2&deleted_at=is.null&status=eq.ready&select=id,bucket_role,bucket,object_key,byte_size,checksum_algorithm,checksum_value,status,metadata&order=id.asc',
  headers,
  signal: AbortSignal.timeout(requestTimeoutMs),
})

let healthy = 0
let missing = 0
let mismatched = 0
let checksumMismatched = 0
let deepChecked = 0
for (const [index, object] of objects.entries()) {
  const locator = {
    provider: 'r2',
    bucketRole: object.bucket_role,
    bucket: object.bucket,
    objectKey: object.object_key,
  } as const
  const head = await retryOperation(() => driver.headObject(locator))
  let issue = !head
    ? 'object_missing'
    : object.byte_size !== null && head.byteSize !== object.byte_size
      ? 'byte_size_mismatch'
      : object.checksum_algorithm === 'sha256' &&
          object.checksum_value &&
          head.metadata['beegame-sha256'] !== object.checksum_value
        ? 'checksum_metadata_mismatch'
      : undefined
  if (issue === 'object_missing' && repairMissing) {
    const repaired = await repairMissingObject(object, locator)
    if (repaired) {
      healthy += 1
      console.log(`${object.id}: restored from verified Supabase source`)
      if ((index + 1) % 100 === 0)
        console.log(`Reconciliation progress: ${index + 1}/${objects.length}.`)
      continue
    }
  }
  if (!issue && deepChecked < deepLimit && object.checksum_value) {
    deepChecked += 1
    const payload = await retryOperation(() => driver.getObject(locator))
    if (!payload) issue = 'object_missing'
    else if (sha256Hex(payload.bytes) !== object.checksum_value)
      issue = 'content_checksum_mismatch'
  }
  if (!issue) {
    healthy += 1
    if ((index + 1) % 100 === 0)
      console.log(`Reconciliation progress: ${index + 1}/${objects.length}.`)
    continue
  }
  if (issue === 'object_missing') missing += 1
  else if (issue === 'byte_size_mismatch') mismatched += 1
  else checksumMismatched += 1
  console.error(`${object.id}: ${issue}`)
  if (apply) {
    await rest(
      `beegame_storage_objects?id=eq.${encodeURIComponent(object.id)}`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          prefer: 'return=minimal',
        },
        body: JSON.stringify({
          status: 'failed',
          metadata: {
            ...(object.metadata ?? {}),
            reconciliation: { issue, checked_at: new Date().toISOString() },
          },
          updated_at: new Date().toISOString(),
        }),
      },
    )
  }
}

console.log(
  `R2 reconciliation: ${healthy} healthy, ${missing} missing, ${mismatched} size mismatch, ${checksumMismatched} checksum mismatch.`,
)
if (deepLimit > 0)
  console.log(`R2 deep checksum verification: ${deepChecked} object(s) read.`)
if (!apply && missing + mismatched + checksumMismatched > 0)
  console.log(
    'No rows changed. Re-run with --apply to mark invalid objects failed.',
  )
if (missing + mismatched + checksumMismatched > 0) process.exitCode = 1

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

async function repairMissingObject(
  object: StorageObjectRow,
  destination: {
    provider: 'r2'
    bucketRole: ProjectStorageBucketRole
    bucket: string
    objectKey: string
  },
): Promise<boolean> {
  const jobs = await rest<MigrationJobRow[]>(
    `beegame_storage_migration_jobs?destination_storage_object_id=eq.${encodeURIComponent(object.id)}&select=source_storage_object_id&order=created_at.desc&limit=1`,
  )
  const sourceId = jobs[0]?.source_storage_object_id
  if (!sourceId) return false
  const sources = await rest<SourceStorageObjectRow[]>(
    `beegame_storage_objects?id=eq.${encodeURIComponent(sourceId)}&provider=eq.supabase&deleted_at=is.null&select=provider,bucket,object_key,mime_type,byte_size,checksum_value&limit=1`,
  )
  const source = sources[0]
  if (!source) return false
  const response = await retryOperation(async () => {
    const result = await fetch(
      `${supabaseUrl}/storage/v1/object/${encodeURIComponent(source.bucket)}/${encodeObjectPath(source.object_key)}`,
      { headers, signal: AbortSignal.timeout(requestTimeoutMs) },
    )
    if (!result.ok)
      throw new Error(`Supabase recovery download failed (${result.status})`)
    return result
  })
  const bytes = new Uint8Array(await response.arrayBuffer())
  const checksum = sha256Hex(bytes)
  if (source.byte_size !== null && bytes.byteLength !== source.byte_size)
    throw new Error(`Supabase recovery source size mismatch for ${object.id}`)
  if (source.checksum_value && checksum !== source.checksum_value)
    throw new Error(`Supabase recovery source checksum mismatch for ${object.id}`)
  if (object.byte_size !== null && bytes.byteLength !== object.byte_size)
    throw new Error(`R2 recovery destination size mismatch for ${object.id}`)
  if (object.checksum_value && checksum !== object.checksum_value)
    throw new Error(`R2 recovery destination checksum mismatch for ${object.id}`)
  await retryOperation(() =>
    driver.putObject(
      destination,
      bytes,
      source.mime_type ||
        response.headers.get('content-type') ||
        'application/octet-stream',
      {
        'beegame-object-id': object.id,
        'beegame-sha256': checksum,
      },
    ),
  )
  const verified = await retryOperation(() => driver.headObject(destination))
  return Boolean(
    verified &&
      verified.byteSize === bytes.byteLength &&
      verified.metadata['beegame-sha256'] === checksum,
  )
}

function encodeObjectPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}
function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
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

function readPositiveIntegerArgument(name: string): number | undefined {
  const prefix = `${name}=`
  const raw = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`)
  return value
}
