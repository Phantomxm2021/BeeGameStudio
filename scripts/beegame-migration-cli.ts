import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

type Env = Record<string, string | undefined>
type BeeGameFetch = typeof fetch

export type MigrationCliOptions = {
  ownerId: string
  dataDir: string
  apply: boolean
}

export type MigrationAuthContext = {
  authToken: string
  userId?: string
}

export function loadEnvFile(path: string, env: Env = process.env): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) continue
    const key = trimmed.slice(0, separatorIndex).trim()
    if (!key || env[key] !== undefined) continue
    env[key] = unquoteEnvValue(trimmed.slice(separatorIndex + 1).trim())
  }
}

export function parseMigrationArgs(
  args: string[],
  input: {
    env?: Env
    homeDir?: string
  } = {},
): MigrationCliOptions {
  const env = input.env ?? process.env
  const options: MigrationCliOptions = {
    ownerId: (
      env.BEEGAME_MIGRATION_OWNER_ID ??
      env.BEEGAME_MIGRATION_AUTH_USER_ID ??
      ''
    ).trim(),
    dataDir: resolve(
      env.BEEGAME_MIGRATION_DATA_DIR?.trim() ||
        env.AGENT_WORKFLOW_DATA_DIR?.trim() ||
        join(input.homeDir ?? homedir(), '.beegame', 'dashboard'),
    ),
    apply: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--apply') {
      options.apply = true
      continue
    }
    if (arg === '--owner-id') {
      options.ownerId = args[index + 1]?.trim() ?? ''
      index += 1
      continue
    }
    if (arg === '--data-dir') {
      options.dataDir = resolve(args[index + 1]?.trim() ?? '')
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

export async function resolveMigrationAuthContext(input: {
  url: string
  anonKey: string
  env?: Env
  fetchImpl?: BeeGameFetch
}): Promise<MigrationAuthContext> {
  const env = input.env ?? process.env
  const authToken = (
    env.BEEGAME_SUPABASE_ACCESS_TOKEN ??
    env.SUPABASE_ACCESS_TOKEN ??
    ''
  ).trim()
  if (authToken) {
    return {
      authToken,
      ...(env.BEEGAME_SUPABASE_USER_ID?.trim()
        ? { userId: env.BEEGAME_SUPABASE_USER_ID.trim() }
        : {}),
    }
  }

  const email = env.BEEGAME_MIGRATION_EMAIL?.trim()
  const password = env.BEEGAME_MIGRATION_PASSWORD?.trim()
  if (!email || !password) {
    throw new Error(
      'Missing Supabase migration auth. Set BEEGAME_SUPABASE_ACCESS_TOKEN, or BEEGAME_MIGRATION_EMAIL + BEEGAME_MIGRATION_PASSWORD.',
    )
  }

  const baseUrl = input.url.replace(/\/+$/, '')
  const response = await (input.fetchImpl ?? fetch)(
    `${baseUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        apikey: input.anonKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    },
  )
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `Supabase migration sign-in failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
    )
  }
  const payload = await response.json() as Record<string, unknown>
  const token = stringField(payload.access_token)
  const user = isRecord(payload.user) ? payload.user : undefined
  const userId = user ? stringField(user.id) : undefined
  if (!token || !userId) {
    throw new Error('Supabase migration sign-in did not return access_token and user.id')
  }
  process.env.BEEGAME_MIGRATION_AUTH_USER_ID = userId
  return {
    authToken: token,
    userId,
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

function stringField(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
