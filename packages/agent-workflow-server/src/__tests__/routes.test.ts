import { beforeEach, describe, expect, test } from 'bun:test'
import {
  createModelConfig,
  resetAgentWorkflow,
} from '@claude-code-best/agent-workflow'
import { createAgentWorkflowApp } from '../app'
import type { RuntimeAdapter } from '../runtime/types'

describe('agent workflow server routes', () => {
  const runtimeAdapter: RuntimeAdapter = {
    async startRun(input) {
      input.emit({
        type: 'phase_started',
        phase: input.run.currentPhase,
      })
      input.emit({
        type: 'agent_log',
        message: 'Workflow accepted by test runtime.',
        phase: input.run.currentPhase,
        agentName: 'orchestrator',
      })
    },
    async cancelRun() {},
    async retryRun() {},
    async resumeRun() {},
  }
  const app = createAgentWorkflowApp({ runtimeAdapter })

  beforeEach(() => {
    resetAgentWorkflow()
  })

  test('creates and lists masked model configs for an owner', async () => {
    const createRes = await app.request('/api/model-configs?ownerId=owner-a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Primary LLM',
        provider: 'openai-compatible',
        baseUrl: 'https://llm.example.invalid/v1',
        apiKey: 'sk-dashboard-secret',
        models: { balanced: 'balanced-model' },
        isDefault: true,
      }),
    })
    expect(createRes.status).toBe(200)
    const created = await createRes.json()
    expect(created.apiKey).toBeUndefined()
    expect(created.apiKeyPreview).toBe('sk-d...cret')

    const listRes = await app.request('/api/model-configs?ownerId=owner-a')
    expect(listRes.status).toBe(200)
    expect(await listRes.json()).toEqual([
      expect.objectContaining({ id: created.id, name: 'Primary LLM' }),
    ])
  })

  test('creates project, run, event, and artifact records', async () => {
    const projectRes = await app.request('/api/projects?ownerId=owner-a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Prototype',
        idea: 'A puzzle game controlled through spatial rules.',
        targetRuntime: 'custom-engine',
        workspacePath: '/tmp/prototype',
      }),
    })
    expect(projectRes.status).toBe(200)
    const project = await projectRes.json()
    const modelConfig = createModelConfig('owner-a', {
      name: 'Primary LLM',
      provider: 'openai-compatible',
      apiKey: 'sk-test-secret',
      models: { balanced: 'balanced-model' },
    })

    const runRes = await app.request('/api/runs?ownerId=owner-a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        modelConfigId: modelConfig.id,
      }),
    })
    expect(runRes.status).toBe(200)
    const run = await runRes.json()
    expect(run.status).toBe('running')
    expect(run.phases[0]).toEqual(
      expect.objectContaining({ title: 'Idea Intake', status: 'running' }),
    )

    const startedDetailRes = await app.request(`/api/runs/${run.id}`)
    expect(startedDetailRes.status).toBe(200)
    const startedDetail = await startedDetailRes.json()
    expect(
      startedDetail.events.map((event: { type: string }) => event.type),
    ).toEqual(['run.created', 'phase.updated', 'agent.log'])

    const phaseRes = await app.request(`/api/runs/${run.id}/phase`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phase: 'GDD', status: 'running' }),
    })
    expect(phaseRes.status).toBe(200)

    const logRes = await app.request(`/api/runs/${run.id}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'agent.log',
        message: 'Drafting design goals.',
        phase: 'GDD',
        agentName: 'designer',
      }),
    })
    expect(logRes.status).toBe(200)

    const artifactRes = await app.request('/api/artifacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        runId: run.id,
        kind: 'gdd',
        title: 'Game Design Document',
        path: '/tmp/prototype/docs/gdd.md',
      }),
    })
    expect(artifactRes.status).toBe(200)

    const detailRes = await app.request(`/api/runs/${run.id}`)
    expect(detailRes.status).toBe(200)
    const detail = await detailRes.json()
    expect(detail.run.currentPhase).toBe('GDD')
    expect(detail.events.map((event: { type: string }) => event.type)).toEqual([
      'run.created',
      'phase.updated',
      'agent.log',
      'phase.updated',
      'agent.log',
      'artifact.created',
    ])
    expect(detail.artifacts).toEqual([
      expect.objectContaining({ title: 'Game Design Document' }),
    ])
  })

  test('lists worker summaries for the visual dashboard', async () => {
    const res = await app.request('/api/workers')
    expect(res.status).toBe(200)
    const workers = await res.json()
    expect(workers.length).toBeGreaterThan(0)
    expect(workers[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        name: expect.any(String),
        status: expect.any(String),
      }),
    )
  })
})
