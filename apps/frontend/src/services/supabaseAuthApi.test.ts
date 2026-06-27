import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearSupabaseSession,
  getSupabaseAccessToken,
  isSupabaseAuthConfigured,
  signInWithSupabasePassword,
} from './supabaseAuthApi';

describe('supabaseAuthApi', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('detects when Supabase auth env is configured', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');

    expect(isSupabaseAuthConfigured()).toBe(true);
  });

  it('signs in with email/password and stores the session access token', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const fetchMock = vi.fn(async () => Response.json({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      user: { id: 'user-1', email: 'user@example.com' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const session = await signInWithSupabasePassword({
      email: 'user@example.com',
      password: 'secret-password',
    });

    expect(session).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { id: 'user-1', email: 'user@example.com' },
    });
    expect(getSupabaseAccessToken()).toBe('access-token');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/token?grant_type=password',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'anon-key',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'secret-password',
        }),
      }),
    );
  });

  it('clears expired sessions instead of returning stale access tokens', () => {
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'expired-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1000,
      user: { id: 'user-1' },
    }));

    expect(getSupabaseAccessToken()).toBe('');
    expect(localStorage.getItem('beegame_supabase_session')).toBeNull();
  });

  it('clears the stored session on sign out', () => {
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'access-token',
      expiresAt: Date.now() + 3600_000,
      user: { id: 'user-1' },
    }));

    clearSupabaseSession();

    expect(getSupabaseAccessToken()).toBe('');
  });
});
