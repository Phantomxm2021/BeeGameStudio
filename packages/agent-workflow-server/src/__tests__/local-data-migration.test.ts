import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  loadBeeGameLocalDashboardData,
  migrateBeeGameLocalDashboardData,
} from '../local-data-migration'
import { upsertMcpServer } from '../mcp-servers-store'
import { BeeGameProjectMetadataStore, getBeeGameProjectDatabasePath } from '../project-metadata-store'
import { saveRuntimeSettingsConfig } from '../runtime-settings-store'
import { saveWebToolsConfig } from '../web-tools-store'
import { listAuditEvents } from '../audit-events-store'
import { encryptSecret } from '../security/secret-crypto'

describe('local data migration', () => {
  const originalKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY

  beforeAll(() => {
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString('base64')
  })

  afterAll(() => {
    if (originalKey === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = originalKey
  })

  test('loads local dashboard data without stripping migration secrets', async () => {
    const dataDir = await createLocalDashboardData()

    const data = loadBeeGameLocalDashboardData(dataDir)

    expect(data.projects).toEqual([
      expect.objectContaining({
        id: 'project_1',
        name: 'Project One',
      }),
    ])
    expect(data.sessions).toEqual([
      expect.objectContaining({
        id: 'beegame_session_1',
        projectId: 'project_1',
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
    const migrated = readFileSync(join(dataDir, 'model-configs.json'), 'utf8')
    expect(migrated).not.toContain('sk-local-secret')
    expect(JSON.parse(migrated).configs[0].apiKey).toMatch(/^v1\./u)
    expect(loadBeeGameLocalDashboardData(dataDir).modelConfigs[0]?.apiKey)
      .toBe('sk-local-secret')
    expect(readFileSync(join(dataDir, 'model-configs.json'), 'utf8')).toBe(migrated)
  })

  test('audits the number of legacy secrets migrated instead of records', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-secret-counts-'))
    writeFileSync(join(dataDir, 'model-configs.json'), `${JSON.stringify({
      version: 1,
      configs: [
        {
          id: 'legacy-model',
          ownerId: 'dashboard-local',
          name: 'Legacy',
          provider: 'openai-compatible',
          apiKey: 'legacy-model-secret',
          models: {},
        },
        {
          id: 'encrypted-model',
          ownerId: 'dashboard-local',
          name: 'Encrypted',
          provider: 'openai-compatible',
          apiKey: encryptSecret('encrypted-model-secret', 'model-config:api-key'),
          models: {},
        },
      ],
    })}\n`, 'utf8')
    writeFileSync(join(dataDir, 'web-tools.json'), `${JSON.stringify({
      version: 1,
      config: {
        braveApiKey: 'legacy-brave-secret',
        exaApiKey: encryptSecret('encrypted-exa-secret', 'web-tools:exa-api-key'),
      },
    })}\n`, 'utf8')
    writeFileSync(join(dataDir, 'mcp-servers.json'), `${JSON.stringify({
      version: 1,
      servers: [{
        name: 'mixed-server',
        env: [
          { key: 'LEGACY_ONE', value: 'legacy-one-secret' },
          { key: 'LEGACY_TWO', value: 'legacy-two-secret' },
          { key: 'ENCRYPTED', value: encryptSecret('encrypted-secret', 'mcp-server:env:ENCRYPTED') },
        ],
      }],
    })}\n`, 'utf8')

    loadBeeGameLocalDashboardData(dataDir)

    const events = listAuditEvents({ dataDir })
    expect(events.map(event => event.metadata)).toEqual([
      { count: 1 },
      { count: 1 },
      { count: 2 },
    ])
  })

  test('dry-runs by default and applies project records when requested', async () => {
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
      upsertSession: async (ownerId: string, payload: unknown) => {
        calls.push({ method: 'upsertSession', ownerId, payload })
        return payload
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
      sessions: 1,
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
      'upsertSession',
      'upsertMcpServer',
    ])
    expect(calls.every(call =>
      call.ownerId === '00000000-0000-0000-0000-000000000001'
    )).toBe(true)
  })

  test('migrates platform settings only when explicitly requested', async () => {
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
      upsertSession: async (ownerId: string, payload: unknown) => {
        calls.push({ method: 'upsertSession', ownerId, payload })
        return payload
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

    await migrateBeeGameLocalDashboardData({
      ownerId: '00000000-0000-0000-0000-000000000001',
      dataDir,
      store,
      dryRun: false,
      includePlatformSettings: true,
    })

    expect(calls.map(call => call.method)).toEqual([
      'upsertProject',
      'upsertSession',
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

  test('records destination secret migration counts without secret values or ids', async () => {
    const dataDir = await createLocalDashboardData()
    const auditCalls: unknown[] = []
    const store = {
      upsertProject: async () => undefined,
      upsertSession: async () => undefined,
      upsertModelConfig: async () => undefined,
      saveRuntimeSettings: async () => undefined,
      saveWebTools: async () => undefined,
      upsertMcpServer: async () => undefined,
      recordSecretMigration: async (_ownerId: string, metadata: unknown) => {
        auditCalls.push(metadata)
      },
    }

    await migrateBeeGameLocalDashboardData({
      ownerId: '00000000-0000-0000-0000-000000000001',
      dataDir,
      store,
      dryRun: false,
      includePlatformSettings: true,
    })

    expect(auditCalls).toEqual([{
      modelConfigs: 1,
      webTools: 1,
      mcpServers: 1,
      count: 3,
    }])
    expect(JSON.stringify(auditCalls)).not.toContain('sk-local-secret')
    expect(JSON.stringify(auditCalls)).not.toContain('project_1')
  })

  test('does not require destination audit support', async () => {
    const dataDir = await createLocalDashboardData()
    const store = {
      upsertProject: async () => undefined,
      upsertSession: async () => undefined,
      upsertModelConfig: async () => undefined,
      saveRuntimeSettings: async () => undefined,
      saveWebTools: async () => undefined,
      upsertMcpServer: async () => undefined,
    }

    await expect(migrateBeeGameLocalDashboardData({
      ownerId: '00000000-0000-0000-0000-000000000001',
      dataDir,
      store,
      dryRun: false,
      includePlatformSettings: true,
    })).resolves.toBeDefined()
  })
})

async function createLocalDashboardData(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), 'beegame-migration-'))
  const projectDir = join(dataDir, 'Project One')
  const transcriptDir = join(projectDir, 'transcripts')
  mkdirSync(transcriptDir, { recursive: true })
  writeFileSync(
    join(transcriptDir, 'project-one__abcdef12.jsonl'),
    [
      JSON.stringify({
        id: 1,
        sessionId: 'beegame_session_1',
        type: 'session.started',
        createdAt: '2026-06-27T01:00:00.000Z',
      }),
      JSON.stringify({
        id: 2,
        sessionId: 'beegame_session_1',
        type: 'assistant.message',
        text: 'Ready',
        createdAt: '2026-06-27T01:05:00.000Z',
      }),
    ].join('\n') + '\n',
    'utf8',
  )
  new BeeGameProjectMetadataStore(getBeeGameProjectDatabasePath(dataDir))
    .upsertProject({
      id: 'project_1',
      name: 'Project One',
      root_path: projectDir,
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
