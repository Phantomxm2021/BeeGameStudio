import type { BeeGameSupabaseUser } from '../../frontend/src/services/supabaseAuthApi';

export function getPortalAccountUser(): BeeGameSupabaseUser | null;
export function subscribePortalAccount(listener: (user: BeeGameSupabaseUser | null) => void): () => void;
export function openPortalLogin(): Promise<void>;
export function signOutPortalAccount(): void;
