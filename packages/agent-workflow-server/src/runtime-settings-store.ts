import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const STORE_FILE = 'runtime-settings.json'

export type RuntimeSettingsConfig = {
  autoMemoryEnabled?: boolean
  autoDreamEnabled?: boolean
  skillSearchEnabled?: boolean
  treeSitterBashEnabled?: boolean
  webBrowserToolEnabled?: boolean
  bashClassifierEnabled?: boolean
  mcpSkillsEnabled?: boolean
}

export type RuntimeSettingsStoreOptions = {
  dataDir?: string
}

type StorePayload = {
  version: 1
  config: RuntimeSettingsConfig
}

const BOOLEAN_FIELDS: Array<keyof RuntimeSettingsConfig> = [
  'autoMemoryEnabled',
  'autoDreamEnabled',
  'skillSearchEnabled',
  'treeSitterBashEnabled',
  'webBrowserToolEnabled',
  'bashClassifierEnabled',
  'mcpSkillsEnabled',
]

export function getDefaultRuntimeSettingsStoreDir(): string {
  return (
    process.env.AGENT_WORKFLOW_DATA_DIR ??
    join(homedir(), '.beegame', 'dashboard')
  )
}

export function loadRuntimeSettingsConfig(
  options: RuntimeSettingsStoreOptions = {},
): RuntimeSettingsConfig {
  const filePath = getStoreFilePath(options)
  if (!existsSync(filePath)) return {}

  const payload = JSON.parse(readFileSync(filePath, 'utf8')) as StorePayload
  if (payload.version !== 1 || !isObject(payload.config)) {
    throw new Error('Unsupported runtime settings store format')
  }

  return normalizeRuntimeSettingsConfig(payload.config)
}

export function saveRuntimeSettingsConfig(
  input: RuntimeSettingsConfig,
  options: RuntimeSettingsStoreOptions = {},
): RuntimeSettingsConfig {
  const previous = loadRuntimeSettingsConfig(options)
  const normalized = normalizeRuntimeSettingsConfig({
    ...previous,
    ...input,
  })

  const filePath = getStoreFilePath(options)
  mkdirSync(dirname(filePath), { recursive: true })

  const payload: StorePayload = {
    version: 1,
    config: normalized,
  }
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(tempPath, filePath)

  return normalized
}

export function mapRuntimeSettingsToEnv(
  config: RuntimeSettingsConfig,
  options: RuntimeSettingsStoreOptions = {},
): Record<string, string> {
  const env: Record<string, string> = {}
  if (config.skillSearchEnabled !== undefined) {
    env.SKILL_SEARCH_ENABLED = config.skillSearchEnabled ? '1' : '0'
  }
  if (
    config.autoMemoryEnabled !== undefined ||
    config.autoDreamEnabled !== undefined
  ) {
    env.CLAUDE_CONFIG_DIR = getClaudeConfigDir(options)
  }
  if (config.autoMemoryEnabled !== undefined) {
    env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = config.autoMemoryEnabled ? '0' : '1'
  }
  if (config.treeSitterBashEnabled) {
    env.FEATURE_TREE_SITTER_BASH = '1'
  }
  if (config.webBrowserToolEnabled) {
    env.FEATURE_WEB_BROWSER_TOOL = '1'
  }
  if (config.bashClassifierEnabled) {
    env.FEATURE_BASH_CLASSIFIER = '1'
  }
  if (config.mcpSkillsEnabled) {
    env.FEATURE_MCP_SKILLS = '1'
  }
  return env
}

export function syncRuntimeSettingsToDedicatedRuntimeConfig(
  config: RuntimeSettingsConfig,
  options: RuntimeSettingsStoreOptions = {},
): void {
  if (
    config.autoMemoryEnabled === undefined &&
    config.autoDreamEnabled === undefined
  ) {
    return
  }
  const filePath = join(getClaudeConfigDir(options), 'settings.json')
  mkdirSync(dirname(filePath), { recursive: true })
  const previous = readJsonObject(filePath)
  const next = {
    ...previous,
    ...(config.autoMemoryEnabled !== undefined
      ? { autoMemoryEnabled: config.autoMemoryEnabled }
      : {}),
    ...(config.autoDreamEnabled !== undefined
      ? { autoDreamEnabled: config.autoDreamEnabled }
      : {}),
  }
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

function normalizeRuntimeSettingsConfig(
  config: RuntimeSettingsConfig,
): RuntimeSettingsConfig {
  const normalized: RuntimeSettingsConfig = {}
  for (const field of BOOLEAN_FIELDS) {
    if (typeof config[field] === 'boolean') {
      normalized[field] = config[field]
    }
  }
  return normalized
}

function getStoreFilePath(options: RuntimeSettingsStoreOptions): string {
  return join(options.dataDir ?? getDefaultRuntimeSettingsStoreDir(), STORE_FILE)
}

function getClaudeConfigDir(options: RuntimeSettingsStoreOptions): string {
  return join(options.dataDir ?? getDefaultRuntimeSettingsStoreDir(), 'claude-config')
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    return isObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
