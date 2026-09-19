import { describe, expect, test } from 'bun:test'
import { compactTranscriptForChatHistory } from '../app'
import type { BeeGameEvent } from '../beegame/session-manager'

const thinkingEvent = (
  id: number,
  text: string,
  status: 'started' | 'streaming' | 'ended',
  createdAt: string,
  blockId = 'think-1',
): BeeGameEvent => ({
  id,
  sessionId: 'session-1',
  type: 'assistant.thinking',
  text,
  createdAt: new Date(createdAt),
  payload: {
    type: 'assistant.thinking',
    status,
    thinkingBlockId: blockId,
    thinkingStartedAt: '2026-09-17T00:00:00.000Z',
  },
})

describe('chat transcript compaction', () => {
  test('retains native task lifecycle and progress but not unrelated system chatter', () => {
    const events: BeeGameEvent[] = ['task_started', 'task_progress', 'task_notification', 'init'].map((subtype, id) => ({
      id, type: 'system.status', text: 'system', sessionId: 'worker-1', createdAt: new Date(),
      payload: { type: 'system', subtype, task_id: 'task-1', tool_use_id: 'agent-1' },
    }))
    expect(compactTranscriptForChatHistory(events).map(event => event.payload?.subtype))
      .toEqual(['task_started', 'task_progress', 'task_notification'])
  })
  test('preserves one completed Thinking lifecycle with its full duration', () => {
    const compacted = compactTranscriptForChatHistory([
      thinkingEvent(1, 'Checking', 'started', '2026-09-17T00:00:00.000Z'),
      thinkingEvent(2, ' files', 'streaming', '2026-09-17T00:00:04.000Z'),
      thinkingEvent(3, 'Thinking', 'ended', '2026-09-17T00:00:09.000Z'),
    ])

    expect(compacted).toHaveLength(1)
    expect(compacted[0]).toMatchObject({
      id: 3,
      text: 'Checking files',
      createdAt: new Date('2026-09-17T00:00:09.000Z'),
      payload: {
        status: 'ended',
        thinkingBlockId: 'think-1',
        thinkingStartedAt: '2026-09-17T00:00:00.000Z',
      },
    })
  })

  test('does not merge adjacent Thinking blocks with different identities', () => {
    const compacted = compactTranscriptForChatHistory([
      thinkingEvent(1, 'First', 'started', '2026-09-17T00:00:00.000Z', 'think-1'),
      thinkingEvent(2, 'Second', 'started', '2026-09-17T00:00:01.000Z', 'think-2'),
      thinkingEvent(3, 'Thinking', 'ended', '2026-09-17T00:00:02.000Z', 'think-2'),
    ])

    expect(compacted.map(event => ({ text: event.text, block: event.payload?.thinkingBlockId }))).toEqual([
      { text: 'First', block: 'think-1' },
      { text: 'Second', block: 'think-2' },
    ])
  })
})
