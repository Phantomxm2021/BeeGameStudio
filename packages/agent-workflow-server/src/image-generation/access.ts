import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { ImageGenerationConfig } from './config'
import type { ImageGenerationService } from './service'
import { ImageAttemptError } from './attempt'
import { ImageServiceError } from './service'
import { createImagePromptRecord } from './prompt-record'
import { ImageConfigurationError } from './runtime-config'
import { ImageReferenceError, readProjectReferenceImage } from './reference-image'
import { CREDIT_FACE_VALUE_PER_USD, fixedImageChargeCreditsMicro } from './pricing'

const generation = z.object({
  requestId: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(32000),
  background: z.enum(['auto', 'opaque', 'transparent']).optional(),
  quality: z.enum(['auto', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  size: z.enum(['1024x1024', '1024x1536', '1536x1024']).optional(),
  referenceImagePath: z.string().trim().min(1).max(512).optional(),
}).strict()

/** Short-lived, user/project-scoped capability. The Agent never receives provider or billing keys. */
export function openImageGenerationAccess(input: {
  userId: string
  projectId: string
  workspacePath: string
  requiredQuality?: 'low'
  loadConfig: () => Promise<ImageGenerationConfig>
  service: ImageGenerationService
}) {
  const path = '/' + randomBytes(32).toString('hex') + '/generate'
  const record = createImagePromptRecord(input.workspacePath, path)
  let closed = false
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0, idleTimeout: 0, maxRequestBodySize: 256 * 1024,
    async fetch(request) {
      if (closed || request.headers.has('origin') || new URL(request.url).pathname !== path)
        return new Response('Not found', { status: 404 })
      if (request.method === 'GET') {
        try {
          const config = await input.loadConfig()
          const query = new URL(request.url).searchParams
          const requestedQuality = query.get('quality') ?? input.requiredQuality ?? config.quality
          const quality = input.requiredQuality && requestedQuality !== input.requiredQuality
            ? undefined : requestedQuality
          const size = query.get('size') ?? config.size
          let quotedCreditsMicro: number | null = null
          if (config.provider === 'cloudflare' && config.billing) {
            try { if (quality) quotedCreditsMicro = fixedImageChargeCreditsMicro(config.billing, quality, size) }
            catch { /* Unpriced variant is unavailable, without an upstream call. */ }
          }
          const available = Boolean(quality && config.apiKey && config.billing && (config.provider !== 'cloudflare' || quotedCreditsMicro !== null))
          return Response.json({ available,
            provider: config.provider, model: config.model, quality: input.requiredQuality ?? config.quality, size: config.size,
            referenceImageSupported: config.provider === 'cloudflare',
            ...(config.provider === 'cloudflare' ? { availableSizes: ['1024x1024', '1024x1536', '1536x1024'] } : {}),
            ...(config.provider === 'cloudflare' ? { quotedCreditsMicro,
              ...(config.billing && quotedCreditsMicro === null ? { unavailableReason: 'No fixed Credit price configured for this quality and size' } : {}) } : {}),
            maxRequestCredits: config.billing?.maxRequestCredits ?? null,
            creditFaceValuePerUsd: CREDIT_FACE_VALUE_PER_USD,
            modelPriceMultiplier: config.billing?.markupMultiplier ?? null },
          { headers: { 'cache-control': 'no-store' } })
        } catch {
          return Response.json({ error: 'Image generation configuration unavailable' }, { status: 503 })
        }
      }
      if (request.method !== 'POST') return new Response('POST required', { status: 405 })
      const parsed = generation.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: 'Expected requestId, prompt and optional background/quality/size/referenceImagePath' }, { status: 400 })
      if (input.requiredQuality && parsed.data.quality && parsed.data.quality !== input.requiredQuality)
        return Response.json({ error: `This delivery milestone requires quality ${input.requiredQuality}` }, { status: 422 })
      const normalizedRequest = { ...parsed.data,
        ...(input.requiredQuality ? { quality: input.requiredQuality } : {}) }
      let stage = 'configuration'
      let config: ImageGenerationConfig | undefined
      let recorded = false
      let recordOk = true
      try {
        const { requestId, referenceImagePath, ...imageRequest } = normalizedRequest
        config = await input.loadConfig()
        stage = 'reference-image'
        const referenceImage = referenceImagePath
          ? await readProjectReferenceImage(input.workspacePath, referenceImagePath) : undefined
        recordOk = record(normalizedRequest, config, { event: 'request-received',
          ...(referenceImage ? { referenceImageSha256: referenceImage.sha256 } : {}) })
        recorded = true
        stage = 'generation-or-billing'
        const result = await input.service.generate({ ownerId: input.userId, projectId: input.projectId,
          requestId, config, request: { ...imageRequest,
            ...(input.requiredQuality ? { quality: input.requiredQuality } : {}),
            ...(referenceImage ? { referenceImage } : {}) } })
        recordOk = record(normalizedRequest, config, { event: 'image-returned', model: result.model,
          providerRequestId: result.providerRequestId, mimeType: result.mimeType,
          note: result.billingState === 'pending'
            ? 'Image delivered; billing reconciliation pending. Reservation retained; do not regenerate.'
            : 'May be a recovered result; final file selection is recorded in Asset Manifest.' }) && recordOk
        return new Response(Buffer.from(result.bytes), { headers: {
          'content-type': result.mimeType, 'cache-control': 'no-store',
          ...(result.chargedCreditsMicro !== null ? { 'x-image-credits-micro': String(result.chargedCreditsMicro) } : {}),
          'x-image-billing-state': result.billingState,
          'x-image-prompt-record': recordOk ? 'recorded' : 'failed',
        } })
      } catch (error) {
        const attempt = error instanceof ImageAttemptError ? error : undefined
        const configuration = error instanceof ImageConfigurationError ? error : undefined
        const reference = error instanceof ImageReferenceError ? error : undefined
        const details = { stage: error instanceof ImageServiceError ? error.stage : stage,
          code: reference?.code ?? configuration?.code ?? attempt?.code ?? attempt?.reason
            ?? (error instanceof ImageServiceError ? error.stage : 'configuration-or-billing-failed'),
          upstreamStatus: attempt?.status, diagnosticId: configuration?.diagnosticId ?? attempt?.diagnosticId,
          ...(configuration?.facts ?? {}),
          replayed: attempt?.replayed ?? false, outcome: attempt?.reason }
        console.warn('[image-generation]', { event: 'delivery-failed', projectId: input.projectId, requestId: parsed.data.requestId,
          ...details })
        if (!recorded) recordOk = record(normalizedRequest, config, { event: 'request-received' })
        recordOk = record(normalizedRequest, config, { event: 'delivery-failed', ...details }) && recordOk
        // Expose structured facts, never raw upstream bodies, credentials or echoed prompts.
        return Response.json({ error: 'Image request not delivered. Replaying an unknown/rejected receipt does not resubmit upstream. Do not change requestId merely to retry; report the failure and diagnostic details.',
          requestId: parsed.data.requestId, ...details, promptRecord: recordOk ? 'recorded' : 'failed' },
          { status: reference ? 400 : error instanceof ImageServiceError && error.stage === 'price-unavailable' ? 422
            : attempt?.replayed || attempt?.reason === 'conflict' ? 409 : attempt ? 502 : 503 })
      }
    },
  })
  const endpoint = `http://127.0.0.1:${server.port}${path}`
  return {
    endpoint,
    instruction: [
      'Optional AI image generation is available with platform credentials and billing held by the host. Agent chooses whether, when and what to generate.',
      ...(input.requiredQuality ? [`For this delivery milestone, image quality is ${input.requiredQuality}; other quality requests are unavailable.`] : []),
      'Use the optional project asset command described in the current project context. Its cost command shows availability and, for Cloudflare, the exact fixed Credit price for the requested quality and size. Generate displays that price before reserving the same amount. Reuse one stable requestId for recovery; only an intentionally different artwork gets a new ID. Non-2xx responses are not images.',
      'Cloudflare GPT Image 2.5 Flare can generate a new image or edit a reference image. Its documented background options are auto, opaque and transparent; choose per asset rather than treating transparency as mandatory. It supports low, medium, high, xhigh, max or auto quality and 1024x1024, 1024x1536, 1536x1024 or auto size. This BGS capability outputs PNG and accepts at most one project reference image; the configured price and milestone may restrict quality and size. Inspect the returned image, including actual alpha when transparency matters; the model does not supply reliable atlas frame coordinates. Official provider details: https://developers.cloudflare.com/ai/models/openai/gpt-image-2.5-flare/',
      'For image editing, you may pass an existing project-relative PNG under assets/ as referenceImagePath; no visual board is required. The provider must support reference images; the cost command reports availability. Do not submit host paths or regenerate an unknown paid attempt.',
      'The host records requests and billing outcomes in assets/ai-generation-prompts.md; no manual maintenance is needed. Register only the actual selected file and hash in the Manifest.',
    ].join('\n'),
    close() {
      closed = true
      // Stop accepting new work, but do not discard an already-paid in-flight response.
      void server.stop(false)
    },
  }
}
