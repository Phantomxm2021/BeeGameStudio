import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  authorRuntimeCommand,
  authorRuntimeEnvironment,
  type AuthorNativeMessage,
  type AuthorRuntimeError,
  type AuthorRuntimeConfig,
} from './runtime'
import { createAuthorRuntimeForTest } from './test-entry'
import {
  createFoundationMarkdownStreamSink,
  foundationMarkdownPendingPath,
} from '../domain/foundation-markdown-stream'

type FakeProcess = {
  stdin: {
    write(content: string): number
    flush(): number
    end(): number
  }
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exitCode: number | null
  kill(signal?: string): void
  exited: Promise<number>
}

type Spawn = (command: string[], options: {
  cwd: string
  env: Record<string, string>
  stdin: 'pipe'
  stdout: 'pipe'
  stderr: 'pipe'
}) => FakeProcess

const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'foundation-authoring-runtime-test-')))
afterAll(() => rm(workspacePath, { recursive: true, force: true }))

function config(command = ['native-model']): AuthorRuntimeConfig {
  return {
    command,
    env: {
      ANTHROPIC_AUTH_TOKEN: 'secret-token',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'author-model',
      NPM_CONFIG_CACHE: '/tmp/author-npm-cache',
      npm_config_userconfig: '/tmp/author-npmrc',
      NOT_ALLOWED_TO_NATIVE: 'must-not-forward',
    },
    data: { descriptor: 'not logged' },
  }
}

function makeSpawn(
  onMessage: (
    message: AuthorNativeMessage,
    emit: (value: AuthorNativeMessage) => void,
    control: { exitBeforeDrain(): void },
  ) => void,
): { spawn: Spawn; commands: string[][]; environments: Record<string, string>[] } {
  const commands: string[][] = []
  const environments: Record<string, string>[] = []
  const spawn: Spawn = (command, options) => {
    commands.push(command)
    environments.push(options.env)
    let outputController!: ReadableStreamDefaultController<Uint8Array>
    let errorController!: ReadableStreamDefaultController<Uint8Array>
    let resolveExited!: (code: number) => void
    let processExitCode: number | null = null
    const exited = new Promise<number>(resolve => { resolveExited = resolve })
    const stdout = new ReadableStream<Uint8Array>({
      start(controller) { outputController = controller },
    })
    const stderr = new ReadableStream<Uint8Array>({
      start(controller) { errorController = controller },
    })
    const emit = (value: AuthorNativeMessage) => {
      outputController.enqueue(new TextEncoder().encode(`${JSON.stringify(value)}\n`))
    }
    const control = {
      exitBeforeDrain() {
        if (processExitCode !== null) return
        processExitCode = 0
        resolveExited(0)
      },
    }
    const process: FakeProcess = {
      stdin: {
        write(content) {
          for (const line of content.split('\n').filter(Boolean)) {
            onMessage(JSON.parse(line) as AuthorNativeMessage, emit, control)
          }
          return content.length
        },
        flush() { return 0 },
        end() {
          if (processExitCode === null) {
            processExitCode = 0
            outputController.close()
            errorController.close()
            resolveExited(0)
          }
          return 0
        },
      },
      stdout,
      stderr,
      get exitCode() { return processExitCode },
      kill() {
        if (processExitCode !== null) return
        processExitCode = 143
        outputController.close()
        errorController.close()
        resolveExited(143)
      },
      exited,
    }
    return process
  }
  return { spawn, commands, environments }
}

function emitMarkdown(emit: (value: AuthorNativeMessage) => void, markdown: string, sessionId = '550e8400-e29b-41d4-a716-446655440000') {
  emit({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: markdown } },
  })
  emit({ type: 'result', subtype: 'success', is_error: false, result: markdown, session_id: sessionId })
}

