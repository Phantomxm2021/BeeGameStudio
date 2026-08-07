export type ResourceUserContext = {
  id: string
  modelConfigOwnerId?: string
  role?: string
  permissions?: string[]
}

export type ResourceUserResolver = (
  request: Request,
) => ResourceUserContext | undefined | Promise<ResourceUserContext | undefined>

export function hasResourceAdminPermission(user: ResourceUserContext): boolean {
  return user.role === 'owner' || Boolean(user.permissions?.includes('resources.manage'))
}

export function createLocalResourceUserResolver(
  env: NodeJS.ProcessEnv = process.env,
): ResourceUserResolver {
  return () => ({
    id: env.BEEGAME_LOCAL_USER_ID?.trim() || 'local-user',
    role: 'owner',
    permissions: ['resources.manage'],
  })
}

type ResourceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * Resolves the same server-verified context used by the workflow service.
 * A resource request never trusts role claims sent by the browser directly.
 */
export function createSupabaseResourceUserResolver(
  options: {
    url?: string
    apiKey?: string
    fetchImpl?: ResourceFetch
  } = {},
): ResourceUserResolver | undefined {
  const baseUrl = trim(options.url ?? process.env.BEEGAME_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL)
  const apiKey = trim(options.apiKey ?? process.env.BEEGAME_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY)
  if (!baseUrl || !apiKey) return undefined
  const fetchImpl = options.fetchImpl ?? fetch
  return async request => {
    const token = bearerToken(request)
    if (!token) return undefined
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/rest/v1/rpc/beegame_current_user_context`, {
        method: 'POST',
        headers: { apikey: apiKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) return undefined
      return toResourceUser(await response.json())
    } catch {
      return undefined
    }
  }
}

export function createConfiguredResourceUserResolver(
  env: NodeJS.ProcessEnv = process.env,
  options: { fetchImpl?: ResourceFetch } = {},
): ResourceUserResolver | undefined {
  return createSupabaseResourceUserResolver({
    url: env.BEEGAME_SUPABASE_URL ?? env.SUPABASE_URL ?? env.VITE_SUPABASE_URL,
    apiKey: env.BEEGAME_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  })
}

export function isLocalResourceFallbackAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV !== 'production' || env.BEEGAME_ALLOW_LOCAL_RESOURCE_AUTH === '1'
}

function bearerToken(request: Request): string | undefined {
  const value = request.headers.get('authorization')?.trim() || ''
  const match = /^Bearer\s+(.+)$/i.exec(value)
  return match?.[1]?.trim() || undefined
}

function toResourceUser(value: unknown): ResourceUserContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  if (!id) return undefined
  const modelConfigOwnerId = typeof row.modelConfigOwnerId === 'string'
    ? row.modelConfigOwnerId.trim()
    : typeof row.model_config_owner_id === 'string'
      ? row.model_config_owner_id.trim()
      : ''
  const role = typeof row.role === 'string' ? row.role.trim() : undefined
  const permissions = Array.isArray(row.permissions)
    ? row.permissions.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : undefined
  return { id, ...(modelConfigOwnerId ? { modelConfigOwnerId } : {}), ...(role ? { role } : {}), ...(permissions?.length ? { permissions } : {}) }
}

function trim(value: string | undefined): string {
  return value?.trim() || ''
}
