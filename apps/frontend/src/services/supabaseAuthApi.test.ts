import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearSupabaseSession,
  consumeSupabaseRedirectSession,
  getSupabaseAccessToken,
  hydrateSupabaseSessionUser,
  isSupabaseAuthConfigured,
  signInWithSupabaseOAuth,
  signInWithSupabasePassword,
  signUpWithSupabasePassword,
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

  it('signs up with email/password and stores the returned session when available', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const fetchMock = vi.fn(async () => Response.json({
      access_token: 'signup-access-token',
      refresh_token: 'signup-refresh-token',
      expires_in: 3600,
      user: { id: 'user-2', email: 'new@example.com' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const session = await signUpWithSupabasePassword({
      email: 'new@example.com',
      password: 'secret-password',
      displayName: 'New Player',
    });

    expect(session?.accessToken).toBe('signup-access-token');
    expect(getSupabaseAccessToken()).toBe('signup-access-token');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/signup',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'anon-key',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          email: 'new@example.com',
          password: 'secret-password',
          data: {
            display_name: 'New Player',
          },
        }),
      }),
    );
  });

  it('starts a Supabase OAuth redirect for third-party providers', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const assign = vi.fn();
    vi.stubGlobal('location', {
      href: 'http://localhost:5173/',
      origin: 'http://localhost:5173',
      assign,
    });

    signInWithSupabaseOAuth('github');

    expect(assign).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/authorize?provider=github&redirect_to=http%3A%2F%2Flocalhost%3A5173',
    );
  });

  it('stores a Supabase session from an OAuth redirect hash', () => {
    const replaceState = vi.fn();
    vi.stubGlobal('history', { replaceState });
    vi.stubGlobal('location', {
      href: 'http://localhost:5173/#access_token=oauth-token&refresh_token=oauth-refresh&expires_in=3600&token_type=bearer',
      origin: 'http://localhost:5173',
      pathname: '/',
      search: '',
      hash: '#access_token=oauth-token&refresh_token=oauth-refresh&expires_in=3600&token_type=bearer',
    });

    expect(consumeSupabaseRedirectSession()).toBe(true);
    expect(getSupabaseAccessToken()).toBe('oauth-token');
    expect(replaceState).toHaveBeenCalledWith({}, document.title, '/');
  });

  it('hydrates OAuth redirect sessions with provider nickname and avatar metadata', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const replaceState = vi.fn();
    const fetchMock = vi.fn(async () => Response.json({
      id: 'oauth-user',
      email: 'oauth@example.com',
      user_metadata: {
        user_name: 'octo-maker',
        avatar_url: 'https://avatars.example.com/octo.png',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('history', { replaceState });
    vi.stubGlobal('location', {
      href: 'http://localhost:5173/#access_token=oauth-token&refresh_token=oauth-refresh&expires_in=3600&token_type=bearer',
      origin: 'http://localhost:5173',
      pathname: '/',
      search: '',
      hash: '#access_token=oauth-token&refresh_token=oauth-refresh&expires_in=3600&token_type=bearer',
    });

    expect(consumeSupabaseRedirectSession()).toBe(true);
    const session = await hydrateSupabaseSessionUser();

    expect(session?.user).toMatchObject({
      id: 'oauth-user',
      email: 'oauth@example.com',
      displayName: 'octo-maker',
      avatarUrl: 'https://avatars.example.com/octo.png',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          apikey: 'anon-key',
          authorization: 'Bearer oauth-token',
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
