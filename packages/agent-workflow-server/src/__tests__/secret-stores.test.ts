import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  createModelConfig,
  resetModelConfigs,
  updateModelConfig,
} from '@bee-game-studio/agent-workflow'
import {
  readModelConfigSnapshotFromStore,
  saveModelConfigsToStore,
} from '../model-config-store'
import {
  listMcpServers,
  upsertMcpServer,
} from '../mcp-servers-store'

describe('local secret persistence', () => {
  const originalKey = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY

  beforeAll(() => {
    process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 31).toString('base64')
  })

  afterAll(() => {
    resetModelConfigs()
    if (originalKey === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = originalKey
  })

  test('encrypts model and MCP secrets while public DTOs expose previews only', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-secrets-'))
    resetModelConfigs()
    createModelConfig('owner', {
      name: 'Model',
      provider: 'openai-compatible',
      apiKey: 'generated-model-secret',
      models: { balanced: 'model' },
    })
    saveModelConfigsToStore({ dataDir })
    const mcp = upsertMcpServer({
      name: 'MCP',
      enabled: true,
      transport: 'stdio',
      scope: 'beegame',
      command: 'node',
      env: [{ key: 'TOKEN', value: 'generated-mcp-secret' }],
    }, { dataDir })

    const stored = await readFile(join(dataDir, 'model-configs.json'), 'utf8')
    const mcpStored = await readFile(join(dataDir, 'mcp-servers.json'), 'utf8')
    expect(stored).not.toContain('generated-model-secret')
    expect(mcpStored).not.toContain('generated-mcp-secret')
    expect(JSON.stringify(mcp)).not.toContain('generated-mcp-secret')
    expect(mcp.env).toEqual([{ key: 'TOKEN', valuePreview: 'gene…cret' }])
  })

  test('preserves omitted secrets and clears them only with an explicit empty value', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-secret-updates-'))
    resetModelConfigs()
    const model = createModelConfig('owner', {
      name: 'Model',
      provider: 'openai-compatible',
      apiKey: 'generated-model-secret',
      models: { balanced: 'model' },
    })
    saveModelConfigsToStore({ dataDir })
    updateModelConfig(model.id, { name: 'Renamed' })
    saveModelConfigsToStore({ dataDir })
    expect(readModelConfigSnapshotFromStore({ dataDir })[0]?.apiKey)
      .toBe('generated-model-secret')

    updateModelConfig(model.id, { apiKey: '' })
    saveModelConfigsToStore({ dataDir })
    expect(readModelConfigSnapshotFromStore({ dataDir })[0]?.apiKey).toBe('')

    const first = upsertMcpServer({
      name: 'MCP', enabled: true, transport: 'stdio', scope: 'beegame',
      command: 'node', env: [{ key: 'TOKEN', value: 'generated-mcp-secret' }],
    }, { dataDir })
    upsertMcpServer({ id: first.id, name: 'MCP', enabled: true, transport: 'stdio', scope: 'beegame', command: 'node', env: [{ key: 'TOKEN' }] }, { dataDir })
    expect(listMcpServers({ dataDir })[0]?.env).toEqual([{ key: 'TOKEN', valuePreview: 'gene…cret' }])
    upsertMcpServer({ id: first.id, name: 'MCP', enabled: true, transport: 'stdio', scope: 'beegame', command: 'node', env: [{ key: 'TOKEN', value: '' }] }, { dataDir })
    expect(listMcpServers({ dataDir })[0]?.env).toEqual([{ key: 'TOKEN' }])
  })
})
