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
})
