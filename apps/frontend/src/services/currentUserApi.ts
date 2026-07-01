import apiClient from './apiClient';

export type BeeGameRole = 'owner' | 'developer' | 'reviewer' | 'viewer';

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
  | 'audit.read';

export type BeeGameCurrentUser = {
  id: string;
  accountId?: string;
  role: BeeGameRole;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  permissions: BeeGamePermission[];
};

export const getCurrentUser = (): Promise<BeeGameCurrentUser> => (
  apiClient.get('/api/current-user', {
    headers: { 'Hide-Error-Toast': 'true' },
  })
);

export const deleteCurrentUser = (): Promise<{ ok: true }> => (
  apiClient.delete('/api/current-user')
);

export const hasPermission = (
  user: BeeGameCurrentUser | undefined | null,
  permission: BeeGamePermission,
): boolean => Boolean(user?.permissions.includes(permission));
