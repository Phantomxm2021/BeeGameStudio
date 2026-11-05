import { imageConfigSchema, type ImageGenerationConfig } from './config'
import { ImageProviderError, type ImageGenerationProvider, type ImageRequest, type ImageResult } from './provider'

export class OpenAIImageProvider implements ImageGenerationProvider {
  constructor(private readonly request: (url: string, init: RequestInit) => Promise<Response> = fetch) {}

  protected endpoint(config: ImageGenerationConfig, input: ImageRequest): string {
    // Standard Images API routes separate generation from reference-based edits.
    // Preserve the configured origin/prefix and custom gateway endpoints.
    return input.referenceImage
      ? config.baseUrl.replace(/\/images\/generations\/?$/, '/images/edits')
      : config.baseUrl
  }
  protected headers(config: ImageGenerationConfig): Record<string, string> {
    return { authorization: 'Bearer ' + config.apiKey, 'content-type': 'application/json' }
  }
  protected body(config: ImageGenerationConfig, input: ImageRequest) {
    return { model: config.model, prompt: input.prompt, n: 1, output_format: 'png',
      size: input.size ?? config.size, quality: input.quality ?? config.quality, background: input.background ?? 'auto',
      ...(input.referenceImage ? { images: [{ image_url: `data:${input.referenceImage.mimeType};base64,${Buffer.from(input.referenceImage.bytes).toString('base64')}` }] } : {}) }
  }

  async generate(rawConfig: ImageGenerationConfig, input: ImageRequest): Promise<ImageResult> {
    const config = imageConfigSchema.parse(rawConfig)
    if (!config.apiKey) throw new ImageProviderError('Image provider API key is not configured', 'rejected')
    if (!input.prompt.trim() || input.prompt.length > 32000)
      throw new ImageProviderError('Image prompt must contain 1–32000 characters', 'rejected')
    const endpoint = this.endpoint(config, input)
    const started = Date.now()
    const redact = (text: string) => {
      for (const secret of [config.apiKey, config.upstreamApiKey, input.prompt, input.prompt.trim()]) {
        if (secret) {
          text = text.replaceAll(secret, '[redacted]')
          text = text.replaceAll(JSON.stringify(secret).slice(1, -1), '[redacted]')
        }
      }
      return text.replace(/Bearer\s+[^\s"<>]+/gi, 'Bearer [redacted]')
        .replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]')
        .replace(/[A-Za-z0-9+/=]{256,}/g, '[binary omitted]')
    }
    const logResponse = (body: unknown, response: Response) => {
      // Keep error messages/codes and HTML 404 responses useful, without printing
      // credentials, echoed requests or multi-megabyte image payloads.
      const serialized = JSON.stringify(body, (key, value) =>
        /^(authorization|api[_-]?key|access[_-]?token|token|cookie|prompt|revised_prompt|request|headers|b64_json|base64|image_url|images|input_references)$/i.test(key) ? '[redacted]' : value)
      const safe = redact(serialized ?? 'null')
      console.info('[image-generation]', {
        event: 'upstream-response', provider: config.provider, url: endpoint,
        model: config.model, status: response.status, elapsedMs: Date.now() - started,
        requestId: redact(response.headers.get('x-request-id') ?? '').slice(0, 200),
        contentType: redact(response.headers.get('content-type') ?? '').slice(0, 200),
        body: safe.slice(0, 8192), truncated: safe.length > 8192,
      })
    }
    const failed = (error: unknown, stage: 'request' | 'response', status?: number) => {
      const aborted = input.signal?.aborted === true || error instanceof Error && error.name === 'AbortError'
      const code = aborted ? 'request-aborted' : stage === 'request' ? 'network-error' : 'response-format-or-image'
      const describe = (value: unknown) => {
        if (!(value instanceof Error)) return { message: redact(String(value)).slice(0, 1024) }
        const code = (value as NodeJS.ErrnoException).code
        return { name: redact(value.name).slice(0, 100), message: redact(value.message).slice(0, 1024),
          ...(code !== undefined ? { code: redact(String(code)).slice(0, 100) } : {}) }
      }
      // Cancellation cannot prove that the upstream did not generate or charge.
      const failure = new ImageProviderError(aborted
        ? 'Image request was cancelled; provider result is unknown; do not automatically resubmit'
        : stage === 'request' ? 'Image provider result is unknown; do not automatically resubmit'
          : 'Image response could not be recovered; upstream cost may have occurred',
        'unknown', status, code, { cause: error })
      console.warn('[image-generation]', {
        event: 'upstream-failed', diagnosticId: failure.diagnosticId,
        provider: config.provider, url: endpoint, model: config.model,
        stage, code, status, elapsedMs: Date.now() - started, signalAborted: input.signal?.aborted === true,
        error: describe(error),
        ...(error instanceof Error && error.cause !== undefined ? { cause: describe(error.cause) } : {}),
        ...(input.signal?.aborted ? { abortReason: describe(input.signal.reason) } : {}),
      })
      return failure
    }
    let response: Response
    try {
      response = await this.request(endpoint, {
        method: 'POST',
        headers: this.headers(config),
        body: JSON.stringify(this.body(config, input)),
        signal: input.signal,
        redirect: 'error',
      })
    } catch (error) {
      throw failed(error, 'request')
    }
    if (!response.ok) {
      const raw = await response.text().catch(() => '[response body unavailable]')
      let body: unknown = raw
      try { body = JSON.parse(raw) } catch { /* Retain non-JSON gateway errors. */ }
      logResponse(body, response)
      throw new ImageProviderError('Image provider returned HTTP ' + response.status,
        response.status >= 500 || response.status === 408 ? 'unknown' : 'rejected', response.status, 'upstream-http')
    }
    try {
      const body = await response.json() as { data?: { b64_json?: string }[]; usage?: unknown }
      logResponse({ imageCount: body.data?.length ?? 0, usage: body.usage ?? null }, response)
      const encoded = body.data?.[0]?.b64_json
      if (body.data?.length !== 1 || !encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
        throw new Error('Invalid image response')
      const bytes = Buffer.from(encoded, 'base64')
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new Error('Expected PNG')
      return { bytes, mimeType: 'image/png', model: config.model,
        ...(response.headers.get('x-request-id') ? { providerRequestId: response.headers.get('x-request-id')! } : {}),
        usage: body.usage ?? null }
    } catch (error) {
      throw failed(error, 'response', response.status)
    }
  }
}
