import { beforeEach, describe, expect, it, vi } from 'vitest';

import apiClient from './apiClient';
import {
  getCurrentUser,
  hasPermission,
  type BeeGameCurrentUser,
} from './currentUserApi';

vi.mock('./apiClient', () => ({
  default: {
    get: vi.fn(),
  },
}));

describe('currentUserApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the current BeeGame user from the server', async () => {
    const user: BeeGameCurrentUser = {
      id: 'dashboard-local',
      role: 'owner',
      permissions: ['project.read', 'agent.send_message'],
    };
    vi.mocked(apiClient.get).mockResolvedValue(user);

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
});
