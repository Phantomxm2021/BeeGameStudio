import { afterEach, describe, expect, test } from 'bun:test'
import {
  createSupabaseRuntimeEnvClientFromEnv,
  isSupabaseRuntimeEnvAuthError,
} from '../supabase-runtime-env-client'
import { encryptSecret } from '../security/secret-crypto'

describe('SupabaseRuntimeEnvClient', () => {
  const originalFetch = globalThis.fetch
  const originalEnv = {
    BEEGAME_SUPABASE_URL: process.env.BEEGAME_SUPABASE_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    BEEGAME_SUPABASE_ANON_KEY: process.env.BEEGAME_SUPABASE_ANON_KEY,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    BEEGAME_CONFIG_ENCRYPTION_KEY: process.env.BEEGAME_CONFIG_ENCRYPTION_KEY,
    BEEGAME_ALLOW_PLAINTEXT_SECRETS: process.env.BEEGAME_ALLOW_PLAINTEXT_SECRETS,
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

  test('decrypts model credentials returned by the runtime env RPC', async () => {
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
    delete process.env.BEEGAME_ALLOW_PLAINTEXT_SECRETS
    process.env.VITE_SUPABASE_URL = 'https://vite-project.supabase.co'
    process.env.VITE_SUPABASE_ANON_KEY = 'vite-anon-key'
    const encrypted = encryptSecret('sk-runtime-secret', 'model-config:api-key')

    globalThis.fetch = (async () => Response.json({
      OPENAI_API_KEY: encrypted,
      OPENAI_BASE_URL: 'https://llm.example/v1',
      OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
    })) as unknown as typeof fetch

    const client = createSupabaseRuntimeEnvClientFromEnv()
    await expect(client?.loadRuntimeEnv({
      userId: '00000000-0000-0000-0000-000000000001',
      dataDir: '/workspace',
      authToken: 'user-token',
    })).resolves.toEqual({
      OPENAI_API_KEY: 'sk-runtime-secret',
      OPENAI_BASE_URL: 'https://llm.example/v1',
      OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
    })
  })

  test('preserves structured auth status for refresh decisions', async () => {
    process.env.VITE_SUPABASE_URL = 'https://vite-project.supabase.co'
    process.env.VITE_SUPABASE_ANON_KEY = 'vite-anon-key'
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'expired' }), {
        status: 401,
        statusText: 'Unauthorized',
      })) as unknown as typeof fetch

    const client = createSupabaseRuntimeEnvClientFromEnv()
    const error = await client
      ?.loadRuntimeEnv({
        userId: '00000000-0000-0000-0000-000000000001',
        dataDir: '/workspace',
        authToken: 'expired-token',
      })
      .catch(value => value)

    expect(isSupabaseRuntimeEnvAuthError(error)).toBe(true)
  })
})
