#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs'
import { lookup } from 'node:dns/promises'
import {
  createR2StorageDriver,
  resolveProjectStorageConfiguration,
} from '../packages/beegame-storage-core/src/index'

loadEnvFile('.env.local')

const configuration = resolveProjectStorageConfiguration(process.env)
if (configuration.provider !== 'r2') {
  throw new Error(
    'Set BEEGAME_PROJECT_STORAGE_PROVIDER=r2 before running the R2 smoke test',
  )
}

const driver = createR2StorageDriver(configuration.r2)
const bytes = crypto.getRandomValues(new Uint8Array(64))
const browserOrigin = 'http://127.0.0.1:62173'
const locator = {
  provider: 'r2' as const,
  bucketRole: 'project-private' as const,
  bucket: configuration.buckets['project-private'],
  objectKey: `smoke/${crypto.randomUUID()}/payload.bin`,
}

try {
  const uploadUrl = await driver.createUploadUrl({
    ...locator,
    contentType: 'application/octet-stream',
    expiresInSeconds: 120,
  })
  const uploaded = await safeFetch(
    uploadUrl,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        origin: browserOrigin,
      },
      body: bytes,
    },
    'upload',
  )
  if (!uploaded.ok) {
    throw new Error(
      `R2 smoke upload failed: ${uploaded.status} ${await uploaded.text()}`,
    )
  }
  assertCors(uploaded, browserOrigin, 'upload')

  const head = await driver.headObject(locator)
  if (!head || head.byteSize !== bytes.byteLength) {
    throw new Error(
      `R2 smoke verification failed: expected ${bytes.byteLength} bytes, received ${head?.byteSize ?? 'missing'}`,
    )
  }

  const downloadUrl = await driver.createDownloadUrl({
    ...locator,
    expiresInSeconds: 120,
  })
  const downloaded = await safeFetch(
    downloadUrl,
    { headers: { origin: browserOrigin } },
    'download',
  )
  if (!downloaded.ok) {
    throw new Error(`R2 smoke download failed: ${downloaded.status}`)
  }
  assertCors(downloaded, browserOrigin, 'download')
  const received = new Uint8Array(await downloaded.arrayBuffer())
  if (
    received.byteLength !== bytes.byteLength ||
    received.some((value, index) => value !== bytes[index])
  ) {
    throw new Error('R2 smoke download content does not match the upload')
  }

  console.log('BeeGame R2 smoke test passed.')
} finally {
  await driver.deleteObject(locator).catch(() => {
    console.warn('BeeGame R2 smoke cleanup could not reach the configured endpoint.')
  })
}

function assertCors(
  response: Response,
  expectedOrigin: string,
  operation: 'upload' | 'download',
): void {
  const observed = response.headers.get('access-control-allow-origin')
  if (observed !== expectedOrigin) {
    throw new Error(
      `R2 smoke ${operation} is missing browser CORS for ${expectedOrigin}`,
    )
  }
}

function isFakeIpAddress(address: string): boolean {
  const parts = address.split('.').map(Number)
  return (
    parts.length === 4 &&
    parts[0] === 198 &&
    Number.isInteger(parts[1]) &&
    parts[1]! >= 18 &&
    parts[1]! <= 19
  )
}

async function safeFetch(
  input: string,
  init: RequestInit | undefined,
  operation: 'upload' | 'download',
): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch {
    const hostname = new URL(input).hostname
    const resolved = await lookup(hostname).catch(() => undefined)
    const networkHint =
      resolved && isFakeIpAddress(resolved.address)
        ? ' The endpoint is currently routed through a TUN/Fake-IP address; allow *.r2.cloudflarestorage.com in the local proxy or select a route that supports Cloudflare R2.'
        : ''
    throw new Error(
      `R2 smoke ${operation} could not connect to the configured endpoint; signed URL details were redacted.${networkHint}`,
    )
  }
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) continue
    const key = trimmed.slice(0, separatorIndex).trim()
    if (!key || process.env[key] !== undefined) continue
    process.env[key] = unquoteEnvValue(trimmed.slice(separatorIndex + 1).trim())
  }
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}
