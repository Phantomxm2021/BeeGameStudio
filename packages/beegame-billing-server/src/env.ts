import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export type BillingEnv = Record<string, string | undefined>

export type BillingEnvLoadResult = {
  loadedPath?: string
  loadedKeys: string[]
  skippedExistingKeys: string[]
}

export type BillingEnvSummary = {
  configured: string[]
  missing: string[]
}

export type BillingListenOptions = {
  host: string
  port: number
}

const REQUIRED_BILLING_ENV_KEYS = [
  'BEEGAME_SUPABASE_URL',
  'BEEGAME_SUPABASE_ANON_KEY',
  'BEEGAME_SUPABASE_SERVICE_ROLE_KEY',
  'BEEGAME_STRIPE_SECRET_KEY',
  'BEEGAME_STRIPE_WEBHOOK_SECRET',
  'BEEGAME_STRIPE_PRICE_CREDITS',
] as const

export function resolveBeeGameBillingEnvFile(input: {
  cwd?: string
  env?: BillingEnv
} = {}): string | undefined {
  const env = input.env ?? process.env
  const cwd = input.cwd ?? process.cwd()
  const explicit = normalizeOptional(env.BEEGAME_BILLING_ENV_FILE)
  const candidates = [
    explicit,
    resolve(cwd, '.env.billing'),
    resolve(cwd, 'docker/.env.billing'),
    resolve(cwd, '../../.env.billing'),
    resolve(cwd, '../../docker/.env.billing'),
  ].filter((item): item is string => Boolean(item))
  return candidates.find(candidate => existsSync(candidate))
}

export async function loadBeeGameBillingEnvFile(
  path: string | undefined,
  env: BillingEnv = process.env,
): Promise<BillingEnvLoadResult> {
  const result: BillingEnvLoadResult = {
    ...(path ? { loadedPath: path } : {}),
    loadedKeys: [],
    skippedExistingKeys: [],
  }
  if (!path) return result
  const content = await readFile(path, 'utf8')
  for (const line of content.split('\n')) {
    const parsed = parseEnvLine(line)
    if (!parsed) continue
    if (env[parsed.key] !== undefined) {
      result.skippedExistingKeys.push(parsed.key)
      continue
    }
    env[parsed.key] = parsed.value
    result.loadedKeys.push(parsed.key)
  }
  return result
}

export async function loadBeeGameBillingEnv(
  env: BillingEnv = process.env,
): Promise<BillingEnvLoadResult> {
  return loadBeeGameBillingEnvFile(resolveBeeGameBillingEnvFile({ env }), env)
}

export function summarizeBeeGameBillingEnv(
  env: BillingEnv = process.env,
): BillingEnvSummary {
  const configured: string[] = []
  const missing: string[] = []
  for (const key of REQUIRED_BILLING_ENV_KEYS) {
    if (normalizeOptional(env[key])) {
      configured.push(key)
    } else {
      missing.push(key)
    }
  }
  return { configured, missing }
}

export function resolveBeeGameBillingListenOptions(
  env: BillingEnv = process.env,
): BillingListenOptions {
  const configuredPort = Number.parseInt(env.BEEGAME_BILLING_PORT ?? '', 10)
  return {
    host: normalizeOptional(env.BEEGAME_BILLING_HOST) ?? '127.0.0.1',
    port: Number.isFinite(configuredPort) && configuredPort >= 0
      ? configuredPort
      : 62175,
  }
}

function parseEnvLine(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return undefined
  const separatorIndex = trimmed.indexOf('=')
  if (separatorIndex <= 0) return undefined
  const key = trimmed.slice(0, separatorIndex).trim()
  if (!key) return undefined
  const value = unquoteEnvValue(trimmed.slice(separatorIndex + 1).trim())
  return { key, value }
}

function unquoteEnvValue(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
