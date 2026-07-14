import { describe, expect, test } from 'bun:test'
import {
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
      total_tokens: 81,
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
