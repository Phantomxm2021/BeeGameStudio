import { test, expect } from 'bun:test'
import { requestProvider } from './request'
import { nativeRequest } from './requests'
import { toolAlias, mapTools, opaqueReasoning, conversation, UNKNOWN_TOOL_FEEDBACK } from './messages'
import type { ProviderConfig } from './config'
import { startProviderBridge } from './bridge'
import { providerConfig } from './config'
import { parseSse } from './response-stream'

const signal = () => AbortSignal.timeout(5000)
const base: ProviderConfig = {
  protocol: 'chat-completions',
  baseUrl: 'https://fixture.invalid/v1',
  apiKey: 'synthetic-secret',
  model: 'fixture-model',
  auth: 'bearer',
}
const body = {
  model: 'fixture-model',
  input: [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'Synthetic question' },
        { type: 'input_image', image_url: 'data:image/png;base64,AQID' },
      ],
    },
  ],
  tools: [
    {
      type: 'namespace',
      name: 'functions',
      tools: [
        {
          type: 'function',
          name: 'probe',
          description: 'Fixture',
          parameters: {
            type: 'object',
            properties: { value: { type: 'string' } },
          },
        },
      ],
    },
  ],
  text: {
    format: {
      type: 'json_schema',
      name: 'fixture',
      schema: { type: 'object', properties: { accepted: { type: 'boolean' } } },
    },
  },
}
const sse = (events: unknown[]) =>
  new Response(
    events.map(value => 'data: ' + JSON.stringify(value) + '\n\n').join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )

