import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { projectAssetDisplayTasks } from './document-display-tasks'

describe('resource-content display tasks', () => {
  test('shows content preparation in the single resource phase', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-display-'))
    try {
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({
        version: 7,
        project_target: { asset_format_capabilities: ['json'], runtime_asset_root: 'assets/runtime', content_root: 'assets/content', generated_asset_root: 'assets/generated' },
        requirements: [{ id: 'data.player', required: true }], resources: [],
      }))
      const tasks = projectAssetDisplayTasks({ workspacePath: workspace, phase: 'RESOURCE_PREPARATION', workflowStatus: 'running', thinking: 'working' })
      expect(tasks.map(task => task.id)).toContain('content-descriptions')
      expect(tasks.every(task => task.operation === 'produce')).toBe(true)
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })
})
