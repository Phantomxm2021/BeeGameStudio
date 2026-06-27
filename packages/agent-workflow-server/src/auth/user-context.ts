export type BeeGameRole = 'owner' | 'developer' | 'reviewer' | 'viewer'

export type BeeGamePermission =
  | 'workspace.read'
  | 'workspace.manage'
  | 'workspace.manage_members'
  | 'project.read'
  | 'project.create'
  | 'project.delete'
  | 'project.export'
  | 'agent.send_message'
  | 'agent.cancel'
  | 'agent.approve_tool'
  | 'preview.manage'
  | 'assets.upload'
  | 'assets.integrate'
  | 'model_config.manage'
  | 'mcp.manage'
  | 'runtime_settings.manage'
  | 'secrets.manage'

export type BeeGameUserContext = {
  id: string
  role: BeeGameRole
}

export type BeeGameUserResolver = (
  request: Request,
) => BeeGameUserContext | undefined

export const DEFAULT_LOCAL_USER_ID = 'dashboard-local'

export function getLocalUserContext(): BeeGameUserContext {
  return {
    id: process.env.BEEGAME_LOCAL_USER_ID?.trim() || DEFAULT_LOCAL_USER_ID,
    role: normalizeBeeGameRole(process.env.BEEGAME_LOCAL_USER_ROLE),
  }
}

export function hasBeeGamePermission(
  user: BeeGameUserContext,
  permission: BeeGamePermission,
): boolean {
  return getRolePermissions(user.role).has(permission)
}

export function listBeeGamePermissions(
  user: BeeGameUserContext,
): BeeGamePermission[] {
  return [...getRolePermissions(user.role)]
}

export function createEnvTokenUserResolver(
  env: NodeJS.ProcessEnv = process.env,
): BeeGameUserResolver | undefined {
  const raw = env.BEEGAME_AUTH_TOKENS?.trim()
  if (!raw) return undefined
  const usersByToken = parseAuthTokenUsers(raw)
  return request => {
    const token = getBearerToken(request)
    return token ? usersByToken.get(token) : undefined
  }
}

export function getBearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization')?.trim()
  if (!header) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1]?.trim() || undefined
}

export function normalizeBeeGameRole(value: string | undefined): BeeGameRole {
  if (
    value === 'owner' ||
    value === 'developer' ||
    value === 'reviewer' ||
    value === 'viewer'
  ) {
    return value
  }
  return 'owner'
}

function getRolePermissions(role: BeeGameRole): ReadonlySet<BeeGamePermission> {
  if (role === 'owner') return OWNER_PERMISSIONS
  if (role === 'developer') return DEVELOPER_PERMISSIONS
  if (role === 'reviewer') return REVIEWER_PERMISSIONS
  return VIEWER_PERMISSIONS
}

function parseAuthTokenUsers(raw: string): Map<string, BeeGameUserContext> {
  const parsed = JSON.parse(raw) as unknown
  const entries = new Map<string, BeeGameUserContext>()
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const entry = toTokenUserEntry(item)
      if (entry) entries.set(entry.token, entry.user)
    }
    return entries
  }
  if (isRecord(parsed)) {
    for (const [token, value] of Object.entries(parsed)) {
      const user = toUserContext(value)
      if (token.trim() && user) entries.set(token.trim(), user)
    }
  }
  return entries
}

function toTokenUserEntry(
  value: unknown,
): { token: string; user: BeeGameUserContext } | undefined {
  if (!isRecord(value)) return undefined
  const token = typeof value.token === 'string' ? value.token.trim() : ''
  const user = toUserContext(value)
  return token && user ? { token, user } : undefined
}

function toUserContext(value: unknown): BeeGameUserContext | undefined {
  if (!isRecord(value)) return undefined
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  if (!id) return undefined
  return {
    id,
    role: normalizeBeeGameRole(
      typeof value.role === 'string' ? value.role : undefined,
    ),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const VIEWER_PERMISSIONS = new Set<BeeGamePermission>([
  'workspace.read',
  'project.read',
  'project.export',
])

const REVIEWER_PERMISSIONS = new Set<BeeGamePermission>([
  ...VIEWER_PERMISSIONS,
])

const DEVELOPER_PERMISSIONS = new Set<BeeGamePermission>([
  ...REVIEWER_PERMISSIONS,
  'project.create',
  'agent.send_message',
  'agent.cancel',
  'agent.approve_tool',
  'preview.manage',
  'assets.upload',
  'assets.integrate',
])

const OWNER_PERMISSIONS = new Set<BeeGamePermission>([
  ...DEVELOPER_PERMISSIONS,
  'workspace.manage',
  'workspace.manage_members',
  'project.delete',
  'model_config.manage',
  'mcp.manage',
  'runtime_settings.manage',
  'secrets.manage',
])
