import { describe, expect, test } from 'bun:test'
import {
  createBeeGameThinkingFetch,
  ensureBeeGameMacroGlobals,
  type MutableAppState,
  stopRunningLocalShellTasks,
  toQueryEngineThinkingConfig,
} from '../beegame/query-engine-runner'

describe('QueryEngineSessionRuntime shell cleanup', () => {

  test('installs MACRO globals before loading root CLI modules', () => {
    const target = globalThis as typeof globalThis & { MACRO?: Record<string, string> }
    const previous = target.MACRO
    Reflect.deleteProperty(target, 'MACRO')
    try {
      ensureBeeGameMacroGlobals()

      expect(target.MACRO).toEqual(expect.objectContaining({
        VERSION: expect.any(String),
        BUILD_TIME: expect.any(String),
        FEEDBACK_CHANNEL: '',
        ISSUES_EXPLAINER: '',
        NATIVE_PACKAGE_URL: '',
        PACKAGE_URL: '',
        VERSION_CHANGELOG: '',
      }))
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(target, 'MACRO')
      } else {
        target.MACRO = previous
      }
    }
  })

  test('kills only running local shell tasks for the current runtime app state', async () => {
    const killed: string[] = []
    let state: MutableAppState = {
      tasks: {
        bash_running: {
          type: 'local_bash',
          status: 'running',
        },
        bash_completed: {
          type: 'local_bash',
          status: 'completed',
        },
        agent_running: {
          type: 'local_agent',
          status: 'running',
        },
      },
    }

    const killedTaskIds = await stopRunningLocalShellTasks(
      state,
      updater => {
        state = updater(state)
      },
      taskId => {
        killed.push(taskId)
      },
    )

    expect(killedTaskIds).toEqual(['bash_running'])
    expect(killed).toEqual(['bash_running'])
  })

  test('maps BeeGame chat thinking mode to QueryEngine thinking config', () => {
    expect(toQueryEngineThinkingConfig('disabled')).toEqual({ type: 'disabled' })
    expect(toQueryEngineThinkingConfig('enabled')).toEqual({ type: 'adaptive' })
  })

  test('injects explicit thinking flag into matching OpenAI-compatible chat requests', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const baseFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      })
      return new Response('{}')
    }) as typeof fetch
    const wrapped = createBeeGameThinkingFetch(
      baseFetch,
      'https://llm.example.invalid/compatible/v1',
      'disabled',
    )

    await wrapped('https://llm.example.invalid/compatible/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'balanced-model', messages: [] }),
    })

    expect(calls[0]).toEqual({
      url: 'https://llm.example.invalid/compatible/v1/chat/completions',
      body: {
        model: 'balanced-model',
        messages: [],
        enable_thinking: false,
      },
    })

    const thinkingFetch = createBeeGameThinkingFetch(
      baseFetch,
      'https://llm.example.invalid/compatible/v1',
      'enabled',
    )
    await thinkingFetch('https://llm.example.invalid/compatible/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'balanced-model', messages: [] }),
    })

    expect(calls[1]?.body.enable_thinking).toBe(true)
  })

  test('does not modify requests outside the configured OpenAI-compatible base URL', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const baseFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      })
      return new Response('{}')
    }) as typeof fetch
    const wrapped = createBeeGameThinkingFetch(
      baseFetch,
      'https://llm.example.invalid/v1',
      'enabled',
    )

    await wrapped('https://other.example.invalid/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'balanced-model', messages: [] }),
    })

    expect(calls[0]?.body).toEqual({
      model: 'balanced-model',
      messages: [],
    })
  })
})
