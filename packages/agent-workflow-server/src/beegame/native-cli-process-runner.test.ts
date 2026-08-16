import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import {
  createNativeCliProcessRunner,
  nativeRuntimeEnvironment,
  nativeRuntimeCommand,
} from './native-cli-process-runner'

const fixturePath = fileURLToPath(
  new URL('./fixtures/native-runtime-fixture.ts', import.meta.url),
)

function startRuntime(options: { markdownStream?: boolean } = {}) {
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
    ...(options.markdownStream
      ? {
          workflowMarkdownStreamContract: {
            workspacePath: process.cwd(),
            runId: 'run-1',
            dispatchId: 'dispatch-1',
            targetPath: 'docs/GDD.md' as const,
            maxBytes: 512_000,
          },
        }
      : {}),
  })
}

describe('native CLI process runner', () => {
  test('does not override native provider stream recovery policy', () => {
    const env = nativeRuntimeEnvironment({
      ANTHROPIC_AUTH_TOKEN: 'selected-token',
    })

    expect(env.CLAUDE_ENABLE_STREAM_WATCHDOG).toBeUndefined()
    expect(env.CLAUDE_STREAM_IDLE_TIMEOUT_MS).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('selected-token')
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

    expect(command.some(argument => argument.startsWith('--tools='))).toBe(false)
    expect(
      command.some(argument => argument.startsWith('--allowedTools=')),
    ).toBe(false)
  })

  test('does not inject workflow agent definitions into a Reviewer launch', () => {
    const command = nativeRuntimeCommand({
      sessionId: 'foundation-reviewer',
      cwd: process.cwd(),
      env: {},
      workflowWorker: true,
      workflowWorkerType: 'document-reviewer',
    })

    expect(command.some(value => value.startsWith('--agents='))).toBe(false)
  })

  test('disables native tools only for a foundation Markdown stream turn', () => {
    const command = nativeRuntimeCommand({
      sessionId: 'beegame_stream_author',
      cwd: process.cwd(),
      env: {},
      workflowWorker: true,
      workflowWorkerType: 'document-author',
      workflowMarkdownStreamContract: {
        workspacePath: process.cwd(),
        runId: 'run-1',
        dispatchId: 'dispatch-1',
        targetPath: 'docs/GDD.md',
        maxBytes: 512_000,
      },
    })

    expect(command).toContain('--tools')
    expect(command[command.indexOf('--tools') + 1]).toBe('')
  })

  test('forwards native messages and resolves only on result', async () => {
    const runtime = await startRuntime()
    const messages: Record<string, unknown>[] = []

    await runtime.submit({
      prompt: 'write',
      signal: new AbortController().signal,
      onMessage: message => messages.push(message),
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    expect(messages.map(message => message.type)).toEqual([
      'assistant',
      'result',
    ])
    expect(messages.at(-1)?.received_session_id).toBe('')
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

  test('rejects a thinking-only provider result for a Markdown stream turn', async () => {
    const runtime = await startRuntime({ markdownStream: true })
    await expect(
      runtime.submit({
        prompt: 'incomplete-success',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow(
      'native model response ended without visible Markdown',
    )
    runtime.dispose?.()
  })

  test('accepts visible Markdown when provider stop metadata is missing', async () => {
    const runtime = await startRuntime({ markdownStream: true })
    await expect(
      runtime.submit({
        prompt: 'visible-markdown-without-stop-reason',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).resolves.toBeUndefined()
    runtime.dispose?.()
  })

  test('routes native permission requests through the BGS authority callback', async () => {
    const runtime = await startRuntime()
    const requests: unknown[] = []
    const messages: Record<string, unknown>[] = []

    await runtime.submit({
      prompt: 'permission',
      signal: new AbortController().signal,
      onMessage: message => messages.push(message),
      requestPermission: async request => {
        requests.push(request)
        return { behavior: 'allow', scope: 'once' }
      },
    })

    expect(requests).toEqual([
      {
        toolUseID: 'tool-1',
        toolName: 'Write',
        message: 'Write requires permission.',
        input: { file_path: 'docs/GDD.md', content: 'test' },
      },
    ])
    expect(messages.at(-1)).toMatchObject({
      type: 'result',
      subtype: 'success',
    })
    runtime.dispose?.()
  })
})
