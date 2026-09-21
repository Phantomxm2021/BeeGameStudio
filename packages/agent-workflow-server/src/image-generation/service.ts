import { createHash } from 'node:crypto'
import type { ImageBillingClient, ImageBillingInput } from '@bee-game-studio/beegame-billing-core/image-billing'
import { ImageAttemptError, ImageAttemptStore, type ImageAttemptInput } from './attempt'
import { imagePricingSchema, imageChargeCreditsMicro, creditsToMicro } from './pricing'

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
    if (input.config.provider === 'openrouter' && pricing.creditsPerUsd === undefined)
      throw new Error('OpenRouter image billing requires the provider-cost exchange rate')
    if (!input.config.apiKey || !input.request.prompt.trim() || input.request.prompt.length > 32000)
      throw new Error('Image provider key and valid prompt are required')
    input.request.signal?.throwIfAborted()
    const digest = createHash('sha256').update(JSON.stringify([
      input.config.provider, input.config.baseUrl, input.config.model, input.config.size,
      input.config.quality, input.request.prompt, input.request.background ?? 'auto',
    ])).digest('hex')
    const base: ImageBillingInput = {
      projectId: input.projectId, requestId: input.requestId, digest, action: 'reserve',
      amountCreditsMicro: creditsToMicro(pricing.maxRequestCredits),
      projectBudgetCreditsMicro: creditsToMicro(pricing.projectBudgetCredits), metadata: { pricing },
    }
    const receipt = await observe('reserve', () => this.billing.apply(input.ownerId, base))
    if (receipt.state === 'released') throw new Error('Image request was released; a new intentional attempt needs a new request ID')
    // Settlement uses the frozen reservation price, not a later administrator edit.
    const frozen = imagePricingSchema.parse(receipt.metadata.pricing)
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
      const charged = await observe('price-usage', async () => imageChargeCreditsMicro(result.usage, frozen))
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
