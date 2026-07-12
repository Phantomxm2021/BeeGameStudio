import { describe, expect, test } from 'bun:test'
import {
  createConfiguredUserResolver,
  createEnvTokenUserResolver,
  createSupabaseUserResolver,
  getBearerToken,
  hasBeeGamePermission,
} from '../auth/user-context'

describe('BeeGame user context', () => {
  test('allows developers to delete their own project after route ownership validation', () => {
    expect(hasBeeGamePermission({ id: 'developer-1', role: 'developer' }, 'project.delete')).toBe(true)
    expect(hasBeeGamePermission({ id: 'viewer-1', role: 'viewer' }, 'project.delete')).toBe(false)
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

  test('treats Supabase user context fetch failures as unresolved auth', async () => {
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
    ).resolves.toBeUndefined()
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
