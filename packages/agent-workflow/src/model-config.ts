import { randomUUID } from 'node:crypto'

import {
  resolveModelApiProtocol,
  type ModelApiProtocol,
  type ModelProviderKind,
} from './model-protocol'
export {
  resolveModelApiProtocol,
  type ModelApiProtocol,
  type ModelProviderKind,
} from './model-protocol'

export type ModelAuthMethod = 'platform' | 'byok' | 'chatgpt-subscription'

export function modelAuthMethods(
  provider: ModelProviderKind,
): ModelAuthMethod[] {
  return [
    'platform',
    'byok',
    ...(provider === 'openai-compatible'
      ? ['chatgpt-subscription' as const]
      : []),
  ]
}

export function validateModelAccess(
  provider: ModelProviderKind,
  methods: unknown,
): ModelAuthMethod[] {
  if (
    !['anthropic-compatible', 'openai-compatible', 'gemini', 'grok'].includes(
      provider,
    )
  ) {
    throw new Error('Unsupported model provider')
  }
  if (methods === undefined) return ['platform']
  if (
    !Array.isArray(methods) ||
    !methods.length ||
    methods.some(method => !modelAuthMethods(provider).includes(method))
  ) {
    throw new Error(
      'Choose at least one authentication method supported by this provider',
    )
  }
  return [...new Set(methods)]
}

