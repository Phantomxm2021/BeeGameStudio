import { describe, expect, test } from 'bun:test'

import {
  assertSmokeRuntimeEnv,
  summarizeRuntimeEnv,
} from '../beegame-smoke-runtime-env'

describe('BeeGame Supabase smoke runtime env', () => {
  test('fails when runtime env has no model provider configuration', () => {
    expect(() =>
      assertSmokeRuntimeEnv({
        BEEGAME_CONFIG_DIR: '/tmp/beegame',
      }, {
        modelConfigOwnerId: 'platform-owner',
      }),
    ).toThrow(
      'effective model config owner: platform-owner',
    )
  })

  test('accepts an OpenAI-compatible runtime env without exposing secrets in summary', () => {
    const env = {
      OPENAI_API_KEY: 'sk-secret',
      OPENAI_BASE_URL: 'https://llm.example/v1',
      BEEGAME_MODEL: 'balanced-model',
    }

    expect(() => assertSmokeRuntimeEnv(env)).not.toThrow()
    expect(summarizeRuntimeEnv(env)).toEqual({
      OPENAI_API_KEY: '<redacted>',
      OPENAI_BASE_URL: '<set>',
      BEEGAME_MODEL: '<set>',
    })
  })
})
