import { describe, expect, test } from 'bun:test'
import {
  adaptResponsesStreamToAnthropic,
  buildResponsesRequest,
  extractUsage,
  parseSSE,
} from '../responsesAdapter.js'
import { formatOpenAIPromptCacheKey } from '../openaiShared.js'
import { calculateCacheHitRate } from '../../../../utils/cacheWarning.js'
import { anthropicMessagesToOpenAI } from '@ant/model-provider'
import { asSystemPrompt } from '@ant/model-provider/types'

describe('Responses SSE framing and cleanup', () => {
  async function collect(response: Response) {
    const events = []
    for await (const event of parseSSE(response)) events.push(event)
    return events
  }

  test.each(['\n\n', '\r\n\r\n', '\r\n\n', '\n\r\n'])(
    'parses complete frames across byte boundaries: %j',
    async delimiter => {
      const expected = { type: 'response.output_text.delta', delta: '中文' }
      const bytes = new TextEncoder().encode(
        ': heartbeat' +
          delimiter +
          'data: ' +
          JSON.stringify(expected) +
          delimiter +
          'data: [DONE]' +
          delimiter,
      )
      let offset = 0
      const response = new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (offset === bytes.length) controller.close()
            else controller.enqueue(bytes.slice(offset, ++offset))
          },
        }),
      )
      expect(await collect(response)).toEqual([expected])
      expect(response.body!.locked).toBe(false)
    },
  )

  test('supports multiline data and does not invent a frame at EOF', async () => {
    const response = new Response(
      'data: {"type":\r\ndata: "response.completed"}\r\n\r\ndata: {"type":"unfinished"}',
    )
    expect(await collect(response)).toEqual([{ type: 'response.completed' }])
    expect(response.body!.locked).toBe(false)
  })

  test.each([
    'early-return',
    'invalid-json',
    'provider-failure',
    'cleanup-failure',
  ])('cancels the source and releases its lock on %s', async mode => {
    let cancelled = false
    const payload =
      mode === 'invalid-json'
        ? '{broken'
        : JSON.stringify({
            type: 'response.failed',
            response: { error: { message: 'provider failure' } },
          })
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: ' + payload + '\n\n'),
          )
          // Keep the source open: consumer termination must actively cancel it.
        },
        cancel() {
          cancelled = true
          if (mode === 'cleanup-failure') throw new Error('cleanup failure')
        },
      }),
    )
    if (mode === 'early-return') {
      for await (const _event of parseSSE(response)) break
    } else if (mode === 'invalid-json') {
      await expect(collect(response)).rejects.toThrow()
    } else {
      const consume = async () => {
        for await (const _event of adaptResponsesStreamToAnthropic(
          parseSSE(response),
          'test',
        )) {
        }
      }
      await expect(consume()).rejects.toThrow('provider failure')
    }
    expect(cancelled).toBe(true)
    expect(response.body!.locked).toBe(false)
  })
})

