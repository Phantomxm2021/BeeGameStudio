import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';

import {
  API_BASE_URL,
  AUTHENTICATION_REQUIRED_EVENT,
  authenticatedFetch,
  buildAuthHeaders,
  buildApiUrlWithBase,
  buildUnauthorizedMessage,
  isAuthenticationServiceUnavailable,
} from './apiClient';
import apiClient from './apiClient';

describe('apiClient defaults', () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('uses same-origin requests by default', () => {
    expect(API_BASE_URL).toBe('');
  });

  it('keeps iframe preview paths on the configured API origin', () => {
    expect(buildApiUrlWithBase('/previews/session-1/', 'http://127.0.0.1:62174'))
      .toBe('http://127.0.0.1:62174/previews/session-1/');
    expect(buildApiUrlWithBase('/previews/session-1/', ''))
      .toBe('/previews/session-1/');
    expect(buildApiUrlWithBase('https://preview.example/session-1/', 'http://127.0.0.1:62174'))
      .toBe('https://preview.example/session-1/');
  });

  it('adds the dev/offline bearer token to fetch requests outside production', async () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', 'runtime-token');
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/current-user');

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer runtime-token');
  });

  it('ignores the dev/offline bearer token in production mode by default', async () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_API_AUTH_TOKEN', 'runtime-token');
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/current-user');

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBeNull();
  });

  it('never uses the dev/offline bearer token in production', async () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_API_AUTH_TOKEN', 'runtime-token');
    vi.stubEnv('VITE_BEEGAME_ALLOW_DEV_AUTH_TOKEN', '1');
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/current-user');

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBeNull();
  });

  it('does not mix the dev bearer token into HttpOnly cookie authentication', async () => {
    vi.stubEnv('VITE_BEEGAME_HTTPONLY_SESSIONS', '1');
    vi.stubEnv('VITE_API_AUTH_TOKEN', 'runtime-token');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/auth/session/refresh')) {
        return Response.json({ authenticated: true, user: { id: 'cookie-user' } });
      }
      if (fetchMock.mock.calls.filter(([value]) => String(value).includes('/api/current-user')).length === 1) {
        return new Response(null, { status: 401 });
      }
      return Response.json({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/current-user');

    const initialHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(initialHeaders.get('Authorization')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session/refresh', {
      method: 'POST',
      credentials: 'include',
    });
  });

  it('uses the Supabase session token when no deployment token is configured', async () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', '');
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'supabase-session-token',
      expiresAt: Date.now() + 3600_000,
      user: { id: 'user-1' },
    }));
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/current-user');

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer supabase-session-token');
  });

  it('uses the Supabase session token before the dev/offline bearer token', async () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', 'runtime-token');
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'supabase-session-token',
      expiresAt: Date.now() + 3600_000,
      user: { id: 'user-1' },
    }));
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/usage/events');

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer supabase-session-token');
  });

  it('refreshes an expired Supabase session token before fetch requests', async () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', '');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'expired-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1000,
      user: { id: 'user-1' },
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/auth/v1/token')) {
        return Response.json({
          access_token: 'fresh-token',
          refresh_token: 'fresh-refresh-token',
          expires_in: 3600,
          user: { id: 'user-1' },
        });
      }
      return Response.json({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/current-user');

    const apiHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(apiHeaders.get('Authorization')).toBe('Bearer fresh-token');
  });

  it('refreshes a Supabase session after a 401 even when the dev/offline token exists', async () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', 'runtime-token');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'stale-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600_000,
      user: { id: 'user-1' },
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/usage/events') && fetchMock.mock.calls.length === 1) {
        return new Response(JSON.stringify({ message: 'expired' }), { status: 401 });
      }
      if (String(input).includes('/auth/v1/token')) {
        return Response.json({
          access_token: 'fresh-token',
          refresh_token: 'fresh-refresh-token',
          expires_in: 3600,
          user: { id: 'user-1' },
        });
      }
      return Response.json({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/usage/events');

    const replayHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    expect(replayHeaders.get('Authorization')).toBe('Bearer fresh-token');
  });

  it('does not log out globally when a refreshed request is still unauthorized', async () => {
    vi.stubEnv('VITE_BEEGAME_HTTPONLY_SESSIONS', '1');
    vi.stubGlobal('window', new EventTarget());
    const authenticationRequired = vi.fn();
    window.addEventListener(AUTHENTICATION_REQUIRED_EVENT, authenticationRequired);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/auth/session/refresh')) {
        return Response.json({
          authenticated: true,
          expires_at: Date.now() + 3600_000,
          user: { id: 'cookie-user' },
        });
      }
      return new Response(JSON.stringify({ error: 'route-specific unauthorized' }), { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await authenticatedFetch('/api/projects/project-1/preview');

    expect(response.status).toBe(401);
    expect(authenticationRequired).not.toHaveBeenCalled();
    window.removeEventListener(AUTHENTICATION_REQUIRED_EVENT, authenticationRequired);
  });

  it('shares one cookie refresh across concurrent unauthorized requests', async () => {
    vi.stubEnv('VITE_BEEGAME_HTTPONLY_SESSIONS', '1');
    let refreshCalls = 0;
    const attempts = new Map<string, number>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/session/refresh')) {
        refreshCalls += 1;
        await Promise.resolve();
        return Response.json({
          authenticated: true,
          expires_at: Date.now() + 3600_000,
          user: { id: 'cookie-user' },
        });
      }
      const count = attempts.get(url) ?? 0;
      attempts.set(url, count + 1);
      return count === 0
        ? new Response(null, { status: 401 })
        : Response.json({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const responses = await Promise.all([
      authenticatedFetch('/api/projects/project-1/runtime-state'),
      authenticatedFetch('/api/projects/project-1/preview'),
    ]);

    expect(responses.every(response => response.ok)).toBe(true);
    expect(refreshCalls).toBe(1);
  });

  it('retries Axios cookie requests without an empty authorization header', async () => {
    vi.stubEnv('VITE_BEEGAME_HTTPONLY_SESSIONS', '1');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      authenticated: true,
      expires_at: Date.now() + 3600_000,
      user: { id: 'cookie-user' },
    })));
    let attempts = 0;
    const adapter = vi.fn(async config => {
      attempts += 1;
      if (attempts === 1) {
        throw new AxiosError(
          'Request failed with status code 401',
          AxiosError.ERR_BAD_REQUEST,
          config,
          {},
          {
            config,
            data: { message: 'expired' },
            headers: {},
            status: 401,
            statusText: 'Unauthorized',
          },
        );
      }
      return {
        config,
        data: { ok: true },
        headers: {},
        status: 200,
        statusText: 'OK',
      };
    });

    await apiClient.get('/api/current-user', { adapter });

    expect(adapter).toHaveBeenCalledTimes(2);
    expect(adapter.mock.calls[1]?.[0]?.headers?.Authorization).toBeUndefined();
  });

  it('does not overwrite an explicit authorization header', () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', 'runtime-token');

    const headers = buildAuthHeaders({
      Authorization: 'Bearer explicit-token',
    });

    expect(headers.get('Authorization')).toBe('Bearer explicit-token');
  });

  it('does not forward the application bearer token to an external URL', async () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', 'runtime-token');
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('https://external.example.test/resource');

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBeNull();
  });

  it('uses sign-in copy when no auth token is available', () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', '');

    expect(buildUnauthorizedMessage()).toBe('请先登录 BeeGame');
  });

  it('does not log expected hidden auth errors', async () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', '');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(apiClient.get('/api/current-user', {
      headers: { 'Hide-Error-Log': 'true' },
      adapter: async config => {
        throw new AxiosError(
          'Request failed with status code 401',
          AxiosError.ERR_BAD_REQUEST,
          config,
          {},
          {
            config,
            data: { message: 'authentication required' },
            headers: {},
            status: 401,
            statusText: 'Unauthorized',
          },
        );
      },
    })).rejects.toMatchObject({ status: 401 });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('classifies a temporary authentication outage without logging it as an API failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const request = apiClient.get('/api/projects/project-1/runtime-state', {
      adapter: async config => {
        throw new AxiosError(
          'Request failed with status code 503',
          AxiosError.ERR_BAD_RESPONSE,
          config,
          {},
          {
            config,
            data: {
              code: 'authentication_unavailable',
              message: 'Authentication service is temporarily unavailable',
              recoverable: true,
              retry_after_ms: 2_000,
            },
            headers: { 'retry-after': '2' },
            status: 503,
            statusText: 'Service Unavailable',
          },
        );
      },
    });

    await expect(request).rejects.toSatisfy((error: unknown) => {
      expect(error).toMatchObject({
        status: 503,
        code: 'authentication_unavailable',
        recoverable: true,
        retryAfterMs: 2_000,
      });
      return isAuthenticationServiceUnavailable(error);
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

function stubLocalStorage(): void {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    clear: vi.fn(() => {
      values.clear();
    }),
  });
}
