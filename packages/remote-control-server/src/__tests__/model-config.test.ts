import { describe, test, expect, beforeEach } from 'bun:test'
import {
  createModelConfig,
  deleteModelConfig,
  getDefaultModelConfig,
  getModelConfig,
  listModelConfigs,
  mapModelConfigToRuntime,
  resetModelConfigs,
  updateModelConfig,
} from '../services/model-config'

describe('model config service', () => {
  beforeEach(() => {
    resetModelConfigs()
  })

  test('creates a masked default OpenAI-compatible config', () => {
    const config = createModelConfig('local-user', {
      name: 'OpenRouter',
      provider: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test-secret',
      models: {
        fast: 'openai/gpt-4.1-mini',
        balanced: 'anthropic/claude-sonnet-4',
        strong: 'anthropic/claude-opus-4',
      },
      isDefault: true,
    })

    expect(config.id).toMatch(/^llm_/)
    expect(config.ownerId).toBe('local-user')
    expect(config.apiKeyPreview).toBe('sk-t...cret')
    expect(config.apiKey).toBeUndefined()
    expect(getDefaultModelConfig('local-user')?.id).toBe(config.id)
  })

  test('keeps only one default config per owner', () => {
    const first = createModelConfig('local-user', {
      name: 'First',
      provider: 'anthropic-compatible',
      apiKey: 'first-secret',
      models: {},
      isDefault: true,
    })
    const second = createModelConfig('local-user', {
      name: 'Second',
      provider: 'gemini',
      apiKey: 'second-secret',
      models: { balanced: 'gemini-2.5-pro' },
      isDefault: true,
    })

    expect(getModelConfig(first.id)?.isDefault).toBe(false)
    expect(getDefaultModelConfig('local-user')?.id).toBe(second.id)
  })

  test('updates config without exposing the stored API key', () => {
    const config = createModelConfig('local-user', {
      name: 'Provider',
      provider: 'openai-compatible',
      apiKey: 'sk-original',
      models: {},
      isDefault: true,
    })

    const updated = updateModelConfig(config.id, {
      name: 'Provider Updated',
      apiKey: 'sk-replacement',
    })

    expect(updated?.name).toBe('Provider Updated')
    expect(updated?.apiKeyPreview).toBe('sk-r...ment')
    expect(updated?.apiKey).toBeUndefined()
  })

  test('lists configs by owner only', () => {
    createModelConfig('alice', {
      name: 'Alice',
      provider: 'openai-compatible',
      apiKey: 'alice-secret',
      models: {},
      isDefault: true,
    })
    createModelConfig('bob', {
      name: 'Bob',
      provider: 'gemini',
      apiKey: 'bob-secret',
      models: {},
      isDefault: true,
    })

    expect(listModelConfigs('alice').map(c => c.name)).toEqual(['Alice'])
  })

  test('maps OpenAI-compatible config to existing runtime env names', () => {
    const config = createModelConfig('local-user', {
      name: 'OpenAI Compat',
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'sk-secret',
      models: {
        fast: 'fast-model',
        balanced: 'balanced-model',
        strong: 'strong-model',
      },
      isDefault: true,
    })

    expect(mapModelConfigToRuntime(config.id)).toEqual({
      modelType: 'openai',
      env: {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'https://api.example.test/v1',
        OPENAI_API_KEY: 'sk-secret',
        OPENAI_DEFAULT_HAIKU_MODEL: 'fast-model',
        OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
        OPENAI_DEFAULT_OPUS_MODEL: 'strong-model',
      },
    })
  })

  test('deletes configs and clears default lookup', () => {
    const config = createModelConfig('local-user', {
      name: 'Delete Me',
      provider: 'grok',
      apiKey: 'grok-secret',
      models: {},
      isDefault: true,
    })

    expect(deleteModelConfig(config.id)).toBe(true)
    expect(getModelConfig(config.id)).toBeUndefined()
    expect(getDefaultModelConfig('local-user')).toBeUndefined()
  })
})
