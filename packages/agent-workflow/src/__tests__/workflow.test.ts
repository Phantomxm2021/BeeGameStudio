import { beforeEach, describe, expect, test } from 'bun:test'
import {
  appendWorkflowEvent,
  createArtifact,
  createGameProject,
  createGameRun,
  listArtifactsByRun,
  listGameProjectsByOwner,
  listGameRunsByProject,
  listWorkflowEvents,
  resetAgentWorkflow,
  updateRunPhase,
} from '../index'

describe('agent workflow runs', () => {
  beforeEach(() => {
    resetAgentWorkflow()
  })

  test('creates a project run with visual workflow phases and initial event', () => {
    const project = createGameProject('owner-a', {
      name: 'Prototype',
      idea: 'A puzzle game controlled through spatial rules.',
      targetRuntime: 'custom-engine',
      workspacePath: '/tmp/prototype',
    })
    const run = createGameRun({
      projectId: project.id,
      modelConfigId: 'llm-primary',
    })

    expect(run.status).toBe('queued')
    expect(run.currentPhase).toBe('Idea Intake')
    expect(run.phases.map(phase => phase.title)).toEqual([
      'Idea Intake',
      'GDD',
      'Technical Design',
      'Implementation Plan',
      'Implementation',
      'Build/Test',
      'Preview',
      'Iteration',
    ])
    expect(listWorkflowEvents(run.id)).toEqual([
      expect.objectContaining({
        type: 'run.created',
        phase: 'Idea Intake',
      }),
    ])
  })

  test('updates phase state, records logs, and tracks artifacts', () => {
    const project = createGameProject('owner-a', {
      name: 'Prototype',
      idea: 'A puzzle game controlled through spatial rules.',
      targetRuntime: 'custom-engine',
      workspacePath: '/tmp/prototype',
    })
    const run = createGameRun({
      projectId: project.id,
      modelConfigId: 'llm-primary',
    })

    updateRunPhase(run.id, 'GDD', 'running')
    appendWorkflowEvent(run.id, {
      type: 'agent.log',
      message: 'Drafting design goals.',
      agentName: 'designer',
      phase: 'GDD',
    })
    const artifact = createArtifact({
      projectId: project.id,
      runId: run.id,
      kind: 'gdd',
      title: 'Game Design Document',
      path: '/tmp/prototype/docs/gdd.md',
    })

    expect(listGameProjectsByOwner('owner-a')).toHaveLength(1)
    expect(listGameRunsByProject(project.id)).toEqual([
      expect.objectContaining({ id: run.id, status: 'running' }),
    ])
    expect(listArtifactsByRun(run.id)).toEqual([
      expect.objectContaining({
        id: artifact.id,
        title: 'Game Design Document',
      }),
    ])
    expect(listWorkflowEvents(run.id).map(event => event.type)).toEqual([
      'run.created',
      'phase.updated',
      'agent.log',
      'artifact.created',
    ])
  })

  test('rejects artifact paths outside the project workspace', () => {
    const project = createGameProject('owner-a', {
      name: 'Prototype',
      idea: 'A puzzle game controlled through spatial rules.',
      targetRuntime: 'custom-engine',
      workspacePath: '/tmp/prototype',
    })
    const run = createGameRun({
      projectId: project.id,
      modelConfigId: 'llm-primary',
    })

    expect(() =>
      createArtifact({
        projectId: project.id,
        runId: run.id,
        kind: 'source_file',
        title: 'External Source',
        path: '/tmp/other/src/main.ts',
      }),
    ).toThrow('Artifact path must stay inside the project workspace')
  })
})
