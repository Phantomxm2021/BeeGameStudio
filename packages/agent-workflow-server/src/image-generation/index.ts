import type { ImageGenerationConfig } from './config'
import type { ImageGenerationProvider } from './provider'
import { OpenAIImageProvider } from './openai-provider'
import { OpenRouterImageProvider } from './openrouter-provider'
import { VercelImageProvider } from './vercel-provider'
import { CloudflareImageProvider } from './cloudflare-provider'

// Explicit provider selection, no endpoint probing or fallback requests.
export function createImageGenerationProvider(provider: ImageGenerationConfig['provider'], request?: ConstructorParameters<typeof OpenAIImageProvider>[0]): ImageGenerationProvider {
  switch (provider) {
    case 'openai': return new OpenAIImageProvider(request)
    case 'openrouter': return new OpenRouterImageProvider(request)
    case 'vercel': return new VercelImageProvider(request)
    case 'cloudflare': return new CloudflareImageProvider(request)
    default: throw new Error('Unsupported image provider')
  }
}
export * from './config'
export * from './provider'
