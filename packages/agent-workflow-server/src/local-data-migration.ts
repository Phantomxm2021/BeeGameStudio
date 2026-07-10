import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
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
import {
  loadWebToolsConfig,
  type WebToolsConfig,
} from './web-tools-store'

export type BeeGameLocalDashboardData = {
  projects: BeeGameProjectMetadata[]
  sessions: BeeGameLocalSessionMetadata[]
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
  sessions: number
  modelConfigs: number
  runtimeSettings: boolean
  webTools: boolean
  mcpServers: number
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
  saveWebTools(ownerId: string, config: WebToolsConfig): Promise<unknown>
  upsertMcpServer(
    ownerId: string,
    server: McpServerConfig,
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
    if (summary.webTools) {
      await options.store.saveWebTools(ownerId, data.webTools)
    }
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
  return readModelConfigSnapshotFromStore({ dataDir })
}

function loadLocalSessions(
  projects: BeeGameProjectMetadata[],
): BeeGameLocalSessionMetadata[] {
  return projects.flatMap(project => {
    const workspacePath = project.root_path?.trim()
    if (!workspacePath) return []
    const transcriptDir = join(workspacePath, 'transcripts')
    if (!existsSync(transcriptDir)) return []
    return readdirSync(transcriptDir)
      .filter(fileName => fileName.endsWith('.jsonl'))
      .flatMap(fileName => {
        const transcriptPath = join(transcriptDir, fileName)
        const metadata = readLocalTranscriptMetadata(
          project.id,
          workspacePath,
          transcriptPath,
        )
        return metadata ? [metadata] : []
      })
  })
}

function readLocalTranscriptMetadata(
  projectId: string,
  workspacePath: string,
  transcriptPath: string,
): BeeGameLocalSessionMetadata | undefined {
  const lines = readFileSync(transcriptPath, 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim())
  const events = lines
    .map(parseTranscriptEvent)
    .filter((event): event is Record<string, unknown> => Boolean(event))
  const sessionId = events
    .map(event => stringField(event.sessionId))
    .find(Boolean)
  if (!sessionId) return undefined

  const timestamps = events
    .map(event => parseDateField(event.createdAt))
    .filter((date): date is Date => Boolean(date))
  const fileStats = statSync(transcriptPath)
  return {
    id: sessionId,
    projectId,
    workspacePath,
    status: 'idle',
    transcriptPath,
    createdAt: timestamps[0] ?? fileStats.birthtime,
    updatedAt: timestamps[timestamps.length - 1] ?? fileStats.mtime,
  }
}

function parseTranscriptEvent(line: string): Record<string, unknown> | undefined {
  try {
    const event = JSON.parse(line) as unknown
    return typeof event === 'object' && event !== null && !Array.isArray(event)
      ? event as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
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
    webTools: Object.keys(data.webTools).length > 0,
    mcpServers: data.mcpServers.length,
  }
}

function stringField(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || undefined
}
