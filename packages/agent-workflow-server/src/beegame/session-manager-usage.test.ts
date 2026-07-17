import { describe, expect, test } from 'bun:test'
import {
  getLatestRuntimeUsage,
  sumAssistantMessageUsage,
  type BeeGameEvent,
} from './session-manager'

describe('BeeGame assistant usage aggregation', () => {
  test('counts streamed fragments of one assistant message once', () => {
    const events = [
      assistantUsageEvent(1, 'turn-1', 'message-1', 20_000, 3_001),
      assistantUsageEvent(2, 'turn-1', 'message-1', 20_000, 3_001),
      assistantUsageEvent(3, 'turn-1', 'message-1', 20_000, 3_001),
    ]

    expect(sumAssistantMessageUsage(events)).toEqual({
      prompt_tokens: 20_000,
      completion_tokens: 3_001,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_tokens: 23_001,
    })
  })

  test('counts distinct assistant messages independently', () => {
    const events = [
      assistantUsageEvent(1, 'turn-1', 'message-1', 10, 5),
      assistantUsageEvent(2, 'turn-1', 'message-2', 20, 7),
      assistantUsageEvent(3, 'turn-2', 'message-1', 30, 9),
    ]

    expect(sumAssistantMessageUsage(events)).toEqual({
      prompt_tokens: 60,
      completion_tokens: 21,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_tokens: 81,
    })
  })

  test('uses the latest cumulative SDK model usage snapshot without summing turns', () => {
    const events = [
      assistantUsageEvent(1, 'turn-1', 'visible-1', 10, 5),
      resultModelUsageEvent(2, 'turn-1', {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 300,
        cacheCreationInputTokens: 40,
      }),
      assistantUsageEvent(3, 'turn-2', 'visible-2', 12, 6),
      resultModelUsageEvent(4, 'turn-2', {
        inputTokens: 200,
        outputTokens: 30,
        cacheReadInputTokens: 400,
        cacheCreationInputTokens: 50,
      }),
    ]

    expect(getLatestRuntimeUsage(events)).toEqual({
      prompt_tokens: 200,
      completion_tokens: 30,
      cache_read_tokens: 400,
      cache_creation_tokens: 50,
      total_tokens: 680,
    })
  })

  test('does not add repeated cumulative snapshots from one native turn', () => {
    const events = [
      resultModelUsageEvent(1, 'turn-1', {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 300,
        cacheCreationInputTokens: 40,
      }),
      resultModelUsageEvent(2, 'turn-1', {
        inputTokens: 140,
        outputTokens: 35,
        cacheReadInputTokens: 500,
        cacheCreationInputTokens: 60,
      }),
    ]

    expect(getLatestRuntimeUsage(events)).toEqual({
      prompt_tokens: 140,
      completion_tokens: 35,
      cache_read_tokens: 500,
      cache_creation_tokens: 60,
      total_tokens: 735,
    })
  })
})

function assistantUsageEvent(
  id: number,
  turnId: string,
  messageId: string,
  inputTokens: number,
  outputTokens: number,
): BeeGameEvent {
  return {
    id,
    sessionId: 'session-1',
    turnId,
    type: 'assistant.message',
    text: 'fragment',
    payload: {
      type: 'assistant',
      message: {
        id: messageId,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
      },
    },
    createdAt: new Date(0),
  } as BeeGameEvent
}

function resultModelUsageEvent(
  id: number,
  turnId: string,
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
  },
): BeeGameEvent {
  return {
    id,
    sessionId: 'session-1',
    turnId,
    type: 'result',
    text: 'done',
    payload: {
      type: 'result',
      modelUsage: {
        model: usage,
      },
    },
    createdAt: new Date(0),
  } as BeeGameEvent
}
