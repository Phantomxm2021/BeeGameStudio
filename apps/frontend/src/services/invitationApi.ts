import apiClient from './apiClient';

export type InvitationPublicSettings = {
  required: boolean;
};

export type InvitationRecord = {
  id: string;
  code?: string | null;
  label: string;
  enabled: boolean;
  maxUses?: number | null;
  usedCount: number;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function getInvitationPublicSettings(): Promise<InvitationPublicSettings> {
  return await apiClient.get('/api/invitations/settings');
}

export async function validateInvitationCode(code: string): Promise<boolean> {
  const result = await apiClient.post('/api/invitations/validate', { code }) as { valid: boolean };
  return result.valid === true;
}

export async function listInvitations(): Promise<InvitationRecord[]> {
  return await apiClient.get('/api/admin/invitations');
}

export async function saveInvitationSettings(required: boolean): Promise<InvitationPublicSettings> {
  return await apiClient.put('/api/admin/invitations/settings', { required });
}

export async function createInvitation(input: {
  code: string;
  label?: string;
  maxUses?: number | null;
}): Promise<InvitationRecord> {
  return await apiClient.post('/api/admin/invitations', input);
}

export async function updateInvitation(input: {
  id: string;
  enabled?: boolean;
  label?: string;
  maxUses?: number | null;
  clearMaxUses?: boolean;
}): Promise<InvitationRecord> {
  const { id, ...body } = input;
  return await apiClient.patch(`/api/admin/invitations/${encodeURIComponent(id)}`, body);
}

export async function deleteInvitation(id: string): Promise<boolean> {
  const result = await apiClient.delete(`/api/admin/invitations/${encodeURIComponent(id)}`) as {
    deleted: boolean;
  };
  return result.deleted === true;
}
