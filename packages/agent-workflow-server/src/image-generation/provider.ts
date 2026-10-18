import type { ImageGenerationConfig, ImageSource } from './config'

export type ImageRequest = {
  prompt: string
  quality?: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  background?: 'auto' | 'opaque' | 'transparent'
  size?: '1024x1024' | '1024x1536' | '1536x1024'
  referenceImage?: { bytes: Uint8Array; sha256: string; mimeType: 'image/png' }
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
  generate(config: ImageGenerationConfig, request: ImageRequest, context?: { ownerId: string; source?: ImageSource }): Promise<ImageResult>
}

export class ImageProviderError extends Error {
  constructor(message: string, readonly outcome: 'rejected' | 'unknown', readonly status?: number,
    readonly code: string = 'provider-error') {
    super(message)
    this.name = 'ImageProviderError'
  }
}
