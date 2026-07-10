export type ResourceUserContext = {
  id: string
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
