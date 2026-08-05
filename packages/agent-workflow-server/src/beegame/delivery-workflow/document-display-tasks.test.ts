import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  projectAssetDisplayTasks,
  projectDocumentDisplayTasks,
  projectReviewFindingDisplayItems,
} from './document-display-tasks'

describe('review finding display projection', () => {
  test('uses only the current requiredOutcome contract', () => {
    const findings = [
      {
        findingId: 'foundation-current',
        owner: 'foundation',
        requiredOutcome: 'The foundation documents agree.',
      },
      {
        findingId: 'resource-current',
        owner: 'resource',
        requiredOutcome: 'The resource contract is complete.',
      },
    ]
    expect(projectReviewFindingDisplayItems(findings)).toEqual([
      {
        id: 'foundation-current',
        owner: 'foundation',
        title: 'The foundation documents agree.',
      },
      {
        id: 'resource-current',
        owner: 'resource',
        title: 'The resource contract is complete.',
      },
    ])
    expect(projectReviewFindingDisplayItems(findings, 'resource')).toEqual([
      {
        id: 'resource-current',
        owner: 'resource',
        title: 'The resource contract is complete.',
      },
    ])
  })
})

describe('resource-content display tasks', () => {
  test('shows content preparation in the single resource phase', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-display-'))
    try {
      await mkdir(join(workspace, 'assets'), { recursive: true })
      await writeFile(
        join(workspace, 'assets/asset-manifest.json'),
        JSON.stringify({
          version: 8,
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
        resourceProductionTask: 'RESOURCE_CONTENT',
      })
      expect(tasks.map(task => task.id)).toEqual([
        'RESOURCE_PLAN',
        'RESOURCE_INVENTORY',
        'RESOURCE_CONTENT',
        'RESOURCE_GATE',
      ])
      expect(tasks[2]?.status).toBe('pending')
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
        activeDispatch: { workerType: 'resource-curator', status: 'running' },
        resourceProductionTask: 'RESOURCE_INVENTORY',
        reviewTarget: 'resource',
        reviewFindings: [
          { id: 'F-001', title: 'foundation repair', owner: 'foundation' },
          { id: 'F-002', title: 'resource repair', owner: 'resource' },
        ],
      })
      expect(tasks).toHaveLength(4)
      expect(tasks[0]?.status).toBe('completed')
      expect(tasks[1]).toEqual(
        expect.objectContaining({
          id: 'RESOURCE_INVENTORY',
          status: 'running',
          operation: 'produce',
        }),
      )
      expect(tasks[2]?.status).toBe('pending')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

describe('document repair display tasks', () => {
  test('leaves review tasks pending without Cycle check progress', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-display-'))
    try {
      const input = {
        workspacePath: workspace,
        documentStep: 'FOUNDATION_REVIEW' as const,
        workflowStatus: 'running',
        thinking: 'working' as const,
      }
      const tasks = projectDocumentDisplayTasks(input)
      expect(tasks.find(task => task.id === 'docs/GDD.md')?.status).toBe(
        'pending',
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('shows every check in the sole active review packet as running', async () => {
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
          'gameplay_strategy_viability',
          'economy_progression_integrity',
          'numeric_balance_feasibility',
          'pacing_difficulty_coherence',
        ],
        reviewCompletedCheckIds: [
          'brief_alignment',
          'cross_document_consistency',
          'gameplay_completeness',
        ],
      })
      expect(tasks.map(task => task.status)).toEqual([
        'completed',
        'completed',
        'completed',
        'running',
        'running',
        'pending',
        'pending',
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('shows both content-integration checks in the same active packet', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-display-'))
    try {
      const tasks = projectDocumentDisplayTasks({
        workspacePath: workspace,
        documentStep: 'COMPREHENSIVE_REVIEW',
        workflowStatus: 'running',
        thinking: 'working',
        reviewCheckIds: [
          'resource_semantic_fitness',
          'content_structure_fitness',
          'resource_content_consistency',
        ],
        reviewCompletedCheckIds: ['resource_semantic_fitness'],
      })
      expect(tasks.map(task => [task.id, task.status])).toEqual([
        ['resource_semantic_fitness', 'completed'],
        ['content_structure_fitness', 'running'],
        ['resource_content_consistency', 'running'],
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
        reviewPacketSetComplete: true,
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
        reviewPacketSetComplete: true,
        reviewTarget: 'foundation',
        repairPlan: {
          groups: [
            {
              paths: [
                'docs/GDD.md',
                'docs/BALANCE_DESIGN.md',
                'docs/UI_UX_SPEC.md',
              ],
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
        expect.objectContaining({
          id: 'docs/UI_UX_SPEC.md',
          status: 'pending',
          operation: 'write',
        }),
      ])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
