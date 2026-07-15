import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearSupabaseSession,
  consumeSupabaseRedirectSession,
  getSupabaseAccessToken,
  getValidSupabaseAccessToken,
  hydrateSupabaseSessionUser,
  initializeSupabaseSession,
  isSupabaseAuthConfigured,
  refreshSupabaseSession,
  signInWithSupabaseOAuth,
  signInWithSupabasePassword,
  signUpWithSupabasePassword,
  uploadSupabaseAvatarImage,
} from './supabaseAuthApi';

describe('supabaseAuthApi', () => {
  afterEach(() => {
    vi.useRealTimers();
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

  it('migrates a legacy session once and removes browser refresh-token storage after cookie success', async () => {
    vi.stubEnv('VITE_BEEGAME_HTTPONLY_SESSIONS', '1');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        user: { id: 'user-1', email: 'user@example.com' },
      }))
      .mockResolvedValueOnce(Response.json({
        authenticated: true,
        user: { id: 'user-1', email: 'user@example.com' },
      }))
      .mockResolvedValueOnce(Response.json({
        authenticated: true,
        user: { id: 'user-1', email: 'user@example.com' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await signInWithSupabasePassword({ email: 'user@example.com', password: 'secret-password' });

    expect(localStorage.getItem('beegame_supabase_session')).toBeNull();
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/session');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    });
    expect(fetchMock.mock.calls[2][0]).toBe('/api/auth/session');
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ credentials: 'include' });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    });
  });

  it('fails closed instead of activating a browser-token fallback when cookie verification fails', async () => {
    vi.stubEnv('VITE_BEEGAME_HTTPONLY_SESSIONS', '1');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        user: { id: 'user-1', email: 'user@example.com' },
      }))
      .mockResolvedValueOnce(Response.json({ authenticated: true }))
      .mockResolvedValueOnce(Response.json({ authenticated: false }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(signInWithSupabasePassword({
      email: 'user@example.com',
      password: 'secret-password',
    })).rejects.toMatchObject({ code: 'secure_session_unavailable' });

    expect(localStorage.getItem('beegame_supabase_session')).toBeNull();
    expect(fetchMock.mock.calls[2][0]).toBe('/api/auth/session');
  });

  it('restores one HttpOnly cookie session across concurrent StrictMode initialization', async () => {
    vi.stubEnv('VITE_BEEGAME_HTTPONLY_SESSIONS', '1');
    const fetchMock = vi.fn(async () => Response.json({
      authenticated: true,
      user: { id: 'cookie-user', email: 'cookie@example.com' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([
      initializeSupabaseSession(),
      initializeSupabaseSession(),
    ]);

    expect(first?.user.id).toBe('cookie-user');
    expect(second?.user.id).toBe('cookie-user');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session', { credentials: 'include' });
  });

  it('reports a frontend/backend secure-session flag mismatch', async () => {
    vi.stubEnv('VITE_BEEGAME_HTTPONLY_SESSIONS', '1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));

    await expect(initializeSupabaseSession()).rejects.toMatchObject({
      code: 'secure_session_not_configured',
      status: 404,
    });
  });

  it('coalesces concurrent HttpOnly refreshes into one server request', async () => {
    vi.stubEnv('VITE_BEEGAME_HTTPONLY_SESSIONS', '1');
    const fetchMock = vi.fn(async () => Response.json({
      authenticated: true,
      user: { id: 'cookie-user' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([
      refreshSupabaseSession(),
      refreshSupabaseSession(),
    ]);

    expect(first?.user.id).toBe('cookie-user');
    expect(second?.user.id).toBe('cookie-user');
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it('stores an invitation code in Supabase signup metadata', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const fetchMock = vi.fn(async () => Response.json({
      access_token: 'signup-access-token',
      expires_in: 3600,
      user: { id: 'user-2', email: 'new@example.com' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await signUpWithSupabasePassword({
      email: 'new@example.com',
      password: 'secret-password',
      displayName: 'New Player',
      invitationCode: ' BEE-ALPHA ',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/signup',
      expect.objectContaining({
        body: JSON.stringify({
          email: 'new@example.com',
          password: 'secret-password',
          data: {
            display_name: 'New Player',
            beegame_invitation_code: 'BEE-ALPHA',
          },
        }),
      }),
    );
  });

  it('refreshes an expired session instead of clearing it immediately', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'expired-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1000,
      user: { id: 'user-1', email: 'old@example.com' },
    }));
    const fetchMock = vi.fn(async () => Response.json({
      access_token: 'fresh-token',
      refresh_token: 'fresh-refresh-token',
      expires_in: 3600,
      user: { id: 'user-1', email: 'new@example.com' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    expect(getSupabaseAccessToken()).toBe('');
    const session = await refreshSupabaseSession();

    expect(session?.accessToken).toBe('fresh-token');
    expect(session?.refreshToken).toBe('fresh-refresh-token');
    expect(session?.user.email).toBe('new@example.com');
    expect(await getValidSupabaseAccessToken()).toBe('fresh-token');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/token?grant_type=refresh_token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'anon-key',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({
          refresh_token: 'refresh-token',
        }),
      }),
    );
  });

  it('clears the stored session only when refresh fails', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'expired-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1000,
      user: { id: 'user-1' },
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid refresh token', { status: 401 })));

    await expect(refreshSupabaseSession()).resolves.toBeNull();
    expect(localStorage.getItem('beegame_supabase_session')).toBeNull();
  });

  it('keeps the stored session and retries a transient refresh network failure', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'expired-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1000,
      user: { id: 'user-1' },
    }));
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(Response.json({
        access_token: 'fresh-token',
        refresh_token: 'fresh-refresh-token',
        expires_in: 3600,
        user: { id: 'user-1' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const refresh = refreshSupabaseSession();
      await vi.advanceTimersByTimeAsync(250);

      await expect(refresh).resolves.toMatchObject({ accessToken: 'fresh-token' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(localStorage.getItem('beegame_supabase_session')).toContain('fresh-token');
    } finally {
      vi.useRealTimers();
    }
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

  it('starts Supabase OAuth through the BeeGame invitation Edge Function when an invitation is provided', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const assign = vi.fn();
    const fetchMock = vi.fn(async () => Response.json({
      url: 'https://project.supabase.co/auth/v1/authorize?provider=github&nonce=nonce-1',
      nonce: 'nonce-1',
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      href: 'http://localhost:5173/',
      origin: 'http://localhost:5173',
      assign,
    });

    await signInWithSupabaseOAuth('github', { invitationCode: 'BEE-ALPHA' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/functions/v1/beegame-oauth-start',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'anon-key',
          authorization: 'Bearer anon-key',
          'content-type': 'application/json',
        }),
        body: expect.stringContaining('BEE-ALPHA'),
      }),
    );
    expect(assign).toHaveBeenCalledWith('https://project.supabase.co/auth/v1/authorize?provider=github&nonce=nonce-1');
    expect(JSON.parse(sessionStorage.getItem('beegame_supabase_oauth_pkce') || '{}')).toMatchObject({
      provider: 'github',
      invitationNonce: 'nonce-1',
    });
  });

  it('redeems an OAuth invitation nonce after consuming a PKCE callback', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const replaceState = vi.fn();
    const fetchMock = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/v1/token?grant_type=pkce')) {
        return Response.json({
          access_token: 'pkce-access-token',
          refresh_token: 'pkce-refresh-token',
          expires_in: 3600,
          user: { id: 'pkce-user', email: 'pkce@example.com' },
        });
      }
      if (url.endsWith('/rest/v1/rpc/beegame_redeem_oauth_invitation')) {
        return Response.json({ ok: true });
      }
      return new Response('unexpected url', { status: 500 });
    });
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
      provider: 'github',
      codeVerifier: 'stored-code-verifier',
      invitationNonce: 'nonce-1',
      createdAt: Date.now(),
    }));

    await expect(consumeSupabaseRedirectSession()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://project.supabase.co/rest/v1/rpc/beegame_redeem_oauth_invitation',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: 'anon-key',
          authorization: 'Bearer pkce-access-token',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({ p_nonce: 'nonce-1' }),
      }),
    );
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

  it('deduplicates concurrent OAuth authorization code consumption during app initialization', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    const replaceState = vi.fn();
    const resolveExchange: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveExchange.push(resolve);
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

    const first = consumeSupabaseRedirectSession();
    const second = consumeSupabaseRedirectSession();
    const responseBody = {
      access_token: 'pkce-access-token',
      refresh_token: 'pkce-refresh-token',
      expires_in: 3600,
      user: { id: 'pkce-user', email: 'pkce@example.com' },
    };
    for (const resolve of resolveExchange) {
      resolve(Response.json(responseBody));
    }

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getSupabaseAccessToken()).toBe('pkce-access-token');
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

  it('keeps expired sessions so refresh tokens can renew them', () => {
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'expired-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1000,
      user: { id: 'user-1' },
    }));

    expect(getSupabaseAccessToken()).toBe('');
    expect(localStorage.getItem('beegame_supabase_session')).toContain('refresh-token');
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
