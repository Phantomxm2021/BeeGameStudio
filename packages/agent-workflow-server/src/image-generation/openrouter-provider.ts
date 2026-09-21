import type { ImageGenerationConfig } from './config'
import { OpenAIImageProvider } from './openai-provider'

// The dedicated Image API shares the JSON request and base64 response transport,
// but NOT OpenAI's endpoint or usage schema. Preserve raw usage.cost for pricing.
export class OpenRouterImageProvider extends OpenAIImageProvider {
  protected override endpoint(config: ImageGenerationConfig): string {
    return config.baseUrl
  }
}
