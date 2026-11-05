import { z } from 'zod'
import { getOpenCodeGoProvider } from '@bee-game-studio/agent-workflow/opencode-go'
import type { ProviderConfig } from './config'
import { openCodeGoHeaders } from './requests'

const positiveTokens = z.number().int().positive()
const modelId = z.object({ id: z.string() })
const catalog = z.object({ data: z.array(z.unknown()) })
const metadata = z.object({
  limit: z.object({ output: z.unknown().optional() }).nullish(),
  max_output_tokens: z.unknown().optional(),
  max_completion_tokens: z.unknown().optional(),
  max_tokens: z.unknown().optional(),
  outputTokenLimit: z.unknown().optional(),
})

type OutputBudget = { tokens?: number; unavailable?: string }

/** One lazy metadata read per connection/model, using the bridge's approved
 * transport. A model capability is a ceiling, not a requested output length.
 * Missing metadata keeps the existing provider semantics; never guess from a
 * name, context window, another provider's registry, or the CLI fallback. */
export function providerOutputBudget(config: ProviderConfig, request: typeof fetch, signal: AbortSignal) {
  const cache = new Map<string, Promise<OutputBudget>>()
  let listing: Promise<unknown> | undefined
  async function read(url: string): Promise<unknown> {
    const headers = new Headers({ Accept: 'application/json', ...openCodeGoHeaders(config) })
    if (config.protocol === 'gemini') headers.set('x-goog-api-key', config.apiKey)
    else if (config.protocol === 'anthropic-messages') {
      headers.set(config.auth === 'api-key' ? 'x-api-key' : 'authorization',
        config.auth === 'api-key' ? config.apiKey : 'Bearer ' + config.apiKey)
      headers.set('anthropic-version', '2023-06-01')
    } else headers.set('authorization', 'Bearer ' + config.apiKey)
    const response = await request(url, { headers, redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) })
    if (!response.ok) {
      await response.body?.cancel()
      throw Error('http_' + response.status)
    }
    return response.json()
  }
  async function load(model: string): Promise<OutputBudget> {
    let value: unknown
    try {
      if (config.protocol === 'gemini') {
        value = await read(config.baseUrl + '/models/' + model.replace(/^models\//, '').split('/').map(encodeURIComponent).join('/'))
      } else if (config.protocol === 'anthropic-messages' && !getOpenCodeGoProvider(config.baseUrl)) {
        value = await read(config.baseUrl + (/\/v1$/.test(config.baseUrl) ? '' : '/v1') + '/models/' + encodeURIComponent(model))
      } else {
        listing ??= read(config.baseUrl + (config.protocol === 'anthropic-messages' && !/\/v1$/.test(config.baseUrl) ? '/v1' : '') + '/models')
        const parsed = catalog.safeParse(await listing)
        if (!parsed.success) return { unavailable: 'invalid_catalog' }
        value = parsed.data.data.find(item => {
          const parsedId = modelId.safeParse(item)
          return parsedId.success && parsedId.data.id === model
        })
        if (value === undefined) return { unavailable: 'model_not_listed' }
      }
    } catch (error) {
      // Metadata is optional external I/O. Its failure must be visible without
      // turning an unavailable catalog into a new generation gate or retry.
      if (signal.aborted) throw error
      return { unavailable: error instanceof SyntaxError ? 'invalid_catalog' : 'catalog_unavailable' }
    }
    const parsed = metadata.safeParse(value)
    if (!parsed.success) return { unavailable: 'invalid_model_metadata' }
    const entry = parsed.data
    const candidate = config.protocol === 'gemini' ? entry.outputTokenLimit
      : entry.limit?.output ?? entry.max_output_tokens ?? entry.max_completion_tokens ??
        (config.protocol === 'anthropic-messages' ? entry.max_tokens : undefined)
    if (candidate == null) return { unavailable: 'output_limit_not_advertised' }
    const tokens = positiveTokens.safeParse(candidate)
    return tokens.success ? { tokens: tokens.data } : { unavailable: 'invalid_output_limit' }
  }
  return (model: string): Promise<OutputBudget> => {
    let pending = cache.get(model)
    if (!pending) { pending = load(model); cache.set(model, pending) }
    return pending
  }
}
