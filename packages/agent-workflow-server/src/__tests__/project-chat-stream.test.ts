import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProjectEventsSseStream } from '../app'
import type { BeeGameEvent, BeeGameSessionManager } from '../beegame/session-manager'

test('live events and reconnect share a cursor, and cancelling the reader releases its subscription', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'chat-stream-'))
  const subscribers = new Set<(event: BeeGameEvent) => void>()
  const events: BeeGameEvent[] = [{ id: 1, sessionId: 'main', type: 'assistant.partial',
    text: 'First', createdAt: new Date(0), payload: { type: 'assistant.partial', assistantBlockId: 'block' } }]
  const manager = {
    events: () => [...events],
    subscribeProjectEvents: (_: unknown, callback: (event: BeeGameEvent) => void) => {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
  } as unknown as BeeGameSessionManager
  const connect = (after: number) => createProjectEventsSseStream({ request: new Request('http://localhost/events'),
    userId: 'user', projectId: 'project', sessionId: 'main', workspacePath, after,
    recoveredFromTranscript: false, beeGameSessions: manager }).getReader()
  const decode = (chunk: { value?: Uint8Array; done: boolean }) => {
    const text = new TextDecoder().decode(chunk.value)
    return JSON.parse(text.split('\n').find(line => line.startsWith('data: '))!.slice(6)).events as BeeGameEvent[]
  }
  const reader = connect(0)
  let resumed: ReturnType<typeof connect> | undefined
  try {
    expect(decode(await reader.read()).map(e => [e.id, e.text])).toEqual([[1, 'First']])
    const final: BeeGameEvent = { ...events[0]!, id: 2, type: 'assistant.message', text: 'First, complete.' }
    events.push(final)
    for (const subscriber of subscribers) subscriber(final)
    expect(decode(await reader.read()).map(e => [e.id, e.text])).toEqual([[2, 'First, complete.']])
    await reader.cancel()
    await Bun.sleep(5)
    expect(subscribers.size).toBe(0)
    resumed = connect(1)
    expect(decode(await resumed.read()).map(e => [e.id, e.text])).toEqual([[2, 'First, complete.']])
    await resumed.cancel()
    await Bun.sleep(5)
    expect(subscribers.size).toBe(0)
  } finally {
    await reader.cancel()
    await resumed?.cancel()
    await rm(workspacePath, { recursive: true, force: true })
  }
})
