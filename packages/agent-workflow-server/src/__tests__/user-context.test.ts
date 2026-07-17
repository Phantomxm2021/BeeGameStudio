import { describe, expect, test } from 'bun:test'
import {
  BeeGameAuthUnavailableError,
  createConfiguredUserResolver,
  createEnvTokenUserResolver,
  createSupabaseUserResolver,
  getBearerToken,
  hasBeeGamePermission,
  listBeeGamePermissions,
} from '../auth/user-context'

describe('BeeGame user context', () => {
  test('allows developers to delete their own project after route ownership validation', () => {
    expect(hasBeeGamePermission({ id: 'developer-1', role: 'developer' }, 'project.delete')).toBe(true)
    expect(hasBeeGamePermission({ id: 'viewer-1', role: 'viewer' }, 'project.delete')).toBe(false)
  })

  test('combines role permissions with explicit grants from an older database contract', () => {
    const owner = {
      id: 'owner-1',
      role: 'owner' as const,
      permissions: ['audit.read' as const],
    }

    expect(hasBeeGamePermission(owner, 'credits.admin')).toBe(true)
    expect(hasBeeGamePermission(owner, 'lifecycle.admin')).toBe(true)
    expect(listBeeGamePermissions(owner)).toEqual(expect.arrayContaining([
      'audit.read',
      'credits.admin',
      'lifecycle.admin',
    ]))
  })

  test('extracts bearer tokens from authorization headers', () => {
    const request = new Request('https://beegame.test/api/current-user', {
      headers: { authorization: 'Bearer access-token' },
    })

    expect(getBearerToken(request)).toBe('access-token')
  })

  test('creates a Supabase resolver from configured URL and anon key', async () => {
    const calls: Array<{ url: string; headers: Headers }> = []
    const resolver = createSupabaseUserResolver({
      url: 'https://project.supabase.co/',
      apiKey: 'anon-key',
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          headers: new Headers(init?.headers),
        })
        return Response.json({
          id: 'user_1',
          app_metadata: { beegame_role: 'developer' },
          user_metadata: {
            user_name: 'octo-maker',
            avatar_url: 'https://avatars.example.com/octo.png',
          },
        })
      },
    })

    const user = await resolver?.(
      new Request('https://beegame.test/api/current-user', {
        headers: { authorization: 'Bearer jwt-token' },
      }),
    )

    expect(user).toEqual({
      id: 'user_1',
      role: 'developer',
      displayName: 'octo-maker',
      avatarUrl: 'https://avatars.example.com/octo.png',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      'https://project.supabase.co/rest/v1/rpc/beegame_current_user_context',
    )
    expect(calls[0].headers.get('apikey')).toBe('anon-key')
    expect(calls[0].headers.get('authorization')).toBe('Bearer jwt-token')
  })

  test('falls back to viewer role metadata and rejects invalid Supabase tokens', async () => {
    const validResolver = createSupabaseUserResolver({
      url: 'https://project.supabase.co',
      apiKey: 'anon-key',
      fetchImpl: async () => Response.json({
        id: 'user_2',
        user_metadata: { role: 'viewer' },
      }),
    })
    const invalidResolver = createSupabaseUserResolver({
      url: 'https://project.supabase.co',
      apiKey: 'anon-key',
      fetchImpl: async () => new Response('unauthorized', { status: 401 }),
    })

    expect(
      await validResolver?.(
        new Request('https://beegame.test/api/current-user', {
          headers: { authorization: 'Bearer valid-token' },
        }),
      ),
    ).toEqual({ id: 'user_2', role: 'viewer' })
    expect(
      await invalidResolver?.(
        new Request('https://beegame.test/api/current-user', {
          headers: { authorization: 'Bearer invalid-token' },
        }),
      ),
    ).toBeUndefined()
  })

  test('reports Supabase user context transport failures as unavailable auth', async () => {
    const resolver = createSupabaseUserResolver({
      url: 'https://project.supabase.co',
      apiKey: 'anon-key',
      fetchImpl: async () => {
        throw new Error('unknown certificate verification error')
      },
    })

    await expect(
      resolver?.(
        new Request('https://beegame.test/api/current-user', {
          headers: { authorization: 'Bearer tls-failure-token' },
        }),
      ),
    ).rejects.toBeInstanceOf(BeeGameAuthUnavailableError)
  })

  test('recovers initial user resolution from a transient transport failure', async () => {
    let calls = 0
    const resolver = createSupabaseUserResolver({
      url: 'https://project.supabase.co',
      apiKey: 'anon-key',
      fetchImpl: async () => {
        calls += 1
        if (calls === 1) throw new Error('transient transport failure')
        return Response.json({ id: 'recovered-user', role: 'developer' })
      },
    })

    await expect(resolver?.(
      new Request('https://beegame.test/api/current-user', {
        headers: { authorization: 'Bearer recoverable-token' },
      }),
    )).resolves.toEqual(expect.objectContaining({
      id: 'recovered-user',
      role: 'developer',
    }))
    expect(calls).toBe(2)
  })

  test('aborts a stalled Supabase lookup and does not reuse the failed pending resolution', async () => {
    let calls = 0
    const resolver = createSupabaseUserResolver({
      url: 'https://project.supabase.co',
      apiKey: 'anon-key',
      resolveTimeoutMs: 10,
      fetchImpl: async (_url, init) => {
        calls += 1
        if (calls > 1) {
          return Response.json({ id: 'recovered-user', role: 'developer' })
        }
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'))
          }, { once: true })
        })
      },
    })
    const request = () => new Request('https://beegame.test/api/current-user', {
      headers: { authorization: 'Bearer recoverable-token' },
    })

    await expect(resolver?.(request())).rejects.toMatchObject({
      name: 'BeeGameAuthUnavailableError',
      reason: 'timeout',
    })
    await expect(resolver?.(request())).resolves.toEqual({
      id: 'recovered-user',
      role: 'developer',
    })
    expect(calls).toBe(2)
  })

  test('shares one Supabase context lookup across concurrent requests for the same token', async () => {
    let calls = 0
    const resolver = createSupabaseUserResolver({
      url: 'https://project.supabase.co',
      apiKey: 'anon-key',
      cacheTtlMs: 1_000,
      fetchImpl: async () => {
        calls += 1
        await Promise.resolve()
        return Response.json({ id: 'owner-user', role: 'owner' })
      },
    })
    const request = () => new Request('https://beegame.test/api/current-user', {
      headers: { authorization: 'Bearer shared-token' },
    })

    const [first, second] = await Promise.all([
      resolver?.(request()),
      resolver?.(request()),
    ])

    expect(calls).toBe(1)
    expect(first).toEqual({ id: 'owner-user', role: 'owner' })
    expect(second).toEqual(first)
  })

  test('serves a recently verified user while Supabase context revalidation is temporarily unavailable', async () => {
    let calls = 0
    let unavailable = false
    const resolver = createSupabaseUserResolver({
      url: 'https://project.supabase.co',
      apiKey: 'anon-key',
      cacheTtlMs: 0,
      staleTtlMs: 10_000,
      retryBaseMs: 10_000,
      fetchImpl: async () => {
        calls += 1
        if (unavailable) throw new Error('temporary network failure')
        return Response.json({ id: 'long-running-user', role: 'developer' })
      },
    })
    const request = () => new Request('https://beegame.test/api/current-user', {
      headers: { authorization: 'Bearer long-running-token' },
    })

    const verified = await resolver?.(request())
    unavailable = true
    const stale = await resolver?.(request())
    await waitFor(() => calls === 2)
    const duringBackoff = await resolver?.(request())

    expect(verified).toEqual({ id: 'long-running-user', role: 'developer' })
    expect(stale).toEqual(verified)
    expect(duringBackoff).toEqual(verified)
    expect(calls).toBe(2)
  })

  test('removes stale identity immediately when revalidation explicitly rejects the token', async () => {
    let calls = 0
    let invalid = false
    const resolver = createSupabaseUserResolver({
      url: 'https://project.supabase.co',
      apiKey: 'anon-key',
      cacheTtlMs: 0,
      staleTtlMs: 10_000,
      fetchImpl: async () => {
        calls += 1
        return invalid
          ? new Response('unauthorized', { status: 401 })
          : Response.json({ id: 'revoked-user', role: 'developer' })
      },
    })
    const request = () => new Request('https://beegame.test/api/current-user', {
      headers: { authorization: 'Bearer revoked-token' },
    })

    await resolver?.(request())
    invalid = true
    await resolver?.(request())
    await waitFor(() => calls === 2)
    await Bun.sleep(0)

    expect(await resolver?.(request())).toBeUndefined()
    expect(calls).toBe(3)
  })

  test('does not fall back to raw Supabase auth user when the BeeGame context RPC rejects access', async () => {
    const calls: string[] = []
    const resolver = createSupabaseUserResolver({
      url: 'https://project.supabase.co',
      apiKey: 'anon-key',
      fetchImpl: async (url) => {
        calls.push(String(url))
        if (String(url).endsWith('/rest/v1/rpc/beegame_current_user_context')) {
          return Response.json({ code: 'invitation_required' }, { status: 403 })
        }
        return Response.json({ id: 'raw-auth-user' })
      },
    })

    expect(
      await resolver?.(
        new Request('https://beegame.test/api/current-user', {
          headers: { authorization: 'Bearer blocked-token' },
        }),
      ),
    ).toBeUndefined()
    expect(calls).toEqual([
      'https://project.supabase.co/rest/v1/rpc/beegame_current_user_context',
    ])
  })

  test('keeps the model config owner separate from the project owner context', async () => {
    const resolver = createSupabaseUserResolver({
      url: 'https://project.supabase.co',
      apiKey: 'anon-key',
      fetchImpl: async () => Response.json({
        id: 'developer-user',
        role: 'developer',
        workspace_id: 'workspace-1',
        workspace_owner_id: 'workspace-owner',
        model_config_owner_id: 'platform-owner',
      }),
    })

    expect(
      await resolver?.(
        new Request('https://beegame.test/api/current-user', {
          headers: { authorization: 'Bearer valid-token' },
        }),
      ),
    ).toEqual({
      id: 'developer-user',
      role: 'developer',
      workspaceId: 'workspace-1',
      workspaceOwnerId: 'workspace-owner',
      modelConfigOwnerId: 'platform-owner',
    })
  })

  test('keeps the canonical account id separate from the login user id', async () => {
    const resolver = createSupabaseUserResolver({
      url: 'https://project.supabase.co',
      apiKey: 'anon-key',
      fetchImpl: async () => Response.json({
        id: 'oauth-user',
        account_id: 'canonical-email-account',
        role: 'developer',
        email: 'player@example.com',
      }),
    })

    expect(
      await resolver?.(
        new Request('https://beegame.test/api/current-user', {
          headers: { authorization: 'Bearer valid-token' },
        }),
      ),
    ).toEqual({
      id: 'oauth-user',
      accountId: 'canonical-email-account',
      role: 'developer',
      email: 'player@example.com',
    })
  })

  test('extracts OAuth profile metadata from identity data without granting owner by default', async () => {
    const resolver = createSupabaseUserResolver({
      url: 'https://project.supabase.co',
      apiKey: 'anon-key',
      fetchImpl: async () => Response.json({
        id: 'oauth-user',
        identities: [
          {
            identity_data: {
              email: 'oauth@example.com',
              name: 'OAuth Player',
              picture: 'https://avatars.example.com/oauth.png',
            },
          },
        ],
      }),
    })

    expect(
      await resolver?.(
        new Request('https://beegame.test/api/current-user', {
          headers: { authorization: 'Bearer oauth-token' },
        }),
      ),
    ).toEqual({
      id: 'oauth-user',
      role: 'viewer',
      email: 'oauth@example.com',
      displayName: 'OAuth Player',
      avatarUrl: 'https://avatars.example.com/oauth.png',
    })
  })

  test('prefers static token resolver over Supabase env resolver', async () => {
    const resolver = createConfiguredUserResolver({
      BEEGAME_AUTH_TOKENS: JSON.stringify({
        'static-token': { id: 'static-user', role: 'reviewer' },
      }),
      BEEGAME_SUPABASE_URL: 'https://project.supabase.co',
      BEEGAME_SUPABASE_ANON_KEY: 'anon-key',
    } as NodeJS.ProcessEnv)

    expect(
      await resolver?.(
        new Request('https://beegame.test/api/current-user', {
          headers: { authorization: 'Bearer static-token' },
        }),
      ),
    ).toEqual({ id: 'static-user', role: 'reviewer' })
  })

  test('accepts frontend Supabase env names for the runtime auth resolver', async () => {
    const originalFetch = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = (async (url, init) => {
      calls.push(String(url))
      expect(new Headers(init?.headers).get('apikey')).toBe('vite-anon-key')
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer supabase-token',
      )
      return Response.json({
        id: 'vite-user',
        role: 'developer',
        permissions: ['project.read', 'agent.send_message'],
      })
    }) as typeof fetch
    try {
      const resolver = createConfiguredUserResolver({
        VITE_SUPABASE_URL: 'https://vite-project.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'vite-anon-key',
      } as NodeJS.ProcessEnv)

      expect(
        await resolver?.(
          new Request('https://beegame.test/api/current-user', {
            headers: { authorization: 'Bearer supabase-token' },
          }),
        ),
      ).toEqual({
        id: 'vite-user',
        role: 'developer',
        permissions: ['project.read', 'agent.send_message'],
      })
      expect(calls).toEqual([
        'https://vite-project.supabase.co/rest/v1/rpc/beegame_current_user_context',
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('does not enable static bearer tokens in production by default', async () => {
    const resolver = createEnvTokenUserResolver({
      NODE_ENV: 'production',
      BEEGAME_AUTH_TOKENS: JSON.stringify({
        'static-token': { id: 'static-user', role: 'owner' },
      }),
    } as NodeJS.ProcessEnv)

    expect(resolver).toBeUndefined()
  })

  test('allows static bearer tokens in production only with explicit dev override', async () => {
    const resolver = createEnvTokenUserResolver({
      NODE_ENV: 'production',
      BEEGAME_ALLOW_DEV_AUTH_TOKENS: '1',
      BEEGAME_AUTH_TOKENS: JSON.stringify({
        'static-token': { id: 'static-user', role: 'reviewer' },
      }),
    } as NodeJS.ProcessEnv)

    expect(
      await resolver?.(
        new Request('https://beegame.test/api/current-user', {
          headers: { authorization: 'Bearer static-token' },
        }),
      ),
    ).toEqual({ id: 'static-user', role: 'reviewer' })
  })

  test('falls through to Supabase when static tokens are configured but do not match', async () => {
    const originalFetch = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = (async (url, init) => {
      calls.push(String(url))
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer supabase-token',
      )
      return Response.json({
        id: 'oauth-user',
        email: 'oauth@example.com',
        metadata: {
          global_name: 'OAuth Maker',
          image: 'https://avatars.example.com/oauth.png',
        },
      })
    }) as typeof fetch
    try {
      const resolver = createConfiguredUserResolver({
        BEEGAME_AUTH_TOKENS: JSON.stringify({
          'static-token': { id: 'static-user', role: 'reviewer' },
        }),
        BEEGAME_SUPABASE_URL: 'https://project.supabase.co',
        BEEGAME_SUPABASE_ANON_KEY: 'anon-key',
      } as NodeJS.ProcessEnv)

      expect(
        await resolver?.(
          new Request('https://beegame.test/api/current-user', {
            headers: { authorization: 'Bearer supabase-token' },
          }),
        ),
      ).toEqual({
        id: 'oauth-user',
        role: 'viewer',
        email: 'oauth@example.com',
        displayName: 'OAuth Maker',
        avatarUrl: 'https://avatars.example.com/oauth.png',
      })
      expect(calls).toEqual([
        'https://project.supabase.co/rest/v1/rpc/beegame_current_user_context',
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('uses owner only when Supabase metadata explicitly grants it', async () => {
    const resolver = createSupabaseUserResolver({
      url: 'https://project.supabase.co',
      apiKey: 'anon-key',
      fetchImpl: async () => Response.json({
        id: 'owner-user',
        app_metadata: { beegame_role: 'owner' },
      }),
    })

    expect(
      await resolver?.(
        new Request('https://beegame.test/api/current-user', {
          headers: { authorization: 'Bearer owner-token' },
        }),
      ),
    ).toEqual({ id: 'owner-user', role: 'owner' })
  })
})

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition')
    await Bun.sleep(1)
  }
}