for (const stream of [false, true]) test.each([
  ['chat-completions', 5], ['chat-completions', 0], ['chat-completions', undefined], ['chat-completions', null],
  ['gemini', 5], ['gemini', 0], ['gemini', undefined], ['gemini', null],
] as const)('%s preserves reported reasoning usage (%s) without adding it to output twice; stream=' + stream, async (protocol, reasoning) => {
  const receipt = protocol === 'chat-completions'
    ? { choices: [{ delta: { content: 'Fixture' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 4 },
          ...(reasoning !== undefined ? { completion_tokens_details: { reasoning_tokens: reasoning } } : {}) } }
    : { candidates: [{ content: { role: 'model', parts: [{ text: 'Fixture' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 - (reasoning ?? 0), totalTokenCount: 20,
          cachedContentTokenCount: 4, ...(reasoning !== undefined ? { thoughtsTokenCount: reasoning } : {}) } }
  const reported: unknown[] = []
  const response = await requestProvider({ ...base, protocol }, { model: 'fixture', input: 'Synthetic question', stream },
    (async () => sse([receipt])) as unknown as typeof fetch, signal(), usage => reported.push(usage))
  let result: any
  if (stream) {
    for await (const event of parseSse(response)) {
      if (event.type === 'response.completed') result = event.response
    }
  } else result = await response.json()
  expect(result).toBeDefined()
  expect(result.usage).toMatchObject({ input_tokens: 12, output_tokens: 8, total_tokens: 20,
    input_tokens_details: { cached_tokens: 4 } })
  expect(reported).toHaveLength(1)
  expect(reported[0]).toMatchObject({ input_tokens: 8, output_tokens: 8, cache_read_tokens: 4, total_tokens: 20 })
  if (reasoning === undefined || reasoning === null) {
    expect(result.usage).not.toHaveProperty('output_tokens_details')
    expect(reported[0]).not.toHaveProperty('reasoning_tokens')
  } else {
    expect(result.usage.output_tokens_details).toEqual({ reasoning_tokens: reasoning })
    expect(reported[0]).toHaveProperty('reasoning_tokens', reasoning)
  }
})

test.each([-1, 9])('reasoning usage outside the reported output is rejected: %s', async reasoning => {
  const receipt = { choices: [{ delta: { content: 'Fixture' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 8, completion_tokens_details: { reasoning_tokens: reasoning } } }
  await expect(requestProvider(base, { model: 'fixture', input: 'Synthetic question' },
    (async () => sse([receipt])) as unknown as typeof fetch, signal())).rejects.toThrow('invalid token usage')
})

test('parallel tool images follow the complete result block without losing call associations or signed history', () => {
  for (const imageAt of [0, 1, 2]) {
    const calls = [0, 1, 2].map(index => ({ type: 'function_call', name: 'probe',
      call_id: 'parallel-' + index, arguments: '{}' }))
    const raw = { role: 'assistant', content: null, reasoning_content: 'signed-fixture',
      tool_calls: calls.map(call => ({ id: call.call_id, type: 'function',
        function: { name: 'probe', arguments: '{}' } })) }
    const outputs = calls.map((call, index) => ({ type: 'function_call_output', call_id: call.call_id,
      output: index === imageAt ? [{ type: 'input_image', image_url: 'data:image/png;base64,AQID' }] : 'result-' + index }))
    const native = nativeRequest(base, { model: 'fixture', input: [
      opaqueReasoning('chat-completions', raw), ...calls, ...outputs,
      { role: 'user', content: 'continue' },
    ] })
    const messages = native.body.messages
    expect(messages.map((message: any) => message.role)).toEqual(['assistant', 'tool', 'tool', 'tool', 'user', 'user'])
    expect(messages[0]).toEqual(raw)
    expect(messages.slice(1, 4).map((message: any) => message.tool_call_id)).toEqual(calls.map(call => call.call_id))
    expect(messages[4].content).toEqual([
      { type: 'text', text: 'Images returned by tool parallel-' + imageAt },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
    ])
    expect(messages[5].content).toEqual([{ type: 'text', text: 'continue' }])
    // History ending at a result block also flushes the image exactly once.
    const end = nativeRequest(base, { model: 'fixture', input: [...calls, ...outputs] }).body.messages
    expect(end.map((message: any) => message.role)).toEqual(['assistant', 'tool', 'tool', 'tool', 'user'])
  }
})

test('native requests preserve images, namespaces, tool results and explicit structured output', () => {
  const alias = toolAlias('probe', 'functions')
  for (const protocol of [
    'chat-completions',
    'anthropic-messages',
    'gemini',
  ] as const) {
    const native = nativeRequest({ ...base, protocol }, body)
    const wire = JSON.stringify(native.body)
    expect(wire).toContain('AQID')
    expect(wire).toContain(alias)
    expect(wire).not.toContain('synthetic-secret')
    expect(native.tools[0]).toMatchObject({
      name: 'probe',
      namespace: 'functions',
      alias,
    })
    if (protocol === 'chat-completions')
      expect(native.body).toMatchObject({
        response_format: { type: 'json_schema' },
      })
    if (protocol === 'anthropic-messages')
      expect(native.body).toMatchObject({
        output_config: { format: { type: 'json_schema' } },
      })
    if (protocol === 'gemini')
      expect(native.body).toMatchObject({
        generationConfig: { responseMimeType: 'application/json' },
      })
  }
})

test('wire names preserve native Skill references and default namespaces; constrained names stay distinct and legacy signed history stays exact', () => {
  for (const name of ['exec_command', 'WriteProjectFile', 'mcp__bgs-ui-layout__CheckUiLayouts']) {
    expect(toolAlias(name)).toBe(name)
    expect(toolAlias(name, 'functions')).toBe(name)
  }
  const left = toolAlias('a'.repeat(90), 'alpha'), right = toolAlias('a'.repeat(90), 'beta')
  expect(left).toMatch(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/)
  expect(left).not.toBe(right)
  expect(() => mapTools([{ type: 'namespace', name: 'alpha', tools: [{ type: 'function', name: 'probe' }] },
    { type: 'function', name: toolAlias('probe', 'alpha') }])).toThrow('collide')
  const legacy = { role: 'assistant', content: null, reasoning_content: 'signature-preserved',
    tool_calls: [{ id: 'old', type: 'function', function: { name: 'bgs_legacy_hash', arguments: '{}' } }] }
  const converted = nativeRequest(base, { tools: body.tools, input: [opaqueReasoning('chat-completions', legacy),
    { type: 'function_call_output', call_id: 'old', output: 'previous result' }] })
  expect(converted.body.messages[0]).toEqual(legacy)
  expect(converted.body.tools[0].function.name).toBe('probe')
})

test('custom grammar calls retain the exact input and become custom_tool_call items', async () => {
  const custom = {
    ...body,
    input: 'Synthetic patch',
    tools: [
      {
        type: 'custom',
        name: 'apply_patch',
        format: { type: 'grammar', definition: 'Synthetic grammar' },
      },
    ],
  }
  const args = JSON.stringify({ input: '*** Begin Patch\n*** End Patch' })
  const request = (async () =>
    sse([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_custom',
                  function: { name: toolAlias('apply_patch'), arguments: args },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      },
    ])) as typeof fetch
  const result = (await (
    await requestProvider(base, custom, request, signal())
  ).json()) as any
  expect(result.output[0]).toMatchObject({
    type: 'custom_tool_call',
    name: 'apply_patch',
    input: '*** Begin Patch\n*** End Patch',
    call_id: 'call_custom',
  })
  const continuation = nativeRequest(base, {
    ...custom,
    input: [
      ...result.output,
      {
        type: 'custom_tool_call_output',
        call_id: 'call_custom',
        output: 'Applied',
      },
    ],
  })
  expect(continuation.body.messages).toMatchObject([
    { role: 'assistant', tool_calls: [{ function: { arguments: args } }] },
    { role: 'tool', tool_call_id: 'call_custom', content: 'Applied' },
  ])
})

test('truncation and missing usage cannot be reported as completed', async () => {
  const incomplete = (async () =>
    sse([
      {
        choices: [{ delta: { content: 'partial' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      },
    ])) as typeof fetch
  const result = (await (
    await requestProvider(base, { input: 'Synthetic' }, incomplete, signal())
  ).json()) as any
  expect(result.status).toBe('incomplete')
  const missingUsage = (async () =>
    sse([
      { choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] },
    ])) as typeof fetch
  await expect(
    requestProvider(base, { input: 'Synthetic' }, missingUsage, signal()),
  ).rejects.toThrow('final token usage')
  const truncated = (async () =>
    sse([
      {
        choices: [{ delta: { content: 'partial' } }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      },
    ])) as typeof fetch
  await expect(
    requestProvider(base, { input: 'Synthetic' }, truncated, signal()),
  ).rejects.toThrow('terminal event')
})

test('stream failures use the terminal Response envelope recognized by native Bgs and redact arbitrary errors', async () => {
  for (const malformed of [false, true, 'timeout']) {
    const request = (async () => malformed
      ? new Response(new ReadableStream({ start(controller) {
          controller.error(Object.assign(Error('PRIVATE_UPSTREAM_SECRET'),
            malformed === 'timeout' ? { code: 'UND_ERR_BODY_TIMEOUT' } : {}))
        } }))
      : sse([{ choices: [{ delta: { content: 'partial' }, finish_reason: 'stop' }] }])) as typeof fetch
    const response = await requestProvider(base, { input: 'Synthetic', stream: true }, request, signal())
    const wire = await response.text()
    expect(wire).toContain('event: response.failed\n')
    expect(wire).not.toContain('event: response.completed\n')
    expect(wire).not.toContain('PRIVATE_UPSTREAM_SECRET')
    const terminal = JSON.parse(wire.trim().split('\ndata: ').at(-1)!)
    expect(terminal).toMatchObject({ type: 'response.failed', response: {
      status: 'failed', error: { code: 'provider_stream_failed', message: malformed === 'timeout'
        ? 'The provider transport failed (UND_ERR_BODY_TIMEOUT)' : malformed
        ? 'The provider response failed or was incomplete'
        : 'Provider did not report final token usage' },
    } })
  }
})

test('unknown-name diagnostics distinguish declared native names and stream duplication without exposing model text', async () => {
  for (const [name, classification] of [
    [toolAlias('probe', 'functions').repeat(2), 'repeated-name:probe'],
    ['PRIVATE_MODEL_OUTPUT', 'unmapped'],
  ]) {
    const request = (async () => sse([{
      choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name, arguments: '{}' } }] },
        finish_reason: 'tool_calls' }], usage: { prompt_tokens: 4, completion_tokens: 2 },
    }])) as typeof fetch
    const wire = await (await requestProvider(base, { ...body, stream: true }, request, signal())).text()
    expect(wire).toContain('bgs_provider_errors')
    expect(wire).toContain(classification!)
    expect(wire).not.toContain('PRIVATE_MODEL_OUTPUT')
    expect(wire).toContain('response.completed')
  }
})

test('unknown tools become native rejection calls; provider failures and unsupported capabilities fail without replay', async () => {
  let calls = 0
  const request = (async () => {
    calls++
    return sse([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call',
                  function: { name: 'unknown', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      },
    ])
  }) as typeof fetch
  const failures: { callId: string; diagnostic: string }[] = []
  const result = await (await requestProvider(base, { ...body, input: 'Synthetic' }, request, signal(), undefined,
    (callId, diagnostic) => { failures.push({ callId, diagnostic }) })).json() as any
  expect(result.output[0]).toMatchObject({ type: 'function_call', namespace: 'bgs_provider_errors', name: 'unknown_tool', call_id: 'call' })
  expect(JSON.parse(result.output[0].arguments).error).toContain('unknown tool name')
  const continuation = nativeRequest(base, { ...body, input: [...result.output,
    { type: 'function_call_output', call_id: 'call', output: 'unsupported function name' }] })
  expect(continuation.body.messages[0].tool_calls[0].function.name).toBe('unknown')
  expect(continuation.body).toMatchObject({ messages: [expect.anything(), { content: UNKNOWN_TOOL_FEEDBACK }] })
  expect(failures).toEqual([{ callId: 'call', diagnostic: expect.stringContaining(UNKNOWN_TOOL_FEEDBACK) }])
  expect(calls).toBe(1)
  await expect(
    requestProvider(
      base,
      { input: 'Synthetic' },
      (async () =>
        new Response('PRIVATE_UPSTREAM_SECRET', {
          status: 401,
        })) as typeof fetch,
      signal(),
    ),
  ).rejects.toThrow('401')
  expect(() =>
    nativeRequest(base, {
      input: 'Synthetic',
      tools: [{ type: 'web_search' }],
    }),
  ).toThrow('does not support')
  expect(() =>
    nativeRequest(base, {
      input: 'Synthetic',
      previous_response_id: 'lost-history',
    }),
  ).toThrow('full conversation')
})

test('the local bridge rejects browsers and missing credentials, and cancellation drains the provider request', async () => {
  let cancelled!: () => void
  const cancellation = new Promise<void>(resolve => {
    cancelled = resolve
  })
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(': fixture ready\n\n'))
          },
          cancel() {
            cancelled()
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    },
  })
  const bridge = await startProviderBridge(
    {
      BEEGAME_MODEL_TYPE: 'openai',
      BEEGAME_API_PROTOCOL: 'chat-completions',
      OPENAI_API_KEY: 'synthetic-only',
      OPENAI_BASE_URL: upstream.url.toString().replace(/\/$/, ''),
      BEEGAME_MODEL: 'fixture',
    },
    {
      onUsage() {},
      resolveOutboundTarget: async value => ({
        url: new URL(value),
        addresses: ['127.0.0.1'],
        lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4),
      }),
    },
  )
  try {
    expect(
      (
        await fetch(bridge!.baseUrl + '/responses', {
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await fetch(bridge!.baseUrl + '/responses', {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + bridge!.apiKey,
            Origin: 'https://example.invalid',
          },
          body: '{}',
        })
      ).status,
    ).toBe(404)
    const response = await fetch(bridge!.baseUrl + '/responses', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + bridge!.apiKey },
      body: JSON.stringify({
        input: 'Synthetic',
        model: 'fixture',
        stream: true,
      }),
    })
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel()
    await bridge!.close()
    await Promise.race([
      cancellation,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error('Provider was not cancelled')), 2000),
      ),
    ])
  } finally {
    await bridge?.close()
    upstream.stop(true)
  }
}, 10000)

