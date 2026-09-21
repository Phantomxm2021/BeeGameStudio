import { expect, test } from 'bun:test'
import { createStageChatProjector, type StageChatEvent } from './stage-chat-events'
import { stageChatMessageFromTrace } from './session-manager'

test('projects distinct thinking lifecycles with source timing, not the log polling clock', async () => {
  const events: StageChatEvent[] = []
  const project = createStageChatProjector({ stage: 'author', sink: event => { events.push(event) } })
  const send = async (event: string, data: Record<string, unknown>) => {
    const message = stageChatMessageFromTrace({ event, at: '2026-09-20T00:00:10Z', data: { queryId: 'q', agentId: 'root', messageId: 'm', ...data } })
    if (message) await project(message)
  }
  for (const index of [0, 1]) {
    await send('response.content_start', { index, type: 'thinking', occurredAt: '2026-09-20T00:00:00.000Z' })
    await send('response.content_snapshot', { index, type: 'thinking', content: 'Thought ' + index, receivedBytes: 9 })
    await send('response.content_end', { index, occurredAt: '2026-09-20T00:00:02.130Z' })
  }
  const ended = events.filter(e => e.payload?.status === 'ended')
  expect(ended).toHaveLength(2)
  expect(ended[0].payload?.thinkingBlockId).not.toBe(ended[1].payload?.thinkingBlockId)
  expect(ended[0].payload).toMatchObject({ thinkingStartedAt: '2026-09-20T00:00:00.000Z', occurredAt: '2026-09-20T00:00:02.130Z' })
})

test('cumulative text is scoped by message and ignores checkpoints after its terminal snapshot', async () => {
  const events: StageChatEvent[] = []
  const project = createStageChatProjector({ stage: 'content', sink: event => { events.push(event) } })
  for (const [messageId, content] of [['a', 'Long first message'], ['b', 'Short']]) {
    const checkpoint = stageChatMessageFromTrace({ event: 'response.content_snapshot', data: {
      queryId: 'q', agentId: 'root', messageId, index: 0, type: 'text', content, receivedBytes: content.length,
    } })!
    await project(checkpoint)
    await project({ queryId: 'q', type: 'assistant', message: { id: messageId, content: [{ type: 'text', text: content }] } })
    await project(checkpoint)
  }
  expect(events.map(e => e.text)).toEqual(['Long first message', 'Long first message', 'Short', 'Short'])
  expect(events[0].payload?.assistantBlockId).not.toBe(events[2].payload?.assistantBlockId)
  expect(events[0].payload?.assistantBlockId).toBe(events[1].payload?.assistantBlockId)
})
