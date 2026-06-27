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

export const DEFAULT_LOCAL_USER_ID = 'dashboard-local'

export function getLocalUserContext(): BeeGameUserContext {
  return {
    id: process.env.BEEGAME_LOCAL_USER_ID?.trim() || DEFAULT_LOCAL_USER_ID,
    role: 'owner',
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

function getRolePermissions(role: BeeGameRole): ReadonlySet<BeeGamePermission> {
  if (role === 'owner') return OWNER_PERMISSIONS
  if (role === 'developer') return DEVELOPER_PERMISSIONS
  if (role === 'reviewer') return REVIEWER_PERMISSIONS
  return VIEWER_PERMISSIONS
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
