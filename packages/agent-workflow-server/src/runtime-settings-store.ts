import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const STORE_FILE = 'runtime-settings.json'
const RUNTIME_DIR = '.runtime'
const APP_RUNTIME_DIR = 'app'
const CORE_RUNTIME_DIR = 'core'

export type RuntimeSettingsConfig = {
  autoMemoryEnabled?: boolean
  autoDreamEnabled?: boolean
  skillSearchEnabled?: boolean
  treeSitterBashEnabled?: boolean
  webBrowserToolEnabled?: boolean
  bashClassifierEnabled?: boolean
  mcpSkillsEnabled?: boolean
  resourceLibraryEnabled?: boolean
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
  'resourceLibraryEnabled',
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
  migrateLegacyRuntimeLayout(options)
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
  migrateLegacyRuntimeLayout(options)
  const env: Record<string, string> = {
    BEEGAME_CONFIG_DIR: getBeeGameRuntimeConfigDir(options),
    CLAUDE_CONFIG_DIR: getBeeGameRuntimeConfigDir(options),
    BEEGAME_PROJECT_CONFIG_DIR_NAME: '.beegame',
  }
  if (config.autoMemoryEnabled !== undefined) {
    env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = config.autoMemoryEnabled ? '0' : '1'
  }
  if (config.treeSitterBashEnabled !== undefined) {
    env.FEATURE_TREE_SITTER_BASH = config.treeSitterBashEnabled ? '1' : '0'
  }
  if (config.webBrowserToolEnabled !== undefined) {
    env.FEATURE_WEB_BROWSER_TOOL = config.webBrowserToolEnabled ? '1' : '0'
  }
  if (config.bashClassifierEnabled !== undefined) {
    env.FEATURE_BASH_CLASSIFIER = config.bashClassifierEnabled ? '1' : '0'
  }
  if (config.mcpSkillsEnabled !== undefined) {
    env.FEATURE_MCP_SKILLS = config.mcpSkillsEnabled ? '1' : '0'
  }
  if (config.resourceLibraryEnabled !== undefined) {
    env.BEEGAME_RESOURCE_LIBRARY_ENABLED = config.resourceLibraryEnabled ? '1' : '0'
  }
  return env
}

