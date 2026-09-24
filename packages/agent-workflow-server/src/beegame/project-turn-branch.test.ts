import { expect, test } from 'bun:test'
import { liveProjectConversationEvents, type BeeGameEvent } from './session-manager'

test('editing a user message removes its completed turn and later delivery activity from the live branch', () => {
  const event = (id: number, type: BeeGameEvent['type'], turnId?: string,
    payload?: BeeGameEvent['payload']): BeeGameEvent => ({ id, sessionId: 'session', type,
      text: String(id), ...(turnId ? { turnId } : {}), ...(payload ? { payload } : {}), createdAt: new Date() })
  const events = [
    event(1, 'turn.started', 'first'), event(2, 'user.message', 'first', { type: 'user.message', clientMessageId: 'first-user' }),
    event(3, 'assistant.message', 'first'), event(4, 'turn.completed', 'first'),
    event(5, 'turn.started', 'second'), event(6, 'user.message', 'second', { type: 'user.message', clientMessageId: 'second-user' }),
    event(7, 'assistant.message', 'second'), event(8, 'turn.completed', 'second'),
    event(9, 'system.status', 'stage'), event(10, 'turn.started', 'replacement'),
    event(11, 'user.message', 'replacement', { type: 'user.message', clientMessageId: 'replacement-user', supersedesMessageId: 'second-user' }),
    event(12, 'assistant.message', 'replacement'),
  ]
  expect(liveProjectConversationEvents(events).map(item => item.id)).toEqual([1, 2, 3, 4, 10, 11, 12])
  expect(events).toHaveLength(12) // immutable audit history is preserved
})
