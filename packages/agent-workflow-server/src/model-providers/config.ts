import {
  resolveModelApiProtocol,
  type ModelApiProtocol,
  type ModelProviderKind,
  type RuntimeModelConfig,
} from '@bee-game-studio/agent-workflow'

export type ProviderConfig = {
  protocol: ModelApiProtocol
  baseUrl: string
  apiKey: string
  model?: string
  sessionId?: string
  auth: 'bearer' | 'api-key'
}
export function providerConfig(
  env: Record<string, string>,
  selectedType?: RuntimeModelConfig['modelType'],
  options: { requireApiKey?: boolean } = {},
): ProviderConfig {
  const type = selectedType ?? env.BEEGAME_MODEL_TYPE ?? 'openai'
  const prefix = {
    openai: 'OPENAI',
    anthropic: 'ANTHROPIC',
    gemini: 'GEMINI',
    grok: 'GROK',
  }[type]
  if (!prefix) throw Error('Unsupported model provider')
  const protocol =
    env.BEEGAME_API_PROTOCOL ||
    {
      openai: 'responses',
      anthropic: 'anthropic-messages',
      gemini: 'gemini',
      grok: 'chat-completions',
    }[type]
  resolveModelApiProtocol(
    type === 'anthropic'
      ? 'anthropic-compatible'
      : type === 'openai'
        ? 'openai-compatible'
        : (type as ModelProviderKind),
    protocol,
  )
  const baseUrl =
    env[prefix + '_BASE_URL'] ||
    {
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com',
      gemini: 'https://generativelanguage.googleapis.com/v1beta',
      grok: 'https://api.x.ai/v1',
    }[type]!
  const apiKey =
    env[prefix + '_API_KEY'] ||
    (type === 'anthropic' ? env.ANTHROPIC_AUTH_TOKEN : '')
  if (!apiKey && options.requireApiKey !== false)
    throw Error('The selected provider has no API key')
  const url = new URL(baseUrl)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw Error('Invalid model provider endpoint')
  return {
    protocol: protocol as ModelApiProtocol,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model: env.BEEGAME_MODEL,
    auth: type === 'anthropic' && env.ANTHROPIC_API_KEY ? 'api-key' : 'bearer',
  }
}
