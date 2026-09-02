import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createNativeCliProcessRunner,
  nativeRuntimeEnvironment,
  nativeRuntimeCommand,
} from './native-cli-process-runner'
import { createRuntimeObservability } from './runtime-observability'

const fixturePath = fileURLToPath(
  new URL('./fixtures/native-runtime-fixture.ts', import.meta.url),
)

function startRuntime(
  options: {
    markdownStream?: boolean
    recordStream?: boolean
    workflowJsonSchema?: Record<string, unknown>
    observeMessage?: (message: Record<string, unknown>) => void
  } = {},
) {
  return createNativeCliProcessRunner({
    command: [process.execPath, fixturePath],
    observabilityFactory: () => ({
      beginTurn: () => undefined,
      observeStdoutChunk: () => undefined,
      observeLine: () => undefined,
      observeMessage: message => options.observeMessage?.(message),
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
    ...(options.workflowJsonSchema
      ? { workflowJsonSchema: options.workflowJsonSchema }
      : {}),
    ...(options.recordStream
      ? {
          workflowRecordStreamContract: {
            version: 1 as const,
            terminalRecord: { record: 'done', sliceId: 'slice-1' },
          },
        }
      : {}),
  })
}

function recordStreamCommand(
  mode:
    | 'complete'
    | 'cumulative'
    | 'empty'
    | 'invalid-nonterminal'
    | 'incorrect-terminal'
    | 'dsml'
    | 'tool'
    | 'unicode',
) {
  const script = `
const decoder = new TextDecoder(); let buffer = ''; let count = 0;
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk);
  for (;;) {
    const index = buffer.indexOf('\\n'); if (index < 0) break;
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    const message = JSON.parse(line);
    if (message.type !== 'user') continue; count += 1;
    const emit = text => console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } }));
    if (count === 1) {
      if (${JSON.stringify(mode)} === 'invalid-nonterminal') emit(${JSON.stringify('{not-json-record}\n')});
      else if (${JSON.stringify(mode)} === 'dsml') emit(${JSON.stringify('<tool_use name="Write">\n')});
      else if (${JSON.stringify(mode)} === 'tool') console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Write', input: {} }] } }));
      else if (${JSON.stringify(mode)} === 'unicode') emit(${JSON.stringify('节点😀\n')});
      else emit(${JSON.stringify('{"record":"node","id":"n1"}\n')});
      if (${JSON.stringify(mode)} === 'cumulative') emit(${JSON.stringify('{"record":"node","id":"n1"}\n{"record":"node","id":"n1"}\n')});
      else if (${JSON.stringify(mode)} === 'empty') console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn' }));
      else console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'max_tokens' }));
    } else if (${JSON.stringify(mode)} !== 'empty') {
      emit(${JSON.stringify(mode)} === 'incorrect-terminal'
        ? ${JSON.stringify('{"record":"done","sliceId":"wrong-slice"}\n')}
        : ${JSON.stringify('{"record":"done","sliceId":"slice-1"}\n')});
      console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn' }));
    } else {
      console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn' }));
    }
  }
}
`
  return [process.execPath, '-e', script]
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
    expect(() =>
      nativeRuntimeCommand({
        ...input,
        resumeSessionId: 'beegame_route_only',
      }),
    ).toThrow('native resume session ID must be a UUID')
  })

  test('resumes only an explicit native UUID', () => {
    const nativeSessionId = '550e8400-e29b-41d4-a716-446655440000'
    expect(
      nativeRuntimeCommand({
        sessionId: 'beegame_route_only',
        resumeSessionId: nativeSessionId,
        cwd: process.cwd(),
        env: {},
      }),
    ).toContain(`--resume=${nativeSessionId}`)
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
    expect(command.some(argument => argument.startsWith('--tools='))).toBe(
      false,
    )
    expect(
      command.some(argument => argument.startsWith('--allowedTools=')),
    ).toBe(false)
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

  test('exposes only Read, Edit and the native terminal tool to a revision worker', () => {
    const command = nativeRuntimeCommand({
      sessionId: 'beegame_revision_worker',
      cwd: process.cwd(),
      env: {},
      workflowWorker: true,
      workflowWorkerType: 'foundation-document-reviser',
    })
    expect(command.slice(command.indexOf('--tools') + 1)).toEqual([
      'Read',
      'Edit',
      'SubmitFoundationRevisionResult',
    ])
  })

  test('disables built-in tools for a StructuredOutput workflow turn while retaining its JSON schema', () => {
    const schema = {
      type: 'object',
      properties: { taskId: { type: 'string' } },
      required: ['taskId'],
      additionalProperties: false,
    }
    const command = nativeRuntimeCommand({
      sessionId: 'beegame_fact_extractor',
      cwd: process.cwd(),
      env: {},
      workflowWorker: true,
      workflowWorkerType: 'foundation-fact-extractor',
      workflowJsonSchema: schema,
    })

    expect(command).toContain('--json-schema')
    expect(command[command.indexOf('--json-schema') + 1]).toBe(
      JSON.stringify(schema),
    )
    expect(command).toContain('--tools')
    expect(command[command.indexOf('--tools') + 1]).toBe('')
  })

  test('uses the single native record stream lane without schema or tools', () => {
    const command = nativeRuntimeCommand({
      sessionId: 'beegame_record_stream',
      cwd: process.cwd(),
      env: {},
      workflowWorker: true,
      workflowWorkerType: 'game-ir-compiler',
      workflowRecordStreamContract: {
        version: 1,
        terminalRecord: { record: 'done', sliceId: 'slice-1' },
      },
    })
    expect(command).not.toContain('--json-schema')
    expect(command).toContain('--tools')
    expect(command[command.indexOf('--tools') + 1]).toBe('')
  })

  test('continues one raw NDJSON stream and returns the complete record_stream', async () => {
    const runtime = await createNativeCliProcessRunner({
      command: recordStreamCommand('complete'),
      observabilityFactory: () => ({
        beginTurn: () => undefined,
        observeStdoutChunk: () => undefined,
        observeLine: () => undefined,
        observeMessage: () => undefined,
        finishTurn: () => undefined,
        flush: async () => undefined,
      }),
    }).start({
      sessionId: 'record-stream-session',
      cwd: process.cwd(),
      env: {},
      workflowRecordStreamContract: {
        version: 1,
        terminalRecord: { record: 'done', sliceId: 'slice-1' },
      },
    })
    const messages: Record<string, unknown>[] = []
    await runtime.submit({
      prompt: 'record stream',
      signal: new AbortController().signal,
      onMessage: message => messages.push(message),
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    expect(messages).toEqual([
      expect.objectContaining({
        type: 'result',
        record_stream:
          '{"record":"node","id":"n1"}\n{"record":"done","sliceId":"slice-1"}\n',
      }),
    ])
    runtime.dispose?.()
  })

  test('passes a syntactically invalid non-terminal record to Stage 5 unchanged', async () => {
    const runtime = await createNativeCliProcessRunner({
      command: recordStreamCommand('invalid-nonterminal'),
      observabilityFactory: () => ({
        beginTurn: () => undefined,
        observeStdoutChunk: () => undefined,
        observeLine: () => undefined,
        observeMessage: () => undefined,
        finishTurn: () => undefined,
        flush: async () => undefined,
      }),
    }).start({
      sessionId: 'record-stream-session',
      cwd: process.cwd(),
      env: {},
      workflowRecordStreamContract: {
        version: 1,
        terminalRecord: { record: 'done', sliceId: 'slice-1' },
      },
    })
    const messages: Record<string, unknown>[] = []
    await runtime.submit({
      prompt: 'record stream',
      signal: new AbortController().signal,
      onMessage: message => messages.push(message),
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    expect(messages.at(-1)).toMatchObject({
      type: 'result',
      record_stream:
        '{not-json-record}\n{"record":"done","sliceId":"slice-1"}\n',
    })
    runtime.dispose?.()
  })

  test('rejects DSML record-stream frames as provider protocol errors', async () => {
    const runtime = await createNativeCliProcessRunner({
      command: recordStreamCommand('dsml'),
      observabilityFactory: () => ({
        beginTurn: () => undefined,
        observeStdoutChunk: () => undefined,
        observeLine: () => undefined,
        observeMessage: () => undefined,
        finishTurn: () => undefined,
        flush: async () => undefined,
      }),
    }).start({
      sessionId: 'record-stream-session',
      cwd: process.cwd(),
      env: {},
      workflowRecordStreamContract: {
        version: 1,
        terminalRecord: { record: 'done', sliceId: 'slice-1' },
      },
    })
    await expect(
      runtime.submit({
        prompt: 'record stream',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow(
      'provider_stream_protocol_error: record_stream emitted a DSML frame',
    )
    runtime.dispose?.()
  })

  test('rejects record-stream tool frames as provider protocol errors', async () => {
    const runtime = await createNativeCliProcessRunner({
      command: recordStreamCommand('tool'),
      observabilityFactory: () => ({
        beginTurn: () => undefined,
        observeStdoutChunk: () => undefined,
        observeLine: () => undefined,
        observeMessage: () => undefined,
        finishTurn: () => undefined,
        flush: async () => undefined,
      }),
    }).start({
      sessionId: 'record-stream-session',
      cwd: process.cwd(),
      env: {},
      workflowRecordStreamContract: {
        version: 1,
        terminalRecord: { record: 'done', sliceId: 'slice-1' },
      },
    })
    await expect(
      runtime.submit({
        prompt: 'record stream',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow(
      'provider_stream_protocol_error: record_stream emitted a tool or DSML frame',
    )
    runtime.dispose?.()
  })

  test('rejects assistant text DSML after a valid record-stream prefix', async () => {
    const script = `
for await (const chunk of Bun.stdin.stream()) {
  const text = new TextDecoder().decode(chunk);
  if (!text.includes('"type":"user"')) continue;
  console.log(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"record":"node","id":"n1"}\\n{"record":"done","sliceId":"slice-1"}\\n' } } }));
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '<tool_use name="Write">' }] } }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn' }));
}
`
    const runtime = await createNativeCliProcessRunner({
      command: [process.execPath, '-e', script],
      observabilityFactory: () => ({
        beginTurn: () => undefined,
        observeStdoutChunk: () => undefined,
        observeLine: () => undefined,
        observeMessage: () => undefined,
        finishTurn: () => undefined,
        flush: async () => undefined,
      }),
    }).start({
      sessionId: 'record-stream-session',
      cwd: process.cwd(),
      env: {},
      workflowRecordStreamContract: {
        version: 1,
        terminalRecord: { record: 'done', sliceId: 'slice-1' },
      },
    })
    await expect(
      runtime.submit({
        prompt: 'record stream',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow(
      'provider_stream_protocol_error: record_stream emitted a DSML frame',
    )
    runtime.dispose?.()
  })

  test('rejects an incorrect record-stream terminal as a provider protocol error', async () => {
    const runtime = await createNativeCliProcessRunner({
      command: recordStreamCommand('incorrect-terminal'),
      observabilityFactory: () => ({
        beginTurn: () => undefined,
        observeStdoutChunk: () => undefined,
        observeLine: () => undefined,
        observeMessage: () => undefined,
        finishTurn: () => undefined,
        flush: async () => undefined,
      }),
    }).start({
      sessionId: 'record-stream-session',
      cwd: process.cwd(),
      env: {},
      workflowRecordStreamContract: {
        version: 1,
        terminalRecord: { record: 'done', sliceId: 'slice-1' },
      },
    })
    await expect(
      runtime.submit({
        prompt: 'record stream',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow(
      'provider_stream_protocol_error: record_stream terminal record did not match the expected slice',
    )
    runtime.dispose?.()
  })

  test('writes the exact UTF-8 digest and bytes for native record chunks', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'native-record-observe-'))
    const chunk = Buffer.from('节点😀\n', 'utf8')
    try {
      const runtime = await createNativeCliProcessRunner({
        command: recordStreamCommand('unicode'),
        observabilityFactory: input => createRuntimeObservability(input),
      }).start({
        sessionId: 'record-stream-session',
        cwd: workspacePath,
        env: {},
        workflowRecordStreamContract: {
          version: 1,
          terminalRecord: { record: 'done', sliceId: 'slice-1' },
        },
      })
      await runtime.submit({
        prompt: 'record stream',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      })
      await runtime.dispose?.()
      const raw = await readFile(
        join(workspacePath, '.beegame/logs/native-runtime.jsonl'),
        'utf8',
      )
      expect(raw).toContain(
        JSON.stringify({
          bytes: chunk.byteLength,
          digest: createHash('sha256').update(chunk).digest('hex'),
        }).slice(1, -1),
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects a blank physical record-stream line as a provider protocol error', async () => {
    const script = `
for await (const chunk of Bun.stdin.stream()) {
  const text = new TextDecoder().decode(chunk);
  if (!text.includes('"type":"user"')) continue;
  console.log('');
}
`
    const runtime = await createNativeCliProcessRunner({
      command: [process.execPath, '-e', script],
      observabilityFactory: () => ({
        beginTurn: () => undefined,
        observeStdoutChunk: () => undefined,
        observeLine: () => undefined,
        observeMessage: () => undefined,
        finishTurn: () => undefined,
        flush: async () => undefined,
      }),
    }).start({
      sessionId: 'record-stream-session',
      cwd: process.cwd(),
      env: {},
      workflowRecordStreamContract: {
        version: 1,
        terminalRecord: { record: 'done', sliceId: 'slice-1' },
      },
    })
    await expect(
      runtime.submit({
        prompt: 'record stream',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow(
      'provider_stream_protocol_error: record_stream emitted an internal blank line',
    )
    runtime.dispose?.()
  })

  test('rejects cumulative record stream frames as provider protocol errors', async () => {
    const runtime = await createNativeCliProcessRunner({
      command: recordStreamCommand('cumulative'),
      observabilityFactory: () => ({
        beginTurn: () => undefined,
        observeStdoutChunk: () => undefined,
        observeLine: () => undefined,
        observeMessage: () => undefined,
        finishTurn: () => undefined,
        flush: async () => undefined,
      }),
    }).start({
      sessionId: 'record-stream-session',
      cwd: process.cwd(),
      env: {},
      workflowRecordStreamContract: {
        version: 1,
        terminalRecord: { record: 'done', sliceId: 'slice-1' },
      },
    })
    await expect(
      runtime.submit({
        prompt: 'record stream',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow(
      'provider_stream_protocol_error: record_stream emitted a cumulative frame',
    )
    runtime.dispose?.()
  })

  test('rejects a record stream continuation that makes no progress', async () => {
    const runtime = await createNativeCliProcessRunner({
      command: recordStreamCommand('empty'),
      observabilityFactory: () => ({
        beginTurn: () => undefined,
        observeStdoutChunk: () => undefined,
        observeLine: () => undefined,
        observeMessage: () => undefined,
        finishTurn: () => undefined,
        flush: async () => undefined,
      }),
    }).start({
      sessionId: 'record-stream-session',
      cwd: process.cwd(),
      env: {},
      workflowRecordStreamContract: {
        version: 1,
        terminalRecord: { record: 'done', sliceId: 'slice-1' },
      },
    })
    await expect(
      runtime.submit({
        prompt: 'record stream',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow(
      'provider_stream_protocol_error: record_stream continuation made no progress',
    )
    runtime.dispose?.()
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

  test('completes a structured turn when the validated StructuredOutput tool succeeds', async () => {
    const runtime = await startRuntime({
      workflowJsonSchema: {
        type: 'object',
        properties: { version: { const: 3 } },
        required: ['version'],
        additionalProperties: false,
      },
    })
    const messages: Record<string, unknown>[] = []

    await expect(
      Promise.race([
        runtime.submit({
          prompt: 'structured-success-without-result',
          signal: new AbortController().signal,
          onMessage: message => messages.push(message),
          requestPermission: async () => ({ behavior: 'deny' }),
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('structured turn did not terminate')),
            500,
          ),
        ),
      ]),
    ).resolves.toBeUndefined()
    expect(messages.at(-1)).toMatchObject({
      type: 'result',
      subtype: 'success',
      structured_output: { version: 3 },
    })
    expect(messages.filter(message => message.type === 'result')).toHaveLength(
      1,
    )
    runtime.dispose?.()
  })

  test('continues an incomplete StructuredOutput turn in the same native session after max_tokens', async () => {
    const runtime = await startRuntime({
      workflowJsonSchema: {
        type: 'object',
        properties: { version: { const: 3 } },
        required: ['version'],
        additionalProperties: false,
      },
    })
    const messages: Record<string, unknown>[] = []

    await expect(
      Promise.race([
        runtime.submit({
          prompt: 'structured-truncated',
          signal: new AbortController().signal,
          onMessage: message => messages.push(message),
          requestPermission: async () => ({ behavior: 'deny' }),
        }),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  'structured max-token continuation did not terminate',
                ),
              ),
            500,
          ),
        ),
      ]),
    ).resolves.toBeUndefined()

    expect(
      messages.filter(message => message.type === 'assistant'),
    ).toHaveLength(2)
    expect(
      messages
        .filter(message => message.type === 'assistant')
        .map(message => message.session_id),
    ).toEqual([
      '550e8400-e29b-41d4-a716-446655440000',
      '550e8400-e29b-41d4-a716-446655440000',
    ])
    expect(messages.at(-1)).toMatchObject({
      type: 'result',
      subtype: 'success',
      structured_output: { version: 3 },
    })
    expect(messages.filter(message => message.type === 'result')).toHaveLength(
      1,
    )
    runtime.dispose?.()
  })

  test('does not resolve a StructuredOutput turn when a failed tool is followed by a native success envelope', async () => {
    const runtime = await startRuntime({
      workflowJsonSchema: {
        type: 'object',
        properties: { version: { const: 3 } },
        required: ['version'],
        additionalProperties: false,
      },
    })
    const messages: Record<string, unknown>[] = []

    await expect(
      runtime.submit({
        prompt: 'structured-failure-success-result',
        signal: new AbortController().signal,
        onMessage: message => messages.push(message),
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow('StructuredOutput failed before producing a valid result')
    expect(messages.some(message => message.type === 'user')).toBe(true)
    runtime.dispose?.()
  })

  test('rejects repeated StructuredOutput max-token truncation when the output has made no progress', async () => {
    const runtime = await startRuntime({
      workflowJsonSchema: {
        type: 'object',
        properties: { version: { const: 3 } },
        required: ['version'],
        additionalProperties: false,
      },
    })

    await expect(
      Promise.race([
        runtime.submit({
          prompt: 'structured-truncated-forever',
          signal: new AbortController().signal,
          onMessage: () => undefined,
          requestPermission: async () => ({ behavior: 'deny' }),
        }),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error('structured no-progress failure did not terminate'),
              ),
            500,
          ),
        ),
      ]),
    ).rejects.toThrow(
      'StructuredOutput provider truncation: continuation made no progress',
    )
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

    expect(nativeSessionIds).toEqual(['550e8400-e29b-41d4-a716-446655440000'])
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

  test('recovers a thinking-only provider result in the same Markdown dispatch and session', async () => {
    const runtime = await startRuntime({ markdownStream: true })
    const messages: Record<string, unknown>[] = []
    await expect(
      runtime.submit({
        prompt: 'incomplete-success',
        signal: new AbortController().signal,
        onMessage: message => messages.push(message),
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).resolves.toBeUndefined()
    expect(messages.filter(message => message.type === 'result')).toHaveLength(
      1,
    )
    expect(messages.at(-1)).toMatchObject({
      type: 'result',
      subtype: 'success',
      stop_reason: 'end_turn',
      received_user_count: 2,
    })
    expect(messages.at(-1)?.result).toContain('# Visible Markdown')
    runtime.dispose?.()
  })

  test('accepts a mechanically closed Markdown body when provider stop metadata is missing', async () => {
    const runtime = await startRuntime({ markdownStream: true })
    const messages: Record<string, unknown>[] = []
    await expect(
      runtime.submit({
        prompt: 'complete-markdown-without-stop-reason',
        signal: new AbortController().signal,
        onMessage: message => messages.push(message),
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).resolves.toBeUndefined()
    expect(messages.at(-1)).toMatchObject({
      type: 'result',
      subtype: 'success',
      stop_reason: '',
      received_user_count: 1,
    })
    expect(messages).toHaveLength(3)
    runtime.dispose?.()
  })

  test('recovers a truncated Markdown result in the same native turn and session', async () => {
    const runtime = await startRuntime({ markdownStream: true })
    const messages: Record<string, unknown>[] = []

    await runtime.submit({
      prompt: 'truncated-markdown',
      signal: new AbortController().signal,
      onMessage: message => messages.push(message),
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    expect(messages.filter(message => message.type === 'result')).toHaveLength(
      1,
    )
    expect(messages.at(-1)).toMatchObject({
      type: 'result',
      subtype: 'success',
      stop_reason: 'end_turn',
      received_user_count: 2,
    })
    expect(messages.at(-1)?.result).toContain('## Vision and Product Promise')
    runtime.dispose?.()
  })

  test('continues a long Markdown document until its structure closes', async () => {
    const runtime = await startRuntime({ markdownStream: true })
    const messages: Record<string, unknown>[] = []

    await runtime.submit({
      prompt: 'truncated-markdown-twice',
      signal: new AbortController().signal,
      onMessage: message => messages.push(message),
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    expect(messages.filter(message => message.type === 'result')).toHaveLength(
      1,
    )
    expect(messages.at(-1)).toMatchObject({
      type: 'result',
      subtype: 'success',
      received_user_count: 3,
    })
    expect(messages.at(-1)?.result).toContain('## Production Materials')
    runtime.dispose?.()
  })

  test('classifies an unrecovered Markdown truncation as non-retryable transport failure', async () => {
    const runtime = await startRuntime({ markdownStream: true })

    await expect(
      runtime.submit({
        prompt: 'truncated-markdown-forever',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow('foundation_transport_needs_action')
    runtime.dispose?.()
  })

  test('rejects a structurally invalid Markdown response without replacing the candidate', async () => {
    const runtime = await startRuntime({ markdownStream: true })

    await expect(
      runtime.submit({
        prompt: 'malformed-markdown-end-turn',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow('foundation_transport_needs_action')
    runtime.dispose?.()
  })

  test('rejects a continuation that restarts the document from its title', async () => {
    const runtime = await startRuntime({ markdownStream: true })

    await expect(
      runtime.submit({
        prompt: 'truncated-markdown-forever',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow('restarted the document from its title')
    runtime.dispose?.()
  })

  test('rejects a continuation that makes no progress', async () => {
    const runtime = await startRuntime({ markdownStream: true })

    await expect(
      runtime.submit({
        prompt: 'truncated-markdown-empty-continuation',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow('Markdown continuation made no progress')
    runtime.dispose?.()
  })

  test('rejects a complete body whose heading order cannot be repaired by appending', async () => {
    const nativeResults: Record<string, unknown>[] = []
    const runtime = await startRuntime({
      markdownStream: true,
      observeMessage: message => {
        if (message.type === 'result') nativeResults.push(message)
      },
    })

    await expect(
      runtime.submit({
        prompt: 'unreachable-markdown-order',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow(/cannot be completed by appending/i)
    expect(nativeResults).toHaveLength(1)
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
