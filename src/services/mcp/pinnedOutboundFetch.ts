import {
  createPinnedUndiciDispatcher,
  resolveApprovedOutboundTarget,
} from '@bee-game-studio/security-core'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'

type DispatcherRequestInit = RequestInit & { dispatcher?: unknown }

export type PinnedOutboundFetchDependencies = {
  baseFetch: typeof fetch
  resolveApprovedOutboundTarget: typeof resolveApprovedOutboundTarget
  createPinnedUndiciDispatcher: typeof createPinnedUndiciDispatcher
}

const dependencies: PinnedOutboundFetchDependencies = {
  baseFetch: fetch,
  resolveApprovedOutboundTarget,
  createPinnedUndiciDispatcher,
}

/** Resolves each HTTP(S) request immediately before use and rejects redirects. */
export function createPolicyResolvingPinnedFetch(
  overrides: PinnedOutboundFetchDependencies = dependencies,
): FetchLike {
  return async (input: string | URL, init?: RequestInit) => {
    let url: URL
    try {
      url = new URL(input.toString())
    } catch {
      return overrides.baseFetch(input, init)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return overrides.baseFetch(input, init)
    }

    const target = await overrides.resolveApprovedOutboundTarget(url.toString())
    if (!target) throw new Error('Outbound URL is not permitted')
    const dispatcher = overrides.createPinnedUndiciDispatcher(target)
    try {
      const response = await overrides.baseFetch(target.url, {
        ...init,
        redirect: 'error',
        dispatcher,
      } as DispatcherRequestInit)
      return closePinnedResponse(response, dispatcher)
    } catch (error) {
      await dispatcher.close()
      throw error
    }
  }
}

function closePinnedResponse(
  response: Response,
  dispatcher: ReturnType<typeof createPinnedUndiciDispatcher>,
): Response {
  if (!response.body) {
    void dispatcher.close()
    return response
  }
  const reader = response.body.getReader()
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await dispatcher.close()
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {
          controller.close()
          await close()
        } else controller.enqueue(chunk.value)
      } catch (error) {
        controller.error(error)
        await close()
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        await close()
      }
    },
  })
  return new Response(body, response)
}
