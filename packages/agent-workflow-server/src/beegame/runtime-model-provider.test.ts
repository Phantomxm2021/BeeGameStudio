import { describe, expect, test } from 'bun:test'
import { mergeRuntimeEnv } from './session-manager'

describe('selected native runtime provider', () => {
  test.each(['0', 'false', 'off', 'no', ''])('disabled flags %j do not conflict with the selected endpoint', value => {
    for (const prefix of ['BGS_USE_', 'CLAUDE_CODE_USE_']) {
      expect(mergeRuntimeEnv(undefined, {
        ANTHROPIC_BASE_URL: 'https://fixture.example',
        ...Object.fromEntries(['OPENAI', 'GEMINI', 'GROK'].map(provider => [prefix + provider, value])),
      }).BEEGAME_MODEL_TYPE).toBe('anthropic')
      expect(mergeRuntimeEnv(undefined, { [prefix + 'GEMINI']: value }).BEEGAME_MODEL_TYPE).toBeUndefined()
    }
  })

  test.each(['openai', 'gemini', 'grok'])('enabled %s flag selects the provider', provider => {
    expect(mergeRuntimeEnv(undefined, { ['BGS_USE_' + provider.toUpperCase()]: 'ON' })
      .BEEGAME_MODEL_TYPE).toBe(provider)
  })

  test('genuinely conflicting providers still fail', () => {
    expect(() => mergeRuntimeEnv(undefined, { BGS_USE_OPENAI: '1', BGS_USE_GROK: '1' }))
      .toThrow('multiple providers')
  })

  test('projects the selected model type above inherited process configuration', () => {
    expect(
      mergeRuntimeEnv(
        {
          modelType: 'anthropic',
          env: { ANTHROPIC_BASE_URL: 'https://provider.example.test' },
        },
        { BEEGAME_MODEL_TYPE: 'openai' },
      ),
    ).toMatchObject({
      BEEGAME_MODEL_TYPE: 'anthropic',
      ANTHROPIC_BASE_URL: 'https://provider.example.test',
    })
  })

  test('derives the provider from the selected remote model environment', () => {
    expect(
      mergeRuntimeEnv(undefined, {
        ANTHROPIC_BASE_URL: 'https://provider.example.test',
        ANTHROPIC_AUTH_TOKEN: 'selected-token',
      }),
    ).toMatchObject({ BEEGAME_MODEL_TYPE: 'anthropic' })
  })
})
