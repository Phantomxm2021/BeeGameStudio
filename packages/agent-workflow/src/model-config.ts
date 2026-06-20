import { randomUUID } from 'node:crypto'

export type ModelProviderKind =
  | 'anthropic-compatible'
  | 'openai-compatible'
  | 'gemini'
  | 'grok'

export type ModelTierMap = {
  fast?: string
  balanced?: string
  strong?: string
}

export type PublicModelConfig = {
  id: string
  ownerId: string
  name: string
  provider: ModelProviderKind
  baseUrl?: string
  apiKeyPreview: string
  apiKey?: undefined
  models: ModelTierMap
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

export type ModelConfigInput = {
  name: string
  provider: ModelProviderKind
  baseUrl?: string
  apiKey: string
  models: ModelTierMap
  isDefault?: boolean
}

export type ModelConfigUpdate = Partial<
  Pick<
    ModelConfigInput,
    'name' | 'provider' | 'baseUrl' | 'apiKey' | 'models'
  > & {
    isDefault: boolean
  }
>

export type RuntimeModelConfig = {
  modelType: 'anthropic' | 'openai' | 'gemini' | 'grok'
  env: Record<string, string>
}

type StoredModelConfig = Omit<PublicModelConfig, 'apiKeyPreview' | 'apiKey'> & {
  apiKey: string
}

const configs = new Map<string, StoredModelConfig>()

export function resetModelConfigs(): void {
  configs.clear()
}

export function createModelConfig(
  ownerId: string,
  input: ModelConfigInput,
): PublicModelConfig {
  const now = new Date()
  const record: StoredModelConfig = {
    id: `llm_${randomUUID().replaceAll('-', '')}`,
    ownerId,
    name: input.name,
    provider: input.provider,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    apiKey: input.apiKey,
    models: { ...input.models },
    isDefault: input.isDefault ?? listModelConfigs(ownerId).length === 0,
    createdAt: now,
    updatedAt: now,
  }

  if (record.isDefault) {
    clearOwnerDefaults(ownerId)
  }

  configs.set(record.id, record)
  return toPublicConfig(record)
}

export function getModelConfig(id: string): PublicModelConfig | undefined {
  const record = configs.get(id)
  return record ? toPublicConfig(record) : undefined
}

export function listModelConfigs(ownerId: string): PublicModelConfig[] {
  return [...configs.values()]
    .filter(config => config.ownerId === ownerId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(toPublicConfig)
}

export function updateModelConfig(
  id: string,
  patch: ModelConfigUpdate,
): PublicModelConfig | undefined {
  const record = configs.get(id)
  if (!record) return undefined

  if (patch.name !== undefined) record.name = patch.name
  if (patch.provider !== undefined) record.provider = patch.provider
  if (patch.baseUrl !== undefined) {
    if (patch.baseUrl) {
      record.baseUrl = patch.baseUrl
    } else {
      delete record.baseUrl
    }
  }
  if (patch.apiKey !== undefined) record.apiKey = patch.apiKey
  if (patch.models !== undefined) record.models = { ...patch.models }
  if (patch.isDefault !== undefined) {
    if (patch.isDefault) {
      clearOwnerDefaults(record.ownerId)
      record.isDefault = true
    } else {
      record.isDefault = false
    }
  }
  record.updatedAt = new Date()
  return toPublicConfig(record)
}

export function deleteModelConfig(id: string): boolean {
  return configs.delete(id)
}

export function mapModelConfigToRuntime(
  id: string,
): RuntimeModelConfig | undefined {
  const record = configs.get(id)
  if (!record) return undefined

  switch (record.provider) {
    case 'anthropic-compatible':
      return {
        modelType: 'anthropic',
        env: compactEnv({
          ANTHROPIC_BASE_URL: record.baseUrl,
          ANTHROPIC_AUTH_TOKEN: record.apiKey,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: record.models.fast,
          ANTHROPIC_DEFAULT_SONNET_MODEL: record.models.balanced,
          ANTHROPIC_DEFAULT_OPUS_MODEL: record.models.strong,
        }),
      }
    case 'openai-compatible':
      return {
        modelType: 'openai',
        env: compactEnv({
          CLAUDE_CODE_USE_OPENAI: '1',
          OPENAI_BASE_URL: record.baseUrl,
          OPENAI_API_KEY: record.apiKey,
          OPENAI_DEFAULT_HAIKU_MODEL: record.models.fast,
          OPENAI_DEFAULT_SONNET_MODEL: record.models.balanced,
          OPENAI_DEFAULT_OPUS_MODEL: record.models.strong,
        }),
      }
    case 'gemini':
      return {
        modelType: 'gemini',
        env: compactEnv({
          CLAUDE_CODE_USE_GEMINI: '1',
          GEMINI_BASE_URL: record.baseUrl,
          GEMINI_API_KEY: record.apiKey,
          GEMINI_DEFAULT_HAIKU_MODEL: record.models.fast,
          GEMINI_DEFAULT_SONNET_MODEL: record.models.balanced,
          GEMINI_DEFAULT_OPUS_MODEL: record.models.strong,
        }),
      }
    case 'grok':
      return {
        modelType: 'grok',
        env: compactEnv({
          CLAUDE_CODE_USE_GROK: '1',
          GROK_BASE_URL: record.baseUrl,
          GROK_API_KEY: record.apiKey,
          GROK_DEFAULT_HAIKU_MODEL: record.models.fast,
          GROK_DEFAULT_SONNET_MODEL: record.models.balanced,
          GROK_DEFAULT_OPUS_MODEL: record.models.strong,
        }),
      }
  }
}

function clearOwnerDefaults(ownerId: string): void {
  for (const config of configs.values()) {
    if (config.ownerId === ownerId) {
      config.isDefault = false
    }
  }
}

function toPublicConfig(record: StoredModelConfig): PublicModelConfig {
  return {
    id: record.id,
    ownerId: record.ownerId,
    name: record.name,
    provider: record.provider,
    ...(record.baseUrl ? { baseUrl: record.baseUrl } : {}),
    apiKeyPreview: maskApiKey(record.apiKey),
    models: { ...record.models },
    isDefault: record.isDefault,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '*'.repeat(apiKey.length)
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
}

function compactEnv(
  input: Record<string, string | undefined>,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value) env[key] = value
  }
  return env
}
