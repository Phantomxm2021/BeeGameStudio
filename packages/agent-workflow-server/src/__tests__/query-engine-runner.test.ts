import { describe, expect, test } from 'bun:test'
import {
  createBeeGamePinnedFetch,
  createBeeGameThinkingFetch,
  ensureBeeGameMacroGlobals,
  sanitizeBeeGameResumeMessages,
  type MutableAppState,
  stopRunningLocalShellTasks,
  toQueryEngineThinkingConfig,
} from '../beegame/query-engine-runner'
import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'

describe('QueryEngineSessionRuntime shell cleanup', () => {

  test('routes an approved provider origin through its pinned dispatcher without another resolver lookup', async () => {
    let pinnedLookupCalls = 0
    const providerUrl = 'https://provider.runtime.test/v1'
    const target: ApprovedOutboundTarget = {
      url: new URL(providerUrl),
      addresses: ['93.184.216.34'],
      lookup: (hostname, _options, callback) => {
        pinnedLookupCalls += 1
        expect(hostname).toBe('provider.runtime.test')
        callback(null, '93.184.216.34', 4)
      },
    }
    const calls: Array<{ url: string; dispatcher?: unknown }> = []
    const baseFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        dispatcher: (init as RequestInit & { dispatcher?: unknown } | undefined)?.dispatcher,
      })
      return new Response('{}')
    }) as typeof fetch
    const wrapped = createBeeGamePinnedFetch(baseFetch, {
      OPENAI_BASE_URL: target,
    })

    await wrapped('https://provider.runtime.test/v1/chat/completions')
    await wrapped('https://non-provider.runtime.test/health')

    expect(calls[0]?.dispatcher).toBeDefined()
    expect(calls[1]?.dispatcher).toBeUndefined()
    expect(pinnedLookupCalls).toBe(0)
  })

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

  test('overrides stale OpenAI-compatible extra body thinking flags when chat thinking is disabled', async () => {
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
      body: JSON.stringify({
        model: 'balanced-model',
        messages: [],
        extra_body: {
          enable_thinking: true,
          retained_provider_option: 'keep',
        },
      }),
    })

    expect(calls[0]?.body).toEqual({
      model: 'balanced-model',
      messages: [],
      enable_thinking: false,
      extra_body: {
        enable_thinking: false,
        retained_provider_option: 'keep',
      },
    })
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

  test('removes Claude recovery continuation messages before BeeGame appends a real user prompt', () => {
    const keepBefore = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Previous response.' }] },
    }
    const continuation = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Continue from where you left off.' }],
      },
    }
    const sentinel = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'No response requested.' }],
      },
    }
    const keepAfter = {
      type: 'system',
      message: { role: 'system', content: 'hook output' },
    }

    expect(sanitizeBeeGameResumeMessages({
      messages: [keepBefore, continuation, sentinel, keepAfter],
      turnInterruptionState: {
        kind: 'interrupted_prompt',
        message: continuation,
      },
    })).toEqual([keepBefore, keepAfter])
  })

  test('removes descendants of an interrupted recovery prompt before appending a new BeeGame prompt', () => {
    const cleanAssistant = {
      uuid: 'assistant-clean',
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Clean checkpoint.' }] },
    }
    const apiError = {
      uuid: 'assistant-error',
      parentUuid: 'assistant-clean',
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Provider error.' }] },
    }
    const continuation = {
      uuid: 'synthetic-continuation',
      parentUuid: 'assistant-error',
      type: 'user',
      isMeta: true,
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Continue from where you left off.' }],
      },
    }
    const sentinel = {
      uuid: 'synthetic-sentinel',
      parentUuid: 'synthetic-continuation',
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'No response requested.' }],
      },
    }
    const staleUserPrompt = {
      uuid: 'stale-user-prompt',
      parentUuid: 'synthetic-sentinel',
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Fix the current rendering issue.' }],
      },
    }
    const staleImageMeta = {
      uuid: 'stale-image-meta',
      parentUuid: 'stale-user-prompt',
      type: 'user',
      isMeta: true,
      message: {
        role: 'user',
        content: [{ type: 'text', text: '[Image metadata]' }],
      },
    }
    const laterSyntheticSentinel = {
      uuid: 'later-synthetic-sentinel',
      parentUuid: 'synthetic-continuation',
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'No response requested.' }],
      },
    }
    const laterStaleUserPrompt = {
      uuid: 'later-stale-user-prompt',
      parentUuid: 'later-synthetic-sentinel',
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Fix the current rendering issue again.' }],
      },
    }

    expect(sanitizeBeeGameResumeMessages({
      messages: [
        cleanAssistant,
        apiError,
        continuation,
        sentinel,
        staleUserPrompt,
        staleImageMeta,
        laterSyntheticSentinel,
        laterStaleUserPrompt,
      ],
      turnInterruptionState: {
        kind: 'interrupted_prompt',
        message: continuation,
      },
    })).toEqual([cleanAssistant, apiError])
  })
})
