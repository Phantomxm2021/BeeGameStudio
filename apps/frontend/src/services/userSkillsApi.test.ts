import { beforeEach, describe, expect, it, vi } from 'vitest';

import apiClient, { authenticatedFetch } from './apiClient';
import { importUserSkillPackage, listUserSkills } from './userSkillsApi';

vi.mock('./apiClient', () => ({
  default: {
    delete: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
  authenticatedFetch: vi.fn(),
}));

describe('userSkillsApi', () => {
  const mockGet = apiClient.get as unknown as {
    mockResolvedValue: (value: unknown) => void;
  };
  const mockAuthenticatedFetch = authenticatedFetch as unknown as {
    mockResolvedValue: (value: Response) => void;
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

  it('uploads skill packages as multipart form data without forcing a JSON content type', async () => {
    mockAuthenticatedFetch.mockResolvedValue(Response.json({
      id: 'skill_1',
      slug: 'movement-contracts',
      name: 'movement-contracts',
      description: 'Movement guidance.',
      enabled: true,
      content: '# Movement',
      references: [],
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    }));
    const file = new File(['zip-bytes'], 'movement-contracts.zip', { type: 'application/zip' });

    await expect(importUserSkillPackage(file)).resolves.toMatchObject({
      id: 'skill_1',
      slug: 'movement-contracts',
    });

    expect(authenticatedFetch).toHaveBeenCalledWith('/api/user-skills/import', {
      method: 'POST',
      body: expect.any(FormData),
    });
    const [, init] = (authenticatedFetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0];
    expect(init.headers).toBeUndefined();
    expect((init.body as FormData).get('skill')).toBe(file);
  });
});
