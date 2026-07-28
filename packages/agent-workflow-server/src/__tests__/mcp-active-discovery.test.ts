import { afterEach, describe, expect, test } from 'bun:test'
import { discoverActiveMcpServers } from '../mcp-active-discovery'

const originalFetch = globalThis.fetch

afterEach(async () => {
  globalThis.fetch = originalFetch
})

describe('active MCP discovery', () => {
  test('connects to its bounded loopback candidate without the public outbound policy', async () => {
    const port = 41000
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname !== '/') return new Response('not found', { status: 404 })
      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: { protocolVersion: '2024-11-05', serverInfo: { name: 'local' } },
      })
    }) as unknown as typeof fetch

    const discovered = await discoverActiveMcpServers([], { ports: [port], timeoutMs: 500 })

    expect(discovered).toHaveLength(1)
    expect(discovered[0]?.endpoint).toBe(`http://127.0.0.1:${port}/`)
  })

  test('does not follow a redirect from a loopback candidate', async () => {
    const port = 41001
    globalThis.fetch = (async () => {
      throw new TypeError('redirect error')
    }) as unknown as typeof fetch

    const discovered = await discoverActiveMcpServers([], { ports: [port], timeoutMs: 500 })

    expect(discovered).toEqual([])
  })
})
