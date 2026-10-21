import { bgsHomeDirectory } from './bgs/home'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type RuntimeSettingsConfig = { resourceLibraryEnabled?: boolean }
export type RuntimeSettingsStoreOptions = { dataDir?: string }
export function getDefaultRuntimeSettingsStoreDir() {
  return process.env.AGENT_WORKFLOW_DATA_DIR ?? join(homedir(), '.beegame', 'dashboard')
}
const root = (options: RuntimeSettingsStoreOptions) => options.dataDir ?? getDefaultRuntimeSettingsStoreDir()
export function resolveRuntimeFeatureSettings(config: RuntimeSettingsConfig) {
  return { resourceLibraryEnabled: config.resourceLibraryEnabled ?? true }
}
export function loadRuntimeSettingsConfig(options: RuntimeSettingsStoreOptions = {}): RuntimeSettingsConfig {
  const file = join(root(options), 'runtime-settings.json')
  if (!existsSync(file)) return {}
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  if (saved.version !== 1 || !saved.config || typeof saved.config !== 'object') throw Error('Unsupported runtime settings format')
  return typeof saved.config.resourceLibraryEnabled === 'boolean' ? { resourceLibraryEnabled: saved.config.resourceLibraryEnabled } : {}
}
export function saveRuntimeSettingsConfig(input: RuntimeSettingsConfig, options: RuntimeSettingsStoreOptions = {}) {
  const next = { ...loadRuntimeSettingsConfig(options), ...resolveRuntimeFeatureSettings(input) }
  const file = join(root(options), 'runtime-settings.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file + '.tmp', JSON.stringify({ version: 1, config: next }) + '\n', { mode: 0o600 })
  renameSync(file + '.tmp', file)
  return next
}
export function mapRuntimeSettingsToEnv(config: RuntimeSettingsConfig, options: RuntimeSettingsStoreOptions = {}) {
  const runtime = join(root(options), '.runtime'), tooling = join(runtime, 'tooling'), cache = join(tooling, 'npm-cache')
  mkdirSync(cache, { recursive: true })
  return { BEEGAME_CONFIG_DIR: join(runtime, 'app'), BGS_HOME: bgsHomeDirectory(join(runtime, 'app')),
    NPM_CONFIG_CACHE: cache, npm_config_cache: cache, NPM_CONFIG_USERCONFIG: join(tooling, 'npmrc'), npm_config_userconfig: join(tooling, 'npmrc'),
    BEEGAME_RESOURCE_LIBRARY_ENABLED: resolveRuntimeFeatureSettings(config).resourceLibraryEnabled ? '1' : '0' }
}
