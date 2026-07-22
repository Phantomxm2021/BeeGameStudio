#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs'
import { bootstrapBeeGameR2 } from './beegame-r2-bootstrap'

loadEnvFile('.env.local')

const result = await bootstrapBeeGameR2({ env: process.env })
for (const bucket of result.buckets) {
  console.log(`${bucket.created ? 'Created' : 'Verified'} R2 bucket: ${bucket.name}`)
}
for (const policy of result.cors) {
  console.log(
    `Configured R2 browser CORS: ${policy.name} (${policy.origins.join(', ')})`,
  )
}
if (result.deliveryPublicBaseUrl) {
  console.log(`Verified delivery URL configuration: ${result.deliveryPublicBaseUrl}`)
} else {
  console.warn(
    'R2 buckets are ready, but BEEGAME_R2_DELIVERY_PUBLIC_BASE_URL is not configured.',
  )
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
    process.env[key] = unquote(trimmed.slice(separatorIndex + 1).trim())
  }
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
    return value.slice(1, -1)
  return value
}
