import { z } from 'zod'
import defaultPrices from './default-prices.json'

// Decimal Credits in admin UI; integer micro-Credits at the wallet boundary.
const credits = z.number().finite().nonnegative().max(1_000_000_000).refine(v => Math.abs(v * 1e6 - Math.round(v * 1e6)) < 0.001, 'At most six decimal places')
const usdRate = z.number().finite().nonnegative().max(1_000_000).refine(v => Math.abs(v * 1e6 - Math.round(v * 1e6)) < 0.001, 'At most six decimal places')
// One Credit has a $0.01 purchase face value. Model pricing is applied separately.
export const CREDIT_FACE_VALUE_PER_USD = 100
const markup = z.number().finite().min(1).max(10).refine(v => Math.abs(v * 1e6 - Math.round(v * 1e6)) < 0.001, 'At most six decimal places')
export const CLOUDFLARE_INITIAL_FIXED_CREDITS: Record<string, number> = defaultPrices.cloudflare
const fixedVariant = z.enum([
  'low:1024x1024', 'low:1024x1536', 'low:1536x1024',
  'medium:1024x1024', 'medium:1024x1536', 'medium:1536x1024',
  'high:1024x1024', 'high:1024x1536', 'high:1536x1024',
  'xhigh:1024x1024', 'xhigh:1024x1536', 'xhigh:1536x1024',
  'max:1024x1024', 'max:1024x1536', 'max:1536x1024',
])
export const imagePricingSchema = z.object({
  model: z.string().trim().min(1),
  version: z.string().trim().min(1),
  markupMultiplier: markup,
  textInputUsdPerMillion: usdRate,
  cachedTextInputUsdPerMillion: usdRate,
  imageInputUsdPerMillion: usdRate,
  cachedImageInputUsdPerMillion: usdRate,
  imageOutputUsdPerMillion: usdRate,
  fixedCreditsByVariant: z.partialRecord(fixedVariant, credits.refine(v => v > 0)).optional(),
  maxRequestCredits: credits.refine(v => v > 0),
  projectBudgetCredits: credits.refine(v => v > 0),
}).strict().refine(v => v.projectBudgetCredits >= v.maxRequestCredits, 'Project budget must cover one reservation')
export type ImagePricing = z.infer<typeof imagePricingSchema>
export function creditsToMicro(value: number): number { return Math.round(credits.parse(value) * 1e6) }
export function fixedImageChargeCreditsMicro(pricing: ImagePricing, quality: string, size: string): number {
  const p = imagePricingSchema.parse(pricing)
  const key = fixedVariant.parse(`${quality}:${size}`)
  const amount = p.fixedCreditsByVariant?.[key]
  if (amount === undefined) throw new Error('Fixed image price is not configured for quality and size')
  return creditsToMicro(amount)
}

const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const inputDetails = z.object({ text_tokens: tokenCount, image_tokens: tokenCount,
  cached_text_tokens: tokenCount.optional().default(0), cached_image_tokens: tokenCount.optional().default(0) }).strict()
const outputDetails = z.object({ text_tokens: tokenCount, image_tokens: tokenCount }).strict()
const usageSchema = z.object({
  input_tokens: tokenCount, output_tokens: tokenCount, total_tokens: tokenCount,
  input_tokens_details: inputDetails, output_tokens_details: outputDetails,
}).strict()
export function imageChargeCreditsMicro(rawUsage: unknown, pricing: ImagePricing): number {
  const p = imagePricingSchema.parse(pricing)
  // Missing or ambiguous usage is never interpreted as zero or guessed from dimensions.
  const u = usageSchema.parse(rawUsage)
  if (u.input_tokens !== u.input_tokens_details.text_tokens + u.input_tokens_details.image_tokens
    || u.output_tokens !== u.output_tokens_details.text_tokens + u.output_tokens_details.image_tokens
    || u.total_tokens !== u.input_tokens + u.output_tokens
    || u.input_tokens_details.cached_text_tokens > u.input_tokens_details.text_tokens
    || u.input_tokens_details.cached_image_tokens > u.input_tokens_details.image_tokens
    || u.output_tokens_details.text_tokens !== 0) throw new Error('Inconsistent image usage')
  const microUsd = (value: number) => BigInt(Math.round(value * 1_000_000))
  const cost = BigInt(u.input_tokens_details.text_tokens - u.input_tokens_details.cached_text_tokens) * microUsd(p.textInputUsdPerMillion)
    + BigInt(u.input_tokens_details.cached_text_tokens) * microUsd(p.cachedTextInputUsdPerMillion)
    + BigInt(u.input_tokens_details.image_tokens - u.input_tokens_details.cached_image_tokens) * microUsd(p.imageInputUsdPerMillion)
    + BigInt(u.input_tokens_details.cached_image_tokens) * microUsd(p.cachedImageInputUsdPerMillion)
    + BigInt(u.output_tokens_details.image_tokens) * microUsd(p.imageOutputUsdPerMillion)
  // Each rate is USD / 1M tokens. Apply the configured service markup,
  // then convert at the Credit face value, rounding only at the wallet boundary.
  const markupMicro = BigInt(Math.round(p.markupMultiplier * 1_000_000))
  const charge = (cost * markupMicro * BigInt(CREDIT_FACE_VALUE_PER_USD) + 999_999_999_999n) / 1_000_000_000_000n
  if (charge > BigInt(creditsToMicro(p.maxRequestCredits))) throw new Error('Image charge exceeds reservation; reconciliation required')
  return Number(charge)
}
