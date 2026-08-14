import { describe, expect, test } from 'bun:test'
import { mergeRuntimeEnv } from './session-manager'

describe('selected native runtime provider', () => {
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
})
