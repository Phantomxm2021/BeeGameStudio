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
        BEEGAME_PROJECT_CONFIG_DIR_NAME: '.beegame',
      }, {
        modelConfigOwnerId: 'platform-owner',
      }),
    ).toThrow(
      'effective model config owner: platform-owner',
    )
  })

  test('accepts an OpenAI-compatible runtime env without exposing secrets in summary', () => {
    const env = {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_API_KEY: 'sk-secret',
      OPENAI_BASE_URL: 'https://llm.example/v1',
      OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
    }

    expect(() => assertSmokeRuntimeEnv(env)).not.toThrow()
    expect(summarizeRuntimeEnv(env)).toEqual({
      CLAUDE_CODE_USE_OPENAI: '<set>',
      OPENAI_API_KEY: '<redacted>',
      OPENAI_BASE_URL: '<set>',
      OPENAI_DEFAULT_SONNET_MODEL: '<set>',
    })
  })
})
