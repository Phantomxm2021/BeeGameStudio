import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createNativeCliProcessRunner,
  nativeRuntimeEnvironment,
  nativeRuntimeCommand,
  prepareNativeSessionTemporaryDirectory,
} from './native-cli-process-runner'

const fixturePath = fileURLToPath(
  new URL('./fixtures/native-runtime-fixture.ts', import.meta.url),
)

function startRuntime() {
  return createNativeCliProcessRunner({
    command: [process.execPath, fixturePath],
    observabilityFactory: () => ({
      beginTurn: () => undefined,
      observeStdoutChunk: () => undefined,
      observeLine: () => undefined,
      observeMessage: () => undefined,
      finishTurn: () => undefined,
      flush: async () => undefined,
    }),
  }).start({
    sessionId: 'session-1',
    cwd: process.cwd(),
    env: {},
  })
}

describe('native CLI process runner', () => {
  test('gives each session a stable, project-local scratch directory', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'session-scratch-')))
    try {
      const a = await prepareNativeSessionTemporaryDirectory(root, 'session-a')
      expect(a.startsWith(root + '/')).toBe(true)
      expect((await stat(a)).isDirectory()).toBe(true)
      expect(await prepareNativeSessionTemporaryDirectory(root, 'session-a')).toBe(a)
      expect(await prepareNativeSessionTemporaryDirectory(root, 'session-b')).not.toBe(a)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test('passes preferred response language without changing the native tool inventory', () => {
    const command = nativeRuntimeCommand({ sessionId: 'language', cwd: process.cwd(), env: {}, language: 'zh' })
    expect(command[command.indexOf('--append-system-prompt') + 1]).toContain('User response language: zh')
    expect(command).not.toContain('--tools')
  })

  test('awaits attachment persistence before delivering later terminal messages', async () => {
    const runtime = await startRuntime()
    const received: string[] = []
    try {
      await runtime.submit({ prompt: 'write', signal: new AbortController().signal,
        onMessage: async message => {
          if (message.type === 'assistant') await new Promise(resolve => setTimeout(resolve, 20))
          received.push(String(message.type))
        },
        requestPermission: async () => ({ behavior: 'deny' }) })
      expect(received).toEqual(['assistant', 'result'])
    } finally { runtime.dispose?.() }
  })
  for (const source of ['policy', 'user'] as const) {
    test(`keeps ${source} denials distinct in the native permission response`, async () => {
      const runtime = await startRuntime()
      const messages: Record<string, unknown>[] = []
      try {
        await runtime.submit({ prompt: 'permission', signal: new AbortController().signal,
          onMessage: message => { messages.push(message) },
          requestPermission: async () => ({ behavior: 'deny', source, message: 'Denied at boundary' }) })
        const reply = messages.at(-1)?.permissionResponse as { response: { response: Record<string, unknown> } }
        expect(reply.response.response.behavior).toBe('deny')
        expect(reply.response.response.decisionClassification).toBe(source === 'user' ? 'user_reject' : undefined)
      } finally { runtime.dispose?.() }
    })
  }
  test('drains a resumed agent and forwards the final parent result without injecting a prompt', async () => {
    const runtime = await startRuntime()
    const messages: Record<string, unknown>[] = []
    try {
      await runtime.submit({ prompt: 'agent-lifecycle:complete', signal: new AbortController().signal,
        onMessage: message => { messages.push(message) }, requestPermission: async () => ({ behavior: 'deny' }) })
      expect(messages.at(-1)).toMatchObject({ type: 'result', result: 'Implementation finished', received_user_count: 1 })
      expect(messages.filter(message => message.type === 'result')).toHaveLength(2)
      expect(messages.some(message => message.type === 'assistant')).toBe(true)
    } finally { runtime.dispose?.() }
  })

  test('does not wait for a long-lived background shell server', async () => {
    const runtime = await startRuntime()
    try {
      await runtime.submit({ prompt: 'background-server', signal: new AbortController().signal,
        onMessage: () => undefined, requestPermission: async () => ({ behavior: 'deny' }) })
    } finally { runtime.dispose?.() }
  })

  for (const [mode, error] of [
    ['idle-without-parent', 'before the parent completed'],
    ['eof', 'without a terminal result'],
  ]) {
    test(`rejects ${mode} instead of delivering the interim result`, async () => {
      const runtime = await startRuntime()
      try {
        await expect(runtime.submit({ prompt: `agent-lifecycle:${mode}`, signal: new AbortController().signal,
          onMessage: () => undefined, requestPermission: async () => ({ behavior: 'deny' }) })).rejects.toThrow(error)
      } finally { runtime.dispose?.() }
    })
  }

  test('can stop while waiting for the resumed agent after an interim result', async () => {
    const runtime = await startRuntime()
    const controller = new AbortController()
    try {
      await expect(runtime.submit({ prompt: 'agent-lifecycle:pending', signal: controller.signal,
        onMessage: message => { if (message.type === 'result') controller.abort() },
        requestPermission: async () => ({ behavior: 'deny' }) })).rejects.toThrow('cancelled by user')
    } finally { runtime.dispose?.() }
  })

  test('does not override native provider stream recovery policy', () => {
    const env = nativeRuntimeEnvironment({
      ANTHROPIC_AUTH_TOKEN: 'selected-token',
    })

    expect(env.CLAUDE_ENABLE_STREAM_WATCHDOG).toBeUndefined()
    expect(env.CLAUDE_STREAM_IDLE_TIMEOUT_MS).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('selected-token')
    expect(env.BEEGAME_NATIVE_BACKGROUND_PERMISSIONS).toBe('1')
  })

  test('reports the selected model and sanitized launch contract to passive observability', async () => {
    let observed: Record<string, unknown> | undefined
    const launchContract = {
      selectedEnvironmentKeys: [
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'BEEGAME_CONFIG_DIR',
      ],
      forwardedEnvironmentKeys: [
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'BEEGAME_CONFIG_DIR',
      ],
      endpointClass: 'default' as const,
      configDirectoryConfigured: true,
      credentialConfigured: true,
    }
    const runtime = await createNativeCliProcessRunner({
      command: [process.execPath, fixturePath],
      observabilityFactory: input => {
        observed = input
        return {
          beginTurn: () => undefined,
          observeStdoutChunk: () => undefined,
          observeLine: () => undefined,
          observeMessage: () => undefined,
          finishTurn: () => undefined,
          flush: async () => undefined,
        }
      },
    }).start({
      sessionId: 'session-observed',
      cwd: process.cwd(),
      env: {
        ANTHROPIC_AUTH_TOKEN: 'secret-provider-token',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'selected-sonnet-model',
        BEEGAME_CONFIG_DIR: '/private/config',
      },
      runtimeLaunchContract: launchContract,
    })

    expect(observed).toEqual({
      workspacePath: process.cwd(),
      sessionId: 'session-observed',
      provider: 'anthropic',
      model: 'selected-sonnet-model',
      launchContract,
    })
    expect(JSON.stringify(observed)).not.toContain('secret-provider-token')
    expect(JSON.stringify(observed)).not.toContain('/private/config')
    runtime.dispose?.()
  })

  test('never resumes a first native process with the BGS routing identity', () => {
    const input = {
      sessionId: 'beegame_route_only',
      cwd: process.cwd(),
      env: {},
    }
    expect(nativeRuntimeCommand(input)).not.toContain(
      '--resume=beegame_route_only',
    )
    expect(() => nativeRuntimeCommand({
      ...input,
      resumeSessionId: 'beegame_route_only',
    })).toThrow('native resume session ID must be a UUID')
  })

  test('resumes only an explicit native UUID', () => {
    const nativeSessionId = '550e8400-e29b-41d4-a716-446655440000'
    expect(nativeRuntimeCommand({
      sessionId: 'beegame_route_only',
      resumeSessionId: nativeSessionId,
      cwd: process.cwd(),
      env: {},
    })).toContain(`--resume=${nativeSessionId}`)
  })

  test('does not replace the native document author tool inventory', () => {
    const command = nativeRuntimeCommand({
      sessionId: 'beegame_route_only',
      cwd: process.cwd(),
      env: {},
      workflowWorker: true,
      workflowWorkerType: 'document-author',
    })

    expect(command).not.toContain('--tools')
    expect(command.some(argument => argument.startsWith('--tools='))).toBe(false)
    expect(
      command.some(argument => argument.startsWith('--allowedTools=')),
    ).toBe(false)
  })

  test('forwards native messages and resolves only on result', async () => {
    const runtime = await startRuntime()
    const messages: Record<string, unknown>[] = []

    await runtime.submit({
      prompt: 'write',
      signal: new AbortController().signal,
      onMessage: message => { messages.push(message) },
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    expect(messages.map(message => message.type)).toEqual([
      'assistant',
      'result',
    ])
    expect(messages.at(-1)?.received_session_id).toBe('')
    runtime.dispose?.()
  })

  test('keeps native background task notifications observable after the foreground result', async () => {
    const notifications: string[] = []
    const backgroundMessages: unknown[] = []
    const runtime = await createNativeCliProcessRunner({
      command: [process.execPath, fixturePath],
      observabilityFactory: () => ({
        beginTurn: () => undefined,
        observeStdoutChunk: () => undefined,
        observeLine: () => undefined,
        observeMessage: () => undefined,
        finishTurn: () => undefined,
        flush: async () => undefined,
      }),
    }).start({
      sessionId: 'session-background-notification',
      cwd: process.cwd(),
      env: {},
      onNativeTaskNotification: notification => {
        notifications.push(notification.value)
        backgroundMessages.push(notification.backgroundMessage)
      },
    })

    await runtime.submit({
      prompt: 'post-result-task-notification',
      signal: new AbortController().signal,
      onMessage: () => undefined,
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(notifications).toEqual([
      '<task-id>task-after-result</task-id><status>completed</status>',
    ])
    expect(backgroundMessages).toEqual([expect.objectContaining({ type: 'system', subtype: 'task_notification' })])
    runtime.dispose?.()
  })

  test('keeps confirmed brief evidence metadata out of native prompt content', async () => {
    const runtime = await startRuntime()
    let result: Record<string, unknown> | undefined

    await runtime.submit({
      prompt: 'single-visible-brief',
      confirmedBriefContext: 'metadata-brief-must-not-be-appended',
      signal: new AbortController().signal,
      onMessage: message => {
        if (message.type === 'result') result = message
      },
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    expect(result?.received_content).toBe('single-visible-brief')
    expect(JSON.stringify(result)).not.toContain(
      'metadata-brief-must-not-be-appended',
    )
    runtime.dispose?.()
  })

  test('captures the native UUID and uses it only on later stream messages', async () => {
    const nativeSessionIds: string[] = []
    const runtime = await createNativeCliProcessRunner({
      command: [process.execPath, fixturePath],
      observabilityFactory: () => ({
        beginTurn: () => undefined,
        observeStdoutChunk: () => undefined,
        observeLine: () => undefined,
        observeMessage: () => undefined,
        finishTurn: () => undefined,
        flush: async () => undefined,
      }),
    }).start({
      sessionId: 'beegame_route_only',
      cwd: process.cwd(),
      env: {},
      onNativeSessionId: sessionId => nativeSessionIds.push(sessionId),
    })

    const results: Record<string, unknown>[] = []
    for (const prompt of ['first', 'second']) {
      await runtime.submit({
        prompt,
        signal: new AbortController().signal,
        onMessage: message => {
          if (message.type === 'result') results.push(message)
        },
        requestPermission: async () => ({ behavior: 'deny' }),
      })
    }

    expect(nativeSessionIds).toEqual([
      '550e8400-e29b-41d4-a716-446655440000',
    ])
    expect(results.map(result => result.received_session_id)).toEqual([
      '',
      '550e8400-e29b-41d4-a716-446655440000',
    ])
    runtime.dispose?.()
  })

  test('rejects an explicit native API error with its detail', async () => {
    const runtime = await startRuntime()
    await expect(
      runtime.submit({
        prompt: 'error',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow('provider exploded')
    runtime.dispose?.()
  })

  test('rejects EOF without a terminal result', async () => {
    const runtime = await startRuntime()
    await expect(
      runtime.submit({
        prompt: 'eof',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow('exited without a terminal result')
  })

  test('routes native permission requests through the BGS authority callback', async () => {
    const runtime = await startRuntime()
    const requests: unknown[] = []
    const messages: Record<string, unknown>[] = []

    await runtime.submit({
      prompt: 'permission',
      signal: new AbortController().signal,
      onMessage: message => { messages.push(message) },
      requestPermission: async request => {
        requests.push(request)
        return {
          behavior: 'allow',
          scope: 'session',
          updatedPermissions: request.permissionSuggestions?.map(suggestion => ({
            ...suggestion,
            destination: 'session',
          })),
        }
      },
    })

    expect(requests).toEqual([
      {
        toolUseID: 'tool-1',
        toolName: 'Write',
        message: 'Write requires permission.',
        input: { file_path: 'docs/GDD.md', content: 'test' },
        permissionSuggestions: [
          {
            type: 'addRules',
            rules: [{ toolName: 'Write', ruleContent: 'docs/GDD.md' }],
            behavior: 'allow',
            destination: 'localSettings',
          },
        ],
      },
    ])
    expect(messages.at(-1)).toMatchObject({
      type: 'result',
      subtype: 'success',
    })
    runtime.dispose?.()
  })
})
