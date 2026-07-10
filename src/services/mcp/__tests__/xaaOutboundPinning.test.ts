import { describe, expect, mock, test } from 'bun:test'
import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'
import { createPolicyResolvingPinnedFetch } from '../pinnedOutboundFetch'

const approvedTarget: ApprovedOutboundTarget = {
  url: new URL('https://idp.example.test/token'),
  addresses: ['93.184.216.34'],
  lookup: (_hostname, _options, callback) => callback(null, '93.184.216.34', 4),
}

describe('XAA outbound transport', () => {
  test('resolves and pins metadata or token requests while rejecting redirects', async () => {
    const baseFetch = mock(async () => new Response('{}'))
    const dispatcher = { close: mock(async () => {}) }
    const fetchFn = createPolicyResolvingPinnedFetch({
      baseFetch: baseFetch as never,
      resolveApprovedOutboundTarget: mock(async () => approvedTarget),
      createPinnedUndiciDispatcher: () => dispatcher as never,
    })

    const response = await fetchFn('https://idp.example.test/token', { method: 'POST' })
    await response.text()

    expect(baseFetch).toHaveBeenCalledWith(
      approvedTarget.url,
      expect.objectContaining({ dispatcher, redirect: 'error' }),
    )
    expect(dispatcher.close).toHaveBeenCalledTimes(1)
  })

  test('fails closed before metadata or token requests to a denied endpoint', async () => {
    const baseFetch = mock(async () => new Response('{}'))
    const fetchFn = createPolicyResolvingPinnedFetch({
      baseFetch: baseFetch as never,
      resolveApprovedOutboundTarget: async () => null,
      createPinnedUndiciDispatcher: (() => ({ close: async () => {} })) as never,
    })

    await expect(fetchFn('https://127.0.0.1/token')).rejects.toThrow('Outbound URL is not permitted')
    expect(baseFetch).not.toHaveBeenCalled()
  })
})
