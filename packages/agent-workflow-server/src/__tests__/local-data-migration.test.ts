import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { describe, expect, test } from 'bun:test'
import {
  loadBeeGameLocalDashboardData,
  migrateBeeGameLocalDashboardData,
} from '../local-data-migration'
import { upsertMcpServer } from '../mcp-servers-store'
import { BeeGameProjectMetadataStore, getBeeGameProjectDatabasePath } from '../project-metadata-store'
import { saveRuntimeSettingsConfig } from '../runtime-settings-store'
import { saveWebToolsConfig } from '../web-tools-store'

describe('local data migration', () => {
  test('loads local dashboard data without stripping migration secrets', async () => {
    const dataDir = await createLocalDashboardData()

    const data = loadBeeGameLocalDashboardData(dataDir)

    expect(data.projects).toEqual([
      expect.objectContaining({
        id: 'project_1',
        name: 'Project One',
      }),
    ])
    expect(data.modelConfigs).toEqual([
      expect.objectContaining({
        ownerId: 'dashboard-local',
        apiKey: 'sk-local-secret',
      }),
    ])
    expect(data.webTools.braveApiKey).toBe('brave-local-secret')
    expect(data.mcpServers).toEqual([
      expect.objectContaining({
        env: [{ key: 'TOKEN', value: 'mcp-local-secret' }],
      }),
    ])
  })

  test('dry-runs by default and applies owner-scoped records when requested', async () => {
    const dataDir = await createLocalDashboardData()
    const calls: Array<{ method: string; ownerId: string; payload: unknown }> = []
    const store = {
      upsertProject: async (ownerId: string, payload: unknown) => {
        calls.push({ method: 'upsertProject', ownerId, payload })
        return payload
      },
      upsertModelConfig: async (payload: { ownerId: string }) => {
        calls.push({
          method: 'upsertModelConfig',
          ownerId: payload.ownerId,
          payload,
        })
      },
      saveRuntimeSettings: async (ownerId: string, payload: unknown) => {
        calls.push({ method: 'saveRuntimeSettings', ownerId, payload })
        return payload
      },
      saveWebTools: async (ownerId: string, payload: unknown) => {
        calls.push({ method: 'saveWebTools', ownerId, payload })
        return payload
      },
      upsertMcpServer: async (ownerId: string, payload: unknown) => {
        calls.push({ method: 'upsertMcpServer', ownerId, payload })
        return payload
      },
    }

    await expect(migrateBeeGameLocalDashboardData({
      ownerId: '00000000-0000-0000-0000-000000000001',
      dataDir,
      store,
      dryRun: true,
    })).resolves.toEqual({
      ownerId: '00000000-0000-0000-0000-000000000001',
      dataDir,
      dryRun: true,
      projects: 1,
      modelConfigs: 1,
      runtimeSettings: true,
      webTools: true,
      mcpServers: 1,
    })
    expect(calls).toEqual([])

    await migrateBeeGameLocalDashboardData({
      ownerId: '00000000-0000-0000-0000-000000000001',
      dataDir,
      store,
      dryRun: false,
    })

    expect(calls.map(call => call.method)).toEqual([
      'upsertProject',
      'upsertModelConfig',
      'saveRuntimeSettings',
      'saveWebTools',
      'upsertMcpServer',
    ])
    expect(calls.every(call =>
      call.ownerId === '00000000-0000-0000-0000-000000000001'
    )).toBe(true)
    expect(calls.find(call =>
      call.method === 'upsertModelConfig'
    )?.payload).toEqual(expect.objectContaining({
      ownerId: '00000000-0000-0000-0000-000000000001',
      apiKey: 'sk-local-secret',
    }))
  })
})

async function createLocalDashboardData(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), 'beegame-migration-'))
  new BeeGameProjectMetadataStore(getBeeGameProjectDatabasePath(dataDir))
    .upsertProject({
      id: 'project_1',
      name: 'Project One',
      root_path: '/tmp/project-one',
      created_at: 1780000000000,
    })
  writeFileSync(
    join(dataDir, 'model-configs.json'),
    `${JSON.stringify({
      version: 1,
      configs: [{
        id: 'llm_1',
        ownerId: 'dashboard-local',
        name: 'Local LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example/v1',
        apiKey: 'sk-local-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
        createdAt: '2026-06-27T00:00:00.000Z',
        updatedAt: '2026-06-27T00:00:00.000Z',
      }],
    })}\n`,
    'utf8',
  )
  saveRuntimeSettingsConfig({ skillSearchEnabled: true }, { dataDir })
  saveWebToolsConfig({
    webSearchAdapter: 'brave',
    braveApiKey: 'brave-local-secret',
  }, { dataDir })
  mkdirSync(dataDir, { recursive: true })
  upsertMcpServer({
    name: 'Local MCP',
    enabled: true,
    transport: 'stdio',
    scope: 'beegame',
    command: 'npx',
    args: ['local-mcp'],
    env: [{ key: 'TOKEN', value: 'mcp-local-secret' }],
  }, { dataDir })
  return dataDir
}
