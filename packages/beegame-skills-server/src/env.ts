import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export type SkillsEnv = Record<string, string | undefined>

export type SkillsEnvLoadResult = {
  loadedPath?: string
  loadedKeys: string[]
  skippedExistingKeys: string[]
}

export type SkillsEnvDiagnostic = {
  key: string
  configured: boolean
  source: 'env-file' | 'process-env' | 'missing'
  length: number
}

export type SkillsListenOptions = {
  host: string
  port: number
}

const DIAGNOSTIC_SKILLS_ENV_KEYS = [
  'BEEGAME_SUPABASE_URL',
  'BEEGAME_SUPABASE_ANON_KEY',
  'BEEGAME_SKILLS_HOST',
  'BEEGAME_SKILLS_PORT',
  'BEEGAME_SKILLS_DATA_DIR',
  'BEEGAME_SKILLS_SERVICE_TOKEN',
  'BEEGAME_AUTH_RESOLVE_TIMEOUT_MS',
  'BEEGAME_AUTH_TOKENS',
  'BEEGAME_ALLOW_DEV_AUTH_TOKENS',
] as const

export function resolveBeeGameSkillsEnvFile(input: {
  cwd?: string
  env?: SkillsEnv
} = {}): string | undefined {
  const env = input.env ?? process.env
  const cwd = input.cwd ?? process.cwd()
  const explicit = normalizeOptional(env.BEEGAME_SKILLS_ENV_FILE)
  const candidates = [
    explicit,
    resolve(cwd, '.env.skills'),
    resolve(cwd, '.env.local'),
    resolve(cwd, 'docker/.env.production'),
    resolve(cwd, '../../.env.skills'),
    resolve(cwd, '../../.env.local'),
    resolve(cwd, '../../docker/.env.production'),
  ].filter((item): item is string => Boolean(item))
  return candidates.find(candidate => existsSync(candidate))
}

export async function loadBeeGameSkillsEnvFile(
  path: string | undefined,
  env: SkillsEnv = process.env,
): Promise<SkillsEnvLoadResult> {
  const result: SkillsEnvLoadResult = {
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

export async function loadBeeGameSkillsEnv(
  env: SkillsEnv = process.env,
): Promise<SkillsEnvLoadResult> {
  return loadBeeGameSkillsEnvFile(resolveBeeGameSkillsEnvFile({ env }), env)
}

export function getBeeGameSkillsEnvDiagnostics(
  loadResult: SkillsEnvLoadResult,
  env: SkillsEnv = process.env,
): SkillsEnvDiagnostic[] {
  const loadedKeys = new Set(loadResult.loadedKeys)
  const skippedKeys = new Set(loadResult.skippedExistingKeys)
  return DIAGNOSTIC_SKILLS_ENV_KEYS.map(key => {
    const value = normalizeOptional(env[key])
    return {
      key,
      configured: Boolean(value),
      source: loadedKeys.has(key)
        ? 'env-file'
        : skippedKeys.has(key) || value
          ? 'process-env'
          : 'missing',
      length: value?.length ?? 0,
    }
  })
}

export function resolveBeeGameSkillsListenOptions(
  env: SkillsEnv = process.env,
): SkillsListenOptions {
  const configuredPort = Number.parseInt(env.BEEGAME_SKILLS_PORT ?? '', 10)
  return {
    host: normalizeOptional(env.BEEGAME_SKILLS_HOST) ?? '127.0.0.1',
    port: Number.isFinite(configuredPort) && configuredPort >= 0
      ? configuredPort
      : 62176,
  }
}

function parseEnvLine(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return undefined
  const separatorIndex = trimmed.indexOf('=')
  if (separatorIndex <= 0) return undefined
  const key = trimmed.slice(0, separatorIndex).trim()
  if (!key) return undefined
  return {
    key,
    value: unquoteEnvValue(trimmed.slice(separatorIndex + 1).trim()),
  }
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
