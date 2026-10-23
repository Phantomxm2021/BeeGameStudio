import type { ImageGenerationConfig } from './config'
import { ImageProviderError, type ImageGenerationProvider, type ImageRequest, type ImageResult } from './provider'

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
export type ImageRequestFetch = (url: string, init: RequestInit) => Promise<Response>

/** Cloudflare REST /ai/run: exact endpoint, nested input, URL image result. */
export class CloudflareImageProvider implements ImageGenerationProvider {
  private readonly resultRequest?: ImageRequestFetch

  constructor(
    private readonly request: ImageRequestFetch = fetch,
    resultRequest?: ImageRequestFetch,
  ) {
    // The configured Cloudflare endpoint is operator-owned. The image URL in
    // its response is provider data and must use a separately secured path.
    this.resultRequest = resultRequest
  }

  async generate(rawConfig: ImageGenerationConfig, input: ImageRequest): Promise<ImageResult> {
    const config = rawConfig
    const resultRequest = this.resultRequest
    if (!resultRequest)
      throw new ImageProviderError(
        'Cloudflare image result downloader is not configured',
        'rejected',
        undefined,
        'image-result-downloader-unconfigured',
      )
    if (!config.apiKey) throw new ImageProviderError('Cloudflare API token is not configured', 'rejected')
    if (!input.prompt.trim() || input.prompt.length > 32000)
      throw new ImageProviderError('Image prompt must contain 1–32000 characters', 'rejected')
    const model = config.model.includes('/') ? config.model : 'openai/' + config.model
    const endpoint = config.baseUrl
    if (new URL(endpoint).pathname.endsWith('/images/generations'))
      throw new ImageProviderError('Cloudflare native provider requires /ai/run; use a matching provider for OpenAI-compatible endpoints', 'rejected', undefined, 'protocol-config-mismatch')
    let response: Response
    try {
      response = await this.request(endpoint, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + config.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: {
          prompt: input.prompt, quality: input.quality ?? config.quality, size: input.size ?? config.size,
          output_format: 'png', background: input.background ?? 'auto',
          ...(input.referenceImage ? { images: [`data:image/png;base64,${Buffer.from(input.referenceImage.bytes).toString('base64')}`] } : {}),
        } }),
        signal: input.signal, redirect: 'error',
      })
    } catch {
      throw new ImageProviderError('Cloudflare result is unknown; do not automatically resubmit', 'unknown', undefined, 'network-error')
    }
    const raw = await response.text().catch(() => '')
    let body: any = raw
    try { body = JSON.parse(raw) } catch { /* Preserve non-JSON gateway errors in logs only. */ }
    console.info('[image-generation]', {
      event: 'upstream-response', provider: 'cloudflare', url: endpoint,
      model, status: response.status, body: [config.apiKey, config.upstreamApiKey, input.prompt].filter(Boolean).reduce(
        (text, secret) => text.split(secret).join('[redacted]'),
        JSON.stringify(body, (key, value) =>
          /^(authorization|api[_-]?key|access[_-]?token|token|cookie|prompt|image|images|b64_json|base64)$/i.test(key) ? '[redacted]' : value)).slice(0, 8192),
    })
    if (!response.ok)
      throw new ImageProviderError('Cloudflare returned HTTP ' + response.status,
        response.status >= 500 || response.status === 408 ? 'unknown' : 'rejected', response.status,
        Array.isArray(body?.errors) && body.errors.some((error: { message?: string }) =>
          typeof error.message === 'string' && /rejected by the safety system|safety_violations/i.test(error.message))
          ? 'safety-rejected' : 'upstream-http')
    // Cloudflare has returned both the documented top-level envelope and the
    // REST wrapper shape { result: { state, result: { image } } }.
    const envelope = body?.state === 'Completed' ? body : body?.result
    const imageUrl = typeof envelope?.result?.image === 'string' ? envelope.result.image : ''
    if (envelope?.state !== 'Completed' || !imageUrl)
      throw new ImageProviderError('Cloudflare returned no completed image', 'unknown', response.status, 'response-format')
    let parsedUrl: URL
    try {
      parsedUrl = new URL(imageUrl)
      if (!['https:', 'http:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password)
        throw new Error('invalid image URL')
    } catch {
      throw new ImageProviderError('Cloudflare returned an invalid image URL', 'unknown', response.status, 'image-url-invalid')
    }
    let imageResponse: Response
    try { imageResponse = await resultRequest(parsedUrl.toString(), { redirect: 'error', signal: input.signal }) }
    catch (error) {
      if (error instanceof ImageProviderError) throw error
      throw new ImageProviderError('Cloudflare image result could not be downloaded', 'unknown', response.status, 'image-download-network')
    }
    if (!imageResponse.ok)
      throw new ImageProviderError('Cloudflare image result returned HTTP ' + imageResponse.status, 'unknown', imageResponse.status, 'image-download-http')
    const bytes = Buffer.from(await imageResponse.arrayBuffer())
    if (!bytes.subarray(0, PNG.length).equals(PNG))
      throw new ImageProviderError('Cloudflare image result is not a PNG', 'unknown', response.status, 'image-not-png')
    return { bytes, mimeType: 'image/png', model: config.model,
      ...(response.headers.get('x-request-id') ? { providerRequestId: response.headers.get('x-request-id')! } : {}),
      // gatewayMetadata.keySource is routing metadata, not billable token usage.
      usage: body.usage ?? envelope.usage ?? null }
  }
}
