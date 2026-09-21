import { expect, test } from 'bun:test'
import { createChatTextIdentity } from './chat-text-identity'
import { compactTranscriptForChatHistory } from '../app'
import type { BeeGameEvent } from './session-manager'

const event = (id: number, type: BeeGameEvent['type'], text: string, parent = ''): BeeGameEvent => ({
  id, type, text, sessionId: 'worker', turnId: 'turn', createdAt: new Date(id),
  payload: { type, event: { index: 1 }, parent_tool_use_id: parent },
})

test('legacy deltas and final receipts share one identity, without merging separate messages or children', () => {
  const input = [
    event(1, 'assistant.partial', 'Hello'),
    event(2, 'assistant.partial', 'Child', 'child'),
    event(3, 'assistant.partial', ' world'),
    { ...event(4, 'assistant.message', 'Hello world'), payload: { type: 'assistant', message: { id: 'native-1' } } },
    event(5, 'assistant.message', 'Child done', 'child'),
    event(6, 'assistant.partial', 'Next'),
    event(7, 'assistant.message', 'Next message'),
  ]
  const normalized = input.map(createChatTextIdentity())
  expect(normalized[0].payload?.assistantBlockId).toBe(normalized[3].payload?.assistantBlockId)
  expect(normalized[0].payload?.assistantBlockId).not.toBe(normalized[1].payload?.assistantBlockId)
  expect(normalized[0].payload?.assistantBlockId).not.toBe(normalized[5].payload?.assistantBlockId)
  expect(compactTranscriptForChatHistory(normalized).map(e => e.text)).toEqual(['Hello world', 'Child done', 'Next message'])
  // Loading the same journal after a restart must produce identical IDs.
  expect(input.map(createChatTextIdentity())).toEqual(normalized)
})

test('tool boundaries retain interrupted text; canonical IDs and content remain untouched', () => {
  const canonical = { ...event(5, 'assistant.partial', 'Native'), payload: { type: 'assistant.partial', assistantBlockId: 'native:0' } }
  const output = [event(1, 'assistant.partial', 'Unfinished'), event(2, 'tool.started', 'Run'),
    event(3, 'assistant.partial', 'After tool'), event(4, 'assistant.message', 'After tool.'), canonical,
  ].map(createChatTextIdentity())
  expect(compactTranscriptForChatHistory(output).map(e => e.text)).toEqual(['Unfinished', 'Run', 'After tool.', 'Native'])
  expect(output[4]).toBe(canonical)
})
