import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelConfigSnapshotRecord } from '@claude-code-best/agent-workflow'
import { exportMcpServersSnapshot, type McpServerConfig } from './mcp-servers-store'
import {
  BeeGameProjectMetadataStore,
  getBeeGameProjectDatabasePath,
  type BeeGameProjectMetadata,
} from './project-metadata-store'
import {
  loadRuntimeSettingsConfig,
  type RuntimeSettingsConfig,
} from './runtime-settings-store'
import {
  loadWebToolsConfig,
  type WebToolsConfig,
} from './web-tools-store'

export type BeeGameLocalDashboardData = {
  projects: BeeGameProjectMetadata[]
  modelConfigs: ModelConfigSnapshotRecord[]
  runtimeSettings: RuntimeSettingsConfig
  webTools: WebToolsConfig
  mcpServers: McpServerConfig[]
}

export type BeeGameLocalMigrationSummary = {
  ownerId: string
  dataDir: string
  dryRun: boolean
  projects: number
  modelConfigs: number
  runtimeSettings: boolean
  webTools: boolean
  mcpServers: number
}

export type BeeGameLocalMigrationOptions = {
  ownerId: string
  dataDir: string
  store: BeeGameLocalMigrationStore
  dryRun?: boolean
}

export type BeeGameLocalMigrationStore = {
  upsertProject(
    ownerId: string,
    project: BeeGameProjectMetadata,
  ): Promise<unknown>
  upsertModelConfig(config: ModelConfigSnapshotRecord): Promise<unknown>
  saveRuntimeSettings(
    ownerId: string,
    settings: RuntimeSettingsConfig,
  ): Promise<unknown>
  saveWebTools(ownerId: string, config: WebToolsConfig): Promise<unknown>
  upsertMcpServer(
    ownerId: string,
    server: McpServerConfig,
  ): Promise<unknown>
}

type ModelConfigStorePayload = {
  version: 1
  configs: ModelConfigSnapshotRecord[]
}

export function loadBeeGameLocalDashboardData(
  dataDir: string,
): BeeGameLocalDashboardData {
  return {
    projects: loadLocalProjects(dataDir),
    modelConfigs: loadLocalModelConfigs(dataDir),
    runtimeSettings: loadRuntimeSettingsConfig({ dataDir }),
    webTools: loadWebToolsConfig({ dataDir }),
    mcpServers: exportMcpServersSnapshot({ dataDir }),
  }
}

export async function migrateBeeGameLocalDashboardData(
  options: BeeGameLocalMigrationOptions,
): Promise<BeeGameLocalMigrationSummary> {
  const ownerId = options.ownerId.trim()
  if (!ownerId) throw new Error('Owner id is required')
  const dataDir = options.dataDir.trim()
  if (!dataDir) throw new Error('Data directory is required')

  const data = loadBeeGameLocalDashboardData(dataDir)
  const summary = toMigrationSummary(ownerId, dataDir, Boolean(options.dryRun), data)
  if (summary.dryRun) return summary

  for (const project of data.projects) {
    await options.store.upsertProject(ownerId, project)
  }
  for (const config of data.modelConfigs) {
    await options.store.upsertModelConfig({
      ...config,
      ownerId,
    })
  }
  if (summary.runtimeSettings) {
    await options.store.saveRuntimeSettings(ownerId, data.runtimeSettings)
  }
  if (summary.webTools) {
    await options.store.saveWebTools(ownerId, data.webTools)
  }
  for (const server of data.mcpServers) {
    await options.store.upsertMcpServer(ownerId, server)
  }
  return summary
}

function loadLocalProjects(dataDir: string): BeeGameProjectMetadata[] {
  const databasePath = getBeeGameProjectDatabasePath(dataDir)
  if (!existsSync(databasePath)) return []
  return new BeeGameProjectMetadataStore(databasePath).listProjects()
}

function loadLocalModelConfigs(dataDir: string): ModelConfigSnapshotRecord[] {
  const filePath = join(dataDir, 'model-configs.json')
  if (!existsSync(filePath)) return []
  const payload = JSON.parse(readFileSync(filePath, 'utf8')) as ModelConfigStorePayload
  if (payload.version !== 1 || !Array.isArray(payload.configs)) {
    throw new Error('Unsupported model config store format')
  }
  return payload.configs
}

function toMigrationSummary(
  ownerId: string,
  dataDir: string,
  dryRun: boolean,
  data: BeeGameLocalDashboardData,
): BeeGameLocalMigrationSummary {
  return {
    ownerId,
    dataDir,
    dryRun,
    projects: data.projects.length,
    modelConfigs: data.modelConfigs.length,
    runtimeSettings: Object.keys(data.runtimeSettings).length > 0,
    webTools: Object.keys(data.webTools).length > 0,
    mcpServers: data.mcpServers.length,
  }
}
