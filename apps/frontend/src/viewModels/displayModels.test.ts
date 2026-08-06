import { describe, expect, it } from 'vitest'
import {
  toProjectRuntimeDisplayModel,
  toPermissionDisplayModel,
} from './displayModels'

describe('displayModels', () => {
  it('maps only canonical tool-permission fields', () => {
    const review = {
      gate_id: 'permission-1',
      type: 'BEEGAME_PERMISSION' as const,
      title: 'Bash permission',
      permission_tool_name: 'Bash',
      artifact: { input: { command: 'npm test' } },
      summary: { block_reason: 'Tool approval required.' },
    }
    expect(toPermissionDisplayModel(review)).toEqual({
      ...review,
      task_id: undefined,
      raw: review,
    })
  })

  it('maps the server-owned workflow and build state', () => {
    const display = toProjectRuntimeDisplayModel({
      project_id: 'project-1',
      phase: 'IMPLEMENTATION',
      blocked: false,
      next_action: 'Continue implementation',
      acceptance: { status: 'not_run' },
      build_report: {
        status: ' passed ',
        agents: [' worker '],
        generated_paths: [' dist/index.html '],
        checks: [{ name: ' build ', status: ' passed ' }],
      },
      workflow: {
        runId: 'run-1',
        status: 'needs_action',
        phase: 'DOCUMENT_REVIEW',
        recoverable: true,
        lastProvenPhase: 'DOCUMENT_REVIEW',
        lastProvenUnitId: 'review:resource_semantic_fitness',
        lastProvenUnitKind: 'review-check',
        lastProvenItemId: 'resource_semantic_fitness',
        nextAction: 'resume',
        phaseIndex: 6,
        phaseCount: 9,
        substage: 'CLOSURE_REVIEW',
        convergencePass: 2,
        reviewMode: 'closure',
        reviewTarget: 'resource',
        startedAt: '2026-07-30T10:00:00.000Z',
        tasks: [{ id: 'task-1', title: 'Implement game', status: 'running' }],
      },
    })

    expect(display).toMatchObject({
      project_id: 'project-1',
      phase: 'IMPLEMENTATION',
      blocked: false,
      build_report: {
        status: 'passed',
        agents: ['worker'],
        generated_paths: ['dist/index.html'],
      },
      workflow: {
        runId: 'run-1',
        status: 'blocked',
        recoverable: true,
        lastProvenPhase: 'DOCUMENT_REVIEW',
        lastProvenUnitId: 'review:resource_semantic_fitness',
        lastProvenUnitKind: 'review-check',
        lastProvenItemId: 'resource_semantic_fitness',
        nextAction: 'resume',
        phaseIndex: 6,
        phaseCount: 9,
        substage: 'CLOSURE_REVIEW',
        convergencePass: 2,
        reviewMode: 'closure',
        reviewTarget: 'resource',
        tasks: [{ id: 'task-1', title: 'Implement game', status: 'running' }],
      },
    })
  })

  it('does not invent a workflow from transport phase fields', () => {
    expect(
      toProjectRuntimeDisplayModel({
        project_id: 'project-1',
        phase: 'running',
        blocked: false,
      })?.workflow,
    ).toBeUndefined()
  })

  it('preserves a stopped workflow task without converting it to failure', () => {
    expect(
      toProjectRuntimeDisplayModel({
        project_id: 'project-1',
        workflow: {
          runId: 'run-stopped',
          status: 'stopped',
          tasks: [
            {
              id: 'docs/AUDIO_DESIGN.md',
              title: 'docs/AUDIO_DESIGN.md',
              status: 'stopped',
            },
          ],
        },
      })?.workflow,
    ).toMatchObject({
      status: 'cancelled',
      tasks: [
        {
          id: 'docs/AUDIO_DESIGN.md',
          status: 'stopped',
        },
      ],
    })
  })

  it('normalizes nested stage snapshots from camel and snake case fields in server order', () => {
    const display = toProjectRuntimeDisplayModel({
      project_id: 'project-1',
      workflow: {
        run_id: 'run-stages',
        status: 'running',
        stageSnapshots: [
          {
            stageId: 'FOUNDATION',
            status: 'needs_action',
            currentPhase: 'DOCUMENT_REVIEW',
            phaseIndex: 3,
            phaseCount: 9,
            substage: 'CHECKLIST_REVIEW',
            convergencePass: 2,
            documentStep: 'CHECKLIST_REVIEW',
            reviewMode: 'closure',
            reviewTarget: 'checklist',
            worker: 'reviewer',
            thinking: '  checking findings  ',
            executionStatus: 'waiting',
            currentItemId: 'docs/CHECKLIST.md',
            tasks: [
              {
                id: 'task-1',
                title: 'Review checklist',
                status: 'running',
                operation: 'review',
                attempt: 2,
              },
            ],
            completedTaskCount: 0,
            totalTaskCount: 1,
            createdAt: '2026-08-06T10:00:00.000Z',
            updatedAt: '2026-08-06T10:01:00.000Z',
            completedAt: null,
            elapsedMs: 1000,
            activeSince: '2026-08-06T10:00:30.000Z',
          },
          {
            stage_id: 'IMPLEMENTATION',
            status: 'completed',
            current_phase: 'IMPLEMENTATION',
            phase_index: 4,
            phase_count: 9,
            substage: 'REPAIRING',
            convergence_pass: 1,
            document_step: 'IMPLEMENTATION',
            review_mode: 'initial',
            review_target: 'resource',
            worker: 'builder',
            thinking: 'idle',
            execution_status: 'idle',
            current_item_id: 'src/main.ts',
            tasks: [
              {
                id: 'task-2',
                title: 'Build project',
                status: 'completed',
                operation: 'assemble',
                failure_reason: '  ',
              },
            ],
            completed_task_count: 1,
            total_task_count: 1,
            created_at: '2026-08-06T09:00:00.000Z',
            updated_at: '2026-08-06T09:59:00.000Z',
            completed_at: '2026-08-06T09:59:00.000Z',
            elapsed_ms: 5000,
            active_since: '2026-08-06T09:00:30.000Z',
          },
        ],
        nextAction: 'retry',
        recoverable: true,
        usage: { inputTokens: 20 },
      },
    })

    expect(display?.workflow?.stageSnapshots).toEqual([
      {
        stageId: 'FOUNDATION',
        status: 'blocked',
        currentPhase: 'DOCUMENT_REVIEW',
        phaseIndex: 3,
        phaseCount: 9,
        substage: 'CHECKLIST_REVIEW',
        convergencePass: 2,
        documentStep: 'CHECKLIST_REVIEW',
        reviewMode: 'closure',
        reviewTarget: 'checklist',
        worker: 'reviewer',
        thinking: 'checking findings',
        executionStatus: 'waiting',
        currentItemId: 'docs/CHECKLIST.md',
        tasks: [
          {
            id: 'task-1',
            title: 'Review checklist',
            status: 'running',
            operation: 'review',
            attempt: 2,
          },
        ],
        completedTaskCount: 0,
        totalTaskCount: 1,
        createdAt: '2026-08-06T10:00:00.000Z',
        updatedAt: '2026-08-06T10:01:00.000Z',
        elapsedMs: 1000,
        activeSince: '2026-08-06T10:00:30.000Z',
      },
      {
        stageId: 'IMPLEMENTATION',
        status: 'completed',
        currentPhase: 'IMPLEMENTATION',
        phaseIndex: 4,
        phaseCount: 9,
        substage: 'REPAIRING',
        convergencePass: 1,
        documentStep: 'IMPLEMENTATION',
        reviewMode: 'initial',
        reviewTarget: 'resource',
        worker: 'builder',
        executionStatus: 'idle',
        currentItemId: 'src/main.ts',
        tasks: [
          {
            id: 'task-2',
            title: 'Build project',
            status: 'completed',
            operation: 'assemble',
          },
        ],
        completedTaskCount: 1,
        totalTaskCount: 1,
        createdAt: '2026-08-06T09:00:00.000Z',
        updatedAt: '2026-08-06T09:59:00.000Z',
        completedAt: '2026-08-06T09:59:00.000Z',
        elapsedMs: 5000,
        activeSince: '2026-08-06T09:00:30.000Z',
      },
    ])

    expect(display?.workflow?.nextAction).toBe('retry')
    expect(display?.workflow?.recoverable).toBe(true)
    expect(display?.workflow?.usage).toEqual({ inputTokens: 20 })
  })

  it('filters malformed nested stage snapshots without inventing cards', () => {
    const display = toProjectRuntimeDisplayModel({
      project_id: 'project-1',
      workflow: {
        runId: 'run-stages',
        status: 'running',
        stageSnapshots: [
          { status: 'running', phaseIndex: 1 },
          { stageId: '', status: 'running', phaseIndex: 2 },
          { stageId: 'bad-index', status: 'running', phaseIndex: 0 },
          { stageId: 'bad-index', status: 'running', phaseIndex: 1.5 },
          { stageId: 'bad-status', status: 'unknown', phaseIndex: 2 },
          {
            stageId: 'valid',
            status: 'starting',
            currentPhase: 'STARTING',
            phaseIndex: 1,
            phaseCount: 9,
            tasks: [],
          },
        ],
      },
    })

    expect(display?.workflow?.stageSnapshots).toEqual([
      expect.objectContaining({
        stageId: 'valid',
        status: 'running',
        phaseIndex: 1,
      }),
    ])
  })

  it('keeps legacy workflow fallback when stage snapshots are absent', () => {
    const display = toProjectRuntimeDisplayModel({
      project_id: 'project-1',
      workflow: {
        runId: 'legacy-run',
        status: 'completed',
        phase: 'DELIVERED',
      },
    })

    expect(display?.workflow).toMatchObject({
      runId: 'legacy-run',
      status: 'completed',
      currentPhase: 'DELIVERED',
    })
    expect(display?.workflow?.stageSnapshots).toBeUndefined()
  })

  it('normalizes nested blocks and tasks defensively', () => {
    const display = toProjectRuntimeDisplayModel({
      project_id: 'project-1',
      workflow: {
        runId: 'run-safety',
        status: 'blocked',
        stageSnapshots: [
          {
            stageId: 'SAFE',
            status: 'blocked',
            phaseIndex: 1,
            phaseCount: 1,
            tasks: [
              null,
              { id: '', title: 'missing id', status: 'running' },
              { id: 'task-ok', title: '  Keep me  ', status: 'running' },
            ],
            block: {
              message: '  Approval required  ',
              next_action: '  resume  ',
            },
          },
        ],
      },
    })

    expect(display?.workflow?.stageSnapshots).toEqual([
      expect.objectContaining({
        stageId: 'SAFE',
        tasks: [{ id: 'task-ok', title: 'Keep me', status: 'running' }],
        block: { message: 'Approval required', nextAction: 'resume' },
      }),
    ])
  })
})
