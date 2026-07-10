import { describe, expect, mock, test } from 'bun:test'
import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'
import {
  createPinnedWebSocketConnection,
  createPinnedRemoteMcpConnection,
  validateLocalIdeMcpUrl,
  type RemoteMcpConnectionDependencies,
  type RemoteMcpWebSocketDependencies,
} from '../client'

const approvedTarget: ApprovedOutboundTarget = {
  url: new URL('https://mcp.example.test/rpc'),
  addresses: ['93.184.216.34'],
  lookup: (_hostname, _options, callback) => callback(null, '93.184.216.34', 4),
}

describe('createPinnedRemoteMcpConnection', () => {
  test('uses its pinned dispatcher for request and persistent EventSource fetches', async () => {
    const close = mock(async () => {})
    const dispatcher = { close }
    const resolveApprovedOutboundTarget = mock(async () => approvedTarget)
    const dependencies: RemoteMcpConnectionDependencies = {
      resolveApprovedOutboundTarget,
      createPinnedUndiciDispatcher: () => dispatcher as never,
    }
    const fetchCalls: RequestInit[] = []
    const fetch = mock(async (_url: string | URL, init?: RequestInit) => {
      fetchCalls.push(init ?? {})
      return new Response('ok')
    })

    const connection = await createPinnedRemoteMcpConnection(
      'https://mcp.example.test/rpc',
      dependencies,
    )

    await connection.fetch(fetch)('https://mcp.example.test/rpc', {
      method: 'POST',
    })
    await connection.eventSourceFetch(fetch)(
      'https://mcp.example.test/events',
      { method: 'GET' },
    )

    expect(resolveApprovedOutboundTarget).toHaveBeenCalledWith(
      'https://mcp.example.test/rpc',
    )
    expect(connection.requestInit).toMatchObject({
      dispatcher,
      redirect: 'error',
    })
    expect(fetchCalls).toEqual([
      expect.objectContaining({
        dispatcher,
        method: 'POST',
        redirect: 'error',
      }),
      expect.objectContaining({ dispatcher, method: 'GET', redirect: 'error' }),
    ])

    await connection.close()
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('rejects a forbidden endpoint before creating a dispatcher', async () => {
    const createPinnedUndiciDispatcher = mock(() => ({ close: async () => {} }))
    const dependencies: RemoteMcpConnectionDependencies = {
      resolveApprovedOutboundTarget: async () => null,
      createPinnedUndiciDispatcher: createPinnedUndiciDispatcher as never,
    }

    await expect(
      createPinnedRemoteMcpConnection('https://127.0.0.1/mcp', dependencies),
    ).rejects.toThrow('Outbound URL is not permitted')
    expect(createPinnedUndiciDispatcher).not.toHaveBeenCalled()
  })

  test('does not apply a pinned dispatcher to a different origin or port', async () => {
    const dependencies: RemoteMcpConnectionDependencies = {
      resolveApprovedOutboundTarget: async () => approvedTarget,
      createPinnedUndiciDispatcher: () => ({ close: async () => {} }) as never,
    }
    const connection = await createPinnedRemoteMcpConnection(
      approvedTarget.url.toString(),
      dependencies,
    )
    const fetch = mock(async () => new Response('ok'))

    await expect(
      connection.fetch(fetch)('https://mcp.example.test:8443/rpc'),
    ).rejects.toThrow('Pinned MCP connection origin mismatch')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('createPinnedWebSocketConnection', () => {
  function createDependencies(
    resolveApprovedOutboundTarget: RemoteMcpWebSocketDependencies['resolveApprovedOutboundTarget'],
  ): RemoteMcpWebSocketDependencies {
    return {
      resolveApprovedOutboundTarget,
      createPinnedHttpAgent: () => ({ destroy: mock(() => {}) }) as never,
      createPinnedHttpsAgent: () => ({ destroy: mock(() => {}) }) as never,
    }
  }

  test('pins a secure WebSocket handshake to the policy-approved DNS lookup', async () => {
    const createPinnedHttpsAgent = mock(() => ({ destroy: mock(() => {}) }))
    const dependencies = createDependencies(mock(async () => approvedTarget))
    dependencies.createPinnedHttpsAgent = createPinnedHttpsAgent as never

    const connection = await createPinnedWebSocketConnection(
      'wss://mcp.example.test/rpc',
      dependencies,
    )

    expect(dependencies.resolveApprovedOutboundTarget).toHaveBeenCalledWith(
      'https://mcp.example.test/rpc',
    )
    expect(connection.url.toString()).toBe('wss://mcp.example.test/rpc')
    expect(createPinnedHttpsAgent).toHaveBeenCalledWith(approvedTarget)
  })

  test('rejects an unapproved WebSocket endpoint before creating an agent', async () => {
    const createPinnedHttpsAgent = mock(() => ({ destroy: mock(() => {}) }))
    const dependencies = createDependencies(async () => null)
    dependencies.createPinnedHttpsAgent = createPinnedHttpsAgent as never

    await expect(
      createPinnedWebSocketConnection('wss://127.0.0.1/mcp', dependencies),
    ).rejects.toThrow('Outbound URL is not permitted')
    expect(createPinnedHttpsAgent).not.toHaveBeenCalled()
  })

  test('rejects a policy result whose final WebSocket origin has a different port', async () => {
    const dependencies = createDependencies(async () => ({
      ...approvedTarget,
      url: new URL('https://mcp.example.test:8443/rpc'),
    }))

    await expect(
      createPinnedWebSocketConnection(
        'wss://mcp.example.test/rpc',
        dependencies,
      ),
    ).rejects.toThrow('Pinned WebSocket connection origin mismatch')
  })
})

describe('validateLocalIdeMcpUrl', () => {
  test.each([
    'http://example.test:3456/sse',
    'http://localhost:3456/sse',
    'http://127.0.0.1/sse',
    'http://127.0.0.1:80/sse',
    'ftp://127.0.0.1:3456/sse',
  ])('rejects an IDE endpoint outside literal loopback with explicit port: %s', value => {
    expect(() => validateLocalIdeMcpUrl(value, ['http:', 'https:'])).toThrow(
      'IDE MCP endpoint must use a loopback host and explicit port',
    )
  })

  test('accepts literal IPv4 and IPv6 loopback endpoints with explicit ports', () => {
    expect(
      validateLocalIdeMcpUrl('http://127.0.0.1:3456/sse', ['http:', 'https:'])
        .hostname,
    ).toBe('127.0.0.1')
    expect(
      validateLocalIdeMcpUrl('ws://[::1]:3456', ['ws:', 'wss:']).hostname,
    ).toBe('[::1]')
  })
})
