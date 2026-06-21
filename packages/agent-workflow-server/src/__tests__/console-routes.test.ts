import { beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createModelConfig,
  resetAgentWorkflow,
} from '@claude-code-best/agent-workflow'
import { createAgentWorkflowApp } from '../app'
import type {
  ConsoleProcess,
  ConsoleProcessFactory,
  ConsoleProcessStartInput,
} from '../console/session-manager'

class FakeConsoleProcess implements ConsoleProcess {
  readonly writes: string[] = []
  readonly stops: string[] = []
  onOutput?: (source: 'stdout' | 'stderr', text: string) => void
  onExit?: (exitCode: number | null) => void

  write(text: string): void {
    this.writes.push(text)
  }

  stop(): void {
    this.stops.push('stop')
  }

  emit(source: 'stdout' | 'stderr', text: string): void {
    this.onOutput?.(source, text)
  }

  exit(exitCode: number | null): void {
    this.onExit?.(exitCode)
  }
}

describe('console session routes', () => {
  beforeEach(() => {
    resetAgentWorkflow()
  })

  test('starts a Claude Code console session with model env', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'cc-console-'))
    const starts: ConsoleProcessStartInput[] = []
    const processes: FakeConsoleProcess[] = []
    const processFactory: ConsoleProcessFactory = input => {
      starts.push(input)
      const process = new FakeConsoleProcess()
      processes.push(process)
      return process
    }
    const app = createAgentWorkflowApp({ processFactory })
    const model = createModelConfig('dashboard-local', {
      name: 'Primary LLM',
      provider: 'openai-compatible',
      baseUrl: 'https://llm.example.invalid/v1',
      apiKey: 'sk-dashboard-secret',
      models: { balanced: 'balanced-model' },
    })

    try {
      const res = await app.request('/api/console/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspacePath: workspace,
          modelConfigId: model.id,
        }),
      })

      expect(res.status).toBe(200)
      const session = await res.json()
      expect(session.status).toBe('running')
      expect(starts).toEqual([
        expect.objectContaining({
          cwd: workspace,
          env: expect.objectContaining({
            CLAUDE_CODE_USE_OPENAI: '1',
            OPENAI_API_KEY: 'sk-dashboard-secret',
            OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
          }),
        }),
      ])
      expect(processes).toHaveLength(1)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rejects relative workspace paths before spawning Claude Code', async () => {
    const starts: ConsoleProcessStartInput[] = []
    const app = createAgentWorkflowApp({
      processFactory: input => {
        starts.push(input)
        return new FakeConsoleProcess()
      },
    })

    const res = await app.request('/api/console/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspacePath: './WO' }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Workspace path must be absolute',
    })
    expect(starts).toHaveLength(0)
  })

  test('sends input and returns output events', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'cc-console-'))
    const processes: FakeConsoleProcess[] = []
    const app = createAgentWorkflowApp({
      processFactory: input => {
        const process = new FakeConsoleProcess()
        process.onOutput = input.onOutput
        process.onExit = input.onExit
        processes.push(process)
        return process
      },
    })
    try {
      const sessionRes = await app.request('/api/console/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const inputRes = await app.request(
        `/api/console/sessions/${session.id}/input`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'Build a tiny puzzle game.' }),
        },
      )
      const process = processes[0]
      process.emit('stdout', 'Claude Code response\n')

      expect(inputRes.status).toBe(200)
      expect(process.writes).toEqual(['Build a tiny puzzle game.'])

      const eventsRes = await app.request(
        `/api/console/sessions/${session.id}/events`,
      )
      expect(eventsRes.status).toBe(200)
      const events = await eventsRes.json()
      expect(events.map((event: { type: string }) => event.type)).toEqual([
        'session.started',
        'input',
        'stdout',
      ])
      expect(events.at(-1)).toEqual(
        expect.objectContaining({ text: 'Claude Code response\n' }),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('stops a running console session', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'cc-console-'))
    const processes: FakeConsoleProcess[] = []
    const app = createAgentWorkflowApp({
      processFactory: input => {
        const process = new FakeConsoleProcess()
        process.onOutput = input.onOutput
        process.onExit = input.onExit
        processes.push(process)
        return process
      },
    })
    try {
      const sessionRes = await app.request('/api/console/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspacePath: workspace }),
      })
      const session = await sessionRes.json()

      const stopRes = await app.request(
        `/api/console/sessions/${session.id}/stop`,
        { method: 'POST' },
      )

      expect(stopRes.status).toBe(200)
      expect(processes[0].stops).toEqual(['stop'])
      expect(await stopRes.json()).toEqual(
        expect.objectContaining({ status: 'stopped' }),
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
