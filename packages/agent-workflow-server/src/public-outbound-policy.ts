import { resolve4 as resolve4FromDns } from 'node:dns/promises'
import { isIPv4 } from 'node:net'
import { Agent, request } from 'undici/index.js'
import { createPinnedLookup, type OutboundTargetPolicyOptions } from '@bee-game-studio/security-core'

export type PublicIpv4Resolver = (hostname: string) => Promise<string[]> | string[]
export type PublicOutboundDnsOptions = Pick<OutboundTargetPolicyOptions, 'resolve4' | 'resolve6'>

/**
 * Use an independent public A-record lookup when the local resolver is a
 * transparent development proxy. Private, mixed, and invalid answers remain
 * subject to the shared outbound target validator.
 */
export function createPublicOutboundDns(
  options: PublicOutboundDnsOptions = {},
  resolvePublic4: PublicIpv4Resolver = resolvePublicIpv4,
): PublicOutboundDnsOptions {
  return {
    resolve6: options.resolve6,
    async resolve4(hostname) {
      const addresses = await (options.resolve4 ?? resolve4FromDns)(hostname)
      return addresses.length && addresses.every(isTransparentProxyAddress)
        ? resolvePublic4(hostname)
        : addresses
    },
  }
}

function isTransparentProxyAddress(address: string): boolean {
  return isIPv4(address) && /^198\.(18|19)\./.test(address)
}

export async function resolvePublicIpv4(hostname: string): Promise<string[]> {
  // Bootstrap around the local resolver by pinning the DoH endpoint to 1.1.1.1.
  // TLS still verifies cloudflare-dns.com; no model or caller credentials enter
  // this request.
  const dispatcher = new Agent({
    maxResponseSize: 64 * 1024,
    connect: {
      lookup: createPinnedLookup('cloudflare-dns.com', ['1.1.1.1']) as never,
      autoSelectFamily: false,
      timeout: 3000,
    },
  })
  try {
    const url = new URL('https://cloudflare-dns.com/dns-query')
    url.searchParams.set('name', hostname)
    url.searchParams.set('type', 'A')
    const response = await request(url, {
      dispatcher,
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
    })
    if (response.statusCode !== 200) {
      response.body.destroy()
      throw Error('Public DNS lookup failed')
    }
    const data = await response.body.json() as {
      Status?: number
      TC?: boolean
      Question?: Array<{ name?: string; type?: number }>
      Answer?: Array<{ type?: number; data?: string }>
    }
    if (data.Status !== 0 || data.TC || !data.Question?.some(question =>
      question.type === 1 && question.name?.toLowerCase().replace(/\.$/, '') === hostname.replace(/\.$/, ''),
    ) || !Array.isArray(data.Answer)) throw Error('Invalid public DNS response')
    const addresses = data.Answer.filter(answer => answer.type === 1).map(answer => answer.data)
    if (!addresses.length || addresses.some(address => typeof address !== 'string' || !isIPv4(address)))
      throw Error('Public DNS returned no valid IPv4 addresses')
    return addresses as string[]
  } finally {
    await dispatcher.close()
  }
}
