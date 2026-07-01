import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  API_BASE_URL,
  authenticatedFetch,
  buildAuthHeaders,
  buildUnauthorizedMessage,
} from './apiClient';

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

  it('allows the dev/offline bearer token in production only with explicit override', async () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_API_AUTH_TOKEN', 'runtime-token');
    vi.stubEnv('VITE_BEEGAME_ALLOW_DEV_AUTH_TOKEN', '1');
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/current-user');

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer runtime-token');
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

    await authenticatedFetch('/api/credits/ledger');

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
      if (String(input).includes('/api/credits/ledger') && fetchMock.mock.calls.length === 1) {
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

    await authenticatedFetch('/api/credits/ledger');

    const replayHeaders = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    expect(replayHeaders.get('Authorization')).toBe('Bearer fresh-token');
  });

  it('does not overwrite an explicit authorization header', () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', 'runtime-token');

    const headers = buildAuthHeaders({
      Authorization: 'Bearer explicit-token',
    });

    expect(headers.get('Authorization')).toBe('Bearer explicit-token');
  });

  it('uses sign-in copy when no auth token is available', () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', '');

    expect(buildUnauthorizedMessage()).toBe('请先登录 BeeGame');
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
