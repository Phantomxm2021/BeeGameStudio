import { z } from 'zod'

// Decimal Credits in admin UI; integer micro-Credits at the wallet boundary.
const credits = z.number().finite().nonnegative().max(1_000_000_000).refine(v => Math.abs(v * 1e6 - Math.round(v * 1e6)) < 0.001, 'At most six decimal places')
export const imagePricingSchema = z.object({
  model: z.string().trim().min(1),
  version: z.string().trim().min(1),
  creditsPerUsd: credits.refine(v => v > 0).optional(),
  textInputCreditsPerMillion: credits,
  imageInputCreditsPerMillion: credits,
  textOutputCreditsPerMillion: credits,
  imageOutputCreditsPerMillion: credits,
  maxRequestCredits: credits.refine(v => v > 0),
  projectBudgetCredits: credits.refine(v => v > 0),
}).strict().refine(v => v.projectBudgetCredits >= v.maxRequestCredits, 'Project budget must cover one reservation')
export type ImagePricing = z.infer<typeof imagePricingSchema>
export function creditsToMicro(value: number): number { return Math.round(credits.parse(value) * 1e6) }

const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const details = z.object({ text_tokens: tokenCount, image_tokens: tokenCount }).strict()
const usageSchema = z.object({
  input_tokens: tokenCount, output_tokens: tokenCount, total_tokens: tokenCount,
  input_tokens_details: details, output_tokens_details: details,
}).strict()
export function imageChargeCreditsMicro(rawUsage: unknown, pricing: ImagePricing): number {
  const p = imagePricingSchema.parse(pricing)
  if (p.creditsPerUsd !== undefined) {
    const { cost } = z.object({ cost: z.number().finite().nonnegative().max(1e9) }).parse(rawUsage)
    // Convert the decimal dollar amount exactly, including scientific notation;
    // round only the final micro-Credit amount, never first to cents or micro-dollars.
    const [mantissa, exponent = '0'] = String(cost).split('e')
    const [whole, fractional = ''] = mantissa!.split('.')
    const digits = BigInt(whole! + fractional)
    const scale = fractional.length - Number(exponent)
    const numerator = digits * BigInt(creditsToMicro(p.creditsPerUsd)) * (scale < 0 ? 10n ** BigInt(-scale) : 1n)
    const denominator = scale > 0 ? 10n ** BigInt(scale) : 1n
    const charge = (numerator + denominator - 1n) / denominator
    if (charge > BigInt(creditsToMicro(p.maxRequestCredits))) throw new Error('Image charge exceeds reservation; reconciliation required')
    return Number(charge)
  }
  // Unknown/cached usage shapes are not silently treated as zero or charged at a guessed rate.
  const u = usageSchema.parse(rawUsage)
  if (u.input_tokens !== u.input_tokens_details.text_tokens + u.input_tokens_details.image_tokens
    || u.output_tokens !== u.output_tokens_details.text_tokens + u.output_tokens_details.image_tokens
    || u.total_tokens !== u.input_tokens + u.output_tokens) throw new Error('Inconsistent image usage')
  const weighted = BigInt(u.input_tokens_details.text_tokens) * BigInt(creditsToMicro(p.textInputCreditsPerMillion))
    + BigInt(u.input_tokens_details.image_tokens) * BigInt(creditsToMicro(p.imageInputCreditsPerMillion))
    + BigInt(u.output_tokens_details.text_tokens) * BigInt(creditsToMicro(p.textOutputCreditsPerMillion))
    + BigInt(u.output_tokens_details.image_tokens) * BigInt(creditsToMicro(p.imageOutputCreditsPerMillion))
  const charge = (weighted + 999_999n) / 1_000_000n
  if (charge > BigInt(creditsToMicro(p.maxRequestCredits))) throw new Error('Image charge exceeds reservation; reconciliation required')
  return Number(charge)
}
