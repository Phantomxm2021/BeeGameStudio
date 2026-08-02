import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  projectAssetDisplayTasks,
  projectDocumentDisplayTasks,
} from './document-display-tasks'

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

  test('shows only the active resource repair owner batch', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-display-'))
    try {
      const tasks = projectAssetDisplayTasks({
        workspacePath: workspace,
        phase: 'RESOURCE_PREPARATION',
        workflowStatus: 'running',
        thinking: 'working',
        activeDispatch: { workerType: 'resource-preparer', status: 'running' },
        reviewTarget: 'resource',
        reviewFindings: [
          { id: 'F-001', title: 'foundation repair', owner: 'foundation' },
          { id: 'F-002', title: 'resource repair', owner: 'resource' },
        ],
      })
      expect(tasks).toEqual([
        expect.objectContaining({
          id: 'F-002',
          status: 'running',
          operation: 'produce',
        }),
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

describe('document repair display tasks', () => {
  test('keeps an invalidated existing checklist running until its author finishes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-display-'))
    try {
      await mkdir(join(workspace, 'docs/acceptance'), { recursive: true })
      await writeFile(
        join(workspace, 'docs/acceptance/gameplay-checklist.md'),
        '# Existing invalidated checklist\n',
      )
      expect(
        projectDocumentDisplayTasks({
          workspacePath: workspace,
          documentStep: 'CHECKLIST_DRAFTING',
          workflowStatus: 'running',
          thinking: 'working',
        }),
      ).toEqual([
        expect.objectContaining({
          id: 'docs/acceptance/gameplay-checklist.md',
          status: 'running',
          operation: 'write',
        }),
      ])
      expect(
        projectDocumentDisplayTasks({
          workspacePath: workspace,
          documentStep: 'CHECKLIST_DRAFTING',
          workflowStatus: 'stopped',
          thinking: 'working',
        }),
      ).toEqual([
        expect.objectContaining({
          id: 'docs/acceptance/gameplay-checklist.md',
          status: 'failed',
          operation: 'write',
        }),
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('shows only the active foundation owner batch', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-display-'))
    try {
      const tasks = projectDocumentDisplayTasks({
        workspacePath: workspace,
        documentStep: 'FOUNDATION_DRAFTING',
        workflowStatus: 'running',
        thinking: 'working',
        reviewAccepted: true,
        reviewTarget: 'foundation',
        reviewFindings: [
          { id: 'F-001', title: 'foundation repair', owner: 'foundation' },
          { id: 'F-002', title: 'resource repair', owner: 'resource' },
        ],
      })
      expect(tasks).toEqual([
        expect.objectContaining({
          id: 'F-001',
          status: 'running',
          operation: 'write',
        }),
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
