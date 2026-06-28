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
  uploadSupabaseAvatarImage,
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

  it('starts a Supabase OAuth redirect for third-party providers', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const assign = vi.fn();
    vi.stubGlobal('location', {
      href: 'http://localhost:5173/',
      origin: 'http://localhost:5173',
      assign,
    });

    await signInWithSupabaseOAuth('github');

    const githubUrl = new URL(assign.mock.calls[0][0]);
    expect(githubUrl.origin).toBe('https://project.supabase.co');
    expect(githubUrl.pathname).toBe('/auth/v1/authorize');
    expect(githubUrl.searchParams.get('provider')).toBe('github');
    expect(githubUrl.searchParams.get('redirect_to')).toBe('http://localhost:5173');
    expect(githubUrl.searchParams.get('flow_type')).toBe('pkce');
    expect(githubUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(githubUrl.searchParams.get('code_challenge')).toBeTruthy();

    await signInWithSupabaseOAuth('discord');

    const discordUrl = new URL(assign.mock.calls[1][0]);
    expect(discordUrl.searchParams.get('provider')).toBe('discord');
    expect(discordUrl.searchParams.get('scopes')).toBe('identify email');
  });

  it('stores a Supabase session from an OAuth redirect hash', async () => {
    const replaceState = vi.fn();
    vi.stubGlobal('history', { replaceState });
    vi.stubGlobal('location', {
      href: 'http://localhost:5173/#access_token=oauth-token&refresh_token=oauth-refresh&expires_in=3600&token_type=bearer',
      origin: 'http://localhost:5173',
      pathname: '/',
      search: '',
      hash: '#access_token=oauth-token&refresh_token=oauth-refresh&expires_in=3600&token_type=bearer',
    });

    await expect(consumeSupabaseRedirectSession()).resolves.toBe(true);
    expect(getSupabaseAccessToken()).toBe('oauth-token');
    expect(replaceState).toHaveBeenCalledWith({}, document.title, '/');
  });

  it('exchanges a Supabase OAuth authorization code from a PKCE callback', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const replaceState = vi.fn();
    const fetchMock = vi.fn(async () => Response.json({
      access_token: 'pkce-access-token',
      refresh_token: 'pkce-refresh-token',
      expires_in: 3600,
      user: { id: 'pkce-user', email: 'pkce@example.com' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('history', { replaceState });
    vi.stubGlobal('location', {
      href: 'http://localhost:5173/?code=auth-code',
      origin: 'http://localhost:5173',
      pathname: '/',
      search: '?code=auth-code',
      hash: '',
    });
    sessionStorage.setItem('beegame_supabase_oauth_pkce', JSON.stringify({
      provider: 'discord',
      codeVerifier: 'stored-code-verifier',
      createdAt: Date.now(),
    }));

    await expect(consumeSupabaseRedirectSession()).resolves.toBe(true);

    expect(getSupabaseAccessToken()).toBe('pkce-access-token');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/token?grant_type=pkce',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'anon-key',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          auth_code: 'auth-code',
          code_verifier: 'stored-code-verifier',
        }),
      }),
    );
    expect(replaceState).toHaveBeenCalledWith({}, document.title, '/');
  });

  it('surfaces Supabase OAuth callback errors instead of silently ignoring them', async () => {
    const replaceState = vi.fn();
    vi.stubGlobal('history', { replaceState });
    vi.stubGlobal('location', {
      href: 'http://localhost:5173/#error=server_error&error_description=Discord%20email%20scope%20missing',
      origin: 'http://localhost:5173',
      pathname: '/',
      search: '',
      hash: '#error=server_error&error_description=Discord%20email%20scope%20missing',
    });

    await expect(consumeSupabaseRedirectSession()).rejects.toThrow('Discord email scope missing');
    expect(replaceState).toHaveBeenCalledWith({}, document.title, '/');
  });

  it('explains Supabase external code exchange failures as provider configuration issues', async () => {
    const replaceState = vi.fn();
    vi.stubGlobal('history', { replaceState });
    vi.stubGlobal('location', {
      href: 'http://localhost:5173/?error=server_error&error_description=Unable%2520to%2520exchange%2520external%2520code%253A%2520q6aM',
      origin: 'http://localhost:5173',
      pathname: '/',
      search: '?error=server_error&error_description=Unable%2520to%2520exchange%2520external%2520code%253A%2520q6aM',
      hash: '',
    });
    sessionStorage.setItem('beegame_supabase_oauth_pkce', JSON.stringify({
      provider: 'discord',
      codeVerifier: 'stored-code-verifier',
      createdAt: Date.now(),
    }));

    await expect(consumeSupabaseRedirectSession()).rejects.toThrow(
      'Discord sign-in reached BeeGame, but Supabase could not exchange the provider code.',
    );
    expect(replaceState).toHaveBeenCalledWith({}, document.title, '/');
  });

  it('explains token exchange external code failures with the OAuth provider name', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const replaceState = vi.fn();
    const fetchMock = vi.fn(async () => Response.json({
      error: 'server_error',
      error_description: 'Unable to exchange external code: q6aM',
    }, { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('history', { replaceState });
    vi.stubGlobal('location', {
      href: 'http://localhost:5173/?code=auth-code',
      origin: 'http://localhost:5173',
      pathname: '/',
      search: '?code=auth-code',
      hash: '',
    });
    sessionStorage.setItem('beegame_supabase_oauth_pkce', JSON.stringify({
      provider: 'discord',
      codeVerifier: 'stored-code-verifier',
      createdAt: Date.now(),
    }));

    await expect(consumeSupabaseRedirectSession()).rejects.toThrow(
      'Discord sign-in reached BeeGame, but Supabase could not exchange the provider code.',
    );
  });

  it('hydrates OAuth redirect sessions with provider nickname and avatar metadata', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const replaceState = vi.fn();
    const fetchMock = vi.fn(async () => Response.json({
      id: 'oauth-user',
      identities: [
        {
          identity_data: {
            email: 'oauth@example.com',
            user_name: 'octo-maker',
            avatar_url: 'https://avatars.example.com/octo.png',
          },
        },
      ],
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

    await expect(consumeSupabaseRedirectSession()).resolves.toBe(true);
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

  it('hydrates OAuth provider profile fields from alternate metadata shapes', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const fetchMock = vi.fn(async () => Response.json({
      id: 'discord-user',
      metadata: {
        email: 'discord@example.com',
        global_name: 'Discord Maker',
        image: 'https://avatars.example.com/discord.png',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'discord-token',
      expiresAt: Date.now() + 3600_000,
      user: { id: 'oauth' },
    }));

    const session = await hydrateSupabaseSessionUser();

    expect(session?.user).toMatchObject({
      id: 'discord-user',
      email: 'discord@example.com',
      displayName: 'Discord Maker',
      avatarUrl: 'https://avatars.example.com/discord.png',
    });
  });

  it('uploads avatar images to Supabase Storage and returns a public URL', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    vi.stubEnv('VITE_SUPABASE_AVATAR_BUCKET', 'avatars');
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'access-token',
      expiresAt: Date.now() + 3600_000,
      user: { id: 'user-1' },
    }));
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const url = await uploadSupabaseAvatarImage(
      new File(['avatar-bytes'], 'My Avatar.png', { type: 'image/png' }),
    );

    expect(url).toMatch(
      /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/avatars\/avatars\/user-1\/\d+-my-avatar\.png$/,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/avatars\/avatars\/user-1\/\d+-my-avatar\.png$/,
      ),
      expect.objectContaining({
        method: 'PUT',
        body: expect.any(File),
        headers: expect.objectContaining({
          apikey: 'anon-key',
          authorization: 'Bearer access-token',
          'content-type': 'image/png',
          'x-upsert': 'true',
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
