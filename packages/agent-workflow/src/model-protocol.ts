export type ModelProviderKind =
  | 'anthropic-compatible'
  | 'openai-compatible'
  | 'gemini'
  | 'grok'

export type ModelApiProtocol =
  | 'responses'
  | 'chat-completions'
  | 'anthropic-messages'
  | 'gemini'

export function resolveModelApiProtocol(
  provider: ModelProviderKind,
  value?: unknown,
): ModelApiProtocol {
  const defaults: Record<ModelProviderKind, ModelApiProtocol> = {
    'openai-compatible': 'chat-completions',
    'anthropic-compatible': 'anthropic-messages',
    gemini: 'gemini',
    grok: 'chat-completions',
  }
  const protocol = value ?? defaults[provider]
  const supported =
    provider === 'anthropic-compatible'
      ? ['anthropic-messages']
      : provider === 'gemini'
        ? ['gemini']
        : ['responses', 'chat-completions']
  if (typeof protocol !== 'string' || !supported.includes(protocol))
    throw Error('Unsupported model API protocol for this provider')
  return protocol as ModelApiProtocol
}
