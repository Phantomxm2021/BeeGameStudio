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

  it('does not overwrite an explicit authorization header', () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', 'runtime-token');

    const headers = buildAuthHeaders({
      Authorization: 'Bearer explicit-token',
    });

    expect(headers.get('Authorization')).toBe('Bearer explicit-token');
  });
});
