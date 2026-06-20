import { beforeEach, describe, expect, test } from 'bun:test'
import {
  createModelConfig,
  getRunDetail,
  resetAgentWorkflow,
} from '@claude-code-best/agent-workflow'
import { createAgentWorkflowApp } from '../app'
import type { RuntimeAdapter, RuntimeStartInput } from '../runtime/types'

describe('agent workflow runtime routes', () => {
  beforeEach(() => {
    resetAgentWorkflow()
  })

  test('starts a run through the injected runtime adapter with model env', async () => {
    const starts: RuntimeStartInput[] = []
    const runtimeAdapter: RuntimeAdapter = {
      async startRun(input) {
        starts.push(input)
        input.emit({
          type: 'phase_started',
          phase: 'Idea Intake',
        })
        input.emit({
          type: 'agent_log',
          message: 'Runtime accepted the workflow.',
          phase: 'Idea Intake',
          agentName: 'orchestrator',
        })
      },
      async cancelRun() {},
      async retryRun() {},
      async resumeRun() {},
    }
    const app = createAgentWorkflowApp({ runtimeAdapter })

    const modelConfig = createModelConfig('owner-a', {
      name: 'OpenAI Compatible',
      provider: 'openai-compatible',
      baseUrl: 'https://llm.example.invalid/v1',
      apiKey: 'sk-runtime-secret',
      models: { balanced: 'runtime-balanced' },
    })

    const projectRes = await app.request('/api/projects?ownerId=owner-a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Runtime Prototype',
        idea: 'A game concept supplied by the user.',
        targetRuntime: 'custom-engine',
        workspacePath: '/tmp/runtime-prototype',
      }),
    })
    expect(projectRes.status).toBe(200)
    const project = await projectRes.json()

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
    expect(starts).toHaveLength(1)
    expect(starts[0].run.id).toBe(run.id)
    expect(starts[0].project.id).toBe(project.id)
    expect(starts[0].runtime.modelType).toBe('openai')
    expect(starts[0].runtime.env).toMatchObject({
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://llm.example.invalid/v1',
      OPENAI_API_KEY: 'sk-runtime-secret',
      OPENAI_DEFAULT_SONNET_MODEL: 'runtime-balanced',
    })

    const detail = getRunDetail(run.id)
    expect(detail?.run.status).toBe('running')
    expect(detail?.run.phases[0]).toEqual(
      expect.objectContaining({ title: 'Idea Intake', status: 'running' }),
    )
    expect(detail?.events.map(event => event.type)).toEqual([
      'run.created',
      'phase.updated',
      'agent.log',
    ])
  })

  test('does not create a run when the model config cannot map to runtime', async () => {
    const starts: RuntimeStartInput[] = []
    const app = createAgentWorkflowApp({
      runtimeAdapter: {
        async startRun(input) {
          starts.push(input)
        },
        async cancelRun() {},
        async retryRun() {},
        async resumeRun() {},
      },
    })

    const projectRes = await app.request('/api/projects?ownerId=owner-a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Runtime Prototype',
        idea: 'A game concept supplied by the user.',
        targetRuntime: 'custom-engine',
        workspacePath: '/tmp/runtime-prototype',
      }),
    })
    const project = await projectRes.json()

    const runRes = await app.request('/api/runs?ownerId=owner-a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        modelConfigId: 'missing-model-config',
      }),
    })

    expect(runRes.status).toBe(404)
    expect(starts).toHaveLength(0)
  })

  test('delegates cancel, retry, and resume to the runtime adapter', async () => {
    const controls: string[] = []
    const app = createAgentWorkflowApp({
      runtimeAdapter: {
        async startRun(input) {
          input.emit({ type: 'phase_started', phase: 'Idea Intake' })
        },
        async cancelRun(input) {
          controls.push(`cancel:${input.run.id}`)
          input.emit({
            type: 'run_done',
            status: 'canceled',
            message: 'Workflow canceled.',
          })
        },
        async retryRun(input) {
          controls.push(`retry:${input.run.id}`)
          input.emit({ type: 'phase_started', phase: 'Idea Intake' })
        },
        async resumeRun(input) {
          controls.push(`resume:${input.run.id}`)
          input.emit({
            type: 'agent_log',
            message: 'Workflow resumed.',
            phase: 'Idea Intake',
            agentName: 'orchestrator',
          })
        },
      },
    })

    const modelConfig = createModelConfig('owner-a', {
      name: 'OpenAI Compatible',
      provider: 'openai-compatible',
      apiKey: 'sk-runtime-secret',
      models: { balanced: 'runtime-balanced' },
    })
    const projectRes = await app.request('/api/projects?ownerId=owner-a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Runtime Prototype',
        idea: 'A game concept supplied by the user.',
        targetRuntime: 'custom-engine',
        workspacePath: '/tmp/runtime-prototype',
      }),
    })
    const project = await projectRes.json()
    const runRes = await app.request('/api/runs?ownerId=owner-a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        modelConfigId: modelConfig.id,
      }),
    })
    const run = await runRes.json()

    const cancelRes = await app.request(`/api/runs/${run.id}/cancel`, {
      method: 'POST',
    })
    const retryRes = await app.request(`/api/runs/${run.id}/retry`, {
      method: 'POST',
    })
    const resumeRes = await app.request(`/api/runs/${run.id}/resume`, {
      method: 'POST',
    })

    expect(cancelRes.status).toBe(200)
    expect(retryRes.status).toBe(200)
    expect(resumeRes.status).toBe(200)
    expect(controls).toEqual([
      `cancel:${run.id}`,
      `retry:${run.id}`,
      `resume:${run.id}`,
    ])
    const detail = getRunDetail(run.id)
    expect(detail?.events.map(event => event.type)).toContain('run.canceled')
    expect(detail?.events.at(-1)).toEqual(
      expect.objectContaining({
        type: 'agent.log',
        message: 'Workflow resumed.',
      }),
    )
  })

  test('returns not found for runtime controls on missing runs', async () => {
    const app = createAgentWorkflowApp()

    const res = await app.request('/api/runs/missing-run/cancel', {
      method: 'POST',
    })

    expect(res.status).toBe(404)
  })
})
