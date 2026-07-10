import type { McpServerConfig, McpServerInput } from './mcp-servers-store'
import {
  createPinnedUndiciDispatcher,
  resolveApprovedOutboundTarget,
  type OutboundTargetPolicyOptions,
} from '@bee-game-studio/security-core'

export type McpServerHealthStatus = 'available' | 'unavailable'

export type McpServerTestResult = {
  ok: boolean
  status: McpServerHealthStatus
  message: string
  checkedAt: string
  endpoint?: string
  serverInfo?: {
    name?: string
    version?: string
  }
  capabilities?: Record<string, unknown>
}

export type ActiveDiscoveredMcpServer = McpServerInput & {
  endpoint: string
  exists: boolean
  test: McpServerTestResult
}

export type ActiveMcpDiscoveryOptions = {
  ports?: number[]
  timeoutMs?: number
  outboundTargetPolicyOptions?: OutboundTargetPolicyOptions
  resolveOutboundTarget?: typeof resolveApprovedOutboundTarget
}

const DEFAULT_DISCOVERY_PORTS = [
  3000,
  3001,
  3333,
  5173,
  62173,
  62174,
  6274,
  6277,
  8000,
  8080,
  8081,
  8082,
  8765,
  9000,
]

const DISCOVERY_PATHS = ['', '/mcp', '/sse']
const DEFAULT_TIMEOUT_MS = 900

export async function discoverActiveMcpServers(
  existingServers: McpServerConfig[],
  options: ActiveMcpDiscoveryOptions = {},
): Promise<ActiveDiscoveredMcpServer[]> {
  const ports = normalizePorts(options.ports ?? DEFAULT_DISCOVERY_PORTS)
  const candidates = ports.flatMap(port =>
    DISCOVERY_PATHS.map(path => `http://127.0.0.1:${port}${path}`),
  )
  const tested = await Promise.all(
    candidates.map(endpoint =>
      testMcpEndpoint(endpoint, options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options),
    ),
  )
  const discovered = new Map<string, ActiveDiscoveredMcpServer>()
  for (const test of tested) {
    if (!test.ok || !test.endpoint) continue
    const serverName = test.serverInfo?.name?.trim() || endpointLabel(test.endpoint)
    const input: McpServerInput = {
      name: serverName,
      enabled: true,
      transport: 'http',
      scope: 'beegame',
      url: test.endpoint,
      autoStart: true,
    }
    const key = getMcpServerFingerprint(input)
    if (discovered.has(key)) continue
    discovered.set(key, {
      ...input,
      endpoint: test.endpoint,
      exists: existingServers.some(existing =>
        existing.name === input.name ||
        getMcpServerFingerprint(existing) === key,
      ),
      test,
    })
  }
  return [...discovered.values()]
}

export async function testMcpServerConnection(
  input: McpServerInput,
  options: ActiveMcpDiscoveryOptions = {},
): Promise<McpServerTestResult> {
  if (input.transport === 'stdio') {
    return unavailable(
      'Stdio MCP requires launching a process and cannot be verified from the dashboard.',
    )
  }
  if (!input.url?.trim()) {
    return unavailable('MCP URL is required.')
  }
  if (input.transport === 'sse') {
    return testSseEndpoint(input.url, options.timeoutMs ?? 1600, options)
  }
  return testMcpEndpoint(input.url, options.timeoutMs ?? 1600, options)
}

export function parsePortList(value: string | undefined): number[] | undefined {
  if (!value) return undefined
  const ports = value
    .split(',')
    .map(part => Number.parseInt(part.trim(), 10))
    .filter(port => Number.isInteger(port) && port > 0 && port < 65536)
  return ports.length ? [...new Set(ports)] : undefined
}

