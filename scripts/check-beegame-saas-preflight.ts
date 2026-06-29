#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs'

type Env = Record<string, string | undefined>

loadEnvFile('.env.local')

const env = process.env as Env
const checks = [
  checkAnyEnv('Supabase URL', [
    'BEEGAME_SUPABASE_URL',
    'SUPABASE_URL',
    'VITE_SUPABASE_URL',
  ]),
  checkAnyEnv('Supabase anon key', [
    'BEEGAME_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY',
    'VITE_SUPABASE_ANON_KEY',
  ]),
  checkForbiddenEnv('Runtime host service-role secret', [
    'BEEGAME_SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]),
  checkAnyEnv('Runtime avatar storage bucket', [
    'BEEGAME_SUPABASE_AVATAR_BUCKET',
    'SUPABASE_AVATAR_BUCKET',
    'VITE_SUPABASE_AVATAR_BUCKET',
  ]),
  checkAnyEnv('Runtime asset storage bucket', [
    'BEEGAME_SUPABASE_ASSET_BUCKET',
    'SUPABASE_ASSET_BUCKET',
  ]),
  checkSmokeAuth(),
]

const failed = checks.filter(check => check.status === 'fail')
for (const check of checks) {
  const marker = check.status === 'pass' ? 'ok' : 'fail'
  console.log(`${marker} ${check.label}${check.message ? ` - ${check.message}` : ''}`)
}

if (failed.length > 0) {
  console.error(
    `BeeGame SaaS preflight failed with ${failed.length} issue${failed.length === 1 ? '' : 's'}.`,
  )
  process.exit(1)
}

console.log('BeeGame SaaS preflight passed.')

function checkAnyEnv(
  label: string,
  keys: string[],
): { label: string; status: 'pass' | 'fail'; message?: string } {
  const configuredKey = keys.find(key => Boolean(env[key]?.trim()))
  if (configuredKey) {
    return {
      label,
      status: 'pass',
      message: `configured via ${configuredKey}`,
    }
  }
  return {
    label,
    status: 'fail',
    message: `set one of ${keys.join(', ')}`,
  }
}

function checkForbiddenEnv(
  label: string,
  keys: string[],
): { label: string; status: 'pass' | 'fail'; message?: string } {
  const configuredKeys = keys.filter(key => Boolean(env[key]?.trim()))
  if (configuredKeys.length === 0) {
    return {
      label,
      status: 'pass',
      message: 'not present',
    }
  }
  return {
    label,
    status: 'fail',
    message: `remove ${configuredKeys.join(', ')} from frontend/runtime env`,
  }
}

function checkSmokeAuth(): {
  label: string
  status: 'pass' | 'fail'
  message?: string
} {
  const hasTokenAuth = Boolean(
    env.BEEGAME_SUPABASE_ACCESS_TOKEN?.trim() &&
      env.BEEGAME_SUPABASE_USER_ID?.trim(),
  )
  const hasPasswordAuth = Boolean(
    env.BEEGAME_SMOKE_EMAIL?.trim() &&
      env.BEEGAME_SMOKE_PASSWORD?.trim(),
  )
  if (hasTokenAuth) {
    return {
      label: 'Supabase smoke auth',
      status: 'pass',
      message: 'configured via access token',
    }
  }
  if (hasPasswordAuth) {
    return {
      label: 'Supabase smoke auth',
      status: 'pass',
      message: 'configured via email/password',
    }
  }
  return {
    label: 'Supabase smoke auth',
    status: 'fail',
    message:
      'set BEEGAME_SUPABASE_ACCESS_TOKEN + BEEGAME_SUPABASE_USER_ID, or BEEGAME_SMOKE_EMAIL + BEEGAME_SMOKE_PASSWORD',
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
