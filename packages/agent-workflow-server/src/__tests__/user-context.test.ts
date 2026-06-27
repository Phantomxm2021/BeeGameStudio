import { describe, expect, test } from 'bun:test'
import {
  createConfiguredUserResolver,
  createSupabaseUserResolver,
  getBearerToken,
} from '../auth/user-context'

describe('BeeGame user context', () => {
  test('extracts bearer tokens from authorization headers', () => {
    const request = new Request('https://beegame.test/api/current-user', {
      headers: { authorization: 'Bearer access-token' },
    })

    expect(getBearerToken(request)).toBe('access-token')
  })

  test('creates a Supabase resolver from configured URL and API key', async () => {
    const calls: Array<{ url: string; headers: Headers }> = []
    const resolver = createSupabaseUserResolver({
      url: 'https://project.supabase.co/',
      apiKey: 'service-role-key',
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
    expect(calls[0].url).toBe('https://project.supabase.co/auth/v1/user')
    expect(calls[0].headers.get('apikey')).toBe('service-role-key')
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
})
