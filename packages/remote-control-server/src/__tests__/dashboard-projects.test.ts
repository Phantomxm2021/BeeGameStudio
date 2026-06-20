import { describe, test, expect, beforeEach } from 'bun:test'
import {
  createArtifact,
  createGameProject,
  createGameRun,
  getGameRun,
  listGameProjectsByOwner,
  listGameRunsByProject,
  listArtifactsByRun,
  resetDashboardProjects,
} from '../services/dashboard-projects'

describe('dashboard project service', () => {
  beforeEach(() => {
    resetDashboardProjects()
  })

  test('creates a game project with idea, platform, and workspace path', () => {
    const project = createGameProject('local-user', {
      name: 'Orbit Garden',
      idea: 'A cozy orbital farming game',
      targetPlatform: 'web',
      workspacePath: '/tmp/orbit-garden',
    })

    expect(project.id).toMatch(/^game_/)
    expect(project.ownerId).toBe('local-user')
    expect(project.idea).toBe('A cozy orbital farming game')
    expect(project.targetPlatform).toBe('web')
    expect(project.workspacePath).toBe('/tmp/orbit-garden')
    expect(project.status).toBe('draft')
  })

  test('creates a run with the game generation phase list', () => {
    const project = createGameProject('local-user', {
      name: 'Orbit Garden',
      idea: 'A cozy orbital farming game',
      targetPlatform: 'web',
      workspacePath: '/tmp/orbit-garden',
    })

    const run = createGameRun({
      projectId: project.id,
      modelConfigId: 'llm_default',
    })

    expect(run.id).toMatch(/^run_/)
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
    expect(run.phases[0].status).toBe('pending')
  })

  test('creates artifacts associated with a project run', () => {
    const project = createGameProject('local-user', {
      name: 'Orbit Garden',
      idea: 'A cozy orbital farming game',
      targetPlatform: 'web',
      workspacePath: '/tmp/orbit-garden',
    })
    const run = createGameRun({
      projectId: project.id,
      modelConfigId: 'llm_default',
    })

    const artifact = createArtifact({
      projectId: project.id,
      runId: run.id,
      kind: 'gdd',
      title: 'GDD',
      path: '/tmp/orbit-garden/docs/GDD.md',
      mimeType: 'text/markdown',
    })

    expect(artifact.id).toMatch(/^artifact_/)
    expect(listArtifactsByRun(run.id)).toEqual([artifact])
  })

  test('rejects artifact paths outside the project workspace', () => {
    const project = createGameProject('local-user', {
      name: 'Orbit Garden',
      idea: 'A cozy orbital farming game',
      targetPlatform: 'web',
      workspacePath: '/tmp/orbit-garden',
    })
    const run = createGameRun({
      projectId: project.id,
      modelConfigId: 'llm_default',
    })

    expect(() =>
      createArtifact({
        projectId: project.id,
        runId: run.id,
        kind: 'source_file',
        title: 'Escaped File',
        path: '/tmp/other-project/src/main.ts',
      }),
    ).toThrow('Artifact path must stay inside the project workspace')
  })

  test('lists projects by owner and runs by project', () => {
    const project = createGameProject('local-user', {
      name: 'Orbit Garden',
      idea: 'A cozy orbital farming game',
      targetPlatform: 'web',
      workspacePath: '/tmp/orbit-garden',
    })
    createGameProject('other-user', {
      name: 'Other',
      idea: 'Different game',
      targetPlatform: 'web',
      workspacePath: '/tmp/other',
    })
    const run = createGameRun({
      projectId: project.id,
      modelConfigId: 'llm_default',
    })

    expect(listGameProjectsByOwner('local-user').map(item => item.id)).toEqual([
      project.id,
    ])
    expect(listGameRunsByProject(project.id).map(item => item.id)).toEqual([
      run.id,
    ])
    expect(getGameRun(run.id)?.id).toBe(run.id)
  })
})
