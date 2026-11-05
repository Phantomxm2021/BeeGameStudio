import type { ImageGenerationConfig } from './config'
import type { ImageRequest } from './provider'
import { OpenAIImageProvider } from './openai-provider'

// The dedicated Image API shares the JSON request and base64 response transport,
// but NOT OpenAI's endpoint or usage schema. Preserve raw usage; pricing accepts
// only a trustworthy token-category breakdown.
export class OpenRouterImageProvider extends OpenAIImageProvider {
  protected override endpoint(config: ImageGenerationConfig): string {
    return config.baseUrl
  }

  protected override body(config: ImageGenerationConfig, input: ImageRequest) {
    const { images, ...body } = super.body(config, input)
    return { ...body, ...(images ? { input_references: images.map(image => ({
      type: 'image_url', image_url: { url: image.image_url },
    })) } : {}) }
  }
}
