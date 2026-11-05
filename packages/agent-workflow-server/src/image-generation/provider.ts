import { randomUUID } from 'node:crypto'
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
/** Host-only completed output. The URL may be signed; never expose it in tool results or logs. */
export type ImageResultReference = Omit<ImageResult, 'bytes'> & { url: string }
export type ImageProviderContext = {
  ownerId: string
  source?: ImageSource
  /** Persist before downloading so a failed GET or restart does not lose paid output. */
  onResultReference?: (reference: ImageResultReference) => void
}
export interface ImageGenerationProvider {
  generate(config: ImageGenerationConfig, request: ImageRequest, context?: ImageProviderContext): Promise<ImageResult>
  /** Download an already completed result; this must never submit a generation request. */
  recover?(config: ImageGenerationConfig, reference: ImageResultReference, signal?: AbortSignal): Promise<ImageResult>
}

export class ImageProviderError extends Error {
  readonly diagnosticId = randomUUID()
  constructor(message: string, readonly outcome: 'rejected' | 'unknown', readonly status?: number,
    readonly code: string = 'provider-error', options?: ErrorOptions) {
    super(message, options)
    this.name = 'ImageProviderError'
  }
}
