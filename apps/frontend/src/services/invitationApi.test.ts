import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from './apiClient';
import {
  createInvitation,
  deleteInvitation,
  getInvitationPublicSettings,
  listInvitations,
  saveInvitationSettings,
  updateInvitation,
  validateInvitationCode,
} from './invitationApi';

vi.mock('./apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('invitation API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses same-origin public invitation routes', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ required: true });
    vi.mocked(apiClient.post).mockResolvedValue({ valid: true });

    await expect(getInvitationPublicSettings()).resolves.toEqual({ required: true });
    await expect(validateInvitationCode('BEE-ALPHA')).resolves.toBe(true);

    expect(apiClient.get).toHaveBeenCalledWith('/api/invitations/settings');
    expect(apiClient.post).toHaveBeenCalledWith('/api/invitations/validate', {
      code: 'BEE-ALPHA',
    });
  });

  it('routes every admin operation through the authenticated application API', async () => {
    const record = {
      id: 'invitation-1',
      label: 'Alpha',
      enabled: true,
      usedCount: 0,
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
    };
    vi.mocked(apiClient.get).mockResolvedValue([record]);
    vi.mocked(apiClient.put).mockResolvedValue({ required: true });
    vi.mocked(apiClient.post).mockResolvedValue(record);
    vi.mocked(apiClient.patch).mockResolvedValue(record);
    vi.mocked(apiClient.delete).mockResolvedValue({ deleted: true });

    await expect(listInvitations()).resolves.toEqual([record]);
    await expect(saveInvitationSettings(true)).resolves.toEqual({ required: true });
    await expect(createInvitation({ code: 'BEE-ALPHA', maxUses: 3 })).resolves.toEqual(record);
    await expect(updateInvitation({ id: 'invitation/1', enabled: false })).resolves.toEqual(record);
    await expect(deleteInvitation('invitation/1')).resolves.toBe(true);

    expect(apiClient.get).toHaveBeenCalledWith('/api/admin/invitations');
    expect(apiClient.put).toHaveBeenCalledWith('/api/admin/invitations/settings', { required: true });
    expect(apiClient.post).toHaveBeenCalledWith('/api/admin/invitations', {
      code: 'BEE-ALPHA',
      maxUses: 3,
    });
    expect(apiClient.patch).toHaveBeenCalledWith(
      '/api/admin/invitations/invitation%2F1',
      { enabled: false },
    );
    expect(apiClient.delete).toHaveBeenCalledWith('/api/admin/invitations/invitation%2F1');
  });
});
