import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const STORE_FILE = 'mcp-servers.json'

export type McpServerTransport = 'stdio' | 'sse' | 'http'
export type McpServerScope = 'beegame' | 'global' | 'project'

export type McpServerEnvVar = {
  key: string
  value?: string
  valuePreview?: string
}

export type McpServerConfig = {
  id: string
  name: string
  enabled: boolean
  transport: McpServerTransport
  scope: McpServerScope
  command?: string
  args?: string[]
  url?: string
  cwd?: string
  env?: McpServerEnvVar[]
  autoStart?: boolean
}

export type McpServerInput = Omit<McpServerConfig, 'id'> & {
  id?: string
}

export type DiscoveredMcpServer = McpServerInput & {
  sourcePath: string
  exists: boolean
}

export type McpServersStoreOptions = {
  dataDir?: string
}

type StorePayload = {
  version: 1
  servers: McpServerConfig[]
}

export function getDefaultMcpServersStoreDir(): string {
  return (
    process.env.AGENT_WORKFLOW_DATA_DIR ??
    join(homedir(), '.beegame', 'dashboard')
  )
}

export function listMcpServers(
  options: McpServersStoreOptions = {},
): McpServerConfig[] {
  return loadMcpServers(options).map(toPublicMcpServerConfig)
}

export function exportMcpServersSnapshot(
  options: McpServersStoreOptions = {},
): McpServerConfig[] {
  return loadMcpServers(options)
}

export function upsertMcpServer(
  input: McpServerInput,
  options: McpServersStoreOptions = {},
): McpServerConfig {
  const servers = loadMcpServers(options)
  const existingIndex = input.id
    ? servers.findIndex(server => server.id === input.id)
    : -1
  const existing = existingIndex >= 0 ? servers[existingIndex] : undefined
  const normalized = normalizeMcpServerInput(input, existing)
  const nextServers = existingIndex >= 0
    ? servers.map(server => server.id === normalized.id ? normalized : server)
    : [...servers, normalized]
  saveMcpServers(nextServers, options)
  return toPublicMcpServerConfig(normalized)
}

export function deleteMcpServer(
  id: string,
  options: McpServersStoreOptions = {},
): boolean {
  const servers = loadMcpServers(options)
  const nextServers = servers.filter(server => server.id !== id)
  if (nextServers.length === servers.length) return false
  saveMcpServers(nextServers, options)
  return true
}

export function discoverMcpServers(
  options: McpServersStoreOptions = {},
): DiscoveredMcpServer[] {
  const existingServers = loadMcpServers(options)
  const discovered = new Map<string, DiscoveredMcpServer>()

  for (const filePath of getMcpDiscoveryPaths(options)) {
    for (const server of readMcpServersFromJsonFile(filePath)) {
      const normalized = normalizeMcpServerInput(server, undefined)
      const publicInput = toPublicMcpServerInput(normalized)
      const key = getMcpServerFingerprint(publicInput)
      if (discovered.has(key)) continue
      discovered.set(key, {
        ...publicInput,
        sourcePath: filePath,
        exists: existingServers.some(existing =>
          existing.name === publicInput.name ||
          getMcpServerFingerprint(existing) === key,
        ),
      })
    }
  }

  return [...discovered.values()]
}

function loadMcpServers(options: McpServersStoreOptions): McpServerConfig[] {
  const filePath = getStoreFilePath(options)
  if (!existsSync(filePath)) return []

  const payload = JSON.parse(readFileSync(filePath, 'utf8')) as StorePayload
  if (payload.version !== 1 || !Array.isArray(payload.servers)) {
    throw new Error('Unsupported MCP server store format')
  }
  return payload.servers
    .map(server => normalizeMcpServerInput(server, server))
    .filter(server => server.name)
}

function saveMcpServers(
  servers: McpServerConfig[],
  options: McpServersStoreOptions,
): void {
  const filePath = getStoreFilePath(options)
  mkdirSync(dirname(filePath), { recursive: true })

  const payload: StorePayload = {
    version: 1,
    servers,
  }
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

function normalizeMcpServerInput(
  input: McpServerInput,
  existing?: McpServerConfig,
): McpServerConfig {
  const transport = isMcpServerTransport(input.transport)
    ? input.transport
    : existing?.transport ?? 'stdio'
  const scope = isMcpServerScope(input.scope)
    ? input.scope
    : existing?.scope ?? 'beegame'
  const env = normalizeEnv(input.env, existing?.env)
  const base = {
    id: trimString(input.id) || existing?.id || randomUUID(),
    name: trimString(input.name) || existing?.name || 'MCP Server',
    enabled: typeof input.enabled === 'boolean'
      ? input.enabled
      : existing?.enabled ?? true,
    transport,
    scope,
    cwd: trimString(input.cwd) || undefined,
    env,
    autoStart: typeof input.autoStart === 'boolean'
      ? input.autoStart
      : existing?.autoStart ?? true,
  }
  if (transport === 'stdio') {
    return {
      ...base,
      command: trimString(input.command) || existing?.command || '',
      args: normalizeArgs(input.args),
    }
  }
  return {
    ...base,
    url: trimString(input.url) || existing?.url || '',
  }
}

function getMcpDiscoveryPaths(options: McpServersStoreOptions): string[] {
  const dataDir = options.dataDir ?? getDefaultMcpServersStoreDir()
  const home = homedir()
  const candidates = [
    join(dataDir, '.mcp.json'),
    join(dataDir, 'mcp.json'),
    join(dataDir, STORE_FILE),
    join(home, '.mcp.json'),
    join(home, '.config', 'mcp', 'mcp.json'),
    join(home, '.config', 'mcp', 'servers.json'),
    join(home, '.beegame', 'mcp.json'),
    join(home, '.beegame', 'dashboard', STORE_FILE),
  ]
  return [...new Set(candidates)].filter(path => existsSync(path))
}

function readMcpServersFromJsonFile(filePath: string): McpServerInput[] {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    return extractMcpServers(parsed)
  } catch {
    return []
  }
}

