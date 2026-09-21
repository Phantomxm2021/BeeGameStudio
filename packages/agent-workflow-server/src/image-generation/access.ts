import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { ImageGenerationConfig } from './config'
import type { ImageGenerationService } from './service'
import { ImageAttemptError } from './attempt'
import { ImageServiceError } from './service'
import { createImagePromptRecord } from './prompt-record'
import { ImageConfigurationError } from './runtime-config'

const generation = z.object({
  requestId: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(32000),
  background: z.enum(['auto', 'opaque', 'transparent']).optional(),
}).strict()

/** Short-lived, user/project-scoped capability. The Agent never receives provider or billing keys. */
export function openImageGenerationAccess(input: {
  userId: string
  projectId: string
  workspacePath: string
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
      if (request.method !== 'POST') return new Response('POST required', { status: 405 })
      const parsed = generation.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: 'Expected requestId, prompt and optional background' }, { status: 400 })
      let stage = 'configuration'
      let config: ImageGenerationConfig | undefined
      let recorded = false
      let recordOk = true
      try {
        const { requestId, ...imageRequest } = parsed.data
        config = await input.loadConfig()
        recordOk = record(parsed.data, config, { event: 'request-received' })
        recorded = true
        stage = 'generation-or-billing'
        const result = await input.service.generate({ ownerId: input.userId, projectId: input.projectId,
          requestId, config, request: imageRequest })
        recordOk = record(parsed.data, config, { event: 'image-returned', model: result.model,
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
        const details = { stage: error instanceof ImageServiceError ? error.stage : stage,
          code: configuration?.code ?? attempt?.code ?? attempt?.reason ?? 'configuration-or-billing-failed',
          upstreamStatus: attempt?.status, diagnosticId: configuration?.diagnosticId ?? attempt?.diagnosticId,
          ...(configuration?.facts ?? {}),
          replayed: attempt?.replayed ?? false, outcome: attempt?.reason }
        console.warn('[image-generation]', { event: 'delivery-failed', projectId: input.projectId, requestId: parsed.data.requestId,
          ...details })
        if (!recorded) recordOk = record(parsed.data, config, { event: 'request-received' })
        recordOk = record(parsed.data, config, { event: 'delivery-failed', ...details }) && recordOk
        // Expose structured facts, never raw upstream bodies, credentials or echoed prompts.
        return Response.json({ error: 'Image request not delivered. Replaying an unknown/rejected receipt does not resubmit upstream. Do not change requestId merely to retry; report the failure and diagnostic details.',
          requestId: parsed.data.requestId, ...details, promptRecord: recordOk ? 'recorded' : 'failed' },
          { status: attempt?.replayed || attempt?.reason === 'conflict' ? 409 : attempt ? 502 : 503 })
      }
    },
  })
  const endpoint = `http://127.0.0.1:${server.port}${path}`
  return {
    instruction: [
      'AI image generation is available through native Bash/curl, with platform-configured provider credentials kept in the host.',
      'Use it when no suitable reusable/library/web asset meets the requirements, or when generation is explicitly requested; an access failure is not proof of no suitable asset.',
      `POST ${endpoint} with JSON {"requestId":"stable-asset-attempt-id","prompt":"your image requirements","background":"transparent"}.`,
      'Use curl --fail-with-body with Content-Type: application/json and save the response to a temporary file. On success move the PNG under assets/; on non-2xx read the JSON error, never register it as an image. Choose your own prompt and asset design.',
      'The same requestId recovers the same attempt; only intentional new artwork uses a new ID. There is no automatic regeneration. Non-2xx is not a usable image.',
      'The host automatically records requests and outcomes in assets/ai-generation-prompts.md; no manual maintenance is needed. Final runtime file selection belongs only in the Manifest.',
      'Default generation is medium quality at the configured source size (normally 1024x1024). Increasing an inspection image size does not add source detail. Prefer reusable source elements and compose them as needed; do not treat one generated canvas as the required size of a whole scrolling level.',
      'Keep this temporary URL out of project files. Record AI provenance, the request ID, actual file path/hash and dimensions in the existing Manifest; inspect the actual image before using it.',
    ].join('\n'),
    close() {
      closed = true
      // Stop accepting new work, but do not discard an already-paid in-flight response.
      void server.stop(false)
    },
  }
}
