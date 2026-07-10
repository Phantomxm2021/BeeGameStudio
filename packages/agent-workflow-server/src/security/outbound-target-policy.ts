import { resolve4 as resolve4FromDns, resolve6 as resolve6FromDns } from 'node:dns/promises'
import { isIP } from 'node:net'

type Resolver = (hostname: string) => Promise<string[]> | string[]

export type OutboundTargetPolicyOptions = {
  resolve4?: Resolver
  resolve6?: Resolver
  allowHttp?: boolean
  allowedHosts?: Iterable<string>
}

export async function validateOutboundTarget(
  value: string,
  options: OutboundTargetPolicyOptions = {},
): Promise<boolean> {
  let target: URL
  try {
    target = new URL(value)
  } catch {
    return false
  }

  const allowHttp = options.allowHttp ?? process.env.BEEGAME_ALLOW_INSECURE_OUTBOUND_HTTP === '1'
  if (target.protocol !== 'https:' && (target.protocol !== 'http:' || !allowHttp)) return false
  if (target.username || target.password) return false
  if (!isAllowedHostAndPort(target, options.allowedHosts)) return false

  const hostname = target.hostname.replaceAll('[', '').replaceAll(']', '')
  if (!hostname) return false
  if (isIP(hostname)) return !isBlockedAddress(hostname)

  const [ipv4, ipv6] = await Promise.all([
    resolveAddresses(options.resolve4 ?? resolve4FromDns, hostname),
    resolveAddresses(options.resolve6 ?? resolve6FromDns, hostname),
  ])
  const addresses = [...ipv4, ...ipv6]
  return addresses.length > 0 && addresses.every(address =>
    isIP(address) !== 0 && !isBlockedAddress(address),
  )
}

function isAllowedHostAndPort(target: URL, allowedHosts: Iterable<string> | undefined): boolean {
  const port = target.port || (target.protocol === 'https:' ? '443' : '80')
  const hostname = target.hostname.toLowerCase()
  const entries = allowedHosts ? [...allowedHosts].map(entry => entry.trim().toLowerCase()).filter(Boolean) : []
  const hostAllowed = !entries.length || entries.includes(hostname) || entries.includes(`${hostname}:${port}`)
  if (!hostAllowed) return false
  if (port === '443' || port === '80') return true
  return entries.includes(`${hostname}:${port}`)
}

async function resolveAddresses(resolver: Resolver, hostname: string): Promise<string[]> {
  try {
    return await resolver(hostname)
  } catch {
    return []
  }
}

function isBlockedAddress(address: string): boolean {
  return isIP(address) === 4 ? isBlockedIpv4(address) : isIP(address) === 6 && isBlockedIpv6(address)
}

function isBlockedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  const [first, second] = octets
  return first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first >= 224 && first <= 239)
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized === '::' || normalized === '::1') return true
  const mappedIpv4 = normalized.lastIndexOf(':') >= 0
    ? normalized.slice(normalized.lastIndexOf(':') + 1)
    : ''
  if (mappedIpv4.includes('.') && isIP(mappedIpv4) === 4) return isBlockedIpv4(mappedIpv4)
  const segments = expandIpv6(normalized)
  if (segments && segments.slice(0, 5).every(segment => segment === 0) && segments[5] === 0xffff) {
    return isBlockedIpv4([
      segments[6] >> 8,
      segments[6] & 0xff,
      segments[7] >> 8,
      segments[7] & 0xff,
    ].join('.'))
  }
  const firstSegment = segments?.[0] ?? 0
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
  if (missingSegments < 0 || (!after && !address.includes('::') && missingSegments !== 0)) {
    return undefined
  }
  const segments = [...beforeSegments, ...Array(missingSegments).fill('0'), ...afterSegments]
  if (segments.length !== 8) return undefined
  const values = segments.map(segment => Number.parseInt(segment, 16))
  return values.every(value => Number.isInteger(value) && value >= 0 && value <= 0xffff)
    ? values
    : undefined
}
