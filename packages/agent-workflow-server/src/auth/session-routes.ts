import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Hono } from 'hono'
import type { BeeGameUserContext } from './user-context'
import { decryptSecret, encryptSecret } from '../security/secret-crypto'

export const SESSION_COOKIE_NAME = 'beegame_session'
const SESSION_RECORD_TYPE = 'auth:session'

type SessionRecord = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  user: BeeGameUserContext
}

type SessionFetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>

export type BeeGameSessionRouteOptions = {
  supabaseUrl?: string
  supabaseAnonKey?: string
  fetchImpl?: SessionFetch
  sessionStorePath?: string
}

export type BeeGameSessionAuth = {
  getAccessToken: (request: Request) => string | undefined
}

export function registerBeeGameSessionRoutes(
  app: Hono,
  options: BeeGameSessionRouteOptions = {},
): BeeGameSessionAuth | undefined {
  if (process.env.BEEGAME_HTTPONLY_SESSIONS !== '1') return undefined

  const supabaseUrl = trimTrailingSlash(
    options.supabaseUrl ??
      process.env.BEEGAME_SUPABASE_URL ??
      process.env.SUPABASE_URL ??
      process.env.VITE_SUPABASE_URL ??
      '',
  )
  const supabaseAnonKey = (
    options.supabaseAnonKey ??
      process.env.BEEGAME_SUPABASE_ANON_KEY ??
      process.env.SUPABASE_ANON_KEY ??
      process.env.VITE_SUPABASE_ANON_KEY ??
      ''
  ).trim()
  const fetchImpl = options.fetchImpl ?? fetch
  const sessionStorePath = resolveSessionStorePath(options.sessionStorePath)

  const getRecord = (request: Request): { id: string; record: SessionRecord } | undefined => {
    const id = readCookie(request, SESSION_COOKIE_NAME)
    if (!id) return undefined
    const records = loadRecords(sessionStorePath)
    const encrypted = records[id]
    if (!encrypted) return undefined
    try {
      const record = JSON.parse(decryptSecret(encrypted, SESSION_RECORD_TYPE)) as SessionRecord
      if (!isValidSessionRecord(record)) {
        delete records[id]
        persistRecords(sessionStorePath, records)
        return undefined
      }
      if (record.expiresAt <= Date.now()) {
        delete records[id]
        persistRecords(sessionStorePath, records)
        return undefined
      }
      return { id, record }
    } catch {
      delete records[id]
      persistRecords(sessionStorePath, records)
      return undefined
    }
  }

  const saveRecord = (record: SessionRecord, id = randomBytes(32).toString('base64url')): string => {
    const records = loadRecords(sessionStorePath)
    records[id] = encryptSecret(JSON.stringify(record), SESSION_RECORD_TYPE)
    persistRecords(sessionStorePath, records)
    return id
  }

  app.get('/api/auth/session', c => {
    const current = getRecord(c.req.raw)
    if (!current) return c.json({ authenticated: false }, 401)
    return c.json(sessionResponse(current.record))
  })

  app.post('/api/auth/session', async c => {
    const body = await readJson(c.req.raw)
    const accessToken = readString(body, 'access_token') ?? readString(body, 'accessToken')
    const refreshToken = readString(body, 'refresh_token') ?? readString(body, 'refreshToken')
    if (!accessToken || !refreshToken || !supabaseUrl || !supabaseAnonKey) {
      return c.json({ error: 'Invalid session payload' }, 400)
    }
    const userResponse = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        authorization: `Bearer ${accessToken}`,
      },
    })
    if (!userResponse.ok) return c.json({ error: 'Invalid Supabase session' }, 401)
    const user = toSessionUser(await userResponse.json())
    if (!user) return c.json({ error: 'Invalid Supabase user' }, 401)
    const expiresIn = readNumber(body, 'expires_in') ?? 3600
    const id = saveRecord({
      accessToken,
      refreshToken,
      expiresAt: Date.now() + Math.max(0, expiresIn - 30) * 1000,
      user,
    })
    return new Response(JSON.stringify(sessionResponse({
      accessToken,
      refreshToken,
      expiresAt: Date.now() + Math.max(0, expiresIn - 30) * 1000,
      user,
    })), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': sessionCookie(id),
      },
    })
  })

  app.post('/api/auth/session/refresh', async c => {
    const csrfError = validateOrigin(c.req.raw)
    if (csrfError) return csrfError
    const current = getRecord(c.req.raw)
    if (!current || !supabaseUrl || !supabaseAnonKey) {
      return c.json({ error: 'Session unavailable' }, 401)
    }
    const response = await fetchImpl(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: current.record.refreshToken }),
    })
    if (!response.ok) {
      deleteRecord(sessionStorePath, current.id)
      return clearSessionResponse(401)
    }
    const value = await response.json() as Record<string, unknown>
    const accessToken = readString(value, 'access_token')
    const refreshToken = readString(value, 'refresh_token') ?? current.record.refreshToken
    if (!accessToken) return clearSessionResponse(401)
    const expiresIn = readNumber(value, 'expires_in') ?? 3600
    const record: SessionRecord = {
      ...current.record,
      accessToken,
      refreshToken,
      expiresAt: Date.now() + Math.max(0, expiresIn - 30) * 1000,
    }
    saveRecord(record, current.id)
    return c.json(sessionResponse(record))
  })

  const logout = (request: Request): Response => {
    const csrfError = validateOrigin(request)
    if (csrfError) return csrfError
    const id = readCookie(request, SESSION_COOKIE_NAME)
    if (id) deleteRecord(sessionStorePath, id)
    return clearSessionResponse(200)
  }
  app.post('/api/auth/session/logout', c => logout(c.req.raw))
  app.delete('/api/auth/session/logout', c => logout(c.req.raw))

  return {
    getAccessToken: request => getRecord(request)?.record.accessToken,
  }
}

