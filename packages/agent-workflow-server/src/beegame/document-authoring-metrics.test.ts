import { describe, expect, test } from 'bun:test'
import {
  documentAuthoringMetrics,
  documentAuthoringResponseMetrics,
} from './document-authoring-metrics'
import type { BeeGameEvent } from './session-manager'

function event(
  id: number,
  type: BeeGameEvent['type'],
  payload?: Record<string, unknown>,
  createdAt = new Date(0),
): BeeGameEvent {
  return {
    id,
    sessionId: 'session',
    turnId: 'turn',
    type,
    text: type,
    ...(payload ? { payload: { type, ...payload } } : {}),
    createdAt,
  }
}

describe('document authoring metrics', () => {
  test('aggregates terminal usage and observed native tool activity', () => {
    const events = [
      ...['Write', 'Write', 'Write', 'Write', 'Read', 'Edit'].flatMap(
        (toolName, index) => [
          event(index * 2 + 1, 'tool.started', {
            toolName,
            toolUseID: `tool-${index}`,
          }),
          event(index * 2 + 2, 'tool.completed', {
            toolName,
            toolUseID: `tool-${index}`,
          }),
        ],
      ),
      event(20, 'tool.failed', {
        toolName: 'Read',
        toolUseID: 'failed-read',
      }),
      event(21, 'permission.resolved', { decision: 'deny' }),
      event(22, 'result', {
        num_turns: 7,
        usage: {
          input_tokens: 50_957,
          cache_read_input_tokens: 169_721,
          cache_creation_input_tokens: 0,
          output_tokens: 19_500,
        },
        permission_denials: ['Write'],
      }),
    ]

    expect(
      documentAuthoringMetrics(events, {
        byteLength: 2_048,
        rangeCount: 7,
        projectedLineCount: 196,
      }),
    ).toEqual({
      usageStatus: 'measured',
      inputTokens: 50_957,
      cacheReadTokens: 169_721,
      cacheCreationTokens: 0,
      outputTokens: 19_500,
      rawProcessedTokens: 240_178,
      nativeTurns: 7,
      toolCalls: { Write: 4, Read: 1, Edit: 1 },
      failedToolCalls: 1,
      permissionDenials: 1,
      authorityProjection: {
        byteLength: 2_048,
        rangeCount: 7,
        projectedLineCount: 196,
      },
    })
  })

  test('does not invent usage before a terminal result exists', () => {
    expect(
      documentAuthoringMetrics([
        event(1, 'tool.completed', { toolName: 'Write', toolUseID: 'tool' }),
      ]),
    ).toBeUndefined()
  })

  test('marks an all-zero provider terminal as unavailable instead of measured free usage', () => {
    expect(documentAuthoringMetrics([
      event(1, 'result', {
        usage: {
          input_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens: 0,
        },
      }),
    ])?.usageStatus).toBe('unavailable')
  })

  test('replays native responses without double-counting mirrored assistant/result records', () => {
    const stream = (
      id: number,
      at: number,
      inner: Record<string, unknown>,
    ) => ({
      message: { type: 'stream_event', event: inner, uuid: `uuid-${id}` },
      createdAt: new Date(at).toISOString(),
    })
    const events = [
      stream(1, 100, {
        type: 'message_start',
        message: { id: 'response-1', usage: { input_tokens: 0, output_tokens: 0 } },
      }),
      stream(2, 105, {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      }),
      stream(3, 110, {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'plan' },
      }),
      stream(4, 125, {
        type: 'message_delta',
        delta: { stop_reason: 'max_tokens' },
        usage: { input_tokens: 32000, output_tokens: 32000, cache_read_input_tokens: 8500 },
      }),
      stream(5, 126, { type: 'message_stop' }),
      stream(6, 200, {
        type: 'message_start',
        message: { id: 'response-2', usage: { input_tokens: 0, output_tokens: 0 } },
      }),
      stream(7, 210, {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      stream(8, 215, {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '世界' },
      }),
      // The raw log can be replayed with the same transport UUID; it must not
      // inflate visible bytes or first-text timing.
      stream(8, 216, {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '世界' },
      }),
      stream(9, 220, {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 32067, output_tokens: 4581, cache_read_input_tokens: 43259 },
      }),
      stream(10, 221, { type: 'message_stop' }),
      {
        message: {
          type: 'assistant',
          message: {
            id: 'response-2',
            content: [{ type: 'text', text: '世界' }],
            stop_reason: null,
          },
        },
        createdAt: new Date(222).toISOString(),
      },
      {
        message: {
          type: 'result',
          stop_reason: 'end_turn',
          result: '世界',
          usage: {
            input_tokens: 64067,
            cache_read_input_tokens: 51759,
            cache_creation_input_tokens: 0,
            output_tokens: 36581,
          },
        },
        createdAt: new Date(230).toISOString(),
      },
    ]

    expect(documentAuthoringResponseMetrics(events)).toEqual({
      usageSemantics: 'terminal_result_cumulative',
      terminalUsage: {
        usageStatus: 'measured',
        usageSemantics: 'terminal_result_cumulative',
        inputTokens: 64067,
        cacheReadTokens: 51759,
        cacheCreationTokens: 0,
        outputTokens: 36581,
        rawProcessedTokens: 152407,
      },
      nativeTruncationCount: 1,
      nativeContinuationCount: 1,
      responses: [
        {
          responseIndex: 0,
          messageId: 'response-1',
          stopReason: 'max_tokens',
          textBytes: 0,
          thinkingBytes: 4,
          durationMs: 26,
          truncatedByMaxTokens: true,
          continuationFollowed: true,
          usage: {
            usageStatus: 'measured',
            usageSemantics: 'response_snapshot',
            inputTokens: 32000,
            cacheReadTokens: 8500,
            outputTokens: 32000,
            rawProcessedTokens: 72500,
          },
        },
        {
          responseIndex: 1,
          messageId: 'response-2',
          stopReason: 'end_turn',
          textBytes: 6,
          thinkingBytes: 0,
          firstTextMs: 15,
          durationMs: 21,
          truncatedByMaxTokens: false,
          continuationFollowed: false,
          usage: {
            usageStatus: 'measured',
            usageSemantics: 'response_snapshot',
            inputTokens: 32067,
            cacheReadTokens: 43259,
            outputTokens: 4581,
            rawProcessedTokens: 79907,
          },
        },
      ],
    })
  })

  test('reports terminal-only replay as cumulative and keeps response text bounded', () => {
    const metrics = documentAuthoringResponseMetrics([
      {
        message: {
          type: 'result',
          stop_reason: 'end_turn',
          result: '你好',
          usage: { input_tokens: 8, output_tokens: 2 },
        },
        createdAt: new Date(10).toISOString(),
      },
    ])
    expect(metrics).toEqual({
      usageSemantics: 'terminal_result_cumulative',
      nativeTruncationCount: 0,
      nativeContinuationCount: 0,
      terminalUsage: {
        usageStatus: 'measured',
        usageSemantics: 'terminal_result_cumulative',
        inputTokens: 8,
        outputTokens: 2,
        rawProcessedTokens: 10,
      },
      responses: [],
    })
  })

  test('does not invent per-response usage when the stream omits usage fields', () => {
    const records = [
      {
        message: {
          type: 'stream_event',
          uuid: 'missing-usage-start',
          event: { type: 'message_start', message: { id: 'response' } },
        },
        createdAt: new Date(0).toISOString(),
      },
      {
        message: {
          type: 'stream_event',
          uuid: 'missing-usage-text',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'x' },
          },
        },
        createdAt: new Date(1).toISOString(),
      },
      {
        message: {
          type: 'stream_event',
          uuid: 'missing-usage-stop',
          event: {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
          },
        },
        createdAt: new Date(2).toISOString(),
      },
    ]
    expect(documentAuthoringResponseMetrics(records)).toEqual({
      responses: [
        {
          responseIndex: 0,
          messageId: 'response',
          stopReason: 'end_turn',
          textBytes: 1,
          thinkingBytes: 0,
          firstTextMs: 1,
          truncatedByMaxTokens: false,
          continuationFollowed: false,
        },
      ],
      usageSemantics: 'unavailable',
      nativeTruncationCount: 0,
      nativeContinuationCount: 0,
    })
  })
})