function extractMcpServers(value: unknown): McpServerInput[] {
  if (!isRecord(value)) return []
  const candidate = value.mcpServers ?? value.servers
  if (Array.isArray(candidate)) {
    return candidate
      .map((entry, index) => toMcpServerInputFromUnknown(entry, `server-${index + 1}`))
      .filter((entry): entry is McpServerInput => entry !== undefined)
  }
  if (isRecord(candidate)) {
    return Object.entries(candidate)
      .map(([name, entry]) => toMcpServerInputFromUnknown(entry, name))
      .filter((entry): entry is McpServerInput => entry !== undefined)
  }
  return []
}

function toMcpServerInputFromUnknown(
  value: unknown,
  fallbackName: string,
): McpServerInput | undefined {
  if (!isRecord(value)) return undefined
  const name = trimString(value.name) || fallbackName
  const command = trimString(value.command)
  const url = trimString(value.url)
  const transport = isMcpServerTransport(value.transport)
    ? value.transport
    : command
      ? 'stdio'
      : url
        ? 'http'
        : undefined
  if (!transport) return undefined
  if (transport === 'stdio' && !command) return undefined
  if (transport !== 'stdio' && !url) return undefined

  return {
    name,
    enabled: value.enabled !== false,
    transport,
    scope: isMcpServerScope(value.scope) ? value.scope : 'beegame',
    ...(transport === 'stdio'
      ? {
        command,
        args: normalizeArgs(value.args),
      }
      : { url }),
    ...(trimString(value.cwd) ? { cwd: trimString(value.cwd) } : {}),
    env: normalizeEnvFromUnknown(value.env),
    autoStart: value.autoStart !== false,
  }
}

function normalizeEnvFromUnknown(value: unknown): McpServerEnvVar[] {
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (!isRecord(item)) return undefined
        const key = trimString(item.key)
        if (!key) return undefined
        const envValue = trimString(item.value)
        return {
          key,
          ...(envValue ? { value: envValue } : {}),
        }
      })
      .filter((item): item is McpServerEnvVar => item !== undefined)
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, envValue]) => ({
        key: key.trim(),
        ...(typeof envValue === 'string' && envValue.trim()
          ? { value: envValue.trim() }
          : {}),
      }))
      .filter(item => item.key)
  }
  return []
}

function toPublicMcpServerInput(config: McpServerConfig): McpServerInput {
  return {
    name: config.name,
    enabled: config.enabled,
    transport: config.transport,
    scope: config.scope,
    ...(config.command ? { command: config.command } : {}),
    ...(config.args?.length ? { args: config.args } : {}),
    ...(config.url ? { url: config.url } : {}),
    ...(config.cwd ? { cwd: config.cwd } : {}),
    env: (config.env ?? []).map(item => ({
      key: item.key,
      valuePreview: previewSecret(item.value),
    })),
    autoStart: config.autoStart,
  }
}

function getMcpServerFingerprint(config: McpServerInput): string {
  return JSON.stringify({
    transport: config.transport,
    command: config.command ?? '',
    url: config.url ?? '',
    args: config.args ?? [],
  })
}

function normalizeEnv(
  input: McpServerEnvVar[] | undefined,
  existing: McpServerEnvVar[] | undefined,
): McpServerEnvVar[] {
  if (!Array.isArray(input)) return existing ?? []
  const previous = new Map((existing ?? []).map(item => [item.key, item.value]))
  return input
    .map(item => {
      const key = trimString(item.key)
      if (!key) return undefined
      const nextValue = item.value === undefined
        ? previous.get(key)
        : trimString(item.value) || undefined
      return {
        key,
        ...(nextValue ? { value: nextValue } : {}),
      }
    })
    .filter((item): item is McpServerEnvVar => item !== undefined)
}

function normalizeArgs(args: unknown): string[] {
  if (!Array.isArray(args)) return []
  return args
    .map(arg => trimString(arg))
    .filter(Boolean)
}

function toPublicMcpServerConfig(config: McpServerConfig): McpServerConfig {
  return {
    ...config,
    env: (config.env ?? []).map(item => ({
      key: item.key,
      valuePreview: previewSecret(item.value),
    })),
  }
}

function previewSecret(secret: string | undefined): string | undefined {
  if (!secret) return undefined
  if (secret.length <= 8) return '••••'
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`
}

function getStoreFilePath(options: McpServersStoreOptions): string {
  return join(options.dataDir ?? getDefaultMcpServersStoreDir(), STORE_FILE)
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMcpServerTransport(value: unknown): value is McpServerTransport {
  return value === 'stdio' || value === 'sse' || value === 'http'
}

function isMcpServerScope(value: unknown): value is McpServerScope {
  return value === 'beegame' || value === 'global' || value === 'project'
}
