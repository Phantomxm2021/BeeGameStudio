import { beforeEach, describe, expect, it, vi } from 'vitest';

import apiClient from './apiClient';
import {
  deleteWorkspaceMember,
  listWorkspaceMembers,
  upsertWorkspaceMember,
  type BeeGameWorkspaceMember,
} from './workspaceMembersApi';

vi.mock('./apiClient', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('workspaceMembersApi', () => {
  const mockGet = apiClient.get as unknown as {
    mockResolvedValue: (value: unknown) => void;
  };
  const mockPut = apiClient.put as unknown as {
    mockResolvedValue: (value: unknown) => void;
  };
  const mockDelete = apiClient.delete as unknown as {
    mockResolvedValue: (value: unknown) => void;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps workspace member operations to the BeeGame API', async () => {
    const members: BeeGameWorkspaceMember[] = [{
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'owner',
      createdAt: '2026-06-27T00:00:00.000Z',
    }];
    mockGet.mockResolvedValue(members);
    mockPut.mockResolvedValue({
      workspaceId: 'workspace-1',
      userId: 'user-2',
      role: 'developer',
      createdAt: '2026-06-27T00:00:00.000Z',
    });
    mockDelete.mockResolvedValue({ deleted: true });

    await expect(listWorkspaceMembers()).resolves.toEqual(members);
    await expect(upsertWorkspaceMember('user-2', 'developer')).resolves.toEqual({
      workspaceId: 'workspace-1',
      userId: 'user-2',
      role: 'developer',
      createdAt: '2026-06-27T00:00:00.000Z',
    });
    await expect(deleteWorkspaceMember('user-2')).resolves.toEqual({ deleted: true });

    expect(apiClient.get).toHaveBeenCalledWith('/api/workspace/members');
    expect(apiClient.put).toHaveBeenCalledWith(
      '/api/workspace/members/user-2',
      { role: 'developer' },
    );
    expect(apiClient.delete).toHaveBeenCalledWith('/api/workspace/members/user-2');
  });
});
