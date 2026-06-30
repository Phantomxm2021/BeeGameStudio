import { afterEach, describe, expect, test } from 'bun:test'
import { createSupabaseRuntimeEnvClientFromEnv } from '../supabase-runtime-env-client'

describe('SupabaseRuntimeEnvClient', () => {
  const originalFetch = globalThis.fetch
  const originalEnv = {
    BEEGAME_SUPABASE_URL: process.env.BEEGAME_SUPABASE_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    BEEGAME_SUPABASE_ANON_KEY: process.env.BEEGAME_SUPABASE_ANON_KEY,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
  }

  afterEach(() => {
    globalThis.fetch = originalFetch
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  test('accepts frontend Supabase env names for runtime env RPC access', async () => {
    delete process.env.BEEGAME_SUPABASE_URL
    delete process.env.SUPABASE_URL
    delete process.env.BEEGAME_SUPABASE_ANON_KEY
    delete process.env.SUPABASE_ANON_KEY
    process.env.VITE_SUPABASE_URL = 'https://vite-project.supabase.co'
    process.env.VITE_SUPABASE_ANON_KEY = 'vite-anon-key'

    const calls: Array<{ url: string; headers: Headers; body: unknown }> = []
    globalThis.fetch = (async (url, init) => {
      calls.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as unknown,
      })
      return Response.json({
        OPENAI_API_KEY: 'sk-secret',
        OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
      })
    }) as typeof fetch

    const client = createSupabaseRuntimeEnvClientFromEnv()
    expect(client).toBeDefined()
    await expect(client?.loadRuntimeEnv({
      userId: '00000000-0000-0000-0000-000000000001',
      dataDir: '/workspace',
      authToken: 'user-token',
    })).resolves.toEqual({
      OPENAI_API_KEY: 'sk-secret',
      OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      'https://vite-project.supabase.co/rest/v1/rpc/beegame_runtime_env',
    )
    expect(calls[0].headers.get('apikey')).toBe('vite-anon-key')
    expect(calls[0].headers.get('authorization')).toBe('Bearer user-token')
    expect(calls[0].body).toEqual({
      p_user_id: '00000000-0000-0000-0000-000000000001',
      p_data_dir: '/workspace',
    })
  })
})
