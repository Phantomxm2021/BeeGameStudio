import type { ImageGenerationConfig } from './config'

export type ImageRequest = {
  prompt: string
  background?: 'auto' | 'opaque' | 'transparent'
  signal?: AbortSignal
}
export type ImageResult = {
  bytes: Uint8Array
  mimeType: 'image/png'
  model: string
  providerRequestId?: string
  usage: unknown
}
export interface ImageGenerationProvider {
  generate(config: ImageGenerationConfig, request: ImageRequest): Promise<ImageResult>
}

export class ImageProviderError extends Error {
  constructor(message: string, readonly outcome: 'rejected' | 'unknown', readonly status?: number,
    readonly code: string = 'provider-error') {
    super(message)
    this.name = 'ImageProviderError'
  }
}
