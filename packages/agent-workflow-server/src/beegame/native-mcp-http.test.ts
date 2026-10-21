import { expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startNativeMcpHttp } from './native-mcp-http'
import { prepareNativeMcpConfig, NATIVE_MCP_CONFIG_ENV } from './native-mcp-config'

test('HTTP MCP rejects unapproved stored endpoints before starting a relay', async () => {
  let checks = 0
  await expect(prepareNativeMcpConfig({ [NATIVE_MCP_CONFIG_ENV]: JSON.stringify([
    { id: 'blocked', enabled: true, autoStart: true, scope: 'global', transport: 'http', url: 'http://127.0.0.1:9/mcp' },
  ]) }, process.cwd(), undefined, undefined, { resolveOutboundTarget: async () => { checks++; return undefined } }))
    .rejects.toThrow('MCP endpoint is not permitted')
  expect(checks).toBe(1)
  await expect(prepareNativeMcpConfig({ [NATIVE_MCP_CONFIG_ENV]: JSON.stringify([
    { id: 'ui-layout', enabled: true, autoStart: true, scope: 'global', transport: 'http', url: 'https://synthetic.invalid' },
  ]) }, process.cwd(), {} as any)).rejects.toThrow('reserved')
})

test('HTTP MCP pins DNS, preserves native protocol sessions, blocks redirects and closes its listener', async () => {
  let initialize = 0, redirected = 0
  const trap = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { redirected++; return new Response('unexpected') } })
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET') return new Response(null, { status: 405 })
    if (request.method === 'DELETE') return new Response(null, { status: 204 })
    const body = await request.json() as any
    expect(request.headers.has('x-bgs-mcp-token')).toBe(false)
    if (body.redirect) return new Response(null, { status: 307, headers: { location: trap.url.toString() } })
    if (body.auth) return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="http://127.0.0.1:9/private"' } })
    if (body.method === 'initialize') {
      initialize++
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: body.params.protocolVersion,
        capabilities: { tools: {} }, serverInfo: { name: 'offline', version: '1' } } }, { headers: { 'mcp-session-id': 'offline-session' } })
    }
    expect(request.headers.get('mcp-session-id')).toBe('offline-session')
    if (!body.id) return new Response(null, { status: 202 })
    return Response.json({ jsonrpc: '2.0', id: body.id, result: body.method === 'tools/list'
      ? { tools: [{ name: 'offline_probe', inputSchema: { type: 'object' } }] }
      : { content: [{ type: 'text', text: 'offline success' }] } })
  } })
  const relay = await startNativeMcpHttp({ fixture: `http://synthetic-mcp.invalid:${upstream.port}/mcp` }, {
    resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['127.0.0.1'],
      lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }),
  })
  const config = relay.config.fixture!, client = new Client({ name: 'offline-client', version: '1' })
  const send = (body: unknown, extraHeaders: Record<string, string> = {}) => fetch(config.url, {
    method: 'POST', headers: { ...config.http_headers, 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body),
  })
  try {
    expect((await fetch(config.url, { method: 'POST', body: '{}' })).status).toBe(404)
    expect((await send({}, { origin: 'https://untrusted.invalid' })).status).toBe(404)
    await client.connect(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.http_headers } }))
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['offline_probe'])
    expect(await client.callTool({ name: 'offline_probe', arguments: {} })).toMatchObject({ content: [{ text: 'offline success' }] })
    expect((await fetch(config.url, { method: 'DELETE', headers: config.http_headers })).status).toBe(204)
    expect(initialize).toBe(1)
    expect((await send({ redirect: true })).status).toBe(502)
    expect(redirected).toBe(0)
    const auth = await send({ auth: true })
    expect(auth.status).toBe(502)
    expect(auth.headers.has('www-authenticate')).toBe(false)
    await client.close()
    await relay.close()
    await expect(fetch(config.url)).rejects.toThrow()
  } finally { await client.close(); await relay.close(); upstream.stop(true); trap.stop(true) }
})

test('HTTP MCP live streams deliver before EOF and cancellation drains the upstream socket', async () => {
  let cancelled!: () => void
  const stopped = new Promise<void>(resolve => { cancelled = resolve })
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"synthetic":"ready"}\n\n'))
    }, cancel() { cancelled() } }), { headers: { 'content-type': 'text/event-stream' } })
  } })
  const relay = await startNativeMcpHttp({ fixture: upstream.url.toString() }, {
    resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['127.0.0.1'],
      lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }),
  })
  try {
    const response = await fetch(relay.config.fixture!.url, { headers: relay.config.fixture!.http_headers, signal: AbortSignal.timeout(2000) })
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('ready')
    await reader.cancel()
    await relay.close()
    await Promise.race([stopped, new Promise((_, reject) => setTimeout(() => reject(Error('MCP was not cancelled')), 2000))])
  } finally { await relay.close(); upstream.stop(true) }
}, 5000)
