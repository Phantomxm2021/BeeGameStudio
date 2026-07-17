import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  closeBeeGameRuntimeDispatcher,
  createNativeNotificationQueue,
  createNativeSdkEventQueue,
  createBeeGameToolPermissionContext,
  createBeeGamePinnedFetch,
  assertRequiredBeeGameNativeAgents,
  ensureBeeGameMacroGlobals,
  drainNativeBackgroundNotifications,
  getBeeGameResponseLanguageInstruction,
  hasRunningNativeBackgroundTasks,
  parseNativeTerminalTaskNotification,
  resolveBeeGameSkillReadRoots,
  type MutableAppState,
  stopRunningLocalShellTasks,
} from '../beegame/query-engine-runner'
import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'

describe('QueryEngineSessionRuntime shell cleanup', () => {

  test('maps the session language to a response-only native system preference', () => {
    expect(getBeeGameResponseLanguageInstruction('zh')).toBe(
      'Respond to the user in Simplified Chinese. Keep code, commands, file paths, package names, API identifiers, and raw errors unchanged.',
    )
    expect(getBeeGameResponseLanguageInstruction('fr')).toContain('French')
    expect(getBeeGameResponseLanguageInstruction()).toBeUndefined()
  })

  test('drains only main-session native task notifications without interpreting their result', () => {
    const queued = [
      { value: '<task-notification>first</task-notification>', mode: 'task-notification' },
      { value: 'user input', mode: 'prompt' },
      { value: '<task-notification>subagent</task-notification>', mode: 'task-notification', agentId: 'agent-1' },
      { value: '<task-notification>second</task-notification>', mode: 'task-notification' },
    ]
    const queue = createNativeNotificationQueue({
      dequeueAllMatching(predicate: (command: (typeof queued)[number]) => boolean) {
        const selected = queued.filter(predicate)
        for (const command of selected) queued.splice(queued.indexOf(command), 1)
        return selected
      },
    })

    expect(queue.takeMainThreadTaskNotifications().map(command => command.value)).toEqual([
      '<task-notification>first</task-notification>',
      '<task-notification>second</task-notification>',
    ])
    expect(queued).toEqual([
      { value: 'user input', mode: 'prompt' },
      { value: '<task-notification>subagent</task-notification>', mode: 'task-notification', agentId: 'agent-1' },
    ])
  })

  test('forwards Claude native background SDK events without reconstructing them', () => {
    const nativeEvents = [
      { type: 'system', subtype: 'task_started', task_id: 'agent-1' },
      { type: 'system', subtype: 'task_notification', task_id: 'agent-1', status: 'completed' },
    ]
    const queue = createNativeSdkEventQueue({
      drainSdkEvents: () => nativeEvents.splice(0),
    })

    expect(queue.drain()).toEqual([
      { type: 'system', subtype: 'task_started', task_id: 'agent-1' },
      { type: 'system', subtype: 'task_notification', task_id: 'agent-1', status: 'completed' },
    ])
    expect(queue.drain()).toEqual([])
  })

  test('waits for native background work but excludes foreground tasks and long-lived teammates', () => {
    expect(hasRunningNativeBackgroundTasks({
      tasks: {
        reviewer: { type: 'local_agent', status: 'running', isBackgrounded: true },
      },
    })).toBe(true)
    expect(hasRunningNativeBackgroundTasks({
      tasks: {
        foreground: { type: 'local_agent', status: 'running', isBackgrounded: false },
        teammate: { type: 'in_process_teammate', status: 'running' },
        completed: { type: 'local_agent', status: 'completed', isBackgrounded: true },
      },
    })).toBe(false)
  })

  test('continues the same native session when a background notification arrives later', async () => {
    const controller = new AbortController()
    const queued: Array<{ value: string; mode: string; uuid?: string }> = []
    const processed: string[] = []
    let running = true
    let waits = 0
    let progressFlushes = 0

    await drainNativeBackgroundNotifications({
      signal: controller.signal,
      takeNotifications: () => queued.splice(0),
      hasRunningTasks: () => running,
      runNotification: async command => {
        processed.push(String(command.value))
      },
      flushProgress: () => {
        progressFlushes += 1
      },
      waitForProgress: async () => {
        waits += 1
        running = false
        queued.push({
          value: '<task-notification><task-id>review-1</task-id><status>completed</status><result>review complete</result></task-notification>',
          mode: 'task-notification',
          uuid: 'notification-1',
        })
      },
    })

    expect(waits).toBe(1)
    expect(progressFlushes).toBeGreaterThanOrEqual(2)
    expect(processed).toEqual([
      '<task-notification><task-id>review-1</task-id><status>completed</status><result>review complete</result></task-notification>',
    ])
  })

  test('preserves native notification order and stops without processing followers after abort', async () => {
    const controller = new AbortController()
    const processed: string[] = []

    await drainNativeBackgroundNotifications({
      signal: controller.signal,
      takeNotifications: () => [
        { value: '<task-notification><task-id>first</task-id><status>completed</status></task-notification>', mode: 'task-notification' },
        { value: '<task-notification><task-id>second</task-id><status>completed</status></task-notification>', mode: 'task-notification' },
      ],
      hasRunningTasks: () => true,
      runNotification: async command => {
        processed.push(String(command.value))
        controller.abort()
      },
      waitForProgress: async () => {},
    })

    expect(processed).toEqual(['<task-notification><task-id>first</task-id><status>completed</status></task-notification>'])
  })

  test('only resumes for unique terminal native task notifications', async () => {
    const controller = new AbortController()
    const processed: string[] = []
    const terminal = '<task-notification><task-id>review-1</task-id><tool-use-id>tool-1</tool-use-id><status>completed</status></task-notification>'
    const queued = [
      { value: '<task-notification><task-id>review-1</task-id></task-notification>', mode: 'task-notification' },
      { value: terminal, mode: 'task-notification' },
      { value: terminal, mode: 'task-notification' },
    ]
    await drainNativeBackgroundNotifications({
      signal: controller.signal,
      takeNotifications: () => queued.splice(0),
      hasRunningTasks: () => false,
      runNotification: async command => { processed.push(String(command.value)) },
    })
    expect(processed).toEqual([terminal])
  })

  test('parses only the native terminal lifecycle envelope', () => {
    expect(parseNativeTerminalTaskNotification({
      value: '<task-notification><task-id>a</task-id><status>completed</status></task-notification>',
      mode: 'task-notification',
    })).toEqual({ key: 'a', taskId: 'a', status: 'completed' })
    expect(parseNativeTerminalTaskNotification({
      value: '<task-notification><task-id>a</task-id></task-notification>',
      mode: 'task-notification',
    })).toBeUndefined()
  })

  test('fails before a Claude turn when required native delivery agents were not discovered', () => {
    expect(() => assertRequiredBeeGameNativeAgents([
      { agentType: 'general-purpose' },
      { agentType: 'beegame-document-reviewer' },
    ])).toThrow(
      'BeeGame native runtime capability is unavailable: beegame-acceptance-validator',
    )

    expect(() => assertRequiredBeeGameNativeAgents([
      { agentType: 'beegame-document-reviewer' },
      { agentType: 'beegame-acceptance-validator' },
    ])).not.toThrow()
  })

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

  test('allows read-only access to runtime and trusted built-in skill roots without granting edit access', () => {
    const context = createBeeGameToolPermissionContext({
      mode: 'default',
      alwaysAllowRules: { session: ['Read(/existing/reference/**)'] },
      isBypassPermissionsModeAvailable: true,
    }, ['/runtime/skills', '/platform/builtin-skills'])

    expect(context).toMatchObject({
      mode: 'acceptEdits',
      alwaysAllowRules: {
        session: [
          'Read(/existing/reference/**)',
          'Read(/runtime/skills/**)',
          'Read(/platform/builtin-skills/**)',
        ],
      },
      isBypassPermissionsModeAvailable: false,
    })
    expect(JSON.stringify(context)).not.toContain('Edit(/runtime/skills')
    expect(JSON.stringify(context)).not.toContain('Edit(/platform/builtin-skills')
  })

  test('derives canonical skill roots from the current session environment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-skill-read-roots-'))
    const configDir = join(root, 'user-runtime')
    const runtimeSkillsDir = join(configDir, 'skills')
    const builtinSkillsDir = join(root, 'builtin-skills')
    await Promise.all([
      mkdir(runtimeSkillsDir, { recursive: true }),
      mkdir(builtinSkillsDir, { recursive: true }),
    ])
    try {
      expect(await resolveBeeGameSkillReadRoots({
        BEEGAME_CONFIG_DIR: configDir,
      }, builtinSkillsDir)).toEqual([
        await realpath(runtimeSkillsDir),
        await realpath(builtinSkillsDir),
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
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

  test('uses native TLS only for an approved trusted development proxy target', async () => {
    const target: ApprovedOutboundTarget = {
      url: new URL('https://provider.runtime.test/v1'),
      addresses: ['198.18.0.220'],
      trustedDevelopmentProxy: true,
      lookup: (_hostname, _options, callback) => callback(null, '198.18.0.220', 4),
    }
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const wrapped = createBeeGamePinnedFetch((async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response('{}')
    }) as typeof fetch, { ANTHROPIC_BASE_URL: target })

    await wrapped('https://provider.runtime.test/v1/messages')
    await expect(
      wrapped('https://other.runtime.test/v1/messages'),
    ).rejects.toThrow('Outbound URL is not permitted')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.init).toMatchObject({ redirect: 'error' })
    expect(
      (calls[0]?.init as RequestInit & { dispatcher?: unknown }).dispatcher,
    ).toBeUndefined()
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
