import { existsSync, statSync } from 'node:fs'
import { projectChatPath } from './beegame/project-records'
import { ChatJsonlReader } from './beegame/chat-jsonl-reader'
import type { ModelConfigSnapshotRecord } from '@bee-game-studio/agent-workflow'
import {
  readModelConfigSnapshotFromStore,
} from './model-config-store'
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

export type BeeGameLocalDashboardData = {
  projects: BeeGameProjectMetadata[]
  sessions: BeeGameLocalSessionMetadata[]
  modelConfigs: ModelConfigSnapshotRecord[]
  runtimeSettings: RuntimeSettingsConfig
  mcpServers: McpServerConfig[]
}

export type BeeGameLocalMigrationSummary = {
  ownerId: string
  dataDir: string
  dryRun: boolean
  projects: number
  sessions: number
  modelConfigs: number
  runtimeSettings: boolean
  mcpServers: number
}

export type BeeGameSecretMigrationMetadata = {
  modelConfigs: number
  mcpServers: number
  count: number
}

export type BeeGameLocalSessionMetadata = {
  id: string
  projectId: string
  workspacePath: string
  status: string
  transcriptPath: string
  createdAt: Date
  updatedAt: Date
}

export type BeeGameLocalMigrationOptions = {
  ownerId: string
  dataDir: string
  store: BeeGameLocalMigrationStore
  dryRun?: boolean
  includePlatformSettings?: boolean
}

export type BeeGameLocalMigrationStore = {
  upsertProject(
    ownerId: string,
    project: BeeGameProjectMetadata,
  ): Promise<unknown>
  upsertSession(
    ownerId: string,
    session: BeeGameLocalSessionMetadata,
  ): Promise<unknown>
  upsertModelConfig(config: ModelConfigSnapshotRecord): Promise<unknown>
  saveRuntimeSettings(
    ownerId: string,
    settings: RuntimeSettingsConfig,
  ): Promise<unknown>
  upsertMcpServer(
    ownerId: string,
    server: McpServerConfig,
  ): Promise<unknown>
  recordSecretMigration?(
    ownerId: string,
    metadata: BeeGameSecretMigrationMetadata,
  ): Promise<unknown>
}

export function loadBeeGameLocalDashboardData(
  dataDir: string,
): BeeGameLocalDashboardData {
  const projects = loadLocalProjects(dataDir)
  return {
    projects,
    sessions: loadLocalSessions(projects),
    modelConfigs: loadLocalModelConfigs(dataDir),
    runtimeSettings: loadRuntimeSettingsConfig({ dataDir }),
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
  for (const session of data.sessions) {
    await options.store.upsertSession(ownerId, session)
  }
  if (options.includePlatformSettings) {
    for (const config of data.modelConfigs) {
      await options.store.upsertModelConfig({
        ...config,
        ownerId,
      })
    }
    if (summary.runtimeSettings) {
      await options.store.saveRuntimeSettings(ownerId, data.runtimeSettings)
    }
  }
  for (const server of data.mcpServers) {
    await options.store.upsertMcpServer(ownerId, server)
  }
  if (options.store.recordSecretMigration) {
    const metadata = getSecretMigrationMetadata(data, options.includePlatformSettings === true)
    if (metadata.count > 0) {
      await options.store.recordSecretMigration(ownerId, metadata)
    }
  }
  return summary
}

function getSecretMigrationMetadata(
  data: BeeGameLocalDashboardData,
  includePlatformSettings: boolean,
): BeeGameSecretMigrationMetadata {
  const modelConfigs = includePlatformSettings
    ? data.modelConfigs.filter(config => typeof config.apiKey === 'string' && config.apiKey.length > 0).length
    : 0
  const mcpServers = data.mcpServers
    .flatMap(server => server.env ?? [])
    .filter(item => typeof item.value === 'string' && item.value.length > 0)
    .length
  return {
    modelConfigs,
    mcpServers,
    count: modelConfigs + mcpServers,
  }
}

function loadLocalProjects(dataDir: string): BeeGameProjectMetadata[] {
  const databasePath = getBeeGameProjectDatabasePath(dataDir)
  if (!existsSync(databasePath)) return []
  return new BeeGameProjectMetadataStore(databasePath).listProjects()
}

function loadLocalModelConfigs(dataDir: string): ModelConfigSnapshotRecord[] {
  return readModelConfigSnapshotFromStore({ dataDir })
}

function loadLocalSessions(projects: BeeGameProjectMetadata[]): BeeGameLocalSessionMetadata[] {
  return projects.flatMap(project => {
    const workspacePath = project.root_path?.trim()
    if (!workspacePath) return []
    const transcriptPath = projectChatPath(workspacePath)
    if (!existsSync(transcriptPath)) return []
    const file = statSync(transcriptPath)
    const sessions = new Map<string, BeeGameLocalSessionMetadata>()
    for (const { header } of new ChatJsonlReader().entriesSync(transcriptPath)) {
      if (!header.sessionId) continue
      const time = parseDateField(header.createdAt)
      const session = sessions.get(header.sessionId)
      if (session) session.updatedAt = time ?? session.updatedAt
      else sessions.set(header.sessionId, { id: header.sessionId, projectId: project.id,
        workspacePath, status: 'idle', transcriptPath,
        createdAt: time ?? file.birthtime, updatedAt: time ?? file.mtime })
    }
    return [...sessions.values()]
  })
}

function parseDateField(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : undefined
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
    sessions: data.sessions.length,
    modelConfigs: data.modelConfigs.length,
    runtimeSettings: Object.keys(data.runtimeSettings).length > 0,
    mcpServers: data.mcpServers.length,
  }
}

function stringField(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || undefined
}
