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
      await writeFile(
        join(workspace, 'assets/asset-manifest.json'),
        JSON.stringify({
          version: 7,
          project_target: {
            asset_format_capabilities: ['json'],
            runtime_asset_root: 'assets/runtime',
            content_root: 'assets/content',
            generated_asset_root: 'assets/generated',
          },
          requirements: [{ id: 'data.player', required: true }],
          resources: [],
        }),
      )
      const tasks = projectAssetDisplayTasks({
        workspacePath: workspace,
        phase: 'RESOURCE_PREPARATION',
        workflowStatus: 'running',
        thinking: 'working',
      })
      expect(tasks.map(task => task.id)).toContain('content-descriptions')
      expect(tasks.every(task => task.operation === 'produce')).toBe(true)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
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
  test('shows one serial review cursor instead of parallel running checks', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-display-'))
    try {
      const tasks = projectDocumentDisplayTasks({
        workspacePath: workspace,
        documentStep: 'FOUNDATION_REVIEW',
        workflowStatus: 'running',
        thinking: 'working',
        reviewCheckIds: [
          'brief_alignment',
          'cross_document_consistency',
          'gameplay_completeness',
        ],
        reviewCompletedCheckIds: ['brief_alignment'],
      })
      expect(tasks.map(task => task.status)).toEqual([
        'completed',
        'running',
        'pending',
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('projects initial progress from the durable cursor rather than stale files', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-display-'))
    try {
      await mkdir(join(workspace, 'docs'), { recursive: true })
      await writeFile(join(workspace, 'docs/BALANCE_DESIGN.md'), '# stale\n')
      const tasks = projectDocumentDisplayTasks({
        workspacePath: workspace,
        documentStep: 'FOUNDATION_DRAFTING',
        workflowStatus: 'running',
        thinking: 'working',
        currentItemId: 'docs/LEVEL_SCENE_DESIGN.md',
        foundationDraftCompletedPaths: ['docs/GDD.md'],
      })
      expect(tasks.find(task => task.id === 'docs/GDD.md')?.status).toBe(
        'completed',
      )
      expect(
        tasks.find(task => task.id === 'docs/LEVEL_SCENE_DESIGN.md')?.status,
      ).toBe('running')
      expect(
        tasks.find(task => task.id === 'docs/BALANCE_DESIGN.md')?.status,
      ).toBe('pending')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

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
          status: 'stopped',
          operation: 'write',
        }),
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('shows repair planning before any foundation owner task', async () => {
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
          id: 'foundation-repair-plan',
          status: 'running',
          operation: 'review',
        }),
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('shows the durable serial foundation repair cursor', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-display-'))
    try {
      const tasks = projectDocumentDisplayTasks({
        workspacePath: workspace,
        documentStep: 'FOUNDATION_DRAFTING',
        workflowStatus: 'running',
        thinking: 'working',
        currentItemId: 'docs/BALANCE_DESIGN.md',
        reviewAccepted: true,
        reviewTarget: 'foundation',
        reviewFindings: [
          { id: 'F-001', title: 'repair authority', owner: 'foundation' },
        ],
        repairPlan: {
          groups: [
            {
              affectedPaths: ['docs/GDD.md', 'docs/BALANCE_DESIGN.md'],
            },
          ],
          completedPaths: ['docs/GDD.md'],
        },
      })
      expect(tasks).toEqual([
        expect.objectContaining({
          id: 'docs/GDD.md',
          status: 'completed',
          operation: 'write',
        }),
        expect.objectContaining({
          id: 'docs/BALANCE_DESIGN.md',
          status: 'running',
          operation: 'write',
        }),
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
