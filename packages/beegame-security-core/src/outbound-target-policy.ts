import { resolve4 as resolve4FromDns, resolve6 as resolve6FromDns } from 'node:dns/promises'
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { isIP } from 'node:net'
// Bun resolves the bare `undici` specifier to its compatibility shim, whose
// Agent does not implement the Dispatcher lifecycle. Use the package entrypoint
// explicitly so pinned DNS lookups are enforced by a real Undici dispatcher.
import { Agent as UndiciAgent } from 'undici/index.js'

type Resolver = (hostname: string) => Promise<string[]> | string[]
type LookupCallback = (error: NodeJS.ErrnoException | null, address: string, family: 4 | 6) => void

export type OutboundTargetPolicyOptions = {
  resolve4?: Resolver
  resolve6?: Resolver
  allowHttp?: boolean
  allowedHosts?: Iterable<string>
  /** Development-only support for an explicitly allowlisted proxy hostname. */
  allowTrustedDevelopmentProxy?: boolean
}

export type ApprovedOutboundTarget = {
  url: URL
  addresses: string[]
  lookup: (hostname: string, options: unknown, callback: LookupCallback) => void
}

export async function resolveApprovedOutboundTarget(
  value: string,
  options: OutboundTargetPolicyOptions = {},
): Promise<ApprovedOutboundTarget | null> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  const allowHttp = options.allowHttp ?? process.env.BEEGAME_ALLOW_INSECURE_OUTBOUND_HTTP === '1'
  if (!isAllowedProtocol(url, allowHttp) || url.username || url.password || !isAllowedHostAndPort(url, options.allowedHosts)) {
    return null
  }

  const hostname = normalizeHostname(url.hostname)
  if (!hostname) return null

  const addresses = isIP(hostname)
    ? [hostname]
    : [
        ...await resolveAddresses(options.resolve4 ?? resolve4FromDns, hostname),
        ...await resolveAddresses(options.resolve6 ?? resolve6FromDns, hostname),
      ]

  const allowTrustedDevelopmentProxy =
    options.allowTrustedDevelopmentProxy === true &&
    isExplicitlyAllowedHostname(url, options.allowedHosts) &&
    isIP(hostname) === 0
  if (!addresses.length || addresses.some(address =>
    isIP(address) === 0 ||
    (isBlockedAddress(address) && !(allowTrustedDevelopmentProxy && isTrustedDevelopmentProxyAddress(address))),
  )) {
    return null
  }

  return {
    url,
    addresses,
    lookup: createPinnedLookup(hostname, addresses),
  }
}

export function createPinnedHttpAgent(target: ApprovedOutboundTarget): HttpAgent {
  return new HttpAgent({ lookup: target.lookup as never })
}

export function createPinnedHttpsAgent(target: ApprovedOutboundTarget): HttpsAgent {
  return new HttpsAgent({ lookup: target.lookup as never })
}

export function createPinnedUndiciDispatcher(target: ApprovedOutboundTarget): UndiciAgent {
  return new UndiciAgent({ connect: { lookup: target.lookup as never } })
}

function isAllowedProtocol(url: URL, allowHttp: boolean): boolean {
  return url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')
}

function isAllowedHostAndPort(url: URL, allowedHosts: Iterable<string> | undefined): boolean {
  const hostname = normalizeHostname(url.hostname)
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  const entries = allowedHosts
    ? [...allowedHosts].map(entry => entry.trim().toLowerCase()).filter(Boolean)
    : []
  if (entries.length && !entries.includes(hostname) && !entries.includes(`${hostname}:${port}`)) return false
  return port === '443' || port === '80' || entries.includes(`${hostname}:${port}`)
}

function isExplicitlyAllowedHostname(url: URL, allowedHosts: Iterable<string> | undefined): boolean {
  const hostname = normalizeHostname(url.hostname)
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  const entries = allowedHosts
    ? [...allowedHosts].map(entry => entry.trim().toLowerCase()).filter(Boolean)
    : []
  return entries.includes(hostname) || entries.includes(`${hostname}:${port}`)
}

function normalizeHostname(hostname: string): string {
  return hostname.replaceAll('[', '').replaceAll(']', '').toLowerCase()
}

async function resolveAddresses(resolver: Resolver, hostname: string): Promise<string[]> {
  try {
    return await resolver(hostname)
  } catch {
    return []
  }
}

function createPinnedLookup(hostname: string, addresses: string[]) {
  let nextAddress = 0
  return (requestedHostname: string, _options: unknown, callback: LookupCallback): void => {
    if (normalizeHostname(requestedHostname) !== hostname) {
      callback(Object.assign(new Error('Outbound host mismatch'), { code: 'ENOTFOUND' }), '', 4)
      return
    }

    const address = addresses[nextAddress++ % addresses.length]
    callback(null, address, isIP(address) as 4 | 6)
  }
}

function isBlockedAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4 ? isBlockedIpv4(address) : family === 6 && isBlockedIpv6(address)
}

function isTrustedDevelopmentProxyAddress(address: string): boolean {
  if (isIP(address) !== 4) return false
  const [first, second] = address.split('.').map(Number)
  return first === 198 && (second === 18 || second === 19)
}

function isBlockedIpv4(address: string): boolean {
  const [first, second] = address.split('.').map(Number)
  return first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized === '::' || normalized === '::1') return true

  const dottedIpv4 = normalized.slice(normalized.lastIndexOf(':') + 1)
  if (dottedIpv4.includes('.') && isIP(dottedIpv4) === 4) return isBlockedIpv4(dottedIpv4)

  const segments = expandIpv6(normalized)
  if (!segments) return true
  const isMappedOrCompatibleIpv4 =
    (segments.slice(0, 5).every(segment => segment === 0) && segments[5] === 0xffff) ||
    segments.slice(0, 6).every(segment => segment === 0)
  if (isMappedOrCompatibleIpv4) {
    return isBlockedIpv4([
      segments[6] >> 8,
      segments[6] & 0xff,
      segments[7] >> 8,
      segments[7] & 0xff,
    ].join('.'))
  }

  const firstSegment = segments[0]
  return (firstSegment & 0xfe00) === 0xfc00 ||
    (firstSegment & 0xffc0) === 0xfe80 ||
    (firstSegment & 0xff00) === 0xff00
}

function expandIpv6(address: string): number[] | undefined {
  const [before, after, ...extra] = address.split('::')
  if (extra.length) return undefined

  const beforeSegments = before ? before.split(':') : []
  const afterSegments = after ? after.split(':') : []
  const missingSegments = 8 - beforeSegments.length - afterSegments.length
  if (missingSegments < 0 || (!after && !address.includes('::') && missingSegments !== 0)) return undefined

  const segments = [...beforeSegments, ...Array(missingSegments).fill('0'), ...afterSegments]
  if (segments.length !== 8) return undefined

  const values = segments.map(segment => Number.parseInt(segment, 16))
  return values.every(value => Number.isInteger(value) && value >= 0 && value <= 0xffff)
    ? values
    : undefined
}