function sessionResponse(record: SessionRecord): Record<string, unknown> {
  return {
    authenticated: true,
    expires_at: record.expiresAt,
    user: record.user,
  }
}

function toSessionUser(value: unknown): BeeGameUserContext | undefined {
  if (!isRecord(value)) return undefined
  const id = readString(value, 'id')
  if (!id) return undefined
  const email = readString(value, 'email')
  return {
    id,
    role: 'viewer',
    ...(email ? { email } : {}),
  }
}

function validateOrigin(request: Request): Response | undefined {
  const origin = request.headers.get('origin')?.trim()
  if (!origin) return undefined
  try {
    if (new URL(origin).origin !== new URL(request.url).origin) {
      return Response.json({ error: 'CSRF validation failed' }, { status: 403 })
    }
  } catch {
    return Response.json({ error: 'CSRF validation failed' }, { status: 403 })
  }
  return undefined
}

function sessionCookie(id: string): string {
  return `${SESSION_COOKIE_NAME}=${id}; Max-Age=28800; Secure; HttpOnly; SameSite=Lax; Path=/`
}

function clearSessionResponse(status: number): Response {
  return new Response(JSON.stringify({ ok: status < 400 }), {
    status,
    headers: {
      'content-type': 'application/json',
      'set-cookie': `${SESSION_COOKIE_NAME}=; Max-Age=0; Secure; HttpOnly; SameSite=Lax; Path=/`,
    },
  })
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=') || undefined
  }
  return undefined
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json() as unknown
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value) || typeof value[key] !== 'string') return undefined
  const result = value[key].trim()
  return result || undefined
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value) || typeof value[key] !== 'number' || !Number.isFinite(value[key])) return undefined
  return value[key]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function resolveSessionStorePath(path?: string): string {
  const explicitPath = path?.trim()
  if (explicitPath) return explicitPath
  const dataDir = process.env.AGENT_WORKFLOW_DATA_DIR?.trim()
  return dataDir
    ? join(dataDir, 'auth-sessions.json')
    : join(homedir(), '.beegame', 'dashboard', 'auth-sessions.json')
}

function loadRecords(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!isRecord(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] =>
        typeof entry[0] === 'string' && typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

function persistRecords(path: string, records: Record<string, string>): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  try {
    writeFileSync(temporaryPath, JSON.stringify(records), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, path)
  } catch (error) {
    try {
      unlinkSync(temporaryPath)
    } catch {
      // Preserve the original persistence error.
    }
    throw error
  }
}

function deleteRecord(path: string, id: string): void {
  const records = loadRecords(path)
  if (!(id in records)) return
  delete records[id]
  persistRecords(path, records)
}

function isValidSessionRecord(value: unknown): value is SessionRecord {
  return isRecord(value) &&
    typeof value.accessToken === 'string' && value.accessToken.length > 0 &&
    typeof value.refreshToken === 'string' && value.refreshToken.length > 0 &&
    typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt) &&
    isRecord(value.user) && typeof value.user.id === 'string' && value.user.id.length > 0
}
