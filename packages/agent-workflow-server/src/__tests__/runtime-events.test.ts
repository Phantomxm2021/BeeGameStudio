import { beforeEach, describe, expect, test } from 'bun:test'
import {
  createGameProject,
  createGameRun,
  getRunDetail,
  resetAgentWorkflow,
} from '@claude-code-best/agent-workflow'
import { applyRuntimeEvent } from '../runtime/events'

describe('runtime event application', () => {
  beforeEach(() => {
    resetAgentWorkflow()
  })

  test('maps runtime events into run status, logs, artifacts, and permission waits', () => {
    const project = createGameProject('owner-a', {
      name: 'Runtime Prototype',
      idea: 'A game concept supplied by the user.',
      targetRuntime: 'custom-engine',
      workspacePath: '/tmp/runtime-events',
    })
    const run = createGameRun({
      projectId: project.id,
      modelConfigId: 'llm-primary',
    })

    applyRuntimeEvent(run.id, {
      type: 'phase_started',
      phase: 'GDD',
    })
    applyRuntimeEvent(run.id, {
      type: 'agent_progress',
      phase: 'GDD',
      agentName: 'designer',
      tokenCount: 1200,
      toolCount: 2,
    })
    applyRuntimeEvent(run.id, {
      type: 'artifact_created',
      projectId: project.id,
      kind: 'gdd',
      title: 'Game Design Document',
      path: '/tmp/runtime-events/docs/gdd.md',
      mimeType: 'text/markdown',
    })
    applyRuntimeEvent(run.id, {
      type: 'permission_requested',
      phase: 'Implementation',
      agentName: 'builder',
      message: 'Permission requested for a tool call.',
    })

    const waiting = getRunDetail(run.id)
    expect(waiting?.run.status).toBe('requires_action')
    expect(waiting?.artifacts).toEqual([
      expect.objectContaining({ title: 'Game Design Document' }),
    ])
    expect(waiting?.events.map(event => event.type)).toEqual([
      'run.created',
      'phase.updated',
      'agent.log',
      'artifact.created',
      'permission.requested',
    ])

    applyRuntimeEvent(run.id, {
      type: 'phase_done',
      phase: 'GDD',
    })
    applyRuntimeEvent(run.id, {
      type: 'run_done',
      status: 'completed',
      message: 'Workflow completed.',
    })

    const completed = getRunDetail(run.id)
    expect(completed?.run.status).toBe('completed')
    expect(completed?.events.at(-1)).toEqual(
      expect.objectContaining({ type: 'run.completed' }),
    )
  })

  test('maps failed runtime completion into failed run state', () => {
    const project = createGameProject('owner-a', {
      name: 'Runtime Prototype',
      idea: 'A game concept supplied by the user.',
      targetRuntime: 'custom-engine',
      workspacePath: '/tmp/runtime-events',
    })
    const run = createGameRun({
      projectId: project.id,
      modelConfigId: 'llm-primary',
    })

    applyRuntimeEvent(run.id, {
      type: 'run_done',
      status: 'failed',
      message: 'Workflow failed.',
    })

    const detail = getRunDetail(run.id)
    expect(detail?.run.status).toBe('failed')
    expect(detail?.events.at(-1)).toEqual(
      expect.objectContaining({ type: 'run.failed' }),
    )
  })
})