describe('Responses stream termination', () => {
  async function collect(events: Record<string, unknown>[]) {
    async function* stream() {
      yield* events
    }
    const result = []
    for await (const event of adaptResponsesStreamToAnthropic(stream(), 'test'))
      result.push(event)
    return result
  }

  test('closes every parallel tool block and reports tool_use at completion', async () => {
    const events = await collect([
      { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'one', name: 'noop', arguments: '' } },
      { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', call_id: 'two', name: 'noop', arguments: '' } },
      { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"b":2}' },
      { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"a":1}' },
      { type: 'response.completed', response: { status: 'completed' } },
    ])
    const tools = events.filter((e: any) => e.type === 'content_block_start' && e.content_block.type === 'tool_use') as any[]
    expect(tools).toHaveLength(2)
    for (const tool of tools) expect(events.filter((e: any) => e.type === 'content_block_stop' && e.index === tool.index)).toHaveLength(1)
    expect(events.find((e: any) => e.type === 'message_delta')).toMatchObject({ delta: { stop_reason: 'tool_use' } })
  })

  test('preserves canonical arguments when they arrive on item completion', async () => {
    const events = await collect([
      { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'one', name: 'noop', arguments: '' } },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', call_id: 'one', name: 'noop', arguments: '{"a":1}' } },
      { type: 'response.completed', response: { status: 'completed' } },
    ])
    expect(events.filter((e: any) => e.delta?.type === 'input_json_delta').map((e: any) => e.delta.partial_json).join('')).toBe('{"a":1}')
  })

  test('stops consuming after completion instead of accepting a second response', async () => {
    const events = await collect([
      { type: 'response.output_text.delta', delta: 'one' },
      { type: 'response.completed', response: { status: 'completed' } },
      { type: 'response.output_text.delta', delta: 'two' },
      { type: 'response.completed', response: { status: 'completed' } },
    ])
    expect(events.filter(e => e.type === 'message_stop')).toHaveLength(1)
    expect(events.filter((e: any) => e.delta?.type === 'text_delta').map((e: any) => e.delta.text).join('')).toBe('one')
  })

  test('preserves the actual Responses error event instead of treating it as EOF', async () => {
    await expect(collect([{ type: 'error', code: 'server_error', message: 'upstream failed' }])).rejects.toThrow('upstream failed')
  })

  test('preserves refusal and reasoning summary events', async () => {
    const events = await collect([
      { type: 'response.reasoning_summary_text.delta', delta: 'Summary' },
      { type: 'response.refusal.delta', delta: 'Cannot fulfill this request.' },
      { type: 'response.completed', response: { status: 'completed' } },
    ])
    expect(events.filter((e: any) => e.delta?.type === 'thinking_delta').map((e: any) => e.delta.thinking).join('')).toBe('Summary')
    expect(events.filter((e: any) => e.delta?.type === 'text_delta').map((e: any) => e.delta.text).join('')).toBe('Cannot fulfill this request.')
  })

  test('invalid SSE errors do not retain the response payload', async () => {
    const consume = async () => {
      for await (const _event of parseSSE(new Response('data: PRIVATE_INVALID_JSON\n\n'))) { /* consume */ }
    }
    await expect(consume()).rejects.toThrow('invalid JSON event')
    try { await consume() } catch (error) { expect(String(error)).not.toContain('PRIVATE') }
  })

  test('does not label content-filter incompleteness as a token limit', async () => {
    const events = await collect([{ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'content_filter' } } }])
    expect(events.find((e: any) => e.type === 'message_delta')).toMatchObject({ delta: { stop_reason: 'content_filter' } })
  })

  test('does not silently discard tool arguments with no matching tool block', async () => {
    await expect(collect([
      { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"a":1}' },
      { type: 'response.completed', response: { status: 'completed' } },
    ])).rejects.toThrow('tool')
  })

  test('rejects empty and partial streams', async () => {
    await expect(collect([])).rejects.toThrow('terminal response event')
    await expect(
      collect([{ type: 'response.output_text.delta', delta: 'partial' }]),
    ).rejects.toThrow('terminal response event')
  })

  test.each(['response.completed', 'response.incomplete'])(
    'accepts the explicit terminal event %s',
    async type => {
      const events = await collect([
        { type, response: { status: type.split('.')[1] } },
      ])
      expect(events.at(-1)?.type).toBe('message_stop')
    },
  )

  test('preserves explicit API failures', async () => {
    await expect(
      collect([
        {
          type: 'response.failed',
          response: { error: { message: 'provider failure' } },
        },
      ]),
    ).rejects.toThrow('provider failure')
  })
})

