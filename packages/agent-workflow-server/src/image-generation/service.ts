import { createHash } from 'node:crypto'
import type { ImageBillingClient, ImageBillingInput } from '@bee-game-studio/beegame-billing-core/image-billing'
import { ImageAttemptError, ImageAttemptStore, type ImageAttemptInput } from './attempt'
import { imagePricingSchema, imageChargeCreditsMicro, fixedImageChargeCreditsMicro, creditsToMicro } from './pricing'
import { ImageReferenceError } from './reference-image'

export class ImageServiceError extends Error {
  constructor(readonly stage: string) { super('Image service failed at ' + stage) }
}

/** Only host policy/billing; no Agent planning, retries, asset selection or workflow stages. */
export class ImageGenerationService {
  constructor(private readonly attempts: ImageAttemptStore, private readonly billing: ImageBillingClient) {}

  async generate(input: ImageAttemptInput) {
    const observe = async <T>(stage: string, operation: () => Promise<T>): Promise<T> => {
      const started = Date.now()
      const identity = { projectId: input.projectId, requestId: input.requestId, stage }
      console.info('[image-generation]', { ...identity, event: 'started' })
      try {
        const value = await operation()
        console.info('[image-generation]', { ...identity, event: 'completed', elapsedMs: Date.now() - started })
        return value
      } catch (error) {
        console.warn('[image-generation]', { ...identity, event: 'failed', elapsedMs: Date.now() - started,
          reason: error instanceof ImageAttemptError ? error.reason : 'unavailable',
          ...(error instanceof ImageAttemptError && error.status !== undefined ? { upstreamStatus: error.status } : {}) })
        throw error instanceof ImageAttemptError ? error : new ImageServiceError(stage)
      }
    }
    const pricing = imagePricingSchema.parse(input.config.billing)
    if (pricing.model !== input.config.model) throw new Error('Image pricing does not match the configured model')
    if ((input.request.referenceImage || input.request.size) && input.config.provider !== 'cloudflare')
      throw new ImageReferenceError('provider-unsupported')
    const quality = input.request.quality ?? input.config.quality
    const size = input.request.size ?? input.config.size
    let fixedQuote: number | undefined
    if (input.config.provider === 'cloudflare') {
      try { fixedQuote = fixedImageChargeCreditsMicro(pricing, quality, size) }
      catch { throw new ImageServiceError('price-unavailable') }
    }
    if (!input.config.apiKey || !input.request.prompt.trim() || input.request.prompt.length > 32000)
      throw new Error('Image provider key and valid prompt are required')
    input.request.signal?.throwIfAborted()
    const digest = createHash('sha256').update(JSON.stringify([
      input.config.provider, input.config.baseUrl, input.config.model, input.request.size ?? input.config.size,
      quality, input.request.prompt,
      input.request.background ?? 'auto', input.request.referenceImage?.sha256 ?? null,
    ])).digest('hex')
    const base: ImageBillingInput = {
      projectId: input.projectId, requestId: input.requestId, digest, action: 'reserve',
      amountCreditsMicro: fixedQuote ?? creditsToMicro(pricing.maxRequestCredits),
      projectBudgetCreditsMicro: creditsToMicro(pricing.projectBudgetCredits), metadata: { pricing,
        ...(fixedQuote === undefined ? {} : { fixedQuoteCreditsMicro: fixedQuote, quality, size }) },
    }
    const receipt = await observe('reserve', () => this.billing.apply(input.ownerId, base))
    if (receipt.state === 'released') throw new Error('Image request was released; a new intentional attempt needs a new request ID')
    // Settlement uses the frozen reservation price, not a later administrator edit.
    // Reservations created before the markup change retain their original 1x
    // price; new requests use the current configured multiplier.
    const receiptPricing = receipt.metadata.pricing
    const frozen = imagePricingSchema.parse(receiptPricing && typeof receiptPricing === 'object'
      && !('markupMultiplier' in receiptPricing)
      ? { ...receiptPricing, markupMultiplier: 1 }
      : receiptPricing)
    let result
    try { result = await observe('generate-or-recover', () => this.attempts.generate({ ...input, recoverOnly: !receipt.created })) }
    catch (error) {
      if (error instanceof ImageAttemptError && error.reason === 'rejected')
        await observe('release', () => this.billing.apply(input.ownerId, { ...base, action: 'release', amountCreditsMicro: 0, metadata: {} }))
      // Unknown, aborted, corrupt image, or storage failure: hold remains for reconciliation.
      throw error
    }
    // A validated, durably saved image is deliverable even when the provider
    // omits usage or settlement is unavailable. Keep the reservation for
    // reconciliation; never invent a charge or regenerate the paid output.
    try {
      const charged = input.config.provider === 'cloudflare'
        ? await observe('price-fixed', async () => {
          const quote = receipt.metadata.fixedQuoteCreditsMicro
          if (typeof quote !== 'number' || !Number.isSafeInteger(quote) || quote <= 0)
            throw new Error('Missing frozen fixed image price')
          return quote
        })
        : await observe('price-usage', async () => imageChargeCreditsMicro(result.usage, frozen))
      await observe('settle', () => this.billing.apply(input.ownerId, {
        ...base, action: 'settle', amountCreditsMicro: charged,
        metadata: { usage: result.usage, providerRequestId: result.providerRequestId ?? null },
      }))
      return { ...result, chargedCreditsMicro: charged, billingState: 'settled' as const }
    } catch (error) {
      if (!(error instanceof ImageServiceError)) throw error
      console.warn('[image-generation]', { event: 'billing-pending', projectId: input.projectId,
        requestId: input.requestId, stage: error.stage, imageReceived: true })
      return { ...result, chargedCreditsMicro: null, billingState: 'pending' as const }
    }
  }
}
