import { beforeEach, describe, expect, test } from 'bun:test'
import {
  createGameProject,
  createGameRun,
  getRunDetail,
  resetAgentWorkflow,
  type RuntimeModelConfig,
} from '@claude-code-best/agent-workflow'
import { createClaudeCodeRuntimeAdapter } from '../runtime/claude-code-runtime-adapter'
import { applyRuntimeEvent } from '../runtime/events'
import type { ClaudeCodeRuntimeLaunchInput } from '../runtime/claude-code-runtime-adapter'

describe('Claude Code runtime adapter', () => {
  beforeEach(() => {
    resetAgentWorkflow()
  })

  test('passes project, run, and runtime env into the launcher and maps progress events', async () => {
    const project = createGameProject('owner-a', {
      name: 'Runtime Prototype',
      idea: 'A game concept supplied by the user.',
      targetRuntime: 'custom-engine',
      workspacePath: '/tmp/claude-code-runtime',
    })
    const run = createGameRun({
      projectId: project.id,
      modelConfigId: 'llm-primary',
    })
    const runtime: RuntimeModelConfig = {
      modelType: 'openai',
      env: {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_API_KEY: 'sk-runtime-secret',
      },
    }
    const launches: ClaudeCodeRuntimeLaunchInput[] = []
    const adapter = createClaudeCodeRuntimeAdapter({
      async launch(input) {
        launches.push(input)
        input.emit({ type: 'phase_started', phase: 'GDD' })
        input.emit({
          type: 'artifact_created',
          projectId: input.project.id,
          kind: 'gdd',
          title: 'Game Design Document',
          path: '/tmp/claude-code-runtime/docs/gdd.md',
        })
        input.emit({
          type: 'run_done',
          status: 'completed',
          message: 'Workflow completed.',
        })
      },
    })

    await adapter.startRun({
      project,
      run,
      runtime,
      emit: event => applyRuntimeEvent(run.id, event),
    })

    expect(launches).toHaveLength(1)
    expect(launches[0].runtime.env.OPENAI_API_KEY).toBe('sk-runtime-secret')
    expect(launches[0].project.workspacePath).toBe('/tmp/claude-code-runtime')
    const detail = getRunDetail(run.id)
    expect(detail?.run.status).toBe('completed')
    expect(detail?.artifacts).toEqual([
      expect.objectContaining({ title: 'Game Design Document' }),
    ])
  })

  test('delegates run controls to the launcher callbacks', async () => {
    const project = createGameProject('owner-a', {
      name: 'Runtime Prototype',
      idea: 'A game concept supplied by the user.',
      targetRuntime: 'custom-engine',
      workspacePath: '/tmp/claude-code-runtime',
    })
    const run = createGameRun({
      projectId: project.id,
      modelConfigId: 'llm-primary',
    })
    const controls: string[] = []
    const adapter = createClaudeCodeRuntimeAdapter({
      async launch() {},
      async cancel(input) {
        controls.push(`cancel:${input.run.id}`)
      },
      async retry(input) {
        controls.push(`retry:${input.run.id}`)
      },
      async resume(input) {
        controls.push(`resume:${input.run.id}`)
      },
    })

    await adapter.cancelRun({
      run,
      emit: event => applyRuntimeEvent(run.id, event),
    })
    await adapter.retryRun({
      run,
      emit: event => applyRuntimeEvent(run.id, event),
    })
    await adapter.resumeRun({
      run,
      emit: event => applyRuntimeEvent(run.id, event),
    })

    expect(controls).toEqual([
      `cancel:${run.id}`,
      `retry:${run.id}`,
      `resume:${run.id}`,
    ])
  })
})
