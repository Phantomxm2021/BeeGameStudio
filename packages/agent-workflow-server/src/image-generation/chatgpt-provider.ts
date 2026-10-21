import { createHash } from 'node:crypto'
import { createChatGPTResponsesStream } from '../bgs/auth'
import { withBgsAccountUse } from '../bgs/account-activity'
import { CHATGPT_IMAGE_ENDPOINT, type ImageGenerationConfig } from './config'
import { ImageProviderError, type ImageGenerationProvider, type ImageRequest, type ImageResult } from './provider'

/** Explicit subscription adapter. Availability on this OAuth endpoint still
 * requires an authorized real test; no fallback to API keys or another account. */
export class ChatGPTSubscriptionImageProvider implements ImageGenerationProvider {
  constructor(private readonly configDirectory: string,
    private readonly request: typeof fetch = fetch) {}

  async generate(config: ImageGenerationConfig, input: ImageRequest): Promise<ImageResult> {
    return withBgsAccountUse(this.configDirectory, () => this.generateWithAccount(config, input))
  }

  private async generateWithAccount(config: ImageGenerationConfig, input: ImageRequest): Promise<ImageResult> {
    if (!['openai', 'chatgpt-subscription'].includes(config.provider) || config.baseUrl !== CHATGPT_IMAGE_ENDPOINT || !config.responseModel ||
        config.apiKey || config.upstreamApiKey || !input.prompt.trim() || input.prompt.length > 32000 || input.referenceImage)
      throw new ImageProviderError('Invalid subscription image configuration', 'rejected', undefined, 'subscription-configuration')
    input.signal?.throwIfAborted()
    const limits: Record<string, number> = {}
    let requestId: string | undefined
    let submitted = false
    const fetchOverride = (async (...args: Parameters<typeof fetch>) => {
      submitted = true
      const response = await this.request(...args)
      requestId = response.headers.get('x-request-id') ?? undefined
      for (const window of ['primary', 'secondary']) {
        for (const field of ['used-percent', 'window-minutes', 'reset-at']) {
          const header = `x-codex-${window}-${field}`, raw = response.headers.get(header)
          if (raw === null || !raw.trim()) continue
          const value = Number(raw)
          if (Number.isFinite(value) && value >= 0 && (field !== 'used-percent' || value <= 100)) limits[header] = value
        }
      }
      return response
    }) as typeof fetch
    try {
      const stream = await createChatGPTResponsesStream({ configDirectory: this.configDirectory, fetchOverride,
        signal: input.signal ?? new AbortController().signal,
        request: { model: config.responseModel, stream: true, store: false,
          instructions: 'Generate exactly one image using the image_generation tool.',
          input: [{ role: 'user', content: [{ type: 'input_text', text: input.prompt }] }],
          tools: [{ type: 'image_generation', model: config.model, action: 'generate', output_format: 'png', partial_images: 0,
            quality: input.quality ?? config.quality, size: input.size ?? config.size, background: input.background ?? 'auto' }],
          tool_choice: { type: 'image_generation' },
          prompt_cache_key: 'image-' + createHash('sha256').update(this.configDirectory).digest('hex'),
        } })
      const images = new Map<string, Record<string, unknown>>()
      let completed = false, usage: unknown = null
      const collect = (value: unknown) => {
        if (!value || typeof value !== 'object') return
        const item = value as Record<string, unknown>
        if (item.type !== 'image_generation_call') return
        if (typeof item.id !== 'string' || !item.id || item.status !== 'completed' || typeof item.result !== 'string')
          throw new Error('Incomplete image item')
        const previous = images.get(item.id)
        if (previous && previous.result !== item.result) throw new Error('Conflicting image output')
        images.set(item.id, { ...previous, ...item })
      }
      for await (const event of stream) {
        if (completed) throw new Error('Unexpected event after completion')
        if (event.type === 'response.error' || event.type === 'error' || event.type === 'response.failed' || event.type === 'response.incomplete')
          throw new Error('Subscription image response failed')
        if (event.type === 'response.output_item.done') collect(event.item)
        if (event.type === 'response.completed') {
          const response = event.response as Record<string, unknown> | undefined
          if (response?.status !== 'completed') throw new Error('Unconfirmed response completion')
          if (Array.isArray(response.output)) response.output.forEach(collect)
          usage = response.usage ?? null
          requestId ??= typeof response.id === 'string' ? response.id : undefined
          completed = true
        }
      }
      if (!completed || images.size !== 1) throw new Error('Expected one completed image')
      const image = [...images.values()][0]!, encoded = image.result as string
      if (encoded.length > 48 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid image encoding')
      const bytes = Buffer.from(encoded, 'base64')
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Expected PNG')
      return { bytes, mimeType: 'image/png', model: config.model, providerRequestId: requestId,
        usage: { source: 'chatgpt-subscription', response: usage, image: image.usage ?? null, limits } }
    } catch (error) {
      const status = (error as { status?: number }).status
      const rejected = !submitted || typeof status === 'number' && status >= 400 && status < 500 && status !== 408
      // Upstream errors can echo prompts or credentials. Only status/code leave
      // this adapter; aborted/unknown/partial results are never auto-resubmitted.
      throw new ImageProviderError('Subscription image request was not delivered', rejected ? 'rejected' : 'unknown', status,
        !submitted ? 'subscription-login-unavailable' : status === 429 ? 'subscription-limit'
          : status === 401 || status === 403 ? 'subscription-access-denied' : 'subscription-image-failed')
    }
  }
}
