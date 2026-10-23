import { afterEach, describe, expect, test } from 'bun:test'
import { discoverActiveMcpServers, testMcpServerConnection } from '../mcp-active-discovery'
import { createRequire } from 'node:module'

const originalFetch = globalThis.fetch

afterEach(async () => {
  globalThis.fetch = originalFetch
})

describe('active MCP discovery', () => {
  test('initializes a stdio server with configured environment without inheriting host secrets or invoking tools', async () => {
    const require = createRequire(import.meta.url)
    const code = `import {McpServer} from ${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/server/mcp.js'))};
import {StdioServerTransport} from ${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/server/stdio.js'))};
const configured=process.env.FIXTURE_MCP_VALUE==='configured' && !process.env.BGS_MCP_TEST_HOST_SECRET;
const server=new McpServer({name:configured?'fixture':'bad-environment',version:'1'});
server.registerTool('must_not_run',{inputSchema:{}},async()=>{process.exit(1)});
await server.connect(new StdioServerTransport());`
    const previous = process.env.BGS_MCP_TEST_HOST_SECRET
    process.env.BGS_MCP_TEST_HOST_SECRET = 'must-not-be-inherited'
    try {
      const result = await testMcpServerConnection({
        name: 'Fixture', enabled: true, transport: 'stdio', scope: 'beegame', command: process.execPath,
        args: ['--eval', code], env: [{ key: 'FIXTURE_MCP_VALUE', value: 'configured' }],
      })
      expect(result).toMatchObject({ ok: true, status: 'available', serverInfo: { name: 'fixture', version: '1' } })
      expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.BGS_MCP_TEST_HOST_SECRET
      else process.env.BGS_MCP_TEST_HOST_SECRET = previous
    }
  })

  test('reports an uninstalled stdio command as unavailable', async () => {
    const result = await testMcpServerConnection({
      name: 'Missing', enabled: true, transport: 'stdio', scope: 'beegame', command: '/not-installed/bgs-mcp',
    })
    expect(result).toMatchObject({ ok: false, status: 'unavailable' })
    expect(result.message).toContain('executable was not found')
  })

  test('times out and closes a stdio server that does not respond', async () => {
    const result = await testMcpServerConnection({
      name: 'Unresponsive', enabled: true, transport: 'stdio', scope: 'beegame', command: process.execPath,
      args: ['--eval', 'process.stdin.resume();process.stdin.on("end",()=>process.exit())'],
    }, { timeoutMs: 100 })
    expect(result).toMatchObject({ ok: false, status: 'unavailable', message: 'MCP initialize timed out.' })
  })

  test('continues to report a failed HTTP test as unavailable', async () => {
    const result = await testMcpServerConnection({
      name: 'Missing endpoint', enabled: true, transport: 'http', scope: 'beegame',
    })
    expect(result).toMatchObject({ ok: false, status: 'unavailable' })
  })

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
