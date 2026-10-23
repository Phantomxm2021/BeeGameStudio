import { createPinnedRuntimeFetch } from '../beegame/model-runtime-network'
import { modelRuntimeFetch } from '../beegame/model-runtime-transport'
import {
  getTLSFetchOptions,
  resolveApprovedOutboundTarget,
  type OutboundTargetPolicyOptions,
} from '@bee-game-studio/security-core'
import { ImageProviderError } from './provider'

export type ImageResultRequest = (url: string, init: RequestInit) => Promise<Response>

export type ImageResultRequestOptions = {
  resolveOutboundTarget: typeof resolveApprovedOutboundTarget
  outboundTargetPolicyOptions: OutboundTargetPolicyOptions
  /** Test-only transport injection; production uses the pinned Undici path. */
  baseFetch?: typeof fetch
}

/** Build the host-owned network boundary for an untrusted provider image URL. */
export function createImageResultRequest(options: ImageResultRequestOptions): ImageResultRequest {
  const baseFetch = options.baseFetch ?? modelRuntimeFetch
  return async (url, init) => {
    const target = await options.resolveOutboundTarget(
      url,
      options.outboundTargetPolicyOptions,
    )
    if (!target)
      throw new ImageProviderError(
        'Cloudflare image result URL is not permitted',
        'unknown',
        undefined,
        'image-url-not-permitted',
      )
    const request = createPinnedRuntimeFetch(
      baseFetch,
      { imageResult: target },
      { tls: getTLSFetchOptions().tls },
    )
    try {
      // Consume the body before closing the per-result dispatcher. The
      // provider validates and stores the same bytes after this callback.
      const response = await request(url, { ...init, redirect: 'error' })
      const bytes = await response.arrayBuffer()
      return new Response(bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    } finally {
      await request.close()
    }
  }
}
