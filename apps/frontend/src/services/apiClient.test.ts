import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  API_BASE_URL,
  authenticatedFetch,
  buildAuthHeaders,
} from './apiClient';

describe('apiClient defaults', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses same-origin requests by default', () => {
    expect(API_BASE_URL).toBe('');
  });

  it('adds the runtime bearer token to fetch requests', async () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', 'runtime-token');
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await authenticatedFetch('/api/current-user');

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer runtime-token');
  });

  it('falls back to the Supabase session token when no deployment token is configured', async () => {
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

  it('does not overwrite an explicit authorization header', () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', 'runtime-token');

    const headers = buildAuthHeaders({
      Authorization: 'Bearer explicit-token',
    });

    expect(headers.get('Authorization')).toBe('Bearer explicit-token');
  });
});
