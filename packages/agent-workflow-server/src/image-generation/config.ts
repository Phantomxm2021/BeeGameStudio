import { z } from 'zod'
import { imagePricingSchema } from './pricing'

export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-flare'
export const imageProviderSchema = z.enum(['openai', 'openrouter', 'vercel', 'cloudflare'])
export type ImageProviderKind = z.infer<typeof imageProviderSchema>
export const imageConfigSchema = z.object({
  provider: imageProviderSchema.default('openai'),
  baseUrl: z.string().url().default('https://api.openai.com/v1/images/generations').superRefine((value, ctx) => {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      ctx.addIssue({ code: 'custom', message: 'Base URL must be HTTP(S), without credentials, query or fragment' })
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      ctx.addIssue({ code: 'custom', message: 'Remote providers require HTTPS' })
  }),
  model: z.string().trim().min(1).max(200).default(DEFAULT_IMAGE_MODEL),
  apiKey: z.string().trim().max(8192).default(''),
  upstreamApiKey: z.string().trim().max(8192).default(''),
  billing: imagePricingSchema.nullable().default(null),
  quality: z.enum(['auto', 'low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  size: z.string().regex(/^(auto|[1-9]\d{1,4}x[1-9]\d{1,4})$/).default('1024x1024'),
}).strict()

export type ImageGenerationConfig = z.infer<typeof imageConfigSchema>
// Zod defaults also run inside partial(); PATCH must preserve omitted credentials.
export const imageConfigPatchSchema = z.record(z.string(), z.unknown()).transform((raw, ctx) => {
  const parsed = imageConfigSchema.partial().safeParse(raw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
    return z.NEVER
  }
  return Object.fromEntries(Object.keys(raw).map(key => [key, parsed.data[key as keyof ImageGenerationConfig]])) as Partial<ImageGenerationConfig>
})
export type PublicImageGenerationConfig = Omit<ImageGenerationConfig, 'apiKey' | 'upstreamApiKey'> & { hasApiKey: boolean; hasUpstreamApiKey: boolean }
export function publicImageConfig(config: ImageGenerationConfig): PublicImageGenerationConfig {
  const { apiKey, upstreamApiKey, ...publicFields } = config
  return { ...publicFields, hasApiKey: Boolean(apiKey), hasUpstreamApiKey: Boolean(upstreamApiKey) }
}
export function defaultImageConfig(provider: ImageProviderKind) {
  const baseUrl = { openai: 'https://api.openai.com/v1/images/generations', openrouter: 'https://openrouter.ai/api/v1/images',
    vercel: 'https://ai-gateway.vercel.sh/v1/images/generations', cloudflare: 'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/run' }[provider]
  return imageConfigSchema.parse({ provider, baseUrl,
    model: provider === 'openrouter' || provider === 'vercel' || provider === 'cloudflare' ? 'openai/' + DEFAULT_IMAGE_MODEL : DEFAULT_IMAGE_MODEL })
}
export function updateImageConfig(previous: ImageGenerationConfig, input: unknown) {
  // Omitted key preserves it; an explicit empty string removes it.
  return imageConfigSchema.parse({ ...previous, ...z.record(z.string(), z.unknown()).parse(input) })
}
