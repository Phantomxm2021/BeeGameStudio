// Go requests keep the subscription's configured /zen/go route.
// Keep protocols separate: Responses and Google models are not supported here.
export const OPENCODE_GO_ID = 'personal-opencode-go'
export const OPENCODE_GO_PROFILES = {
  'anthropic-compatible': {
    label: 'Anthropic',
    baseUrl: 'https://opencode.ai/zen/go',
    model: 'minimax-m3',
  },
  'openai-compatible': {
    label: 'Chat Completions',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    model: 'kimi-k2.7-code',
  },
} as const
export type OpenCodeGoProvider = keyof typeof OPENCODE_GO_PROFILES
export type OpenCodeGoModels = Record<OpenCodeGoProvider, string[]>
export const OPENCODE_GO_CATALOG_URLS = ['https://opencode.ai/inference/go/v1/models', 'https://models.dev/api.json'] as const

/** IDs come from Go itself; protocol metadata uses the same registry as OpenCode.
 * Never infer a model's protocol from its name or make a paid probe request. */
export async function fetchOpenCodeGoModels(fetchImpl: typeof fetch = fetch): Promise<OpenCodeGoModels> {
  const [available, registry] = await Promise.all(OPENCODE_GO_CATALOG_URLS.map(async url => {
    const response = await fetchImpl(url, { headers: { 'User-Agent': 'BeeGameStudio/2.8.4', Accept: 'application/json' },
      signal: AbortSignal.timeout(8000), redirect: 'error' })
    if (!response.ok) throw new Error('OpenCode Go model catalog is unavailable')
    return response.json()
  }))
  if (!Array.isArray(available?.data) || !registry?.['opencode-go']?.models) throw new Error('Invalid OpenCode Go model catalog')
  const ids = new Set(available.data.flatMap((item: { id?: unknown }) => typeof item?.id === 'string' ? [item.id] : []))
  const provider = registry['opencode-go']
  const models: OpenCodeGoModels = { 'anthropic-compatible': [], 'openai-compatible': [] }
  for (const [id, value] of Object.entries(provider.models)) {
    if (!value || typeof value !== 'object') continue
    const model = value as { status?: string; provider?: { npm?: string } }
    if (!ids.has(id) || model.status === 'deprecated') continue
    const npm = model.provider?.npm ?? provider.npm
    if (npm === '@ai-sdk/anthropic') models['anthropic-compatible'].push(id)
    if (npm === '@ai-sdk/openai-compatible') models['openai-compatible'].push(id)
  }
  for (const list of Object.values(models)) list.sort()
  if (!Object.values(models).some(list => list.length)) throw new Error('No supported OpenCode Go models in catalog')
  return models
}
export function isOpenCodeGoProvider(value: unknown): value is OpenCodeGoProvider {
  return value === 'anthropic-compatible' || value === 'openai-compatible'
}

export function getOpenCodeGoProvider(baseUrl: string | undefined): OpenCodeGoProvider | undefined {
  return (Object.keys(OPENCODE_GO_PROFILES) as OpenCodeGoProvider[])
    .find(provider => OPENCODE_GO_PROFILES[provider].baseUrl === baseUrl?.replace(/\/$/, ''))
}

export function validateOpenCodeGoConfig(config: {
  provider: string; baseUrl?: string; model?: string; authMethods: readonly string[]
}, catalog?: OpenCodeGoModels): void {
  const provider = getOpenCodeGoProvider(config.baseUrl)
  if (!provider) return
  if (config.provider !== provider) throw new Error('Choose the protocol matching the OpenCode Go endpoint')
  if (config.authMethods.some(method => method !== 'platform' && method !== 'byok')) throw new Error('OpenCode Go requires API key authentication')
  if (!config.model?.trim() || (catalog && !catalog[provider].includes(config.model))) {
    throw new Error('Choose an OpenCode Go model supported by this protocol')
  }
}