describe('buildResponsesRequest', () => {
  test('tool-result screenshots survive the full conversion into Responses input', () => {
    const messages = anthropicMessagesToOpenAI(
      [
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'read-image', name: 'Read', input: {} },
            ],
          },
        },
        {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'read-image',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: 'image/png',
                      data: 'SCREENSHOT',
                    },
                  },
                ],
              },
            ],
          },
        },
      ] as any,
      asSystemPrompt([]),
    )
    const request = buildResponsesRequest({
      model: 'test',
      messages,
      tools: [],
      toolChoice: undefined,
      promptCacheKey: 'test',
    })
    expect(request.input[1]).toMatchObject({
      type: 'function_call_output',
      call_id: 'read-image',
    })
    expect(request.input[2]).toEqual({
      role: 'user',
      content: [
        { type: 'input_text', text: 'Images from tool result read-image:' },
        { type: 'input_image', image_url: 'data:image/png;base64,SCREENSHOT' },
      ],
    })
  })

  const promptCacheKey = formatOpenAIPromptCacheKey('session-abc-123')

  test('includes max reasoning effort for ChatGPT Responses requests', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      reasoningEffort: 'max',
      promptCacheKey,
    })

    expect(request.reasoning).toEqual({ effort: 'max' })
  })

  test('includes reasoning effort for ChatGPT Responses requests', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      reasoningEffort: 'xhigh',
      promptCacheKey,
    })

    expect(request.reasoning).toEqual({ effort: 'xhigh' })
  })

  test('does not include unsupported max_output_tokens parameter', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      promptCacheKey,
    }) as Record<string, unknown>

    expect('max_output_tokens' in request).toBe(false)
  })

  test('includes stable prompt_cache_key for session-sticky cache routing', () => {
    const request = buildResponsesRequest({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      promptCacheKey,
    })

    expect(request.prompt_cache_key).toBe('bgs:session-abc-123')
  })

  test('prompt_cache_key is stable across turns (not derived from messages)', () => {
    const key = formatOpenAIPromptCacheKey('same-session')
    const turn1 = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'first' }],
      tools: [],
      toolChoice: undefined,
      promptCacheKey: key,
    })
    const turn2 = buildResponsesRequest({
      model: 'gpt-5.5',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'second' },
      ],
      tools: [],
      toolChoice: undefined,
      promptCacheKey: key,
    })

    expect(turn1.prompt_cache_key).toBe(turn2.prompt_cache_key)
    expect(turn1.prompt_cache_key).toBe('bgs:same-session')
  })
})

describe('extractUsage (OpenAI Responses → Anthropic usage)', () => {
  test('subtracts cached_tokens so hit rate uses OpenAI total as denominator', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 30_000,
        output_tokens: 100,
        input_tokens_details: { cached_tokens: 20_000 },
      },
    })

    expect(usage).toEqual({
      input_tokens: 10_000,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 20_000,
    })

    // Was 40% under the double-count bug; correct is 66.7%.
    const hitRate = calculateCacheHitRate(usage)
    expect(hitRate).toBeCloseTo((20_000 / 30_000) * 100, 5)
  })

  test('full cache hit can report 100% (not capped at 50%)', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 30_000,
        output_tokens: 50,
        input_tokens_details: { cached_tokens: 30_000 },
      },
    })

    expect(usage.input_tokens).toBe(0)
    expect(usage.cache_read_input_tokens).toBe(30_000)
    expect(calculateCacheHitRate(usage)).toBe(100)
  })

  test('maps cache_write_tokens to cache_creation without double-counting total', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 10_000,
        output_tokens: 10,
        input_tokens_details: {
          cached_tokens: 6_000,
          cache_write_tokens: 2_000,
        },
      },
    })

    expect(usage).toEqual({
      input_tokens: 2_000,
      output_tokens: 10,
      cache_creation_input_tokens: 2_000,
      cache_read_input_tokens: 6_000,
    })
    // segments sum to OpenAI total
    expect(
      usage.input_tokens +
        usage.cache_creation_input_tokens +
        usage.cache_read_input_tokens,
    ).toBe(10_000)
    expect(calculateCacheHitRate(usage)).toBeCloseTo(60, 5)
  })

  test('clamps overlapping write/read that exceed total input', () => {
    const usage = extractUsage({
      usage: {
        input_tokens: 5_000,
        output_tokens: 0,
        input_tokens_details: {
          cached_tokens: 4_000,
          cache_write_tokens: 4_000,
        },
      },
    })

    expect(
      usage.input_tokens +
        usage.cache_creation_input_tokens +
        usage.cache_read_input_tokens,
    ).toBe(5_000)
    expect(usage.cache_read_input_tokens).toBe(4_000)
    expect(usage.cache_creation_input_tokens).toBe(1_000)
    expect(usage.input_tokens).toBe(0)
  })
})
