import type { ImageGenerationConfig } from './config'
import type { ImageRequest } from './provider'
import { OpenAIImageProvider } from './openai-provider'

/** Vercel image-only models use the OpenAI Images API, not chat completions. */
export class VercelImageProvider extends OpenAIImageProvider {
  protected override body(config: ImageGenerationConfig, input: ImageRequest) {
    return { ...super.body(config, input), response_format: 'b64_json' }
  }
}
