import { beforeEach, describe, expect, it, vi } from 'vitest';

import apiClient from './apiClient';
import { listUserSkills } from './userSkillsApi';

vi.mock('./apiClient', () => ({
  default: {
    delete: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

describe('userSkillsApi', () => {
  const mockGet = apiClient.get as unknown as {
    mockResolvedValue: (value: unknown) => void;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads skills without showing a global toast when the settings panel handles errors locally', async () => {
    mockGet.mockResolvedValue([]);

    await expect(listUserSkills()).resolves.toEqual([]);

    expect(apiClient.get).toHaveBeenCalledWith('/api/user-skills', {
      headers: {
        'Hide-Error-Toast': 'true',
      },
    });
  });
});
