import type {
  BeeGameBillingUserContext,
} from '@bee-game-studio/beegame-billing-core/billing-route-types'
import { authRequestTimeoutMs, verifiedTokenCacheUntil, type TLSAwareFetch } from '@bee-game-studio/security-core'
import { createHash } from 'node:crypto'

type BillingUserResolver = (
  request: Request,
  signal?: AbortSignal,
) => BeeGameBillingUserContext | undefined | Promise<BeeGameBillingUserContext | undefined>

export type BeeGameBillingAuthOptions = {
  currentUser?: BeeGameBillingUserContext
  currentUserResolver?: BillingUserResolver
  userResolveTimeoutMs?: number
}

export type BeeGameBillingAuthContext = {
  resolveRequestUser: (request: Request) => Promise<BeeGameBillingUserContext | undefined>
  getCurrentUser: (request?: Request) => BeeGameBillingUserContext
}

export function createBeeGameBillingAuthContext(
  options: BeeGameBillingAuthOptions = {},
): BeeGameBillingAuthContext {
  const requestUsers = new WeakMap<Request, BeeGameBillingUserContext>()
  const timeoutMs = normalizeResolveTimeoutMs(options.userResolveTimeoutMs)
  // Cache only verified identities, scoped to the complete credential, never
  // to a caller-supplied user ID. Billing still validates its own credentials.
  const users = new Map<string, { user: BeeGameBillingUserContext; until: number }>()
  const pending = new Map<string, Promise<BeeGameBillingUserContext | undefined>>()
  const failures = new Map<string, { attempts: number; retryAt: number }>()
  const resolve = async (request: Request) => {
    if (!options.currentUserResolver) return undefined
    const token = getBearerToken(request)
    if (!token) return await resolveWithTimeout(signal => options.currentUserResolver!(request, signal), timeoutMs)
    const key = createHash('sha256').update(token).digest('hex')
    const cached = users.get(key)
    if (cached && cached.until > Date.now()) return cached.user
    users.delete(key)
    const active = pending.get(key)
    if (active) return active
    const retryAt = failures.get(key)?.retryAt ?? 0
    if (retryAt > Date.now()) throw new BillingAuthError('cooldown', undefined, retryAt - Date.now())
    const startedAt = Date.now()
    const lookup = resolveWithTimeout(signal => options.currentUserResolver!(request, signal), timeoutMs)
      .then(user => {
        failures.delete(key)
        if (user) {
          if (users.size >= 256) users.delete(users.keys().next().value!)
          users.set(key, { user, until: verifiedTokenCacheUntil(token, 15_000) })
        }
        return user
      }).catch(error => {
        if (error instanceof BillingAuthError) error.elapsedMs = Date.now() - startedAt
        const attempts = (failures.get(key)?.attempts ?? 0) + 1
        if (failures.size >= 256) failures.delete(failures.keys().next().value!)
        const delay = Math.min(30_000, 2_000 * 2 ** Math.min(attempts - 1, 4))
        if (error instanceof BillingAuthError) error.retryAfterMs = delay
        failures.set(key, { attempts, retryAt: Date.now() + delay })
        throw error
      }).finally(() => { pending.delete(key) })
    pending.set(key, lookup)
    return lookup
  }
  return {
    resolveRequestUser: async request => {
      if (options.currentUser) return options.currentUser
      const user = await resolve(request)
      if (user) requestUsers.set(request, user)
      return user
    },
    getCurrentUser: request => {
      const user = options.currentUser ??
        (request ? requestUsers.get(request) : undefined)
      if (!user) throw new Error('Authenticated BeeGame user is required')
      return user
    },
  }
}

export function createConfiguredBillingUserResolver(
  env: NodeJS.ProcessEnv = process.env,
  options: { fetchImpl?: TLSAwareFetch } = {},
): BillingUserResolver | undefined {
  const supabaseResolver = createSupabaseBillingUserResolver(env, options.fetchImpl)
  return supabaseResolver
}

export function hasBeeGameBillingPermission(
  user: BeeGameBillingUserContext,
  permission: 'audit.read' | 'credits.admin',
): boolean {
  if (user.permissions?.includes(permission)) return true
  return user.role === 'owner'
}

function createSupabaseBillingUserResolver(
  env: NodeJS.ProcessEnv,
  fetchImpl: TLSAwareFetch = globalThis.fetch.bind(globalThis),
): BillingUserResolver | undefined {
  const baseUrl = trimString(
    env.BEEGAME_SUPABASE_URL ??
      env.SUPABASE_URL ??
      env.VITE_SUPABASE_URL,
  )
  const apiKey = trimString(
    env.BEEGAME_SUPABASE_ANON_KEY ??
      env.SUPABASE_ANON_KEY ??
      env.VITE_SUPABASE_ANON_KEY,
  )
  return async (request, signal) => {
    const token = getBearerToken(request)
    if (!token) return undefined
    if (!baseUrl || !apiKey) throw new Error('Billing authentication is not configured')
    const response = await fetchImpl(`${removeTrailingSlashes(baseUrl)}/rest/v1/rpc/beegame_current_user_context`, {
      method: 'POST',
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
      // This lookup can serve several requests; its own deadline owns abort.
      signal,
    }).catch(() => { throw new BillingAuthError(signal?.aborted ? 'timeout' : 'network') })
    if (response.status === 401 || response.status === 403) return undefined
    if (!response.ok) throw new BillingAuthError('upstream', response.status)
    const value = await response.json().catch(() => { throw new Error('Billing authentication response is invalid') })
    // A null identity is an explicit anonymous result; malformed responses are
    // service failures, not evidence that the user's credential is invalid.
    if (value === null) return undefined
    const user = toBillingUser(value)
    if (!user) throw new Error('Billing authentication response has no valid identity')
    return user
  }
}

function toBillingUser(value: unknown): BeeGameBillingUserContext | undefined {
  if (!isObject(value)) return undefined
  const id = trimString(value.id)
  if (!id) return undefined
  const email = trimString(value.email)
  const role = trimString(value.role) || undefined
  const permissions = Array.isArray(value.permissions)
    ? value.permissions.filter(item => typeof item === 'string')
    : undefined
  return {
    id,
    ...(role ? { role } : {}),
    ...(email ? { email } : {}),
    ...(permissions?.length ? { permissions } : {}),
  }
}

function getBearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization')?.trim()
  if (!header) return undefined
  const prefix = 'Bearer '
  return header.toLowerCase().startsWith(prefix.toLowerCase())
    ? header.slice(prefix.length).trim() || undefined
    : undefined
}

async function resolveWithTimeout(
  resolve: (signal: AbortSignal) => BeeGameBillingUserContext | undefined | Promise<BeeGameBillingUserContext | undefined>,
  timeoutMs: number,
): Promise<BeeGameBillingUserContext | undefined> {
  const controller = new AbortController()
  if (timeoutMs <= 0) return await resolve(controller.signal)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      resolve(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new BillingAuthError('timeout'))
          controller.abort()
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function normalizeResolveTimeoutMs(value: number | undefined): number {
  return authRequestTimeoutMs(value)
}

class BillingAuthError extends Error {
  elapsedMs?: number
  constructor(readonly reason: 'timeout' | 'network' | 'upstream' | 'cooldown', readonly upstreamStatus?: number, public retryAfterMs = 2000) {
    super('Billing authentication temporarily unavailable')
    this.name = 'BillingAuthError'
  }
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function removeTrailingSlashes(value: string): string {
  let next = value
  while (next.endsWith('/')) next = next.slice(0, -1)
  return next
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
