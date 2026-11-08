import { BeeGameModelRuntimeError } from '../beegame/model-runtime-host'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { platformImageBillingUnavailableReason, type ImageGenerationConfig, type ImageSource } from './config'
import type { ImageGenerationService } from './service'
import { ImageAttemptError, ImageRequestValidationError } from './attempt'
import { readBeeGameAssetManifestSync } from '../beegame/asset-contracts'
import { ImageServiceError } from './service'
import { createImagePromptRecord } from './prompt-record'
import { ImageConfigurationError } from './runtime-config'
import { ImageReferenceError, readProjectReferenceImage, renderUiReferenceLayout } from './reference-image'
import { fixedImageChargeCreditsMicro } from './pricing'
import { compileUiReferenceBoard, compileUiAssetSheet } from './ui-reference-board.mjs'
import type { ImagePromptReview, ImagePromptReviewContext } from './prompt-review'

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
  { message: 'Supply prompt for a new image request; do not combine it with a saved structured request' })

// PNG can be one part of a 3D/XR need, but cannot supply its model, rig or motion.
const pngKinds = new Set(['image', 'texture', 'sprite', 'sprite-sheet', 'sprite-atlas'])
export function validateImageResourceIntent(workspace: string, request: z.infer<typeof generation>) {
  if (request.uiReference !== undefined || request.uiAssets !== undefined)
    throw new ImageRequestValidationError('New image requests use prompt; structured UI requests are retained only for saved-request recovery.')
  if (!request.purpose) throw new ImageRequestValidationError('New image requests need purpose: reference, experiment or production.')
  if (request.purpose !== 'production') {
    if (request.requirementIds?.length) throw new ImageRequestValidationError('References and experiments do not fulfill production requirements.')
    return
  }
  let manifest
  try { manifest = readBeeGameAssetManifestSync(workspace) }
  catch { throw new ImageRequestValidationError('Production images require a readable Manifest when one exists; repair the saved resource definitions before submitting.') }
  if (!request.requirementIds?.length) {
    // New artwork can be produced before its inventory exists. This does not
    // register a resource or satisfy any requirement. Existing constraints
    // cannot be bypassed by leaving the association out.
    if (manifest.project_target?.resource_library_usage === 'required')
      throw new ImageRequestValidationError('Production images must identify a permitted bitmap requirement when the registered project requires library sourcing.')
    if (manifest.requirements.length)
      throw new ImageRequestValidationError('Production images must identify existing Manifest requirementIds when requirements are already registered.')
    return
  }
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
export function createImageGenerationAccess(input: {
  userId: string
  projectId: string
  workspacePath: string
  screenOrientation?: 'Landscape' | 'Portrait'
  source?: ImageSource
  loadConfig: () => Promise<ImageGenerationConfig>
  service: ImageGenerationService
  reviewPrompt?: (prompt: string, context: ImagePromptReviewContext) => Promise<ImagePromptReview>
}) {
  let closed = false
  const handle = async (request: Request) => {
    if (closed || request.headers.has('origin'))
      return new Response('Not found', { status: 404 })
    const record = createImagePromptRecord(input.workspacePath, new URL(request.url).pathname)
    if (request.method === 'GET') {
      try {
        const config = await input.loadConfig()
        const query = new URL(request.url).searchParams
        const quality = query.get('quality') ?? config.quality
        const size = query.get('size') ?? config.size
        const sharedSubscription = config.provider === 'chatgpt-subscription'
        const fixedPlatform = (!input.source || input.source === 'platform') && (config.provider === 'cloudflare' || sharedSubscription)
        let quotedCreditsMicro: number | null = null
        if (fixedPlatform && config.billing) {
          try { if (quality) quotedCreditsMicro = fixedImageChargeCreditsMicro(config.billing, quality, size) }
          catch { /* Unpriced variant is unavailable, without an upstream call. */ }
        }
        const subscription = input.source === 'chatgpt-subscription'
        const billingUnavailable = (!input.source || input.source === 'platform')
          ? platformImageBillingUnavailableReason(config.provider) : undefined
        const available = Boolean(!billingUnavailable && quality && (subscription ? config.responseModel : sharedSubscription
          ? fixedPlatform && config.responseModel && config.subscriptionOwnerId && quotedCreditsMicro !== null
          : config.apiKey && (input.source === 'byok' || (config.billing && (!fixedPlatform || quotedCreditsMicro !== null)))))
        return Response.json({ available, model: config.model,
          outputFormat: 'png', backgroundModes: ['auto', 'opaque', 'transparent'], maxReferenceImages: 1,
          ...(billingUnavailable ? { unavailableReason: billingUnavailable, unavailableCode: 'billing-unsupported' } : {}),
          quality, size, fixedPrice: fixedPlatform,
          referenceImageSupported: true,
          ...(config.provider === 'cloudflare' || sharedSubscription ? { availableSizes: ['1024x1024', '1024x1536', '1536x1024'] } : {}),
          ...(config.provider === 'cloudflare' || sharedSubscription ? { quotedCreditsMicro,
            ...(config.billing && quotedCreditsMicro === null ? { unavailableReason: 'No fixed Credit price configured for this quality and size' } : {}) } : {}),
          maxRequestCredits: input.source === 'byok' || subscription ? null : config.billing?.maxRequestCredits ?? null,
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
    if (!parsed.success) return Response.json({ error: 'Invalid image request',
      issues: parsed.error.issues.map(({path, code, message}) => ({path, code, message})),
    }, { status: 400 })
    let normalizedRequest
    let board: ReturnType<typeof compileUiReferenceBoard> | undefined
    try {
      board = parsed.data.uiReference === undefined ? undefined : compileUiReferenceBoard(parsed.data, input.screenOrientation)
      normalizedRequest = { ...(board ? board.request : parsed.data.uiAssets !== undefined
        ? compileUiAssetSheet(parsed.data).request : { ...parsed.data, prompt: parsed.data.prompt! }),
        purpose: parsed.data.purpose, requirementIds: parsed.data.requirementIds }
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
      stage = 'reference-image'
      const referenceImage = referenceImagePath
        ? await readProjectReferenceImage(input.workspacePath, referenceImagePath)
        : board ? await renderUiReferenceLayout(board.layout) : undefined
      recordOk = record(normalizedRequest, config, { event: 'request-received',
        purpose, requirementIds,
        ...(board && !referenceImagePath ? { referenceImageRole: 'layout-guide', requestedLayout: board.layout } : {}),
        ...(referenceImage ? { referenceImageSha256: referenceImage.sha256 } : {}) })
      recorded = true
      stage = 'generation-or-billing'
      const result = await input.service.generate({ ownerId: input.userId, projectId: input.projectId,
        requestId, config, validateNewRequest: () => validateImageResourceIntent(input.workspacePath, parsed.data),
        ...(input.reviewPrompt && parsed.data.purpose === 'reference' ? { reviewPrompt: async () => {
          stage = 'prompt-review'
          request.signal.throwIfAborted()
          const review = await input.reviewPrompt!(imageRequest.prompt, {
            purpose: 'reference',
            referenceImage: referenceImage ? { sha256: referenceImage.sha256, mimeType: referenceImage.mimeType } : null,
          })
          recordOk = record(normalizedRequest, config, { event: 'prompt-checked', issues: review.issues }) && recordOk
          if (review.issues.length)
            throw new ImageRequestValidationError('Resolve the image prompt before generation: ' + review.issues.join('; '), 'image-prompt-conflict')
          stage = 'generation-or-billing'
        } } : {}),
        request: { ...imageRequest, signal: request.signal,
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
      const billing = error instanceof ImageServiceError ? error.billingError : undefined
      const configuration = error instanceof ImageConfigurationError ? error : undefined
      const reference = error instanceof ImageReferenceError ? error : undefined
      if (error instanceof ImageRequestValidationError) {
        record(normalizedRequest, config, { event: 'delivery-failed', code: error.code, upstreamSubmitted: false })
        return Response.json({ error: error.message, code: error.code, requestId: parsed.data.requestId,
          note: 'No provider submission or new Credit reservation. Correct the input; do not change a paid request ID.' }, { status: 422 })
      }
      const modelFailure = error instanceof BeeGameModelRuntimeError ? error : undefined
      const promptFailure = stage === 'prompt-review' ? {
        failureCode: modelFailure?.failureCode ?? (error instanceof SyntaxError ? 'invalid-review-json'
          : error instanceof z.ZodError ? 'invalid-review-schema' : 'prompt-check-failed'),
        ...(modelFailure ? { modelStage: modelFailure.stage, httpStatus: modelFailure.httpStatus, networkCode: modelFailure.networkCode } : {}),
      } : {}
      const details = { ...promptFailure, stage: error instanceof ImageServiceError ? error.stage : stage,
        code: reference?.code ?? configuration?.code ?? billing?.code ?? attempt?.code ?? attempt?.reason
          ?? (error instanceof ImageServiceError ? error.stage : stage === 'prompt-review' ? 'prompt-review-unavailable' : 'configuration-or-billing-failed'),
        upstreamStatus: attempt?.status, diagnosticId: configuration?.diagnosticId ?? attempt?.diagnosticId ?? modelFailure?.diagnosticId ?? (stage === 'prompt-review' ? randomUUID() : undefined),
        ...(configuration?.facts ?? {}),
        replayed: attempt?.replayed ?? false, outcome: attempt?.reason }
      if (attempt?.recoveryRequestId) Object.assign(details, { recoveryRequestId: attempt.recoveryRequestId })
      console.warn('[image-generation]', { event: 'delivery-failed', projectId: input.projectId, requestId: parsed.data.requestId,
        ...details })
      if (!recorded) recordOk = record(normalizedRequest, config, { event: 'request-received' })
      recordOk = record(normalizedRequest, config, { event: 'delivery-failed', ...details }) && recordOk
      // Expose structured facts, never raw upstream bodies, credentials or echoed prompts.
      return Response.json({ error: stage === 'prompt-review'
        ? 'Image prompt checking did not complete. No image was submitted or image Credit reservation made. Preserve the request and report the check failure; no automatic retry.'
        : billing
        ? billing.message + '. Preserve the request and report this billing error. No automatic retry.'
        : 'Image request not delivered. Replaying an unknown/rejected receipt does not resubmit upstream. Do not change requestId merely to retry; report the failure and diagnostic details.',
        requestId: parsed.data.requestId, ...details, promptRecord: recordOk ? 'recorded' : 'failed' },
        { status: billing ? billing.status : reference ? 400 : error instanceof ImageServiceError && ['price-unavailable', 'billing-unsupported'].includes(error.stage) ? 422
          : attempt?.replayed || attempt?.reason === 'conflict' ? 409 : attempt ? 502 : 503 })
    }
  }
  return {
    fetch: handle,
    ...(input.screenOrientation ? { screenOrientation: input.screenOrientation } : {}),
    instruction: [
      input.source === 'chatgpt-subscription'
        ? 'Optional AI image generation uses the configured subscription login. This endpoint capability is not yet verified by a real generation. Subscription quota may be consumed; platform image Credits are not charged. No daily image count is promised.'
      : input.source === 'byok'
        ? 'Optional AI image generation uses the user-owned provider key. The provider bills the user directly; platform image Credits are not charged. Agent chooses whether, when and what to generate.'
        : 'Optional AI image generation uses platform credentials and Credits billing held by the host. Agent chooses whether, when and what to generate.',
      ...(input.reviewPrompt ? ['New reference-purpose image requests receive a text-only prompt check before image billing or submission, independently of the current production stage. Production resources keep their resource-intent checks without another full-GDD prompt review. Resolve returned prompt conflicts before submitting a corrected request. Existing paid results recover without another prompt check.'] : []),
      input.source === 'byok' || input.source === 'chatgpt-subscription'
        ? 'Generate or edit with beegame-images generate_image when available; assets.mjs generate is the CLI alternative. The cost command shows availability, not the external provider price. For new work, omit requestId; either entry saves a unique ID before submission. Recovery reuses the original request file and ID unchanged. Non-2xx responses are not images.'
        : 'Generate or edit with beegame-images generate_image when available; assets.mjs generate is the CLI alternative. The cost command shows availability and, for fixed-price image generation, the exact fixed Credit price for the requested quality and size. Shared subscription availability is unverified; its quota is shared, not a promised daily allowance. Generation uses that fixed price for the reservation. For new work, omit requestId; either entry saves a unique ID before submission. Recovery reuses the original request file and ID unchanged. Non-2xx responses are not images.',
      'BGS image generation outputs PNG and accepts at most one project reference image when the cost response reports referenceImageSupported. The cost response identifies the current configured image model and request options, not verified output quality. Query availability, supported sizes and the price for the intended request; use assets.mjs generate --help for parameters. Internal routing and quality identifiers are tool parameters, not user-facing status text. Report the image result and relevant cost without repeating provider, model or quality configuration.',
      'For image editing, you may pass an existing project-relative PNG under assets/ as referenceImagePath; no visual board is required. The provider must support reference images; the cost command reports availability. Do not submit host paths or regenerate an unknown paid attempt.',
      'The host records requests and billing source in assets/ai-generation-prompts.md; no manual maintenance is needed. Register only the actual selected file and hash in the Manifest.',
      'New image requests declare purpose: reference, experiment or production. Production artwork can be generated before any Manifest requirements exist; this saves artwork without registering it or satisfying a requirement. If requirements already exist, identify their requirementIds for compatible bitmap parts, including textures used in 3D/XR. References/experiments carry no requirementIds and do not complete runtime resources. A PNG cannot supply a model, rig, animation behavior or device interaction. Old paid requests remain recoverable without new metadata; these fields never change billing identity.',
      'New image requests use prompt, including concept boards and production atlases. referenceImagePath supports ordinary image edits. Saved requests keep their original identity for recovery. Inspect actual output dimensions and frame bounds before runtime use.',
    ].join('\n'),
    close() {
      closed = true
      // The task router cancels and drains active work before closing access.
    },
  }
}
