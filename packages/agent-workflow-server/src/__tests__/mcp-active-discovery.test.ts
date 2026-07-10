import { afterEach, describe, expect, test } from 'bun:test'
import { createServer, type RequestListener, type Server } from 'node:http'
import { discoverActiveMcpServers } from '../mcp-active-discovery'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

async function startServer(handler: RequestListener): Promise<number> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
  return address.port
}

describe('active MCP discovery', () => {
  test('connects to its bounded loopback candidate without the public outbound policy', async () => {
    const port = await startServer((req, res) => {
      if (req.url !== '/') {
        res.writeHead(404)
        res.end()
        return
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'local' } } }))
    })

    const discovered = await discoverActiveMcpServers([], { ports: [port], timeoutMs: 500 })

    expect(discovered).toHaveLength(1)
    expect(discovered[0]?.endpoint).toBe(`http://127.0.0.1:${port}/`)
  })

  test('does not follow a redirect from a loopback candidate', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(302, { location: 'http://127.0.0.1:1/escaped' })
      res.end()
    })

    const discovered = await discoverActiveMcpServers([], { ports: [port], timeoutMs: 500 })

    expect(discovered).toEqual([])
  })
})
