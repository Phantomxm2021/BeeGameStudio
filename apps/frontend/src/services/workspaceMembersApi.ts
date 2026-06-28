import apiClient from './apiClient';

export type BeeGameWorkspaceMemberRole = 'owner' | 'developer' | 'reviewer' | 'viewer';

export type BeeGameWorkspaceMember = {
  workspaceId: string;
  userId: string;
  role: BeeGameWorkspaceMemberRole;
  createdAt: string;
};

export const listWorkspaceMembers = (): Promise<BeeGameWorkspaceMember[]> => (
  apiClient.get('/api/workspace/members')
);

export const upsertWorkspaceMember = (
  userId: string,
  role: BeeGameWorkspaceMemberRole,
): Promise<BeeGameWorkspaceMember> => (
  apiClient.put(`/api/workspace/members/${encodeURIComponent(userId)}`, { role })
);

export const deleteWorkspaceMember = (
  userId: string,
): Promise<{ deleted: boolean }> => (
  apiClient.delete(`/api/workspace/members/${encodeURIComponent(userId)}`)
);
