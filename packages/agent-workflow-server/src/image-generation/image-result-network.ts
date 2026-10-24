import { createPinnedRuntimeFetch } from '../beegame/model-runtime-network'
import { modelRuntimeFetch } from '../beegame/model-runtime-transport'
import {
  getTLSFetchOptions,
  inspectOutboundTarget,
  type OutboundTargetPolicyOptions,
} from '@bee-game-studio/security-core'
import { createPublicOutboundDns, type PublicIpv4Resolver } from '../public-outbound-policy'
import { ImageProviderError } from './provider'

export type ImageResultRequest = (url: string, init: RequestInit) => Promise<Response>

export type ImageResultRequestOptions = {
  dns?: Pick<OutboundTargetPolicyOptions, 'resolve4' | 'resolve6'>
  /** Test-owned public DNS injection; production uses the pinned DoH resolver. */
  resolvePublic4?: PublicIpv4Resolver
  /** Test-only transport injection; production uses the pinned Undici path. */
  baseFetch?: typeof fetch
}

/** Build the host-owned network boundary for an untrusted provider image URL. */
export function createImageResultRequest(options: ImageResultRequestOptions): ImageResultRequest {
  const baseFetch = options.baseFetch ?? modelRuntimeFetch
  // Result CDN hosts are supplied by the provider, not configured model/MCP
  // endpoints. Validate each destination without inheriting their allowlist or
  // development proxy exception. Only DNS resolvers are shared.
  const resultPolicy: OutboundTargetPolicyOptions = {
    ...createPublicOutboundDns(options.dns, options.resolvePublic4),
    allowHttp: false,
    allowTrustedDevelopmentProxy: false,
  }
  return async (url, init) => {
    const inspection = await inspectOutboundTarget(url, resultPolicy)
    if (!inspection.approved) {
      console.warn('[image-generation]', {
        event: 'image-result-url-rejected',
        reason: inspection.code,
        hostname: inspection.hostname,
      })
      throw new ImageProviderError(
        'Cloudflare image result URL is not permitted',
        'unknown',
        undefined,
        'image-url-not-permitted',
      )
    }
    const tls = getTLSFetchOptions().tls
    const request = createPinnedRuntimeFetch(
      baseFetch,
      { imageResult: inspection.target },
      // Trust configured CAs, but never present API client credentials to a CDN.
      { tls: tls?.ca ? { ca: tls.ca } : undefined },
    )
    try {
      // Consume the body before closing the per-result dispatcher. The
      // provider validates and stores the same bytes after this callback.
      const response = await request(url, { method: 'GET', signal: init.signal, redirect: 'error' })
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