describe('foundation author private native runtime', () => {
  test('builds an isolated plain-Markdown native command and allowlisted environment', () => {
    const command = authorRuntimeCommand(['native-model'])
    expect(command).toEqual([
      'native-model', '--print', '--verbose', '--input-format=stream-json',
      '--output-format=stream-json', '--include-partial-messages',
      '--replay-user-messages', '--permission-prompt-tool=stdio',
    ])
    const env = authorRuntimeEnvironment(config().env)
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('secret-token')
    expect(env.NPM_CONFIG_CACHE).toBe('/tmp/author-npm-cache')
    expect(env.npm_config_userconfig).toBe('/tmp/author-npmrc')
    expect(env.NOT_ALLOWED_TO_NATIVE).toBeUndefined()
    expect(authorRuntimeCommand([
      'native-model',
    ], '550e8400-e29b-41d4-a716-446655440000')).toContain(
      '--resume=550e8400-e29b-41d4-a716-446655440000',
    )
    expect(() => authorRuntimeCommand(['native-model'], 'routing-id')).toThrow(
      'native resume session ID must be a UUID',
    )
  })

  test('forwards the native message, waits for UUID persistence, and resumes it', async () => {
    const fake = makeSpawn((message, emit) => {
      if (message.type !== 'user') return
      emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'draft' }] } })
      emit({ type: 'result', subtype: 'success', is_error: false, result: 'draft', session_id: '550e8400-e29b-41d4-a716-446655440000' })
    })
    const order: string[] = []
    const runtime = createAuthorRuntimeForTest(config(), fake.spawn as Parameters<typeof createAuthorRuntimeForTest>[1])
    const first = await runtime.execute({
      runId: 'run-1', dispatchId: 'dispatch-1', workspacePath,
      prompt: 'draft',
      onNativeSessionId: async () => { order.push('persist'); await Promise.resolve() },
      onMessage: message => { order.push(message.type) },
    })
    expect(order).toEqual(['assistant', 'persist', 'result'])
    expect(first.sessionId).toBe('550e8400-e29b-41d4-a716-446655440000')

    const second = await runtime.execute({
      runId: 'run-1', dispatchId: 'dispatch-2', workspacePath,
      prompt: 'continue', onMessage: () => undefined,
    })
    expect(second.sessionId).toBe(first.sessionId)
    expect(fake.commands[0]).not.toContain('--resume=550e8400-e29b-41d4-a716-446655440000')
    runtime.dispose()
  })

  test('waits for stdout drain and UUID callback before judging an exited process', async () => {
    const fake = makeSpawn((message, emit, control) => {
      if (message.type !== 'user') return
      emit({ type: 'stream_event', event: {
        type: 'content_block_delta', delta: { type: 'text_delta', text: '# Done' },
      } })
      emit({ type: 'result', subtype: 'success', is_error: false, result: '# Done', session_id: '550e8400-e29b-41d4-a716-446655440000' })
      // Resolve `exited` before the stdout reader finishes its awaited UUID
      // callback; the runtime must wait for both before terminal arbitration.
      control.exitBeforeDrain()
    })
    const order: string[] = []
    const runtime = createAuthorRuntimeForTest(config(), fake.spawn as Parameters<typeof createAuthorRuntimeForTest>[1])
    const result = await runtime.execute({
      runId: 'run-exit-race', dispatchId: 'dispatch-exit-race', workspacePath,
      prompt: 'exit-race',
      onNativeSessionId: async () => {
        order.push('persist-start')
        await new Promise(resolve => setTimeout(resolve, 5))
        order.push('persist-end')
      },
      onMessage: message => { order.push(message.type) },
    })
    expect(result.markdown).toBe('# Done')
    expect(order).toEqual(['stream_event', 'persist-start', 'persist-end', 'result'])
    runtime.dispose()
  })

  test('retries one empty Markdown result in the same process and session', async () => {
    let userCount = 0
    const durableUsage: number[] = []
    const fake = makeSpawn((message, emit) => {
      if (message.type !== 'user') return
      userCount += 1
      if (userCount === 1) {
        emit({ type: 'result', subtype: 'success', is_error: false, result: '', session_id: '550e8400-e29b-41d4-a716-446655440000',
          usage: { input_tokens: 5, output_tokens: 1 } })
      } else {
        expect(durableUsage).toContain(6)
        emitMarkdown(emit, '# Complete')
      }
    })
    const messages: AuthorNativeMessage[] = []
    const runtime = createAuthorRuntimeForTest(config(), fake.spawn as Parameters<typeof createAuthorRuntimeForTest>[1])
    const result = await runtime.execute({
      runId: 'run-1', dispatchId: 'dispatch-1', workspacePath,
      prompt: 'empty-first', onMessage: message => { messages.push(message) },
      onUsage: async usage => { await Promise.resolve(); durableUsage.push(usage.total_tokens) },
    })
    expect(userCount).toBe(2)
    expect(result.markdown).toBe('# Complete')
    // The first empty result is an internal retry marker and must not become a
    // terminal sink event. Only the recovered result reaches the sink.
    expect(messages.filter(message => message.type === 'result')).toHaveLength(1)
    runtime.dispose()
  })

  test('integrates with the real author Markdown sink without forwarding the empty retry terminal', async () => {
    const integrationWorkspace = await mkdtemp(join(tmpdir(), 'author-runtime-sink-'))
    const runId = 'run-integration'
    const dispatchId = 'dispatch-integration'
    const sink = await createFoundationMarkdownStreamSink({
      workspacePath: integrationWorkspace,
      runId,
      dispatchId,
      targetPath: 'docs/GDD.md',
      maxBytes: 512_000,
    })
    let userCount = 0
    const fake = makeSpawn((message, emit) => {
      if (message.type !== 'user') return
      userCount += 1
      if (userCount === 1) {
        emit({ type: 'stream_event', event: {
          type: 'message_start', message: { id: 'message-empty' },
        } })
        emit({ type: 'result', subtype: 'success', is_error: false, result: '' })
        return
      }
      emit({ type: 'stream_event', event: {
        type: 'message_start', message: { id: 'message-complete' },
      } })
      emit({ type: 'stream_event', event: {
        type: 'content_block_start', index: 0, content_block: { type: 'text' },
      } })
      emit({ type: 'stream_event', event: {
        type: 'content_block_delta', index: 0,
        delta: { type: 'text_delta', text: '# Complete\n' },
      } })
      emit({ type: 'stream_event', event: {
        type: 'content_block_stop', index: 0,
      } })
      emit({ type: 'stream_event', event: {
        type: 'message_delta', delta: { stop_reason: 'end_turn' },
      } })
      emit({ type: 'result', subtype: 'success', is_error: false, result: '# Complete\n' })
    })
    const runtime = createAuthorRuntimeForTest(config(), fake.spawn as Parameters<typeof createAuthorRuntimeForTest>[1])
    try {
      const result = await runtime.execute({
        runId, dispatchId, workspacePath: integrationWorkspace,
        prompt: 'draft', onMessage: message => { sink.observe(message) },
      })
      expect(result.markdown).toBe('# Complete\n')
      expect(userCount).toBe(2)
      // observe queues disk writes. This test inspects pending bytes without
      // publishing the intentionally incomplete GDD; abort drains that queue.
      await sink.abort('offline pending-byte inspection complete')
      expect(await readFile(
        foundationMarkdownPendingPath(integrationWorkspace, runId, dispatchId),
        'utf8',
      )).toBe('# Complete\n')
    } finally {
      runtime.dispose()
      await sink.abort('integration test cleanup')
      await rm(integrationWorkspace, { recursive: true, force: true })
    }
  })

  test('denies malformed permission requests rather than blanket-denying author tools', async () => {
    const decisions: AuthorNativeMessage[] = []
    const fake = makeSpawn((message, emit) => {
      if (message.type === 'user') {
        emit({ type: 'control_request', request_id: 'permission-1', request: {
          subtype: 'can_use_tool', tool_name: 'Write', tool_use_id: 'tool-1', input: {},
        } })
        return
      }
      if (message.type === 'control_response') {
        decisions.push(message)
        emitMarkdown(emit, '# Denied path')
      }
    })
    const runtime = createAuthorRuntimeForTest(config(), fake.spawn as Parameters<typeof createAuthorRuntimeForTest>[1])
    await runtime.execute({
      runId: 'run-1', dispatchId: 'dispatch-1', workspacePath,
      prompt: 'permission', onMessage: () => undefined,
    })
    expect(decisions[0]).toMatchObject({ response: { response: { behavior: 'deny' } } })
    runtime.dispose()
  })

  test('maps native model errors without exposing provider text', async () => {
    const fake = makeSpawn((message, emit) => {
      if (message.type === 'user') {
        emit({
          type: 'result', subtype: 'error_during_execution', is_error: true,
          errors: ['provider secret must not escape'],
        })
      }
    })
    const runtime = createAuthorRuntimeForTest(config(), fake.spawn as Parameters<typeof createAuthorRuntimeForTest>[1])
    let caught: unknown
    try {
      await runtime.execute({
        runId: 'run-error', dispatchId: 'dispatch-error', workspacePath,
        prompt: 'error',
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ code: 'native_model_error' })
    expect(String((caught as Error).message)).not.toContain('provider secret')
    runtime.dispose()
  })

  test('awaits stdin backpressure failures and returns a sanitized protocol error', async () => {
    const closedStream = () => new ReadableStream<Uint8Array>({
      start(controller) { controller.close() },
    })
    const spawn = ((command: string[], options: {
      cwd: string
      env: Record<string, string>
      stdin: 'pipe'
      stdout: 'pipe'
      stderr: 'pipe'
    }) => ({
      stdin: {
        write: () => Promise.reject(new Error('credential leaked by pipe')),
        flush: () => 0,
        end: () => 0,
      },
      stdout: closedStream(), stderr: closedStream(), exitCode: null,
      kill: () => undefined, exited: new Promise<number>(() => undefined),
    })) as Parameters<typeof createAuthorRuntimeForTest>[1]
    const runtime = createAuthorRuntimeForTest(config(), spawn)
    let caught: unknown
    try {
      await runtime.execute({
        runId: 'run-write-error', dispatchId: 'dispatch-write-error', workspacePath,
        prompt: 'write-error',
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ code: 'native_protocol_error' })
    expect(String((caught as Error).message)).not.toContain('credential leaked')
    runtime.dispose()
  })

  test('returns cumulative and per-turn usage without double-counting stream snapshots', async () => {
    const fake = makeSpawn((message, emit) => {
      if (message.type !== 'user') return
      emit({ type: 'stream_event', event: { type: 'message_delta', usage: { input_tokens: 7, output_tokens: 2 } } })
      emitMarkdown(emit, '# Usage')
    })
    const runtime = createAuthorRuntimeForTest(config(), fake.spawn as Parameters<typeof createAuthorRuntimeForTest>[1])
    const result = await runtime.execute({
      runId: 'run-1', dispatchId: 'dispatch-1', workspacePath,
      prompt: 'usage', onMessage: () => undefined,
    })
    expect(result.usage).toMatchObject({ prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 })
    expect(result.turnUsage).toEqual(result.usage)
    runtime.dispose()
  })

  test('attaches observed usage to a failed terminal and returns a defensive snapshot', async () => {
    const fake = makeSpawn((message, emit) => {
      if (message.type !== 'user') return
      emit({ type: 'stream_event', event: { type: 'message_delta', usage: {
        input_tokens: 11, output_tokens: 4, cache_read_input_tokens: 2,
      } } })
      emit({ type: 'result', subtype: 'error_during_execution', is_error: true,
        errors: ['provider details must stay private'] })
    })
    const runtime = createAuthorRuntimeForTest(config(), fake.spawn as Parameters<typeof createAuthorRuntimeForTest>[1])
    let caught: unknown
    try {
      await runtime.execute({
        runId: 'run-failed-usage', dispatchId: 'dispatch-failed-usage', workspacePath,
        prompt: 'failed-usage',
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ code: 'native_model_error' })
    expect((caught as AuthorRuntimeError).usage).toMatchObject({
      prompt_tokens: 11, completion_tokens: 4, cache_read_tokens: 2, total_tokens: 17,
    })
    expect((caught as AuthorRuntimeError).turnUsage).toEqual((caught as AuthorRuntimeError).usage)
    const snapshot = runtime.getUsageSnapshot()
    snapshot.prompt_tokens = 0
    expect(runtime.getUsageSnapshot().prompt_tokens).toBe(11)
    runtime.dispose()
  })

  test('preserves usage when stop happens before a terminal result', async () => {
    let runtime!: ReturnType<typeof createAuthorRuntimeForTest>
    const fake = makeSpawn((message, emit) => {
      if (message.type !== 'user') return
      emit({ type: 'stream_event', event: { type: 'message_delta', usage: {
        input_tokens: 5, output_tokens: 3,
      } } })
    })
    runtime = createAuthorRuntimeForTest(config(), fake.spawn as Parameters<typeof createAuthorRuntimeForTest>[1])
    let caught: unknown
    try {
      await runtime.execute({
        runId: 'run-stop-usage', dispatchId: 'dispatch-stop-usage', workspacePath,
        prompt: 'stop-usage',
        onMessage: message => {
          if (message.type === 'stream_event') runtime.stop()
        },
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ code: 'cancelled' })
    expect((caught as AuthorRuntimeError).turnUsage).toMatchObject({
      prompt_tokens: 5, completion_tokens: 3, total_tokens: 8,
    })
    expect(runtime.getUsageSnapshot()).toMatchObject({
      prompt_tokens: 5, completion_tokens: 3, total_tokens: 8,
    })
    runtime.dispose()
  })

  test('keeps zero cumulative usage zero and derives normal per-turn differences', async () => {
    let userCount = 0
    const fake = makeSpawn((message, emit) => {
      if (message.type !== 'user') return
      userCount += 1
      if (userCount === 1) {
        emit({ type: 'result', subtype: 'success', is_error: false,
          result: '# First', modelUsage: { model: { inputTokens: 0, outputTokens: 0 } } })
      } else {
        emit({ type: 'result', subtype: 'success', is_error: false,
          result: '# Second', modelUsage: { model: { inputTokens: 13, outputTokens: 5 } } })
      }
    })
    const runtime = createAuthorRuntimeForTest(config(), fake.spawn as Parameters<typeof createAuthorRuntimeForTest>[1])
    const first = await runtime.execute({
      runId: 'run-normal-usage', dispatchId: 'dispatch-first', workspacePath,
      prompt: 'first',
    })
    expect(first.usage).toEqual({
      prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0,
      cache_creation_tokens: 0, total_tokens: 0,
    })
    const second = await runtime.execute({
      runId: 'run-normal-usage', dispatchId: 'dispatch-second', workspacePath,
      prompt: 'second',
    })
    expect(second.turnUsage).toMatchObject({ prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 })
    expect(second.usage).toMatchObject({ prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 })
    runtime.dispose()
  })

  test('does not forward a late native event after the terminal result', async () => {
    const fake = makeSpawn((message, emit) => {
      if (message.type !== 'user') return
      emitMarkdown(emit, '# Done')
      setTimeout(() => emit({
        type: 'assistant', message: { content: [{ type: 'text', text: 'late' }] },
      }), 0)
    })
    const messages: AuthorNativeMessage[] = []
    const runtime = createAuthorRuntimeForTest(config(), fake.spawn as Parameters<typeof createAuthorRuntimeForTest>[1])
    await runtime.execute({
      runId: 'run-1', dispatchId: 'dispatch-1', workspacePath,
      prompt: 'late', onMessage: message => { messages.push(message) },
    })
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(messages.map(message => message.type)).toEqual(['stream_event', 'result'])
    runtime.dispose()
  })

  test('does not retry or write after stop occurs during sink handling', async () => {
    let runtime!: ReturnType<typeof createAuthorRuntimeForTest>
    let userCount = 0
    const fake = makeSpawn((message, emit) => {
      if (message.type !== 'user') return
      userCount += 1
      emit({ type: 'stream_event', event: {
        type: 'content_block_delta', delta: { type: 'text_delta', text: '# Partial' },
      } })
      emit({ type: 'result', subtype: 'success', is_error: false, result: '# Partial' })
    })
    runtime = createAuthorRuntimeForTest(config(), fake.spawn as Parameters<typeof createAuthorRuntimeForTest>[1])
    await expect(runtime.execute({
      runId: 'run-stop-callback', dispatchId: 'dispatch-stop-callback', workspacePath,
      prompt: 'stop-callback',
      onMessage: async message => {
        if (message.type === 'stream_event') {
          await Promise.resolve()
          runtime.stop()
        }
      },
    })).rejects.toMatchObject({ code: 'cancelled' })
    expect(userCount).toBe(1)
    runtime.dispose()
  })

  test('stop is local to one runtime instance and rejects only its active turn', async () => {
    let firstEmit: ((value: AuthorNativeMessage) => void) | undefined
    const firstFake = makeSpawn((message, emit) => {
      if (message.type === 'user') firstEmit = emit
    })
    const secondFake = makeSpawn((message, emit) => {
      if (message.type === 'user') emitMarkdown(emit, '# Other runtime')
    })
    const first = createAuthorRuntimeForTest(config(), firstFake.spawn as Parameters<typeof createAuthorRuntimeForTest>[1])
    const second = createAuthorRuntimeForTest(config(), secondFake.spawn as Parameters<typeof createAuthorRuntimeForTest>[1])
    const pending = first.execute({ runId: 'r1', dispatchId: 'd1', workspacePath, prompt: 'wait' })
    while (!firstEmit) await new Promise(resolve => setTimeout(resolve, 1))
    first.stop()
    await expect(pending).rejects.toThrow('cancelled')
    await expect(second.execute({ runId: 'r2', dispatchId: 'd2', workspacePath, prompt: 'go' })).resolves.toMatchObject({ markdown: '# Other runtime' })
    expect(firstEmit).toBeDefined()
    first.dispose()
    second.dispose()
  })

  test('stop during permission initialization prevents spawning a native process', async () => {
    const fake = makeSpawn(() => {})
    const runtime = createAuthorRuntimeForTest(config(), fake.spawn as Parameters<typeof createAuthorRuntimeForTest>[1])
    const pending = runtime.execute({ runId: 'r1', dispatchId: 'd1', workspacePath, prompt: 'wait' })
    runtime.stop()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    expect(fake.commands).toHaveLength(0)
    runtime.dispose()
  })
})
