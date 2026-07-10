import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { decryptSecret, encryptSecret, isSecretEnvelope } from './security/secret-crypto'
import { appendAuditEvent } from './audit-events-store'

const STORE_FILE = 'web-tools.json'

export type WebSearchAdapter = 'tavily' | 'api' | 'bing' | 'brave' | 'exa'
export type WebFetchAdapter = 'tavily' | 'http'

export type WebToolsConfig = {
  webSearchAdapter?: WebSearchAdapter
  webFetchAdapter?: WebFetchAdapter
  tavilyEndpointUrl?: string
  braveApiKeyPreview?: string
  braveApiKey?: string
  exaApiKeyPreview?: string
  exaApiKey?: string
  exaEndpointUrl?: string
  webFetchHttpTimeoutMs?: number
  clearSecret?: boolean
}

export type WebToolsStoreOptions = {
  dataDir?: string
}

type StorePayload = {
  version: 1
  config: WebToolsConfig
}

export function getDefaultWebToolsStoreDir(): string {
  return (
    process.env.AGENT_WORKFLOW_DATA_DIR ??
    join(homedir(), '.beegame', 'dashboard')
  )
}

export function loadWebToolsConfig(
  options: WebToolsStoreOptions = {},
): WebToolsConfig {
  const filePath = getStoreFilePath(options)
  if (!existsSync(filePath)) return {}

  const payload = JSON.parse(readFileSync(filePath, 'utf8')) as StorePayload
  if (payload.version !== 1 || !isObject(payload.config)) {
    throw new Error('Unsupported web tools store format')
  }

  const config = normalizeWebToolsConfig({
    ...payload.config,
    ...(typeof payload.config.braveApiKey === 'string'
      ? { braveApiKey: decryptSecret(payload.config.braveApiKey, 'web-tools:brave-api-key') }
      : {}),
    ...(typeof payload.config.exaApiKey === 'string'
      ? { exaApiKey: decryptSecret(payload.config.exaApiKey, 'web-tools:exa-api-key') }
      : {}),
  })
  const legacySecretCount = [payload.config.braveApiKey, payload.config.exaApiKey]
    .filter((value): value is string => typeof value === 'string' && !isSecretEnvelope(value))
    .length
  if (legacySecretCount > 0) {
    persistWebToolsConfig(config, options)
    appendAuditEvent({
      actorId: 'system',
      action: 'secret.migrated',
      targetType: 'web_tools',
      targetId: 'local',
      metadata: { count: legacySecretCount },
    }, { dataDir: options.dataDir })
  }
  return config
}

export function saveWebToolsConfig(
  input: WebToolsConfig,
  options: WebToolsStoreOptions = {},
): WebToolsConfig {
  const previous = loadWebToolsConfig(options)
  const normalized = normalizeWebToolsConfig({
    ...previous,
    ...input,
    braveApiKey: resolveSecretInput(input.braveApiKey, previous.braveApiKey, input.clearSecret),
    exaApiKey: resolveSecretInput(input.exaApiKey, previous.exaApiKey, input.clearSecret),
  })

  persistWebToolsConfig(normalized, options)

  return toPublicWebToolsConfig(normalized)
}

function persistWebToolsConfig(
  normalized: WebToolsConfig,
  options: WebToolsStoreOptions,
): void {
  const filePath = getStoreFilePath(options)
  mkdirSync(dirname(filePath), { recursive: true })

  const payload: StorePayload = {
    version: 1,
    config: {
      ...normalized,
      ...(normalized.braveApiKey !== undefined
        ? { braveApiKey: encryptSecret(normalized.braveApiKey, 'web-tools:brave-api-key') }
        : {}),
      ...(normalized.exaApiKey !== undefined
        ? { exaApiKey: encryptSecret(normalized.exaApiKey, 'web-tools:exa-api-key') }
        : {}),
      clearSecret: undefined,
    },
  }
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

export function toPublicWebToolsConfig(
  config: WebToolsConfig,
): WebToolsConfig {
  return {
    ...config,
    clearSecret: undefined,
    braveApiKeyPreview: previewSecret(config.braveApiKey),
    braveApiKey: undefined,
    exaApiKeyPreview: previewSecret(config.exaApiKey),
    exaApiKey: undefined,
  }
}

export function mapWebToolsConfigToRuntimeEnv(
  config: WebToolsConfig,
): Record<string, string> {
  const env: Record<string, string> = {}
  if (config.webSearchAdapter) env.WEB_SEARCH_ADAPTER = config.webSearchAdapter
  if (config.braveApiKey) env.BRAVE_SEARCH_API_KEY = config.braveApiKey
  if (config.exaApiKey) env.EXA_API_KEY = config.exaApiKey
  return env
}

function normalizeWebToolsConfig(config: WebToolsConfig): WebToolsConfig {
  return {
    ...(isWebSearchAdapter(config.webSearchAdapter)
      ? { webSearchAdapter: config.webSearchAdapter }
      : {}),
    ...(isWebFetchAdapter(config.webFetchAdapter)
      ? { webFetchAdapter: config.webFetchAdapter }
      : {}),
    ...(trimString(config.tavilyEndpointUrl)
      ? { tavilyEndpointUrl: trimString(config.tavilyEndpointUrl) }
      : {}),
    ...(trimString(config.braveApiKey)
      ? { braveApiKey: trimString(config.braveApiKey) }
      : {}),
    ...(trimString(config.exaApiKey)
      ? { exaApiKey: trimString(config.exaApiKey) }
      : {}),
    ...(trimString(config.exaEndpointUrl)
      ? { exaEndpointUrl: trimString(config.exaEndpointUrl) }
      : {}),
    ...(Number.isInteger(config.webFetchHttpTimeoutMs) &&
    Number(config.webFetchHttpTimeoutMs) > 0
      ? { webFetchHttpTimeoutMs: Number(config.webFetchHttpTimeoutMs) }
      : {}),
  }
}

function resolveSecretInput(
  next: string | undefined,
  previous: string | undefined,
  clearSecret = false,
): string | undefined {
  if (clearSecret) return undefined
  if (next === undefined) return previous
  return trimString(next) || previous
}

function previewSecret(secret: string | undefined): string | undefined {
  if (!secret) return undefined
  if (secret.length <= 8) return '••••'
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`
}

function getStoreFilePath(options: WebToolsStoreOptions): string {
  return join(options.dataDir ?? getDefaultWebToolsStoreDir(), STORE_FILE)
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isWebSearchAdapter(value: unknown): value is WebSearchAdapter {
  return value === 'tavily' ||
    value === 'api' ||
    value === 'bing' ||
    value === 'brave' ||
    value === 'exa'
}

function isWebFetchAdapter(value: unknown): value is WebFetchAdapter {
  return value === 'tavily' || value === 'http'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