async function testMcpEndpoint(
  rawEndpoint: string,
  timeoutMs: number,
  options: ActiveMcpDiscoveryOptions = {},
): Promise<McpServerTestResult> {
  const approved = await (options.resolveOutboundTarget ?? resolveApprovedOutboundTarget)(
    rawEndpoint,
    resolveOutboundTargetPolicyOptions(options.outboundTargetPolicyOptions),
  )
  if (!approved) {
    return unavailable('Outbound URL is not permitted')
  }
  const endpoint = normalizeEndpoint(rawEndpoint)
  if (!endpoint) return unavailable('Invalid MCP URL.')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const dispatcher = createPinnedUndiciDispatcher(approved)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'BeeGame Dashboard',
            version: '0.1.0',
          },
        },
      }),
      signal: controller.signal,
      dispatcher,
    } as RequestInit)
    const text = await response.text()
    if (!response.ok) {
      return unavailable(`MCP initialize failed with HTTP ${response.status}.`, endpoint)
    }
    const parsed = parseMcpInitializeResponse(text)
    if (!isRecord(parsed) || !isRecord(parsed.result)) {
      return unavailable('MCP initialize did not return a valid JSON-RPC result.', endpoint)
    }
    const result = parsed.result
    if (
      typeof result.protocolVersion !== 'string' &&
      !isRecord(result.serverInfo) &&
      !isRecord(result.capabilities)
    ) {
      return unavailable('MCP initialize result is missing server metadata.', endpoint)
    }
    return {
      ok: true,
      status: 'available',
      message: 'MCP initialize succeeded.',
      checkedAt: new Date().toISOString(),
      endpoint,
      ...(isRecord(result.serverInfo)
        ? {
          serverInfo: {
            ...(typeof result.serverInfo.name === 'string'
              ? { name: result.serverInfo.name }
              : {}),
            ...(typeof result.serverInfo.version === 'string'
              ? { version: result.serverInfo.version }
              : {}),
          },
        }
        : {}),
      ...(isRecord(result.capabilities)
        ? { capabilities: result.capabilities }
        : {}),
    }
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'MCP initialize timed out.'
      : 'MCP initialize request failed.'
    return unavailable(message, endpoint)
  } finally {
    if (typeof dispatcher.close === 'function') await dispatcher.close()
    clearTimeout(timeout)
  }
}

async function testSseEndpoint(
  rawEndpoint: string,
  timeoutMs: number,
  options: ActiveMcpDiscoveryOptions = {},
): Promise<McpServerTestResult> {
  const approved = await (options.resolveOutboundTarget ?? resolveApprovedOutboundTarget)(
    rawEndpoint,
    resolveOutboundTargetPolicyOptions(options.outboundTargetPolicyOptions),
  )
  if (!approved) {
    return unavailable('Outbound URL is not permitted')
  }
  const endpoint = normalizeEndpoint(rawEndpoint)
  if (!endpoint) return unavailable('Invalid MCP URL.')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const dispatcher = createPinnedUndiciDispatcher(approved)
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        accept: 'text/event-stream',
      },
      signal: controller.signal,
      dispatcher,
    } as RequestInit)
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok) {
      return unavailable(`SSE endpoint failed with HTTP ${response.status}.`, endpoint)
    }
    if (!contentType.toLowerCase().includes('text/event-stream')) {
      return unavailable('SSE endpoint did not return an event stream.', endpoint)
    }
    return {
      ok: true,
      status: 'available',
      message: 'SSE endpoint accepted an event stream connection.',
      checkedAt: new Date().toISOString(),
      endpoint,
    }
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'SSE endpoint timed out.'
      : 'SSE endpoint request failed.'
    return unavailable(message, endpoint)
  } finally {
    if (typeof dispatcher.close === 'function') await dispatcher.close()
    clearTimeout(timeout)
    controller.abort()
  }
}

function normalizeEndpoint(rawEndpoint: string): string | undefined {
  try {
    const url = new URL(rawEndpoint)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.hostname === '0.0.0.0' || url.hostname === '::') {
      url.hostname = '127.0.0.1'
    }
    return url.toString()
  } catch {
    return undefined
  }
}

function resolveOutboundTargetPolicyOptions(options: OutboundTargetPolicyOptions | undefined): OutboundTargetPolicyOptions {
  return {
    ...options,
    allowedHosts: options?.allowedHosts ?? readAllowedOutboundHosts(),
  }
}

function readAllowedOutboundHosts(): string[] {
  const value = process.env.BEEGAME_OUTBOUND_ALLOWED_HOSTS
  return value ? value.split(',').map(host => host.trim()).filter(Boolean) : []
}

function unavailable(message: string, endpoint?: string): McpServerTestResult {
  return {
    ok: false,
    status: 'unavailable',
    message,
    checkedAt: new Date().toISOString(),
    ...(endpoint ? { endpoint } : {}),
  }
}

function normalizePorts(ports: number[]): number[] {
  return [...new Set(ports.filter(port =>
    Number.isInteger(port) && port > 0 && port < 65536,
  ))]
}

function endpointLabel(endpoint: string): string {
  const url = new URL(endpoint)
  return `MCP ${url.host}${url.pathname === '/' ? '' : url.pathname}`
}

function getMcpServerFingerprint(config: McpServerInput): string {
  return JSON.stringify({
    transport: config.transport,
    command: config.command ?? '',
    url: config.url ?? '',
    args: config.args ?? [],
  })
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function parseMcpInitializeResponse(value: string): unknown {
  const parsed = parseJson(value)
  if (parsed !== undefined) return parsed

  for (const line of value.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const eventPayload = trimmed.slice('data:'.length).trim()
    if (!eventPayload || eventPayload === '[DONE]') continue
    const eventJson = parseJson(eventPayload)
    if (eventJson !== undefined) return eventJson
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
