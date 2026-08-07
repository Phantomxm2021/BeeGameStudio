import type {
  BeeGameBillingUserContext,
} from '@bee-game-studio/beegame-billing-core/billing-route-types'
import type { TLSAwareFetch } from '../../../src/utils/mtls.js'

type BillingUserResolver = (
  request: Request,
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
  return {
    resolveRequestUser: async request => {
      if (options.currentUser) return options.currentUser
      const user = options.currentUserResolver
        ? await resolveWithTimeout(options.currentUserResolver(request), timeoutMs)
        : undefined
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
  if (!baseUrl || !apiKey) return undefined
  return async request => {
    const token = getBearerToken(request)
    if (!token) return undefined
    const response = await fetchImpl(`${removeTrailingSlashes(baseUrl)}/rest/v1/rpc/beegame_current_user_context`, {
      method: 'POST',
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    }).catch(() => undefined)
    if (!response?.ok) return undefined
    return toBillingUser(await response.json().catch(() => undefined))
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
  user: BeeGameBillingUserContext | undefined | Promise<BeeGameBillingUserContext | undefined>,
  timeoutMs: number,
): Promise<BeeGameBillingUserContext | undefined> {
  if (timeoutMs <= 0) return await user
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      user,
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function normalizeResolveTimeoutMs(value: number | undefined): number {
  const configured = value ?? Number.parseInt(
    process.env.BEEGAME_AUTH_RESOLVE_TIMEOUT_MS ?? '',
    10,
  )
  return Number.isFinite(configured) && configured >= 0 ? configured : 3_000
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
