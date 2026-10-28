import type { McpServerEnvVar } from './mcp-servers-store'

// These fields belong to HTTP framing, the MCP protocol, or our private relay.
const reserved = new Set(['host', 'content-length', 'transfer-encoding', 'connection',
  'keep-alive', 'upgrade', 'te', 'trailer', 'proxy-authorization', 'proxy-connection',
  'origin', 'accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version',
  'last-event-id', 'x-bgs-mcp-token'])

export function normalizeMcpHeaders(input: unknown, existing: McpServerEnvVar[] = []): McpServerEnvVar[] {
  if (input === undefined) input = existing
  if (!Array.isArray(input)) throw Error('Invalid MCP headers')
  const previous = new Map(existing.map(item => [item.key.toLowerCase(), item.value]))
  const seen = new Set<string>()
  return input.map(item => {
    if (!item || typeof item.key !== 'string') throw Error('Invalid MCP header name')
    const key = item.key.trim().toLowerCase()
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(key) || reserved.has(key) || seen.has(key))
      throw Error('Invalid, reserved or duplicate MCP header name')
    seen.add(key)
    if (item.value !== undefined && (typeof item.value !== 'string' || /[^\t\x20-\x7e\x80-\xff]/.test(item.value)))
      throw Error('Invalid MCP header value')
    const value = item.clearSecret === true ? undefined : item.value?.trim() || previous.get(key)
    return { key, ...(value ? { value } : {}) }
  })
}

export function mcpHttpHeaders(input: unknown): Record<string, string> {
  return Object.fromEntries(normalizeMcpHeaders(input).flatMap(item => item.value ? [[item.key, item.value]] : []))
}