export function syncRuntimeSettingsToDedicatedRuntimeConfig(
  config: RuntimeSettingsConfig,
  options: RuntimeSettingsStoreOptions = {},
): void {
  migrateLegacyRuntimeLayout(options)
  const filePath = join(getBeeGameRuntimeConfigDir(options), 'settings.json')
  mkdirSync(dirname(filePath), { recursive: true })
  const previous = readJsonObject(filePath)
  const previousSandbox = isObject(previous.sandbox) ? previous.sandbox : {}
  const sandboxEnabled = process.env.BEEGAME_NATIVE_SANDBOX_ENABLED !== '0'
  const sandboxFailIfUnavailable =
    process.env.BEEGAME_NATIVE_SANDBOX_FAIL_IF_UNAVAILABLE !== '0'
  const localBindingOverride =
    process.env.BEEGAME_NATIVE_SANDBOX_ALLOW_LOCAL_BINDING
  const sandboxAllowLocalBinding = localBindingOverride === '1'
    || (localBindingOverride !== '0' && process.env.NODE_ENV !== 'production')
  const next = {
    ...previous,
    // BeeGame runs each Claude Code session in a dedicated process and
    // workspace. Keep the remaining command boundary in Claude Code's native
    // sandbox instead of granting broad Bash permissions from the dashboard.
    // This is host isolation policy, not a user/model-provider feature flag.
    sandbox: {
      ...previousSandbox,
      enabled: sandboxEnabled,
      autoAllowBashIfSandboxed: sandboxEnabled,
      // Keep sandboxing as the default execution path. When a native runtime
      // capability (for example a browser process) cannot run inside it,
      // Claude Code may request the user's normal Bash permission to retry
      // outside the sandbox. This enables the same explicit fallback as the
      // TUI; it does not auto-approve or bypass that permission decision.
      allowUnsandboxedCommands: true,
      failIfUnavailable: sandboxEnabled && sandboxFailIfUnavailable,
      // Native localhost binding is required for project-owned preview and
      // runtime acceptance. Local development enables it by default. A
      // production deployment must opt in from an isolated worker/container;
      // this setting does not grant outbound access.
      network: {
        ...(isObject(previousSandbox.network) ? previousSandbox.network : {}),
        allowLocalBinding: sandboxEnabled && sandboxAllowLocalBinding,
      },
    },
    ...(config.autoMemoryEnabled !== undefined
      ? { autoMemoryEnabled: config.autoMemoryEnabled }
      : {}),
    ...(config.autoDreamEnabled !== undefined
      ? { autoDreamEnabled: config.autoDreamEnabled }
      : {}),
    ...(config.skillSearchEnabled !== undefined
      ? { skillSearchEnabled: config.skillSearchEnabled }
      : {}),
    ...(config.treeSitterBashEnabled !== undefined
      ? { treeSitterBashEnabled: config.treeSitterBashEnabled }
      : {}),
    ...(config.webBrowserToolEnabled !== undefined
      ? { webBrowserToolEnabled: config.webBrowserToolEnabled }
      : {}),
    ...(config.bashClassifierEnabled !== undefined
      ? { bashClassifierEnabled: config.bashClassifierEnabled }
      : {}),
    ...(config.mcpSkillsEnabled !== undefined
      ? { mcpSkillsEnabled: config.mcpSkillsEnabled }
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

function migrateLegacyRuntimeLayout(
  options: RuntimeSettingsStoreOptions,
): void {
  const dataDir = options.dataDir ?? getDefaultRuntimeSettingsStoreDir()
  moveLegacyDirectory(
    join(dataDir, 'beegame-config'),
    getBeeGameRuntimeConfigDir(options),
  )
  moveLegacyDirectory(
    join(dataDir, 'claude-config'),
    getCoreRuntimeConfigDir(options),
  )
  moveLegacyFile(
    join(getCoreRuntimeConfigDir(options), '.claude.json'),
    join(getCoreRuntimeConfigDir(options), '.config.json'),
  )
  migrateLegacyCoreProjectDirs(getCoreRuntimeConfigDir(options))
  cleanupRuntimeLayout(options)
}

export function cleanupRuntimeLayout(
  options: RuntimeSettingsStoreOptions = {},
): void {
  const appDir = getBeeGameRuntimeConfigDir(options)
  const coreDir = getCoreRuntimeConfigDir(options)

  removeRuntimeProbePath(join(appDir, '.dashboard-write-test'))
  for (const configDir of new Set([appDir, coreDir])) {
    removeEmptyDirectory(join(configDir, 'modes'))
    removeEmptyDirectory(join(configDir, 'plans'))
    removeEmptyDescendantDirectories(join(configDir, 'session-env'), {
      removeRoot: true,
    })
    removeEmptyDescendantDirectories(join(configDir, 'projects'), {
      removeRoot: false,
    })
    removeEmptyDirectory(configDir)
  }
}

function moveLegacyDirectory(from: string, to: string): void {
  if (!existsSync(from)) return
  mkdirSync(dirname(to), { recursive: true })
  if (!existsSync(to)) {
    renameSync(from, to)
    return
  }
  cpSync(from, to, { recursive: true, force: false, errorOnExist: false })
  rmSync(from, { recursive: true, force: true })
}

function moveLegacyFile(from: string, to: string): void {
  if (!existsSync(from)) return
  mkdirSync(dirname(to), { recursive: true })
  if (!existsSync(to)) {
    renameSync(from, to)
    return
  }
  rmSync(from, { force: true })
}

function migrateLegacyCoreProjectDirs(coreDir: string): void {
  const projectsDir = join(coreDir, 'projects')
  if (!existsSync(projectsDir)) return
  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('project-')) continue

    moveLegacyDirectory(
      join(projectsDir, entry.name),
      join(projectsDir, getNeutralProjectStorageKey(entry.name)),
    )
  }
}

function getNeutralProjectStorageKey(value: string): string {
  return `project-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`
}

function removeEmptyDescendantDirectories(
  dir: string,
  options: { removeRoot: boolean },
): void {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    removeEmptyDescendantDirectories(join(dir, entry.name), {
      removeRoot: true,
    })
  }
  if (options.removeRoot) {
    removeEmptyDirectory(dir)
  }
}

function removeEmptyDirectory(dir: string): void {
  if (!existsSync(dir)) return
  try {
    if (readdirSync(dir).length === 0) {
      rmdirSync(dir)
    }
  } catch {
    // Runtime cleanup is best-effort; active sessions may recreate these dirs.
  }
}

function removeRuntimeProbePath(path: string): void {
  if (!existsSync(path)) return
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {
    // Runtime cleanup is best-effort; active sessions may recreate this probe.
  }
}

function getRuntimeDir(options: RuntimeSettingsStoreOptions): string {
  return join(options.dataDir ?? getDefaultRuntimeSettingsStoreDir(), RUNTIME_DIR)
}

function getBeeGameRuntimeConfigDir(
  options: RuntimeSettingsStoreOptions,
): string {
  return join(getRuntimeDir(options), APP_RUNTIME_DIR)
}

function getCoreRuntimeConfigDir(options: RuntimeSettingsStoreOptions): string {
  return join(getRuntimeDir(options), CORE_RUNTIME_DIR)
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