test('runtime selection requires the selected credential and a matching wire protocol', () => {
  expect(providerConfig({ OPENAI_API_KEY: 'fixture' }).protocol).toBe(
    'responses',
  )
  expect(() =>
    providerConfig({
      BEEGAME_MODEL_TYPE: 'gemini',
      OPENAI_API_KEY: 'unrelated',
    }),
  ).toThrow('no API key')
  expect(() =>
    providerConfig({
      BEEGAME_MODEL_TYPE: 'gemini',
      BEEGAME_API_PROTOCOL: 'responses',
      GEMINI_API_KEY: 'fixture',
    }),
  ).toThrow('protocol')
  expect(
    providerConfig({
      BEEGAME_MODEL_TYPE: 'anthropic',
      ANTHROPIC_API_KEY: 'selected',
      ANTHROPIC_AUTH_TOKEN: 'unrelated',
    }),
  ).toMatchObject({
    apiKey: 'selected',
    auth: 'api-key',
    protocol: 'anthropic-messages',
  })
})

test('Go requests identify BGS and preserve one session id across calls and protocols', () => {
  for (const [protocol, baseUrl] of [
    ['chat-completions', 'https://opencode.ai/zen/go/v1'],
    ['anthropic-messages', 'https://opencode.ai/zen/go'],
  ] as const) {
    const config = {
      ...base,
      protocol,
      baseUrl,
      sessionId: 'synthetic-conversation',
    }
    const first = nativeRequest(config, {
      model: 'fixture',
      input: 'First turn',
    })
    const next = nativeRequest(config, { model: 'fixture', input: 'Next turn' })
    expect(first.headers['User-Agent']).toBe('bee-game-studio/2.8.4')
    expect(first.headers['X-Opencode-Session']).toBe('synthetic-conversation')
    expect(next.headers['X-Opencode-Session']).toBe(
      first.headers['X-Opencode-Session'],
    )
    expect(() =>
      nativeRequest(
        { ...config, sessionId: undefined },
        { model: 'fixture', input: 'Synthetic' },
      ),
    ).toThrow('stable model session')
  }
})


test.each(['chat-completions', 'anthropic-messages', 'gemini'] as const)('unknown tool feedback preserves call IDs and ordinary outputs: %s', protocol => {
  const input = [
    { type: 'function_call', namespace: 'bgs_provider_errors', name: 'unknown_tool', call_id: 'bad', arguments: '{}' },
    { type: 'function_call_output', call_id: 'bad', output: 'unsupported call: bgs_provider_errorsunknown_tool' },
    { type: 'function_call', name: 'probe', call_id: 'good', arguments: '{}' },
    { type: 'function_call_output', call_id: 'good', output: 'actual tool result' },
  ]
  const outputs = conversation({ input }, protocol).messages.filter(item => item.role === 'tool')
  expect(outputs).toEqual([
    { role: 'tool', id: 'bad', content: [{ type: 'text', text: UNKNOWN_TOOL_FEEDBACK }] },
    { role: 'tool', id: 'good', content: [{ type: 'text', text: 'actual tool result' }] },
  ])
  expect(conversation({ input: input.slice(0, 1) }, protocol).messages.some(item => item.role === 'tool')).toBe(false)
})
