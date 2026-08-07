import {
  mapStoredModelConfigToRuntime,
  type RuntimeModelConfig,
  type ModelProviderKind,
  type ModelTierMap,
} from '@bee-game-studio/agent-workflow'
import { decryptSecret } from '@bee-game-studio/agent-workflow-server/security/secret-crypto'

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type ModelConfigRow = {
  id: string
  owner_id: string
  provider: string
  base_url: string | null
  api_key_ciphertext: string | null
  models: Record<string, unknown>
  is_default: boolean
}

export type ResourceModelConfigResolver = {
  resolve(ownerId: string, requestedId?: string): Promise<{ id: string; runtime: RuntimeModelConfig }>
}

export function createSupabaseResourceModelConfigResolver(options: {
  baseUrl: string
  serviceRoleKey: string
  fetchImpl?: FetchImplementation
}): ResourceModelConfigResolver {
  const fetchImpl = options.fetchImpl ?? fetch
  const rest = `${options.baseUrl.replace(/\/+$/, '')}/rest/v1`
  const headers = {
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
  }

  return {
    async resolve(ownerId, requestedId) {
      const ownerFilter = `owner_id=eq.${encodeURIComponent(ownerId)}`
      const idFilter = requestedId ? `&id=eq.${encodeURIComponent(requestedId)}` : ''
      const response = await fetchImpl(
        `${rest}/beegame_model_configs?${ownerFilter}${idFilter}&select=id,owner_id,provider,base_url,api_key_ciphertext,models,is_default&order=is_default.desc,updated_at.desc&limit=1`,
        { headers },
      )
      if (!response.ok) throw new Error(`Model config lookup failed (${response.status})`)
      const rows = (await response.json()) as unknown
      if (!Array.isArray(rows) || !rows[0] || typeof rows[0] !== 'object' || Array.isArray(rows[0])) {
        throw new Error(requestedId ? 'Selected model config was not found for the current user' : 'No model config is configured for the current user')
      }
      const row = rows[0] as ModelConfigRow
      if (row.owner_id !== ownerId || typeof row.id !== 'string' || !row.id.trim()) {
        throw new Error('Selected model config ownership is invalid')
      }
      const provider = parseProvider(row.provider)
      const models = parseModelTierMap(row.models)
      const apiKey = row.api_key_ciphertext
        ? decryptSecret(row.api_key_ciphertext, 'model-config:api-key')
        : ''
      const runtime = mapStoredModelConfigToRuntime({
        provider,
        ...(row.base_url ? { baseUrl: row.base_url } : {}),
        apiKey,
        models,
      })
      if (!Object.keys(runtime.env).length) throw new Error('Selected model config has no runtime settings')
      return { id: row.id, runtime }
    },
  }
}

function parseProvider(value: unknown): ModelProviderKind {
  if (value === 'anthropic-compatible' || value === 'openai-compatible' || value === 'gemini' || value === 'grok') return value
  throw new Error('Selected model config provider is unsupported')
}

function parseModelTierMap(value: unknown): ModelTierMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  return {
    ...(typeof record.fast === 'string' && record.fast.trim() ? { fast: record.fast.trim() } : {}),
    ...(typeof record.balanced === 'string' && record.balanced.trim() ? { balanced: record.balanced.trim() } : {}),
    ...(typeof record.strong === 'string' && record.strong.trim() ? { strong: record.strong.trim() } : {}),
  }
}
