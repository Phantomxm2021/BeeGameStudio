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

/** New connections prefer Responses; missing protocols on saved legacy records
 * still resolve through their original provider default above. */
export function defaultModelApiProtocol(provider: ModelProviderKind): ModelApiProtocol {
  return provider === 'openai-compatible' || provider === 'grok'
    ? 'responses'
    : resolveModelApiProtocol(provider)
}


/** A URL path edit stays on the same credential recipient. Incomplete settings
 * input cannot qualify for reuse; undefined URLs retain legacy default binding. */
export function sameModelEndpointOrigin(previous: string | undefined, next: string | undefined): boolean {
  if (previous === undefined || next === undefined) return previous === next
  try {
    const before = new URL(previous), after = new URL(next)
    return before.protocol === 'https:' && after.protocol === 'https:' && before.origin === after.origin
  } catch {
    return false
  }
}
