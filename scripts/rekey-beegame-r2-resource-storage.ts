#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs'
import {
  buildResourcePackObjectKey,
  createR2StorageDriver,
  resolveProjectStorageConfiguration,
  type StorageObjectHead,
  type StorageObjectLocator,
} from '../packages/beegame-storage-core/src/index'
import { fetchAllSupabaseRows } from './supabase-rest-pagination'
import { retryOperation } from './retry-operation'

type ResourceObjectRow = {
  id: string
  pack_id: string | null
  bucket: string
  object_key: string
  byte_size: number | null
  checksum_value: string | null
  metadata: Record<string, unknown> | null
}

loadEnvFile('.env.local')
const apply = process.argv.includes('--apply')
const limit = readPositiveIntegerArgument('--limit')
const requestTimeoutMs =
  readPositiveIntegerArgument('--request-timeout-ms') ?? 120_000
const configuration = resolveProjectStorageConfiguration(process.env)
if (configuration.provider !== 'r2')
  throw new Error('Set BEEGAME_PROJECT_STORAGE_PROVIDER=r2 before rekeying')
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
const objects = await fetchAllSupabaseRows<ResourceObjectRow>({
  baseUrl: supabaseUrl,
  path: 'beegame_storage_objects?provider=eq.r2&bucket_role=eq.resource-private&deleted_at=is.null&status=eq.ready&select=id,pack_id,bucket,object_key,byte_size,checksum_value,metadata&order=id.asc',
  headers,
  signal: AbortSignal.timeout(requestTimeoutMs),
})
const ownerless = objects.filter(object => !object.pack_id)
if (ownerless.length > 0) {
  console.error(
    `Rekey blocked: ${ownerless.length} Resource Library object(s) have no Pack id.`,
  )
  process.exit(1)
}
const candidates = objects.flatMap(object => {
  const expectedKey = buildResourcePackObjectKey(object.pack_id!, object.id)
  return object.object_key === expectedKey ? [] : [{ object, expectedKey }]
})
const selected = candidates.slice(0, limit ?? candidates.length)
console.log(
  `${apply ? 'Applying' : 'Planning'} ${selected.length} of ${candidates.length} Resource Library object rekey(s).`,
)
if (!apply) {
  for (const candidate of selected.slice(0, 100))
    console.log(
      `- ${candidate.object.object_key} -> ${candidate.expectedKey}`,
    )
  if (selected.length > 100)
    console.log(`- …and ${selected.length - 100} more`)
  console.log('No data changed. Re-run with --apply to copy, verify and cut over.')
  process.exit(0)
}

let completed = 0
let failed = 0
let orphanedOldCopies = 0
for (const candidate of selected) {
  try {
    const source = locator(candidate.object, candidate.object.object_key)
    const destination = locator(candidate.object, candidate.expectedKey)
    const existing = await retryOperation(() => driver.headObject(destination))
    if (!matches(candidate.object, existing))
      await retryOperation(() => driver.copyObject(source, destination))
    const verified = await retryOperation(() => driver.headObject(destination))
    if (!matches(candidate.object, verified))
      throw new Error('R2 Pack-key destination verification failed')
    try {
      await retryOperation(() =>
        patchObject(candidate.object, candidate.expectedKey, verified!),
      )
    } catch (error) {
      await driver.deleteObject(destination).catch(() => undefined)
      throw error
    }
    try {
      await retryOperation(() => driver.deleteObject(source))
    } catch (error) {
      orphanedOldCopies += 1
      console.error(
        `Cut over ${candidate.object.id}, but could not remove old R2 key ${candidate.object.object_key}: ${error instanceof Error ? error.message : error}`,
      )
    }
    completed += 1
    if (completed % 25 === 0)
      console.log(
        `Rekey progress: ${completed} completed, ${failed} failed, ${orphanedOldCopies} old copies pending cleanup.`,
      )
  } catch (error) {
    failed += 1
    console.error(
      `Failed ${candidate.object.id}: ${error instanceof Error ? error.message : error}`,
    )
  }
}
console.log(
  `Rekey finished: ${completed} completed, ${failed} failed, ${orphanedOldCopies} old copies pending cleanup.`,
)
if (failed > 0 || orphanedOldCopies > 0) process.exitCode = 1

function locator(
  object: ResourceObjectRow,
  objectKey: string,
): StorageObjectLocator {
  return {
    provider: 'r2',
    bucketRole: 'resource-private',
    bucket: object.bucket,
    objectKey,
  }
}

function matches(
  object: ResourceObjectRow,
  head: StorageObjectHead | undefined,
): boolean {
  if (!head) return false
  if (object.byte_size !== null && head.byteSize !== object.byte_size)
    return false
  if (
    object.checksum_value &&
    head.metadata['beegame-sha256'] !== object.checksum_value
  )
    return false
  return true
}

async function patchObject(
  object: ResourceObjectRow,
  objectKey: string,
  head: StorageObjectHead,
): Promise<void> {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/beegame_storage_objects?id=eq.${encodeURIComponent(object.id)}&object_key=eq.${encodeURIComponent(object.object_key)}`,
    {
      method: 'PATCH',
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers: {
        ...headers,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({
        object_key: objectKey,
        byte_size: head.byteSize,
        etag: head.etag ?? null,
        metadata: {
          ...(object.metadata ?? {}),
          previous_object_key: object.object_key,
          pack_keyed_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }),
    },
  )
  if (!response.ok)
    throw new Error(
      `Storage metadata cutover failed (${response.status}): ${await response.text()}`,
    )
  const rows = (await response.json()) as unknown
  if (Array.isArray(rows) && rows.length === 1) return
  const current = await fetch(
    `${supabaseUrl}/rest/v1/beegame_storage_objects?id=eq.${encodeURIComponent(object.id)}&select=object_key&limit=1`,
    {
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers,
    },
  )
  if (!current.ok)
    throw new Error(`Storage metadata verification failed (${current.status})`)
  const currentRows = (await current.json()) as Array<{ object_key?: unknown }>
  if (currentRows[0]?.object_key === objectKey) return
  throw new Error('Storage metadata changed during Pack-key cutover')
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function readPositiveIntegerArgument(name: string): number | undefined {
  const prefix = `${name}=`
  const raw = process.argv
    .find(argument => argument.startsWith(prefix))
    ?.slice(prefix.length)
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