export type PublicModelConfig = {
  published?: boolean
  authMethods?: ModelAuthMethod[]
  id: string
  ownerId: string
  name: string
  provider: ModelProviderKind
  apiProtocol?: ModelApiProtocol
  baseUrl?: string
  apiKeyPreview: string
  apiKey?: undefined
  model?: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

export type ModelConfigInput = {
  published?: boolean
  authMethods?: ModelAuthMethod[]
  name: string
  provider: ModelProviderKind
  apiProtocol?: ModelApiProtocol
  baseUrl?: string
  apiKey: string
  model?: string
  isDefault?: boolean
}

export type ModelConfigUpdate = Partial<
  Pick<
    ModelConfigInput,
    | 'name'
    | 'provider'
    | 'apiProtocol'
    | 'baseUrl'
    | 'apiKey'
    | 'model'
    | 'published'
    | 'authMethods'
  > & {
    isDefault: boolean
    clearSecret: boolean
  }
>

export type RuntimeModelConfig = {
  modelType: 'anthropic' | 'openai' | 'gemini' | 'grok'
  env: Record<string, string>
}

export type StoredModelConfigRuntimeInput = {
  provider: ModelProviderKind
  apiProtocol?: ModelApiProtocol
  baseUrl?: string
  apiKey: string
  model?: string
}

type StoredModelConfig = Omit<PublicModelConfig, 'apiKeyPreview' | 'apiKey'> & {
  apiKey: string
}

export type ModelConfigSnapshotRecord = Omit<
  StoredModelConfig,
  'createdAt' | 'updatedAt'
> & {
  createdAt: string
  updatedAt: string
}

const configs = new Map<string, StoredModelConfig>()

export function resetModelConfigs(): void {
  configs.clear()
}

export function exportModelConfigSnapshot(): ModelConfigSnapshotRecord[] {
  return [...configs.values()].map(config => ({
    published: config.published ?? true,
    authMethods: config.authMethods ?? ['platform'],
    id: config.id,
    ownerId: config.ownerId,
    name: config.name,
    provider: config.provider,
    apiProtocol: config.apiProtocol,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    apiKey: config.apiKey,
    model: readStoredModelSelection(config),
    isDefault: config.isDefault,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  }))
}

export function importModelConfigSnapshot(
  snapshot: ModelConfigSnapshotRecord[],
): void {
  configs.clear()
  for (const config of snapshot) {
    const methods = config.authMethods?.filter(method =>
      modelAuthMethods(config.provider).includes(method),
    ) ?? ['platform']
    resolveModelApiProtocol(config.provider, config.apiProtocol)
    const supported = methods.length > 0
    configs.set(config.id, {
      published: supported && (config.published ?? true),
      authMethods: methods.length ? methods : ['platform'],
      id: config.id,
      ownerId: config.ownerId,
      name: config.name,
      provider: config.provider,
      apiProtocol: config.apiProtocol,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      apiKey: config.apiKey,
      model: readStoredModelSelection(config),
      isDefault: config.isDefault,
      createdAt: new Date(config.createdAt),
      updatedAt: new Date(config.updatedAt),
    })
  }
}

export function createModelConfig(
  ownerId: string,
  input: ModelConfigInput,
): PublicModelConfig {
  const now = new Date()
  const record: StoredModelConfig = {
    published: input.published ?? true,
    authMethods: validateModelAccess(input.provider, input.authMethods),
    id: `llm_${randomUUID().replaceAll('-', '')}`,
    ownerId,
    name: input.name,
    provider: input.provider,
    apiProtocol: resolveModelApiProtocol(input.provider, input.apiProtocol),
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    apiKey: input.apiKey,
    model: input.model?.trim(),
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

  const methods = validateModelAccess(
    patch.provider ?? record.provider,
    patch.authMethods ?? record.authMethods,
  )
  const provider = patch.provider ?? record.provider
  const protocol = resolveModelApiProtocol(
    provider,
    patch.apiProtocol ??
      (provider === record.provider ? record.apiProtocol : undefined),
  )
  record.apiProtocol = protocol
  record.authMethods = methods
  if (patch.published !== undefined) record.published = patch.published
  if (patch.name !== undefined) record.name = patch.name
  if (patch.provider !== undefined) record.provider = patch.provider
  if (patch.baseUrl !== undefined) {
    if (patch.baseUrl) {
      record.baseUrl = patch.baseUrl
    } else {
      delete record.baseUrl
    }
  }
  if (patch.clearSecret) record.apiKey = ''
  else if (patch.apiKey !== undefined && patch.apiKey.trim())
    record.apiKey = patch.apiKey
  if (patch.model !== undefined) record.model = patch.model.trim()
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

  return mapStoredModelConfigToRuntime(record)
}

export function mapStoredModelConfigToRuntime(
  record: StoredModelConfigRuntimeInput,
): RuntimeModelConfig {
  const modelType =
    record.provider === 'anthropic-compatible'
      ? 'anthropic'
      : record.provider === 'openai-compatible'
        ? 'openai'
        : record.provider
  const prefix = {
    anthropic: 'ANTHROPIC',
    openai: 'OPENAI',
    gemini: 'GEMINI',
    grok: 'GROK',
  }[modelType]
  const baseUrl =
    record.baseUrl ||
    {
      anthropic: 'https://api.anthropic.com',
      openai: 'https://api.openai.com/v1',
      gemini: 'https://generativelanguage.googleapis.com/v1beta',
      grok: 'https://api.x.ai/v1',
    }[modelType]
  return {
    modelType,
    env: compactEnv({
      [prefix + '_BASE_URL']: baseUrl,
      [prefix + '_API_KEY']: record.apiKey,
      BEEGAME_API_PROTOCOL: resolveModelApiProtocol(
        record.provider,
        record.apiProtocol,
      ),
      BEEGAME_MODEL: record.model,
    }),
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
    published: record.published ?? true,
    authMethods: [...(record.authMethods ?? ['platform'])],
    id: record.id,
    ownerId: record.ownerId,
    name: record.name,
    provider: record.provider,
    apiProtocol: record.apiProtocol,
    ...(record.baseUrl ? { baseUrl: record.baseUrl } : {}),
    apiKeyPreview: maskApiKey(record.apiKey),
    model: record.model,
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

/** Read the selected model from saved records, including pre-single-model snapshots.
 * Legacy tiers are read only here; new API requests and writes use `model`. */
export function readStoredModelSelection(record: { model?: unknown; models?: unknown }): string | undefined {
  const previous = record.models && typeof record.models === 'object' && !Array.isArray(record.models)
    ? (record.models as Record<string, unknown>).balanced : undefined
  const value = record.model ?? previous
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
