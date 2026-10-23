import { describe, expect, test } from 'bun:test'
import { compactTranscriptForChatHistory, findTodoWriteEvents, paginateTranscriptEvents } from '../app'
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
  test('pages by full event time even when project-journal append IDs differ', () => {
    const events = [
      { id: 1, createdAt: new Date('2026-09-24T17:59:00Z') },
      { id: 2, createdAt: new Date('2026-09-23T17:42:00Z') },
      { id: 3, createdAt: new Date('2026-09-24T17:59:00Z') },
      { id: 4, createdAt: new Date('2026-09-22T17:00:00Z') },
    ]
    const latest = paginateTranscriptEvents(events, { limit: 2 })
    expect(latest.events.map(event => event.id)).toEqual([1, 3])
    expect(latest.page.nextBeforeId).toBe(1)
    expect(paginateTranscriptEvents(events, { limit: 2, beforeId: 1 }).events.map(event => event.id))
      .toEqual([4, 2])
  })
  test('native thinking snapshots keep their block identity and child scope', () => {
    const events = [
      thinkingEvent(1, 'Thinking', 'started', '2026-09-17T00:00:00.000Z'),
      thinkingEvent(2, 'First', 'streaming', '2026-09-17T00:00:02.000Z'),
      thinkingEvent(3, 'First and second', 'streaming', '2026-09-17T00:00:04.000Z'),
      thinkingEvent(4, 'Thinking', 'ended', '2026-09-17T00:00:07.000Z'),
    ].map(event => ({ ...event,
      payload: { ...event.payload!, contentMode: 'snapshot' },
    }))
    const compact = compactTranscriptForChatHistory(events)
    expect(compact).toHaveLength(1)
    expect(compact[0]).toMatchObject({ text: 'First and second',
      createdAt: new Date('2026-09-17T00:00:07.000Z'), payload: { status: 'ended', sourceSequence: 1 } })
    const child = events.map(e => ({ ...e, payload: { ...e.payload, parentToolUseID: 'child' } }))
    expect(compactTranscriptForChatHistory([...events, ...child])).toHaveLength(2)
  })
  test('returns Todo snapshots across all sessions instead of just the last one', () => {
    const todos: BeeGameEvent[] = ['session-a', 'session-b', 'session-c'].map((sessionId, id) => ({
      id, sessionId, type: 'tool.completed', text: 'TodoWrite', createdAt: new Date(id),
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
  test('retains native context compaction boundaries in Chat history', () => {
    const base = { sessionId: 'session-1', turnId: 'turn-1', type: 'system.status' as const,
      createdAt: new Date('2026-09-24T05:11:04Z') }
    const events: BeeGameEvent[] = [
      { ...base, id: 1, text: 'compacting', payload: { type: 'system', subtype: 'status', status: 'compacting' } },
      { ...base, id: 2, text: 'system', payload: { type: 'system', subtype: 'compact_boundary',
        compact_metadata: { trigger: 'auto', pre_tokens: 167212 } } },
    ] as BeeGameEvent[]
    expect(compactTranscriptForChatHistory(events).map(event => event.id)).toEqual([1, 2])
  })
  test('retains delivery milestones and handoff errors after a completed turn', () => {
    const base = { sessionId: 's', turnId: 'turn', createdAt: new Date() }
    const events: BeeGameEvent[] = [
      { ...base, id: 1, type: 'turn.completed', text: 'Done' },
      { ...base, id: 2, type: 'system.status', text: 'acceptance',
        payload: { type: 'system.status', subtype: 'delivery_phase', phase: 'acceptance' } },
      { ...base, id: 3, type: 'system.status', text: 'Delivery could not continue: fixture failure',
        payload: { type: 'system.status', subtype: 'delivery_error' } },
    ]
    expect(compactTranscriptForChatHistory(events)).toMatchObject(events)
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
