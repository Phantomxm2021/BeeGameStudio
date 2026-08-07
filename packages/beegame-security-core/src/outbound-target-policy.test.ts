import { describe, expect, test } from 'bun:test'
import {
  createPinnedUndiciDispatcher,
  inspectOutboundTarget,
  resolveApprovedOutboundTarget,
} from './outbound-target-policy'

const publicResolvers = {
  resolve4: async () => ['93.184.216.34'],
  resolve6: async () => ['2606:2800:220:1:248:1893:25c8:1946'],
}

function lookupAddress(target: NonNullable<Awaited<ReturnType<typeof resolveApprovedOutboundTarget>>>) {
  return new Promise<{ address: string; family: number }>((resolve, reject) => {
    target.lookup(target.url.hostname, {}, (error, address, family) => {
      if (error) reject(error)
      else resolve({ address, family })
    })
  })
}

describe('resolveApprovedOutboundTarget', () => {
  test('uses injected resolvers to approve a public HTTPS hostname', async () => {
    const requestedHosts: string[] = []
    const target = await resolveApprovedOutboundTarget('https://API.Example.test/v1', {
      resolve4: async hostname => {
        requestedHosts.push(hostname)
        return ['93.184.216.34']
      },
      resolve6: async hostname => {
        requestedHosts.push(hostname)
        return []
      },
    })

    expect(requestedHosts).toEqual(['api.example.test', 'api.example.test'])
    expect(target?.url.hostname).toBe('api.example.test')
    expect(target?.addresses).toEqual(['93.184.216.34'])
  })

  test.each([
    'https://127.0.0.1/api',
    'https://169.254.169.254/latest',
    'https://10.0.0.1/api',
    'https://224.0.0.1/api',
    'https://[::1]/api',
    'https://[fe80::1]/api',
    'https://[ff02::1]/api',
  ])('rejects private or special-use address: %s', async value => {
    await expect(resolveApprovedOutboundTarget(value, publicResolvers)).resolves.toBeNull()
  })

  test.each([
    'https://[::127.0.0.1]/api',
    'https://[::10.0.0.1]/api',
    'https://[::c0a8:1]/api',
    'https://[::ffff:7f00:1]/api',
  ])('rejects IPv4-compatible or mapped IPv6 private address: %s', async value => {
    await expect(resolveApprovedOutboundTarget(value, publicResolvers)).resolves.toBeNull()
  })

  test.each([
    'not a url',
    'file:///etc/passwd',
    'http://api.example.test/v1',
    'https://user:pass@api.example.test/v1',
    'https://api.example.test:8443/v1',
  ])('rejects an unsafe target: %s', async value => {
    await expect(resolveApprovedOutboundTarget(value, publicResolvers)).resolves.toBeNull()
  })

  test('pins approved DNS answers so lookup never resolves again', async () => {
    let resolveCalls = 0
    const target = await resolveApprovedOutboundTarget('https://api.example.test/v1', {
      resolve4: async () => {
        resolveCalls += 1
        return ['93.184.216.34']
      },
      resolve6: async () => [],
    })

    expect(target).not.toBeNull()
    await expect(lookupAddress(target!)).resolves.toEqual({ address: '93.184.216.34', family: 4 })
    await expect(lookupAddress(target!)).resolves.toEqual({ address: '93.184.216.34', family: 4 })
    expect(resolveCalls).toBe(1)
  })

  test('returns a public HTTPS lookup that selects an approved address', async () => {
    const target = await resolveApprovedOutboundTarget('https://api.example.test/v1', publicResolvers)

    expect(target?.url.hostname).toBe('api.example.test')
    await expect(lookupAddress(target!)).resolves.toEqual({ address: '93.184.216.34', family: 4 })
  })

  test('creates a real Undici dispatcher under the Bun runtime', async () => {
    const target = await resolveApprovedOutboundTarget('https://api.example.test/v1', publicResolvers)
    expect(target).not.toBeNull()

    const dispatcher = createPinnedUndiciDispatcher(target!)
    expect(typeof dispatcher.dispatch).toBe('function')
    expect(typeof dispatcher.close).toBe('function')
    expect(typeof dispatcher.destroy).toBe('function')
    await dispatcher.close()
  })

  test('keeps explicit TLS trust material on the pinned dispatcher', async () => {
    const target = await resolveApprovedOutboundTarget('https://api.example.test/v1', publicResolvers)
    expect(target).not.toBeNull()

    const dispatcher = createPinnedUndiciDispatcher(target!, {
      tls: {
        ca: '-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----',
        cert: '-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----',
        key: '-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----',
        passphrase: 'test-passphrase',
      },
    })
    const optionsSymbol = Object.getOwnPropertySymbols(dispatcher)
      .find(symbol => symbol.description === 'options')
    expect(optionsSymbol).toBeDefined()
    expect((dispatcher as unknown as Record<symbol, { connect?: Record<string, unknown> }>)[optionsSymbol!].connect)
      .toMatchObject({
        ca: '-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----',
        cert: '-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----',
        key: '-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----',
        passphrase: 'test-passphrase',
      })
    await dispatcher.close()
  })

  test('permits the development proxy range only for an explicitly allowlisted hostname', async () => {
    const target = await resolveApprovedOutboundTarget('https://provider.example.test/v1', {
      resolve4: async () => ['198.18.0.212'],
      resolve6: async () => [],
      allowedHosts: ['provider.example.test'],
      allowTrustedDevelopmentProxy: true,
    })
    expect(target?.addresses).toEqual(['198.18.0.212'])
    expect(target?.trustedDevelopmentProxy).toBe(true)

    await expect(resolveApprovedOutboundTarget('https://provider.example.test/v1', {
      resolve4: async () => ['198.18.0.212'],
      resolve6: async () => [],
      allowTrustedDevelopmentProxy: true,
    })).resolves.toBeNull()
  })

  test('reports why an outbound target was rejected without exposing resolved addresses', async () => {
    await expect(inspectOutboundTarget('https://blocked.example.test/v1', {
      ...publicResolvers,
      allowedHosts: ['allowed.example.test'],
    })).resolves.toEqual({
      approved: false,
      code: 'host_not_allowed',
      hostname: 'blocked.example.test',
    })

    await expect(inspectOutboundTarget('https://allowed.example.test/v1', {
      resolve4: async () => ['198.18.0.220'],
      resolve6: async () => [],
      allowedHosts: ['allowed.example.test'],
    })).resolves.toEqual({
      approved: false,
      code: 'address_not_public',
      hostname: 'allowed.example.test',
    })
  })
})
