import { describe, expect, mock, test } from 'bun:test'
import {
  ClaudeAuthProvider,
  createPolicyResolvingOAuthFetch,
  type OAuthOutboundTransportDependencies,
} from '../auth'
import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'

const approvedTarget: ApprovedOutboundTarget = {
  url: new URL('https://auth.example.test/token'),
  addresses: ['93.184.216.34'],
  lookup: (_hostname, _options, callback) => callback(null, '93.184.216.34', 4),
}

function createDependencies(
  resolveApprovedOutboundTarget: OAuthOutboundTransportDependencies['resolveApprovedOutboundTarget'],
): OAuthOutboundTransportDependencies & { baseFetch: ReturnType<typeof mock> } {
  const baseFetch = mock(async () => new Response('{}'))
  return {
    baseFetch: baseFetch as never,
    resolveApprovedOutboundTarget,
    createPinnedUndiciDispatcher: () =>
      ({ close: mock(async () => {}) }) as never,
  }
}

describe('OAuth outbound transport', () => {
  test('denies a private OAuth endpoint before issuing a request', async () => {
    const dependencies = createDependencies(async () => null)
    const authFetch = createPolicyResolvingOAuthFetch(dependencies)

    await expect(authFetch('https://127.0.0.1/token')).rejects.toThrow(
      'Outbound URL is not permitted',
    )

    expect(dependencies.baseFetch).not.toHaveBeenCalled()
  })

  test('uses a newly resolved pinned dispatcher instead of a rebinding DNS lookup', async () => {
    const resolveApprovedOutboundTarget = mock(async () => approvedTarget)
    const dispatcher = { close: mock(async () => {}) }
    const dependencies = createDependencies(resolveApprovedOutboundTarget)
    dependencies.createPinnedUndiciDispatcher = () => dispatcher as never
    const authFetch = createPolicyResolvingOAuthFetch(dependencies)

    const response = await authFetch('https://auth.example.test/token', {
      method: 'POST',
    })
    await response.text()

    expect(resolveApprovedOutboundTarget).toHaveBeenCalledWith(
      'https://auth.example.test/token',
    )
    expect(dependencies.baseFetch).toHaveBeenCalledWith(
      approvedTarget.url,
      expect.objectContaining({ dispatcher, redirect: 'error' }),
    )
    expect(dispatcher.close).toHaveBeenCalledTimes(1)
  })

  test('sets redirect error for OAuth requests', async () => {
    const dependencies = createDependencies(async () => approvedTarget)
    const authFetch = createPolicyResolvingOAuthFetch(dependencies)

    await authFetch('https://auth.example.test/token')

    expect(dependencies.baseFetch).toHaveBeenCalledWith(
      approvedTarget.url,
      expect.objectContaining({ redirect: 'error' }),
    )
  })

  test('denies a discovered private authorization endpoint before opening it', async () => {
    const provider = new ClaudeAuthProvider(
      'test-server',
      { type: 'http', url: 'https://mcp.example.test' },
      'http://127.0.0.1:3333/callback',
      true,
      undefined,
      true,
    )

    await expect(
      provider.redirectToAuthorization(new URL('https://127.0.0.1/authorize')),
    ).rejects.toThrow('Outbound URL is not permitted')
  })
})
