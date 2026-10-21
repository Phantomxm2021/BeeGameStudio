import { beforeEach, describe, expect, test } from 'bun:test'
import {
  createModelConfig,
  deleteModelConfig,
  exportModelConfigSnapshot,
  importModelConfigSnapshot,
  listModelConfigs,
  mapModelConfigToRuntime,
  mapStoredModelConfigToRuntime,
  resetAgentWorkflow,
  updateModelConfig,
} from '../index'
import { OPENCODE_GO_PROFILES } from '../opencode-go'

describe('agent workflow model configs', () => {
  beforeEach(() => {
    resetAgentWorkflow()
  })

  test('preserves each provider protocol and supports explicit Responses without guessing from model names', () => {
    for (const [provider,modelType,protocol] of [['anthropic-compatible','anthropic','anthropic-messages'],['gemini','gemini','gemini'],['grok','grok','chat-completions'],['openai-compatible','openai','chat-completions']] as const) {
      expect(mapStoredModelConfigToRuntime({provider,apiKey:'fixture',models:{balanced:'selected'}})).toMatchObject({modelType,env:{BEEGAME_API_PROTOCOL:protocol,BEEGAME_MODEL:'selected'}})
    }
    expect(mapStoredModelConfigToRuntime({provider:'openai-compatible',apiProtocol:'responses',apiKey:'fixture',models:{}}).env.BEEGAME_API_PROTOCOL).toBe('responses')
    for (const [provider,profile] of Object.entries(OPENCODE_GO_PROFILES))
      expect(mapStoredModelConfigToRuntime({provider:provider as any,baseUrl:profile.baseUrl,apiKey:'fixture',models:profile.defaults}).env.BEEGAME_MODEL).toBe(profile.defaults.balanced)
    expect(()=>mapStoredModelConfigToRuntime({provider:'gemini',apiProtocol:'responses',apiKey:'fixture',models:{}})).toThrow('Unsupported')
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

    const runtime = mapModelConfigToRuntime(config.id)
    expect(runtime).toEqual({
      modelType: 'openai',
      env: {
        OPENAI_BASE_URL: 'https://llm.example.invalid/v1',
        OPENAI_API_KEY: 'sk-dashboard-secret',
        BEEGAME_API_PROTOCOL:'chat-completions',
        BGS_DEFAULT_FAST_MODEL: 'fast-model',
        BGS_DEFAULT_BALANCED_MODEL: 'balanced-model',
        BEEGAME_MODEL: 'balanced-model',
      },
    })
    expect(runtime?.env).not.toHaveProperty('BEEGAME_RUNTIME_MODEL_TYPE')
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
