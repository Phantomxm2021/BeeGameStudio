import { describe, expect, test } from 'bun:test'
import { encryptSecret } from '@bee-game-studio/agent-workflow-server/security/secret-crypto'
import { createSupabaseResourceModelConfigResolver } from '../supabase-model-config-resolver'

describe('resource model config resolver', () => {
  const previousKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY

  test('loads the selected backend model config and maps it to the shared runtime contract', async () => {
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString('base64')
    try {
      const resolver = createSupabaseResourceModelConfigResolver({
        baseUrl: 'https://supabase.test',
        serviceRoleKey: 'service-key',
        fetchImpl: async () => Response.json([{
          id: 'model-1',
          owner_id: 'owner-1',
          provider: 'openai-compatible',
          base_url: 'https://model.test',
          api_key_ciphertext: encryptSecret('backend-secret', 'model-config:api-key'),
          models: { balanced: 'balanced-model' },
          is_default: true,
        }]),
      })

      await expect(resolver.resolve('owner-1')).resolves.toEqual({
        id: 'model-1',
        runtime: {
          modelType: 'openai',
          env: {
            CLAUDE_CODE_USE_OPENAI: '1',
            OPENAI_BASE_URL: 'https://model.test',
            OPENAI_API_KEY: 'backend-secret',
            OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
          },
        },
      })
    } finally {
      if (previousKey === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
      else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = previousKey
    }
  })

  test('requires the requested config to belong to the current resource user', async () => {
    const resolver = createSupabaseResourceModelConfigResolver({
      baseUrl: 'https://supabase.test',
      serviceRoleKey: 'service-key',
      fetchImpl: async () => Response.json([]),
    })
    await expect(resolver.resolve('owner-1', 'model-other')).rejects.toThrow('Selected model config was not found')
  })
})
