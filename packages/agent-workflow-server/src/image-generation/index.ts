import type { ImageGenerationConfig } from './config'
import type { ImageGenerationProvider } from './provider'
import { OpenAIImageProvider } from './openai-provider'
import { OpenRouterImageProvider } from './openrouter-provider'
import { VercelImageProvider } from './vercel-provider'
import { CloudflareImageProvider, type ImageRequestFetch } from './cloudflare-provider'
import { ChatGPTSubscriptionImageProvider } from './chatgpt-provider'
import { ImageProviderError } from './provider'
import { getUserDashboardDataRoot } from '../local-runtime-service'
import { join } from 'node:path'

// Explicit provider selection, no endpoint probing or fallback requests.
export function createImageGenerationProvider(
  provider: ImageGenerationConfig['provider'],
  request?: ConstructorParameters<typeof OpenAIImageProvider>[0],
  resultRequest?: ImageRequestFetch,
): ImageGenerationProvider {
  switch (provider) {
    case 'openai': return new OpenAIImageProvider(request)
    case 'openrouter': return new OpenRouterImageProvider(request)
    case 'vercel': return new VercelImageProvider(request)
    case 'cloudflare': return new CloudflareImageProvider(request, resultRequest)
    default: throw new Error('Unsupported image provider')
  }
}
// Credential ownership is host policy, independent of the requesting/charged user.
export function createHostedImageGenerationProvider(
  dataRoot: string,
  request: typeof fetch = fetch,
  resultRequest?: ImageRequestFetch,
): ImageGenerationProvider {
  return { generate(config, input, context) {
    const shared = config.provider === 'chatgpt-subscription'
    if (shared && (context?.source !== 'platform' || !config.subscriptionOwnerId))
      throw new ImageProviderError('Invalid shared subscription context', 'rejected')
    if (shared || context?.source === 'chatgpt-subscription') {
      const ownerId = shared ? config.subscriptionOwnerId! : context!.ownerId
      return new ChatGPTSubscriptionImageProvider(join(getUserDashboardDataRoot(dataRoot, ownerId), '.runtime/app'), request)
        .generate(config, input)
    }
    return createImageGenerationProvider(config.provider, request, resultRequest).generate(config, input)
  } }
}
export * from './config'
export * from './provider'
