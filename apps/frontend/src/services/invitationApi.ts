import { getSupabaseAccessToken } from './supabaseAuthApi';

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

const getSupabaseUrl = (): string => String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const getSupabaseAnonKey = (): string => String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export async function getInvitationPublicSettings(): Promise<InvitationPublicSettings> {
  const value = await callSupabaseRpc<unknown>('beegame_public_invitation_settings', {}, false);
  return { required: isRecord(value) && value.required === true };
}

export async function validateInvitationCode(code: string): Promise<boolean> {
  return await callSupabaseRpc<boolean>('beegame_validate_invitation_code', { p_code: code }, false);
}

export async function listInvitations(): Promise<InvitationRecord[]> {
  return await callSupabaseRpc<InvitationRecord[]>('beegame_admin_list_invitations', {}, true);
}

export async function saveInvitationSettings(required: boolean): Promise<InvitationPublicSettings> {
  const value = await callSupabaseRpc<unknown>('beegame_admin_save_invitation_settings', { p_required: required }, true);
  return { required: isRecord(value) && value.required === true };
}

export async function createInvitation(input: { code: string; label?: string; maxUses?: number | null }): Promise<InvitationRecord> {
  return await callSupabaseRpc<InvitationRecord>('beegame_admin_create_invitation', {
    p_code: input.code,
    p_label: input.label || null,
    p_max_uses: input.maxUses ?? null,
  }, true);
}

export async function updateInvitation(input: {
  id: string;
  enabled?: boolean;
  label?: string;
  maxUses?: number | null;
  clearMaxUses?: boolean;
}): Promise<InvitationRecord> {
  return await callSupabaseRpc<InvitationRecord>('beegame_admin_update_invitation', {
    p_id: input.id,
    p_label: input.label ?? null,
    p_enabled: input.enabled ?? null,
    p_max_uses: input.maxUses ?? null,
    p_clear_max_uses: input.clearMaxUses === true,
  }, true);
}

export async function deleteInvitation(id: string): Promise<boolean> {
  return await callSupabaseRpc<boolean>('beegame_admin_delete_invitation', { p_id: id }, true);
}

async function callSupabaseRpc<T>(
  name: string,
  body: Record<string, unknown>,
  authenticated: boolean,
): Promise<T> {
  const supabaseUrl = getSupabaseUrl().replace(/\/+$/, '');
  const anonKey = getSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) {
    if (!authenticated) return { required: false } as T;
    throw new Error('Supabase invitation settings are not configured.');
  }
  const accessToken = authenticated ? getSupabaseAccessToken() : '';
  if (authenticated && !accessToken) {
    throw new Error('Authentication required.');
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken || anonKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return await response.json() as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
