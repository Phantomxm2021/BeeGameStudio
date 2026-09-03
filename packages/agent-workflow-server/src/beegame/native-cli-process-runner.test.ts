import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import {
  createNativeCliProcessRunner,
  nativeRuntimeEnvironment,
  nativeRuntimeCommand,
} from './native-cli-process-runner'
import type { FoundationDocumentPath } from './delivery-workflow/types'

const fixturePath = fileURLToPath(
  new URL('./fixtures/native-runtime-fixture.ts', import.meta.url),
)

function startRuntime(
  options: {
    markdownStream?: boolean
    workflowJsonSchema?: Record<string, unknown>
    targetPath?: FoundationDocumentPath
  } = {},
) {
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
            targetPath: options.targetPath ?? ('docs/GDD.md' as const),
            maxBytes: 512_000,
          },
        }
      : {}),
    ...(options.workflowJsonSchema
      ? { workflowJsonSchema: options.workflowJsonSchema }
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

    expect(command).not.toContain('--tools')
    expect(command.some(argument => argument.startsWith('--tools='))).toBe(false)
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
      sessionId: 'beegame_revision_worker', cwd: process.cwd(), env: {},
      workflowWorker: true, workflowWorkerType: 'foundation-document-reviser',
    })
    expect(command.slice(command.indexOf('--tools') + 1)).toEqual(['Read', 'Edit', 'SubmitFoundationRevisionResult'])
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
    expect(command[command.indexOf('--json-schema') + 1]).toBe(JSON.stringify(schema))
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
    expect(messages.filter(message => message.type === 'result')).toHaveLength(1)
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
    expect(messages.filter(message => message.type === 'result')).toHaveLength(1)
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

    expect(messages.filter(message => message.type === 'result')).toHaveLength(1)
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

    expect(messages.filter(message => message.type === 'result')).toHaveLength(1)
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

  test('replaces a structurally invalid Asset Plan candidate in the same dispatch', async () => {
    const runtime = await startRuntime({
      markdownStream: true,
      targetPath: 'docs/ASSET_PLAN.md',
    })
    const messages: Record<string, unknown>[] = []

    await runtime.submit({
      prompt: 'asset-structural-replacement',
      signal: new AbortController().signal,
      onMessage: message => messages.push(message),
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    const result = messages.at(-1)!
    expect(messages.filter(message => message.type === 'result')).toHaveLength(1)
    expect(result).toMatchObject({
      type: 'result',
      subtype: 'success',
      received_user_count: 2,
      received_session_ids: ['', '550e8400-e29b-41d4-a716-446655440000'],
    })
    const receivedPrompts = result.received_prompts as string[]
    expect(receivedPrompts).toHaveLength(2)
    expect(receivedPrompts[1]).toContain('complete replacement')
    expect(receivedPrompts[1]).toContain(
      'canonical material headings must follow Production Materials',
    )
    expect(receivedPrompts[1]).toContain('# <document title>')
    expect(receivedPrompts[1]).toContain('## Production Materials')
    const accepted = String(result.result)
    expect(accepted).toBe(fixtureCompleteAssetMarkdown())
    for (const heading of assetMaterialHeadings())
      expect(accepted.split(heading).length - 1).toBe(1)
    runtime.dispose?.()
  })

  test.each([
    ['asset-structural-replacement-empty', 'empty'],
    ['asset-structural-replacement-identical', 'identical'],
    ['asset-structural-replacement-still-invalid', 'still-invalid'],
  ])('fails one structural replacement cycle for %s', async (prompt, _) => {
    const runtime = await startRuntime({
      markdownStream: true,
      targetPath: 'docs/ASSET_PLAN.md',
    })
    let result: Record<string, unknown> | undefined

    await expect(
      runtime.submit({
        prompt,
        signal: new AbortController().signal,
        onMessage: message => {
          if (message.type === 'result') result = message
        },
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow('Markdown structural replacement')
    expect(result).toBeUndefined()
    runtime.dispose?.()
  })

  test('accepts a terminal-only replacement result in the same dispatch', async () => {
    const runtime = await startRuntime({
      markdownStream: true,
      targetPath: 'docs/ASSET_PLAN.md',
    })
    const messages: Record<string, unknown>[] = []

    await runtime.submit({
      prompt: 'asset-structural-replacement-terminal-only',
      signal: new AbortController().signal,
      onMessage: message => messages.push(message),
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    expect(messages.at(-1)?.result).toBe(fixtureCompleteAssetMarkdown())
    expect(messages.at(-1)?.received_user_count).toBe(2)
    runtime.dispose?.()
  })

  test('normalizes a streamed complete candidate when terminal result is empty', async () => {
    const runtime = await startRuntime({ markdownStream: true })
    const messages: Record<string, unknown>[] = []

    await runtime.submit({
      prompt: 'streamed-complete-empty-terminal',
      signal: new AbortController().signal,
      onMessage: message => messages.push(message),
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    expect(messages.at(-1)?.result).toContain('# Visible Markdown')
    expect(messages.at(-1)?.received_user_count).toBe(1)
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

function assetMaterialHeadings(): string[] {
  return [
    '### Asset Inventory Table',
    '### Responsibility Matrix',
    '### Dependency and Integration Diagram',
    '### License Register',
    '### Milestone and Maturity Table',
  ]
}

function fixtureCompleteAssetMarkdown(): string {
  return [
    '# Asset Plan',
    '## Executive Summary',
    'summary',
    '## Asset and Content Inventory',
    'inventory',
    '## Ownership and Responsibility',
    'ownership',
    '## Dependencies and Integration Order',
    'dependencies',
    '## Source, Originality and Licensing',
    'licensing',
    '## Formats, Variants and Budgets',
    'formats',
    '## Production Pipeline and Naming',
    'pipeline',
    '## Milestones, Capacity and Schedule',
    'milestones',
    '## Validation and Quality Status',
    'validation',
    '## Placeholder and Replacement Strategy',
    'replacement',
    '## Delivery, Release and Risks',
    'risks',
    '## Production Materials',
    ...assetMaterialHeadings().flatMap(heading => [heading, 'material']),
  ].join('\n')
}
