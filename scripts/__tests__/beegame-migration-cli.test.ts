import { describe, expect, test } from 'bun:test'

import {
  parseMigrationArgs,
  resolveMigrationAuthContext,
} from '../beegame-migration-cli'

describe('BeeGame local migration CLI', () => {
  test('uses migration email sign-in when no access token is configured', async () => {
    const requests: Array<{ url: string; body?: unknown }> = []
    const auth = await resolveMigrationAuthContext({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
      env: {
        BEEGAME_MIGRATION_EMAIL: 'owner@example.com',
        BEEGAME_MIGRATION_PASSWORD: 'secret-password',
      },
      fetchImpl: (async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        requests.push({
          url: String(input),
          ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
        })
        return Response.json({
          access_token: 'header.payload.signature',
          user: {
            id: 'owner-user',
            email: 'owner@example.com',
          },
        })
      }) as unknown as typeof fetch,
    })

    expect(auth).toEqual({
      authToken: 'header.payload.signature',
      userId: 'owner-user',
    })
    expect(requests).toEqual([
      {
        url: 'https://project.supabase.co/auth/v1/token?grant_type=password',
        body: {
          email: 'owner@example.com',
          password: 'secret-password',
        },
      },
    ])
  })

  test('can default the owner id to the signed-in migration user', async () => {
    const options = parseMigrationArgs([], {
      env: {
        BEEGAME_MIGRATION_AUTH_USER_ID: 'owner-user',
      },
      homeDir: '/Users/demo',
    })

    expect(options.ownerId).toBe('owner-user')
    expect(options.dataDir).toBe('/Users/demo/.beegame/dashboard')
    expect(options.apply).toBe(false)
    expect(options.includePlatformSettings).toBe(false)
  })

  test('requires an explicit flag to migrate platform settings', () => {
    const options = parseMigrationArgs(['--include-platform-settings'], {
      env: {
        BEEGAME_MIGRATION_AUTH_USER_ID: 'owner-user',
      },
      homeDir: '/Users/demo',
    })

    expect(options.includePlatformSettings).toBe(true)
  })

  test('uses only the user-level fallback when no migration data root is configured', () => {
    const options = parseMigrationArgs([], {
      env: {
        BEEGAME_MIGRATION_AUTH_USER_ID: 'owner-user',
      },
      homeDir: '/Users/demo',
    })

    expect(options.dataDir).toBe('/Users/demo/.beegame/dashboard')
  })

  test('extracts access token from copied Supabase localStorage JSON', async () => {
    const auth = await resolveMigrationAuthContext({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
      env: {
        BEEGAME_SUPABASE_ACCESS_TOKEN: JSON.stringify({
          currentSession: {
            access_token: 'header.payload.signature',
            user: { id: 'owner-user' },
          },
        }),
        BEEGAME_SUPABASE_USER_ID: 'owner-user',
      },
    })

    expect(auth).toEqual({
      authToken: 'header.payload.signature',
      userId: 'owner-user',
    })
  })

  test('rejects non-JWT migration access tokens before apply writes', async () => {
    await expect(resolveMigrationAuthContext({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
      env: {
        BEEGAME_SUPABASE_ACCESS_TOKEN: 'not-a-jwt-token',
      },
    })).rejects.toThrow('3 dot-separated parts')
  })
})
