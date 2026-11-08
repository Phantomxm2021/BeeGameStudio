import { expect, test } from 'bun:test'
import { resolveApprovedOutboundTarget } from '@bee-game-studio/security-core'
import { createMcpOutboundPolicy, inspectMcpOutboundTarget, resolveMcpOutboundTarget } from '../mcp-outbound-policy'

const publicDns = { resolve4: () => ['93.184.216.34'], resolve6: () => [] }

test('public MCP is independent of provider whitelist, HTTP and proxy exceptions', async () => {
  const options = { ...publicDns, allowedHosts: ['model.example'], allowHttp: true, allowTrustedDevelopmentProxy: true }
  expect(await resolveMcpOutboundTarget('https://new-mcp.example/mcp', options)).not.toBeNull()
  expect(await resolveApprovedOutboundTarget('https://new-mcp.example/mcp', options)).toBeNull()
  for (const url of ['http://new-mcp.example', 'https://u:p@new-mcp.example', 'https://new-mcp.example:8888',
    'https://127.0.0.1', 'https://169.254.169.254', 'https://10.0.0.1', 'https://198.18.0.15', 'https://[::ffff:127.0.0.1]']) {
    expect(await resolveMcpOutboundTarget(url, options)).toBeNull()
  }
})

test('Fake-IP DNS is independently resolved, checked and pinned without a trusted-proxy bypass', async () => {
  let lookups = 0
  const policy = createMcpOutboundPolicy({ resolve4: () => ['198.18.0.15'], resolve6: () => [] }, async hostname => {
    expect(hostname).toBe('mcp.example'); lookups++; return ['93.184.216.34']
  })
  const target = await resolveApprovedOutboundTarget('https://mcp.example/mcp', policy)
  expect(target?.addresses).toEqual(['93.184.216.34'])
  expect(target?.trustedDevelopmentProxy).toBeUndefined()
  const ip = await new Promise(resolve => target!.lookup('mcp.example', {}, (error, address) => { expect(error).toBeNull(); resolve(address) }))
  expect(ip).toBe('93.184.216.34')
  expect(lookups).toBe(1)
  for (const answer of [[], ['10.0.0.1'], ['198.19.1.1'], ['not-an-ip'], ['93.184.216.34', '127.0.0.1']]) {
    const invalid = createMcpOutboundPolicy({ resolve4: () => ['198.18.0.15'], resolve6: () => [] }, async () => answer)
    expect(await resolveApprovedOutboundTarget('https://mcp.example', invalid)).toBeNull()
  }
  const failed = createMcpOutboundPolicy({ resolve4: () => ['198.18.0.15'], resolve6: () => [] }, async () => { throw Error('unavailable') })
  expect(await resolveApprovedOutboundTarget('https://mcp.example', failed)).toBeNull()
})

test('private or mixed DNS never invokes the Fake-IP fallback and IPv6 is still checked', async () => {
  for (const addresses of [['10.0.0.1'], ['127.0.0.1'], ['198.18.0.15', '93.184.216.34'], ['198.18.0.15', '10.0.0.1']]) {
    let lookups = 0
    const policy = createMcpOutboundPolicy({ resolve4: () => addresses, resolve6: () => [] }, async () => { lookups++; return ['93.184.216.34'] })
    expect(await resolveApprovedOutboundTarget('https://mcp.example', policy)).toBeNull()
    expect(lookups).toBe(0)
  }
  const policy = createMcpOutboundPolicy({ resolve4: () => ['198.18.0.15'], resolve6: () => ['::1'] }, async () => ['93.184.216.34'])
  expect(await resolveApprovedOutboundTarget('https://mcp.example', policy)).toBeNull()
})

test('MCP inspection retains shared refusal codes without applying a provider domain allowlist', async () => {
  const options = { ...publicDns, allowedHosts: ['model.example'] }
  expect((await inspectMcpOutboundTarget('https://new-mcp.example', options)).approved).toBe(true)
  for (const [url, code] of [
    ['bad URL', 'invalid_url'], ['http://public.example', 'unsupported_protocol'],
    ['https://u:p@public.example', 'embedded_credentials'], ['https://public.example:8888', 'port_not_allowed'],
    ['https://127.0.0.1', 'address_not_public'], ['https://169.254.169.254', 'address_not_public'],
  ]) expect(await inspectMcpOutboundTarget(url!, options)).toMatchObject({ approved: false, code })
  expect(await inspectMcpOutboundTarget('https://unresolved.example', {
    resolve4: () => { throw Error('DNS lookup failed') }, resolve6: () => [],
  })).toEqual({ approved: false, code: 'dns_unresolved', hostname: 'unresolved.example' })
  expect(await inspectMcpOutboundTarget('https://mixed.example', {
    resolve4: () => ['93.184.216.34', '10.0.0.1'], resolve6: () => [],
  })).toMatchObject({ approved: false, code: 'address_not_public' })
})
