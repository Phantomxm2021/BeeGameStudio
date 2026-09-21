import { describe, expect, test } from 'bun:test'
import { compactTranscriptForChatHistory, findTodoWriteEvents } from '../app'
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
  test('stage thinking and tool receipts keep native ownership across live mirroring and disk recovery', () => {
    const events = [
      thinkingEvent(1, 'Thinking', 'started', '2026-09-17T00:00:00.000Z'),
      thinkingEvent(2, 'First', 'streaming', '2026-09-17T00:00:02.000Z'),
      thinkingEvent(3, 'First and second', 'streaming', '2026-09-17T00:00:04.000Z'),
      thinkingEvent(4, 'Thinking', 'ended', '2026-09-17T00:00:07.000Z'),
    ].map((event, i) => ({ ...event,
      sessionId: i % 2 ? 'workflow-stage:author' : 'main',
      payload: { ...event.payload!, workflowStageStreamId: 'workflow-stage:author:query-1',
        projectSourceSessionId: i % 2 ? 'workflow-stage:author' : 'main', contentMode: 'snapshot' },
    }))
    const compact = compactTranscriptForChatHistory(events)
    expect(compact).toHaveLength(1)
    expect(compact[0]).toMatchObject({ text: 'First and second',
      createdAt: new Date('2026-09-17T00:00:07.000Z'), payload: { status: 'ended', sourceSequence: 1 } })
    const child = events.map(e => ({ ...e, payload: { ...e.payload, parentToolUseID: 'child' } }))
    expect(compactTranscriptForChatHistory([...events, ...child])).toHaveLength(2)
  })
  test('returns Todo snapshots across all stages instead of just the last one', () => {
    const todos: BeeGameEvent[] = ['author', 'resources', 'content'].map((stage, id) => ({
      id, sessionId: stage, type: 'tool.completed', text: 'TodoWrite', createdAt: new Date(id),
      payload: { type: 'tool.completed', toolName: 'TodoWrite',
        input: { todos: [{ content: 'Review', status: 'completed' }] } },
    }))
    expect(findTodoWriteEvents(todos)).toEqual(todos)
    expect(findTodoWriteEvents([{ ...todos[0]!, payload: { type: 'tool.completed', toolName: 'Read' } }])).toEqual([])
  })
  test('interleaved agents keep independent thought contents and terminal boundaries', () => {
    const events = [
      thinkingEvent(1, 'Parent', 'started', '2026-09-17T00:00:00.000Z'),
      { ...thinkingEvent(2, 'Child', 'started', '2026-09-17T00:00:00.500Z'), sessionId: 'child' },
      thinkingEvent(3, 'Thinking', 'ended', '2026-09-17T00:00:02.000Z'),
      { ...thinkingEvent(4, 'Thinking', 'ended', '2026-09-17T00:00:03.000Z'), sessionId: 'child' },
    ]
    expect(compactTranscriptForChatHistory(events).map(e => [e.sessionId, e.text, e.payload?.status])).toEqual([
      ['session-1', 'Parent', 'ended'], ['child', 'Child', 'ended'],
    ])
  })

  test('retains interrupted prose and complete tool results instead of truncating storage', () => {
    const base = { sessionId: 's', createdAt: new Date() }
    const output = 'x'.repeat(9000)
    const result = compactTranscriptForChatHistory([
      { ...base, id: 1, type: 'assistant.partial', text: 'already generated', payload: { type: 'assistant.partial', messageId: 'm' } },
      { ...base, id: 2, type: 'tool.completed', text: 'finished', payload: { type: 'tool.completed', toolUseID: 't', output, input: { nested: { body: output } } } },
      { ...base, id: 3, type: 'turn.failed', text: 'interrupted' },
    ] as BeeGameEvent[])
    expect(result[0].text).toBe('already generated')
    expect(result[1].payload?.output).toBe(output)
    expect(result[1].payload?.input).toEqual({ nested: { body: output } })
  })
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
