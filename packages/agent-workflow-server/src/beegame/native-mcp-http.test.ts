import { expect, test, spyOn } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startNativeMcpHttp } from './native-mcp-http'
import { prepareNativeMcpConfig, NATIVE_MCP_CONFIG_ENV } from './native-mcp-config'

test('an unapproved HTTP MCP is reported without aborting native configuration', async () => {
  const prepared = await prepareNativeMcpConfig({ [NATIVE_MCP_CONFIG_ENV]: JSON.stringify([
    { id: 'blocked', enabled: true, autoStart: true, scope: 'global', transport: 'http', url: 'https://127.0.0.1/mcp?secret=private' },
  ]) }, process.cwd())
  try {
    expect(prepared.config.mcp_servers).toEqual({})
    expect(prepared.context).toContain('bgs-blocked: address_not_public')
    expect(prepared.context).not.toContain('private')
  } finally { await prepared.close() }
  const user=await prepareNativeMcpConfig({[NATIVE_MCP_CONFIG_ENV]:JSON.stringify([
    {id:'ui-layout',enabled:true,autoStart:true,scope:'global',transport:'stdio',command:'/fixture/user-tool'},
  ])},process.cwd())
  try{expect(user.config.mcp_servers).toHaveProperty('bgs-ui-layout')}
  finally{await user.close()}
})

test('DNS failures and security refusals isolate only their HTTP MCP across fresh preparation and recovery', async () => {
  const servers = [
    { id: 'dns', name: 'Search', transport: 'http', url: 'https://unresolved.invalid/mcp?token=private' },
    { id: 'private', name: 'Internal', transport: 'http', url: 'https://10.0.0.1/mcp' },
    { id: 'public', name: 'Public', transport: 'http', url: 'https://public.invalid/mcp', enabledTools: ['search'], disabledTools: ['write'] },
    { id: 'browser', name: 'Browser', transport: 'stdio', command: '/fixture/browser' },
  ].map(server => ({ ...server, enabled: true, autoStart: true, scope: 'beegame' }))
  const raw = JSON.stringify(servers)
  let lookups = 0
  for (let round = 0; round < 2; round++) {
    const prepared = await prepareNativeMcpConfig({ [NATIVE_MCP_CONFIG_ENV]: raw }, process.cwd(), 'fixture', { outboundTargetPolicyOptions: { resolve4: hostname => {
        lookups++
        if (hostname === 'unresolved.invalid') throw Object.assign(Error('DNS fixture failure'), { code: 'ETIMEOUT' })
        return ['93.184.216.34']
      }, resolve6: () => [] } }, '/host/images.mjs')
    const config = prepared.config.mcp_servers as Record<string, any>
    try {
      expect(Object.keys(config).sort()).toEqual(['beegame-images', 'bgs-browser', 'bgs-public'])
      expect(config['bgs-public']).toMatchObject({ enabled_tools: ['search'], disabled_tools: ['write'] })
      expect(config['bgs-public'].url).toMatch(/^http:\/\/127\.0\.0\.1:/)
      expect(config['bgs-browser'].command).toBe('/fixture/browser')
      expect(config['beegame-images'].args).toEqual(['/host/images.mjs', '--mcp'])
      expect(prepared.context).toContain('bgs-dns: dns_unresolved')
      expect(prepared.context).toContain('bgs-private: address_not_public')
      expect(prepared.context).not.toContain('token=')
      expect(JSON.stringify(servers)).toBe(raw)
    } finally { await prepared.close(); await prepared.close() }
    await expect(fetch(config['bgs-public'].url)).rejects.toThrow()
    const { access } = await import('node:fs/promises')
    await expect(access(config['bgs-browser'].env.PWTEST_SOCKETS_DIR)).rejects.toMatchObject({ code: 'ENOENT' })
  }
  expect(lookups).toBe(4)
})

test('invalid MCP configuration and relay failures remain errors instead of becoming unavailable tools', async () => {
  await expect(prepareNativeMcpConfig({ [NATIVE_MCP_CONFIG_ENV]: '{broken' }, process.cwd())).rejects.toThrow()
  await expect(startNativeMcpHttp({ broken: { url: 'https://public.invalid', headers: [{ key: 'Host', value: 'bad' }] } }))
    .rejects.toThrow('MCP header')
  await expect(startNativeMcpHttp({ broken: 'https://public.invalid' }, { inspectOutboundTarget: async () => {
    throw Error('Broken internal inspector')
  } })).rejects.toThrow('Broken internal inspector')
  const serve = spyOn(Bun, 'serve').mockImplementation(() => { throw Error('Relay listen failed') })
  try {
    await expect(prepareNativeMcpConfig({ [NATIVE_MCP_CONFIG_ENV]: JSON.stringify([
      { id: 'public', enabled: true, autoStart: true, scope: 'global', transport: 'http', url: 'https://public.invalid' },
    ]) }, process.cwd(), undefined, { outboundTargetPolicyOptions: {
      resolve4: () => ['93.184.216.34'], resolve6: () => [],
    } })).rejects.toThrow('Relay listen failed')
  } finally { serve.mockRestore() }
})

test('HTTP MCP pins DNS, preserves native protocol sessions, blocks redirects and closes its listener', async () => {
  let initialize = 0, redirected = 0
  const trap = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { redirected++; return new Response('unexpected') } })
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    expect(request.headers.get('authorization')).toBe('Bearer fixture-secret')
    expect(request.headers.get('x-api-key')).toBe('fixture-key')
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
  const relay = await startNativeMcpHttp({ unavailable: 'https://unresolved.invalid/mcp', fixture: { url: `http://synthetic-mcp.invalid:${upstream.port}/mcp`, headers: [{ key: 'Authorization', value: 'Bearer fixture-secret' }, { key: 'X-API-Key', value: 'fixture-key' }] } }, {
    outboundTargetPolicyOptions: { allowedHosts: ['model.example'], allowHttp: true, allowTrustedDevelopmentProxy: true },
    inspectOutboundTarget: async (value, policy) => {
      if (new URL(value).hostname === 'unresolved.invalid') return { approved: false, code: 'dns_unresolved' }
      expect(policy).toMatchObject({ allowedHosts: [], allowHttp: false, allowTrustedDevelopmentProxy: false })
      return { approved: true, target: { url: new URL(value), addresses: ['127.0.0.1'],
        lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) } }
    },
  })
  expect(relay.unavailable).toEqual(['unavailable: dns_unresolved'])
  expect(relay.config).not.toHaveProperty('unavailable')
  expect(JSON.stringify(relay.config)).not.toContain('fixture-secret')
  expect(JSON.stringify(relay.config)).not.toContain('fixture-key')
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
    const auth = await send({ auth: true }, { authorization: 'Bearer caller-must-not-override' })
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
    inspectOutboundTarget: async value => ({ approved: true, target: { url: new URL(value), addresses: ['127.0.0.1'],
      lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) } }),
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
