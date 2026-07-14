import { describe, expect, test } from 'bun:test'
import {
  closeBeeGameRuntimeDispatcher,
  createBeeGameToolPermissionContext,
  createBeeGamePinnedFetch,
  ensureBeeGameMacroGlobals,
  mergeManagedAgentDefinitions,
  type MutableAppState,
  stopRunningLocalShellTasks,
} from '../beegame/query-engine-runner'
import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'

describe('QueryEngineSessionRuntime shell cleanup', () => {

  test('uses Claude Code native accept-edits mode without enabling bypass permissions', () => {
    expect(createBeeGameToolPermissionContext({
      mode: 'default',
      customRule: 'preserved',
      isBypassPermissionsModeAvailable: true,
    })).toEqual({
      mode: 'acceptEdits',
      customRule: 'preserved',
      isBypassPermissionsModeAvailable: false,
    })
  })

  test('allows read-only access to the materialized skill root without granting edit access', () => {
    const context = createBeeGameToolPermissionContext({
      mode: 'default',
      alwaysAllowRules: { session: ['Read(/existing/reference/**)'] },
      isBypassPermissionsModeAvailable: true,
    }, '/runtime/skills')

    expect(context).toMatchObject({
      mode: 'acceptEdits',
      alwaysAllowRules: {
        session: [
          'Read(/existing/reference/**)',
          'Read(/runtime/skills/**)',
        ],
      },
      isBypassPermissionsModeAvailable: false,
    })
    expect(JSON.stringify(context)).not.toContain('Edit(/runtime/skills')
  })

  test('injects managed validators while preserving unrelated project agents', () => {
    const projectAgent = { agentType: 'project-helper', source: 'project' }
    const staleManagedAgent = { agentType: 'beegame-acceptance-validator', source: 'project' }
    const managedAgent = {
      agentType: 'beegame-acceptance-validator',
      source: 'policySettings' as const,
      whenToUse: 'validate delivery',
      getSystemPrompt: () => 'validate',
    }

    const merged = mergeManagedAgentDefinitions({
      activeAgents: [projectAgent, staleManagedAgent],
      allAgents: [projectAgent, staleManagedAgent],
      allowedAgentTypes: ['project-helper'],
    }, [managedAgent])

    expect(merged.activeAgents).toEqual([projectAgent, managedAgent])
    expect(merged.allAgents).toEqual([projectAgent, managedAgent])
    expect(merged.allowedAgentTypes).toEqual(['project-helper', 'beegame-acceptance-validator'])
    expect((merged.activeAgents as Array<Record<string, unknown>>)[1]).toMatchObject({
      source: 'policySettings',
    })
  })

  test('preserves BeeGame skill read rules when native sub-agents scope their tools', () => {
    const projectAgent = {
      agentType: 'project-helper',
      source: 'project',
      tools: ['Read', 'Glob'],
    }
    const managedAgent = {
      agentType: 'beegame-acceptance-validator',
      source: 'policySettings' as const,
      whenToUse: 'validate delivery',
      tools: ['Read', 'Bash'],
      getSystemPrompt: () => 'validate',
    }

    const merged = mergeManagedAgentDefinitions({
      activeAgents: [projectAgent],
      allAgents: [projectAgent],
    }, [managedAgent], ['Read(/runtime/skills/**)'])

    for (const agent of merged.activeAgents as Array<Record<string, unknown>>) {
      expect(agent.tools).toEqual(expect.arrayContaining(['Read(/runtime/skills/**)']))
    }
    expect((merged.activeAgents as Array<Record<string, unknown>>)[0]?.tools).toEqual([
      'Read',
      'Glob',
      'Read(/runtime/skills/**)',
    ])
  })

  test('closes runtime dispatchers across supported Undici lifecycle shapes', async () => {
    const closed: string[] = []

    await closeBeeGameRuntimeDispatcher({
      close: () => { closed.push('close') },
      destroy: () => { closed.push('unexpected-destroy') },
    })
    await closeBeeGameRuntimeDispatcher({
      destroy: () => { closed.push('destroy') },
    })
    await closeBeeGameRuntimeDispatcher({})

    expect(closed).toEqual(['close', 'destroy'])
  })

  test('routes an approved provider origin through its pinned dispatcher and denies unapproved HTTP(S) origins', async () => {
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
    await expect(
      wrapped('https://non-provider.runtime.test/health'),
    ).rejects.toThrow('Outbound URL is not permitted')
    await wrapped('file:///tmp/local-runtime-input')

    expect(calls[0]?.dispatcher).toBeDefined()
    expect(calls[1]).toEqual({
      url: 'file:///tmp/local-runtime-input',
      dispatcher: undefined,
    })
    expect(pinnedLookupCalls).toBe(0)
  })

  test('rejects redirect-capable requests and cannot reuse a dispatcher across ports', async () => {
    const target: ApprovedOutboundTarget = {
      url: new URL('https://provider.runtime.test/v1'),
      addresses: ['93.184.216.34'],
      lookup: (_hostname, _options, callback) => callback(null, '93.184.216.34', 4),
    }
    const calls: Array<{ init?: RequestInit }> = []
    const wrapped = createBeeGamePinnedFetch((async (_input, init) => {
      calls.push({ init })
      return new Response('{}')
    }) as typeof fetch, { OPENAI_BASE_URL: target })

    await wrapped('https://provider.runtime.test/v1/chat/completions')
    await expect(wrapped('https://provider.runtime.test:8443/v1/chat/completions')).rejects.toThrow('Outbound URL is not permitted')
    expect(calls[0]?.init).toMatchObject({ redirect: 'error' })
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

})
