import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { ImageGenerationConfig, ImageSource } from './config'
import type { ImageGenerationService } from './service'
import { ImageAttemptError, ImageRequestValidationError } from './attempt'
import { readBeeGameAssetManifestSync } from '../beegame/asset-contracts'
import { ImageServiceError } from './service'
import { createImagePromptRecord } from './prompt-record'
import { ImageConfigurationError } from './runtime-config'
import { ImageReferenceError, readProjectReferenceImage } from './reference-image'
import { CREDIT_FACE_VALUE_PER_USD, fixedImageChargeCreditsMicro } from './pricing'
import { compileUiReferenceBoard, compileUiAssetSheet } from './ui-reference-board.mjs'

const generation = z.object({
  requestId: z.string().trim().min(1).max(200),
  purpose: z.enum(['reference', 'experiment', 'production']).optional(),
  requirementIds: z.array(z.string().trim().min(1)).min(1).max(128).optional(),
  prompt: z.string().trim().min(1).max(32000).optional(),
  uiReference: z.unknown().optional(),
  uiAssets: z.unknown().optional(),
  background: z.enum(['auto', 'opaque', 'transparent']).optional(),
  quality: z.enum(['auto', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  size: z.enum(['1024x1024', '1024x1536', '1536x1024']).optional(),
  referenceImagePath: z.string().trim().min(1).max(512).optional(),
}).strict().refine(value => [value.prompt, value.uiReference, value.uiAssets].filter(item => item !== undefined).length === 1,
  { message: 'Use exactly one of prompt, uiReference or uiAssets' })

// PNG can be one part of a 3D/XR need, but cannot supply its model, rig or motion.
const pngKinds = new Set(['image', 'texture', 'sprite', 'sprite-sheet', 'sprite-atlas'])
export function validateImageResourceIntent(workspace: string, request: z.infer<typeof generation>) {
  if (!request.purpose) throw new ImageRequestValidationError('New image requests need purpose: reference, experiment or production.')
  if (request.purpose !== 'production') {
    if (request.requirementIds?.length) throw new ImageRequestValidationError('References and experiments do not fulfill production requirements.')
    return
  }
  if (request.uiReference !== undefined) throw new ImageRequestValidationError('A UI reference board is not a production resource.')
  if (!request.requirementIds?.length) throw new ImageRequestValidationError('Production images must identify existing Manifest requirementIds.')
  let manifest
  try { manifest = readBeeGameAssetManifestSync(workspace) }
  catch { throw new ImageRequestValidationError('Production images require readable existing Manifest requirements; register requirements with resources: [] if no files exist yet.') }
  for (const id of request.requirementIds) {
    const requirement = manifest.requirements.find(item => item.id === id)
    if (!requirement) throw new ImageRequestValidationError('Unknown production requirement: '+id)
    const profile = requirement.acquisition_profile
    if (profile.sourcing_policy && !profile.sourcing_policy.allowed_source_kinds.includes('agent-authored'))
      throw new ImageRequestValidationError('Requirement disallows agent-authored images: '+id)
    const kinds = [...profile.asset_kinds, ...(profile.coverage ?? []).flatMap(item => item.asset_kinds ?? [])]
    if (!kinds.some(kind => pngKinds.has(kind)))
      throw new ImageRequestValidationError('PNG cannot provide the declared resource kind for '+id+'; identify a bitmap part in the existing requirement.')
  }
}

/** Short-lived, user/project-scoped capability. The Agent never receives provider or billing keys. */
export function openImageGenerationAccess(input: {
  userId: string
  projectId: string
  workspacePath: string
  requiredQuality?: 'low'
  screenOrientation?: 'Landscape' | 'Portrait'
  source?: ImageSource
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
          const sharedSubscription = config.provider === 'chatgpt-subscription'
          const fixedPlatform = (!input.source || input.source === 'platform') && (config.provider === 'cloudflare' || sharedSubscription)
          let quotedCreditsMicro: number | null = null
          if (fixedPlatform && config.billing) {
            try { if (quality) quotedCreditsMicro = fixedImageChargeCreditsMicro(config.billing, quality, size) }
            catch { /* Unpriced variant is unavailable, without an upstream call. */ }
          }
          const subscription = input.source === 'chatgpt-subscription'
          const available = Boolean(quality && (subscription ? config.responseModel : sharedSubscription
            ? fixedPlatform && config.responseModel && config.subscriptionOwnerId && quotedCreditsMicro !== null
            : config.apiKey && (input.source === 'byok' || (config.billing && (!fixedPlatform || quotedCreditsMicro !== null)))))
          return Response.json({ available,
            provider: config.provider, model: config.model, quality: requestedQuality, size,
            referenceImageSupported: config.provider === 'cloudflare',
            ...(config.provider === 'cloudflare' || sharedSubscription ? { availableSizes: ['1024x1024', '1024x1536', '1536x1024'] } : {}),
            ...(config.provider === 'cloudflare' || sharedSubscription ? { quotedCreditsMicro,
              ...(config.billing && quotedCreditsMicro === null ? { unavailableReason: 'No fixed Credit price configured for this quality and size' } : {}) } : {}),
            maxRequestCredits: input.source === 'byok' || subscription ? null : config.billing?.maxRequestCredits ?? null,
            creditFaceValuePerUsd: CREDIT_FACE_VALUE_PER_USD,
            modelPriceMultiplier: input.source === 'byok' || subscription || sharedSubscription ? null : config.billing?.markupMultiplier ?? null,
            billingSource: subscription ? 'subscription' : input.source === 'byok' ? 'external' : 'platform',
            ...(subscription || sharedSubscription ? { upstreamQuotaSource: sharedSubscription ? 'platform-subscription' : 'personal-subscription',
              upstreamAvailability: 'unverified', dailyImagesRemaining: null } : {}) },
          { headers: { 'cache-control': 'no-store' } })
        } catch {
          return Response.json({ error: 'Image generation configuration unavailable' }, { status: 503 })
        }
      }
      if (request.method !== 'POST') return new Response('POST required', { status: 405 })
      const parsed = generation.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: 'Expected requestId, exactly one of prompt, uiReference or uiAssets, and optional background/quality/size/referenceImagePath' }, { status: 400 })
      if (input.requiredQuality && parsed.data.quality && parsed.data.quality !== input.requiredQuality)
        return Response.json({ error: `This delivery milestone requires quality ${input.requiredQuality}` }, { status: 422 })
      let normalizedRequest
      try {
        normalizedRequest = { ...(parsed.data.uiAssets !== undefined ? compileUiAssetSheet(parsed.data).request :
          parsed.data.uiReference === undefined ? { ...parsed.data, prompt: parsed.data.prompt! } :
          compileUiReferenceBoard(parsed.data, input.screenOrientation).request),
          purpose: parsed.data.purpose, requirementIds: parsed.data.requirementIds,
          ...(input.requiredQuality ? { quality: input.requiredQuality } : {}) }
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : 'Invalid UI reference specification' }, { status: 400 })
      }
      let stage = 'configuration'
      let config: ImageGenerationConfig | undefined
      let recorded = false
      let recordOk = true
      try {
        const { requestId, referenceImagePath, purpose, requirementIds, ...imageRequest } = normalizedRequest
        config = await input.loadConfig()
        if (parsed.data.uiAssets !== undefined && config.provider !== 'cloudflare')
          throw new ImageRequestValidationError('This provider cannot accept the selected UI design image; no generation submitted. Use a reference-capable provider, not an unrelated replacement style.')
        stage = 'reference-image'
        const referenceImage = referenceImagePath
          ? await readProjectReferenceImage(input.workspacePath, referenceImagePath) : undefined
        recordOk = record(normalizedRequest, config, { event: 'request-received',
          purpose, requirementIds,
          ...(referenceImage ? { referenceImageSha256: referenceImage.sha256 } : {}) })
        recorded = true
        stage = 'generation-or-billing'
        const result = await input.service.generate({ ownerId: input.userId, projectId: input.projectId,
          requestId, config, validateNewRequest: () => validateImageResourceIntent(input.workspacePath, parsed.data),
          request: { ...imageRequest,
            ...(input.requiredQuality ? { quality: input.requiredQuality } : {}),
            ...(referenceImage ? { referenceImage } : {}) } }, input.source ?? 'platform')
        recordOk = record(normalizedRequest, config, { event: 'image-returned', model: result.model,
          providerRequestId: result.providerRequestId, mimeType: result.mimeType,
          note: result.billingState === 'pending'
            ? 'Image delivered; billing reconciliation pending. Reservation retained; do not regenerate.'
            : result.billingState === 'subscription'
              ? 'Generated through the user subscription; no platform image Credits charged. Upstream usage is retained in the host receipt; no daily image allowance is inferred.'
            : result.billingState === 'external'
              ? 'Generated with the user-owned provider key; upstream billing is external to platform Credits.'
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
        if (error instanceof ImageRequestValidationError) {
          record(normalizedRequest, config, { event: 'delivery-failed', code: 'resource-intent', upstreamSubmitted: false })
          return Response.json({ error: error.message, code: 'resource-intent', requestId: parsed.data.requestId,
            note: 'No provider submission or new Credit reservation. Correct the input; do not change a paid request ID.' }, { status: 422 })
        }
        const details = { stage: error instanceof ImageServiceError ? error.stage : stage,
          code: reference?.code ?? configuration?.code ?? attempt?.code ?? attempt?.reason
            ?? (error instanceof ImageServiceError ? error.stage : 'configuration-or-billing-failed'),
          upstreamStatus: attempt?.status, diagnosticId: configuration?.diagnosticId ?? attempt?.diagnosticId,
          ...(configuration?.facts ?? {}),
          replayed: attempt?.replayed ?? false, outcome: attempt?.reason }
        if (attempt?.recoveryRequestId) Object.assign(details, { recoveryRequestId: attempt.recoveryRequestId })
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
      input.source === 'chatgpt-subscription'
        ? 'Optional AI image generation uses the existing ChatGPT subscription login. This endpoint capability is not yet verified by a real generation. Subscription quota may be consumed; platform image Credits are not charged. No daily image count is promised.'
      : input.source === 'byok'
        ? 'Optional AI image generation uses the user-owned provider key. The provider bills the user directly; platform image Credits are not charged. Agent chooses whether, when and what to generate.'
        : 'Optional AI image generation uses platform credentials and Credits billing held by the host. Agent chooses whether, when and what to generate.',
      ...(input.requiredQuality ? [`For this delivery milestone, image quality is ${input.requiredQuality}; other quality requests are unavailable.`] : []),
      input.source === 'byok' || input.source === 'chatgpt-subscription'
        ? 'Use the optional project asset command described in the current project context. Its cost command shows availability, not the external provider price. Reuse one stable requestId for recovery; only an intentionally different artwork gets a new ID. Non-2xx responses are not images.'
        : 'Use the optional project asset command described in the current project context. Its cost command shows availability and, for Cloudflare or a shared ChatGPT subscription, the exact fixed Credit price for the requested quality and size. Shared subscription availability is unverified; its quota is shared, not a promised daily allowance. Generate displays the fixed price before reserving the same amount. Reuse one stable requestId for recovery; only an intentionally different artwork gets a new ID. Non-2xx responses are not images.',
      'Cloudflare GPT Image 2.5 Flare can generate a new image or edit a reference image. Its documented background options are auto, opaque and transparent; choose per asset rather than treating transparency as mandatory. It supports low, medium, high, xhigh, max or auto quality and 1024x1024, 1024x1536, 1536x1024 or auto size. This BGS capability outputs PNG and accepts at most one project reference image; the configured price and milestone may restrict quality and size. Inspect the returned image, including actual alpha when transparency matters; the model does not supply reliable atlas frame coordinates. Official provider details: https://developers.cloudflare.com/ai/models/openai/gpt-image-2.5-flare/',
      'For image editing, you may pass an existing project-relative PNG under assets/ as referenceImagePath; no visual board is required. The provider must support reference images; the cost command reports availability. Do not submit host paths or regenerate an unknown paid attempt.',
      'The host records requests and billing source in assets/ai-generation-prompts.md; no manual maintenance is needed. Register only the actual selected file and hash in the Manifest.',
      'New image requests declare purpose: reference, experiment or production. Production requests include existing Manifest requirementIds for compatible bitmap parts, including textures used in 3D/XR. References/experiments carry no requirementIds and do not complete runtime resources. A PNG cannot supply a model, rig, animation behavior or device interaction. Old paid requests remain recoverable without new metadata; these fields never change billing identity.',
      'UI reference boards use uiReference; design-linked runtime skins use uiAssets with referenceImagePath. Both structured inputs are documented by assets.mjs --help and compiled by the host. ui-board-plan and ui-assets-plan inspect requests without generation or billing; submit the same structured input after quoting its chosen canvas. Production skins still need inspected alpha/bounds and measured named atlas frames; requested grid cells are not generated frame coordinates.',
    ].join('\n'),
    close() {
      closed = true
      // Stop accepting new work, but do not discard an already-paid in-flight response.
      return server.stop(false)
    },
  }
}
