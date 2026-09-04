import { describe, expect, test } from 'bun:test'
import { documentAuthoringMetrics } from './document-authoring-metrics'
import type { BeeGameEvent } from './session-manager'

function event(
  id: number,
  type: BeeGameEvent['type'],
  payload?: Record<string, unknown>,
): BeeGameEvent {
  return {
    id,
    sessionId: 'session',
    turnId: 'turn',
    type,
    text: type,
    ...(payload ? { payload: { type, ...payload } } : {}),
    createdAt: new Date(0),
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
})
