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
  | 'secrets.manage';

export type BeeGameCurrentUser = {
  id: string;
  role: BeeGameRole;
  permissions: BeeGamePermission[];
};

export const getCurrentUser = (): Promise<BeeGameCurrentUser> => (
  apiClient.get('/api/current-user')
);

export const hasPermission = (
  user: BeeGameCurrentUser | undefined | null,
  permission: BeeGamePermission,
): boolean => Boolean(user?.permissions.includes(permission));
