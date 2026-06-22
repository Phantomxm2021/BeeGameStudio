import { beforeEach, describe, expect, test } from 'bun:test'
import {
  createModelConfig,
  deleteModelConfig,
  exportModelConfigSnapshot,
  importModelConfigSnapshot,
  listModelConfigs,
  mapModelConfigToRuntime,
  resetAgentWorkflow,
  updateModelConfig,
} from '../index'

describe('agent workflow model configs', () => {
  const legacyRuntimeEnvPrefix = ['CLAU', 'DE_CODE_USE_'].join('')

  beforeEach(() => {
    resetAgentWorkflow()
  })

  test('masks API keys while preserving runtime mapping internally', () => {
    const config = createModelConfig('owner-a', {
      name: 'Primary LLM',
      provider: 'openai-compatible',
      baseUrl: 'https://llm.example.invalid/v1',
      apiKey: 'sk-dashboard-secret',
      models: { fast: 'fast-model', balanced: 'balanced-model' },
      isDefault: true,
    })

    expect(config.apiKey).toBeUndefined()
    expect(config.apiKeyPreview).toBe('sk-d...cret')
    expect(config.isDefault).toBe(true)

    expect(mapModelConfigToRuntime(config.id)).toEqual({
      modelType: 'openai',
      env: {
        [`${legacyRuntimeEnvPrefix}OPENAI`]: '1',
        OPENAI_BASE_URL: 'https://llm.example.invalid/v1',
        OPENAI_API_KEY: 'sk-dashboard-secret',
        OPENAI_DEFAULT_HAIKU_MODEL: 'fast-model',
        OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
      },
    })
  })

  test('keeps default configs scoped to one owner', () => {
    const first = createModelConfig('owner-a', {
      name: 'First',
      provider: 'gemini',
      apiKey: 'first-secret',
      models: { balanced: 'gemini-balanced' },
      isDefault: true,
    })
    const second = createModelConfig('owner-a', {
      name: 'Second',
      provider: 'grok',
      apiKey: 'second-secret',
      models: { balanced: 'grok-balanced' },
      isDefault: true,
    })
    const otherOwner = createModelConfig('owner-b', {
      name: 'Other',
      provider: 'anthropic-compatible',
      apiKey: 'other-secret',
      models: { balanced: 'beegame-balanced' },
      isDefault: true,
    })

    expect(listModelConfigs('owner-a')).toEqual([
      expect.objectContaining({ id: first.id, isDefault: false }),
      expect.objectContaining({ id: second.id, isDefault: true }),
    ])
    expect(listModelConfigs('owner-b')).toEqual([
      expect.objectContaining({ id: otherOwner.id, isDefault: true }),
    ])
  })

  test('updates and deletes model configs', () => {
    const config = createModelConfig('owner-a', {
      name: 'Editable',
      provider: 'anthropic-compatible',
      apiKey: 'anthropic-secret',
      models: { strong: 'strong-model' },
    })

    const updated = updateModelConfig(config.id, {
      name: 'Updated',
      apiKey: 'updated-secret',
      models: { strong: 'strong-next' },
    })

    expect(updated).toEqual(
      expect.objectContaining({
        name: 'Updated',
        apiKeyPreview: 'upda...cret',
        models: { strong: 'strong-next' },
      }),
    )
    expect(deleteModelConfig(config.id)).toBe(true)
    expect(listModelConfigs('owner-a')).toEqual([])
  })

  test('exports and imports model configs with runtime secrets intact', () => {
    const config = createModelConfig('owner-a', {
      name: 'Persisted',
      provider: 'openai-compatible',
      baseUrl: 'https://llm.example.invalid/v1',
      apiKey: 'persisted-secret',
      models: { balanced: 'balanced-model' },
      isDefault: true,
    })

    const snapshot = exportModelConfigSnapshot()
    resetAgentWorkflow()
    importModelConfigSnapshot(snapshot)

    expect(listModelConfigs('owner-a')).toEqual([
      expect.objectContaining({
        id: config.id,
        name: 'Persisted',
        apiKeyPreview: 'pers...cret',
        isDefault: true,
      }),
    ])
    expect(mapModelConfigToRuntime(config.id)).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          OPENAI_API_KEY: 'persisted-secret',
        }),
      }),
    )
  })
})
