import { beforeEach, describe, expect, it, vi } from 'vitest';

import apiClient from './apiClient';
import {
  deleteCurrentUser,
  getCurrentUser,
  hasPermission,
  type BeeGameCurrentUser,
} from './currentUserApi';

vi.mock('./apiClient', () => ({
  default: {
    delete: vi.fn(),
    get: vi.fn(),
  },
}));

describe('currentUserApi', () => {
  const mockGet = apiClient.get as unknown as {
    mockResolvedValue: (value: unknown) => void;
  };
  const mockDelete = apiClient.delete as unknown as {
    mockResolvedValue: (value: unknown) => void;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the current BeeGame user from the server', async () => {
    const user: BeeGameCurrentUser = {
      id: 'user-123',
      role: 'owner',
      email: 'owner@example.com',
      displayName: 'Owner',
      permissions: ['project.read', 'agent.send_message'],
    };
    mockGet.mockResolvedValue(user);

    await expect(getCurrentUser()).resolves.toEqual(user);
    expect(apiClient.get).toHaveBeenCalledWith('/api/current-user', {
      headers: { 'Hide-Error-Toast': 'true' },
    });
  });

  it('checks whether a user has a named permission', () => {
    const user: BeeGameCurrentUser = {
      id: 'developer',
      role: 'developer',
      permissions: ['project.read', 'agent.send_message'],
    };

    expect(hasPermission(user, 'agent.send_message')).toBe(true);
    expect(hasPermission(user, 'project.delete')).toBe(false);
    expect(hasPermission(undefined, 'project.read')).toBe(false);
  });

  it('deletes the current BeeGame user through the server RPC bridge', async () => {
    mockDelete.mockResolvedValue({ ok: true });

    await expect(deleteCurrentUser()).resolves.toEqual({ ok: true });
    expect(apiClient.delete).toHaveBeenCalledWith('/api/current-user');
  });
});
