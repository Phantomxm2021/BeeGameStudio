import { describe, expect, test } from 'bun:test'
import {
  createConfiguredResourceUserResolver,
  createSupabaseResourceUserResolver,
  isLocalResourceFallbackAllowed,
} from '../auth'

describe('resource server authentication', () => {
  test('resolves permissions from the server-verified Supabase user context', async () => {
    const resolver = createSupabaseResourceUserResolver({
      url: 'https://project.supabase.co',
      apiKey: 'anon-key',
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe('https://project.supabase.co/rest/v1/rpc/beegame_current_user_context')
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-token')
        return Response.json({ id: 'user-1', role: 'developer', permissions: ['resources.manage'] })
      },
    })
    expect(await resolver?.(new Request('https://resource.local/api/resource-packs', {
      headers: { authorization: 'Bearer access-token' },
    }))).toEqual({ id: 'user-1', role: 'developer', permissions: ['resources.manage'] })
  })

  test('does not create a resolver without an anonymous Supabase key', () => {
    expect(createConfiguredResourceUserResolver({
      BEEGAME_SUPABASE_URL: 'https://project.supabase.co',
    } as NodeJS.ProcessEnv)).toBeUndefined()
  })

  test('allows local fallback only outside production unless explicitly enabled', () => {
    expect(isLocalResourceFallbackAllowed({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(true)
    expect(isLocalResourceFallbackAllowed({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false)
    expect(isLocalResourceFallbackAllowed({ NODE_ENV: 'production', BEEGAME_ALLOW_LOCAL_RESOURCE_AUTH: '1' } as NodeJS.ProcessEnv)).toBe(true)
  })
})
