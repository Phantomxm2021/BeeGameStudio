import type {
  BeeGameSkillsUserContext,
} from '@bee-game-studio/beegame-skills-core/types'

export type SkillsUserResolver = (
  request: Request,
) => BeeGameSkillsUserContext | undefined | Promise<BeeGameSkillsUserContext | undefined>

export type BeeGameSkillsAuthOptions = {
  currentUser?: BeeGameSkillsUserContext
  currentUserResolver?: SkillsUserResolver
}

export function createBeeGameSkillsAuthContext(
  options: BeeGameSkillsAuthOptions = {},
) {
  const requestUsers = new WeakMap<Request, BeeGameSkillsUserContext>()
  return {
    resolveRequestUser: async (request: Request) => {
      if (options.currentUser) return options.currentUser
      const user = options.currentUserResolver
        ? await options.currentUserResolver(request)
        : undefined
      if (user) requestUsers.set(request, user)
      return user
    },
    getCurrentUser: (request?: Request) => {
      const user = options.currentUser ??
        (request ? requestUsers.get(request) : undefined)
      if (!user) throw new Error('Authenticated BeeGame user is required')
      return user
    },
  }
}

export function createConfiguredSkillsUserResolver(
  env: NodeJS.ProcessEnv = process.env,
): SkillsUserResolver | undefined {
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
  if (!baseUrl || !apiKey) return createLocalSkillsUserResolver(env)
  return async request => {
    const token = getBearerToken(request)
    if (!token) return undefined
    const response = await fetch(`${removeTrailingSlashes(baseUrl)}/rest/v1/rpc/beegame_current_user_context`, {
      method: 'POST',
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    }).catch(() => undefined)
    if (!response?.ok) return undefined
    return toSkillsUser(await response.json().catch(() => undefined))
  }
}

export function hasBeeGameSkillsPermission(
  user: BeeGameSkillsUserContext,
  permission: 'skills.manage',
): boolean {
  if (user.permissions?.includes(permission)) return true
  return permission === 'skills.manage' && Boolean(user.id)
}

function createLocalSkillsUserResolver(env: NodeJS.ProcessEnv): SkillsUserResolver {
  const id = trimString(env.BEEGAME_LOCAL_USER_ID) || 'local-user'
  return () => ({
    id,
    role: 'owner',
    permissions: ['skills.manage'],
  })
}

function toSkillsUser(value: unknown): BeeGameSkillsUserContext | undefined {
  if (!isObject(value)) return undefined
  const id = trimString(value.id)
  if (!id) return undefined
  const email = trimString(value.email)
  const role = trimString(value.role)
  const permissions = Array.isArray(value.permissions)
    ? value.permissions.filter(item => typeof item === 'string')
    : undefined
  return {
    id,
    ...(email ? { email } : {}),
    ...(role ? { role } : {}),
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
