import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile, appendFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectChatTimeline } from './project-chat-timeline'
import type { BeeGameEvent } from './session-manager'

test('journal offsets preserve large UTF-8 output and recover a torn final append', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'beegame-journal-offset-'))
  try {
    const path = join(dir, 'events.jsonl')
    const large = '图集结果🚀'.repeat(60000)
    const event = (id: number, text: string): BeeGameEvent => ({ id, sessionId: 's', type: 'tool.completed', text, createdAt: new Date(id) })
    const writer = new ProjectChatTimeline(path)
    await writer.append([event(1, large), event(2, 'last')], 2)
    const good = await readFile(path, 'utf8')
    await appendFile(path, '{"id":3,"text":"partial')
    const reader = new ProjectChatTimeline(path)
    expect((await reader.append([], 1)).map(e => e.text)).toEqual(['last'])
    expect(await readFile(path, 'utf8')).toBe(good)
    expect((await reader.append([]))[0]?.text).toBe(large)
    expect((await reader.append([event(3, '新输出')], 2)).map(e => [e.id, e.text])).toEqual([[3, '新输出']])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('concurrent native appends and restart cannot renumber a project cursor', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'beegame-chat-timeline-'))
  try {
    const path = join(dir, 'events.jsonl')
    const event = (id: number, at: number): BeeGameEvent => ({ id, sessionId: 'native-session', type: 'assistant.message', text: String(id), createdAt: new Date(at) })
    const timeline = new ProjectChatTimeline(path)
    expect((await timeline.append([event(1, 100), event(3, 300)])).map(e => [e.id, e.text])).toEqual([[1, '1'], [2, '3']])
    const results = await Promise.all([timeline.append([event(2, 200)]), timeline.append([event(4, 400)])])
    expect(results.at(-1)?.map(e => [e.id, e.text])).toEqual([[1, '1'], [2, '3'], [3, '2'], [4, '4']])
    const reopened = new ProjectChatTimeline(path)
    expect((await reopened.append([event(2, 200), event(5, 500)])).filter(e => e.id > 4).map(e => e.text)).toEqual(['5'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('source-local IDs can restart in another transcript without losing either event', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'beegame-chat-source-ids-'))
  try {
    const timeline = new ProjectChatTimeline(join(dir, 'events.jsonl'))
    const event = (sessionId: string, at: string): BeeGameEvent => ({
      id: 1, sessionId, type: 'assistant.message', text: sessionId, createdAt: new Date(at),
    })
    expect((await timeline.append([
      event('session-a', '2026-09-23T17:59:00Z'),
      event('session-b', '2026-09-24T12:55:00Z'),
    ])).map(item => [item.id, item.sessionId, item.payload?.projectSourceEventId]))
      .toEqual([[1, 'session-a', 1], [2, 'session-b', 1]])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a failed append is retryable and cursor reads return only unseen records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'beegame-chat-retry-'))
  try {
    const parent = join(dir, 'chat')
    const timeline = new ProjectChatTimeline(join(parent, 'events.jsonl'))
    await timeline.append([])
    await writeFile(parent, 'Temporary obstruction')
    const event: BeeGameEvent = { id: 1, sessionId: 's', type: 'assistant.message', text: 'Retain me', createdAt: new Date(0) }
    await expect(timeline.append([event])).rejects.toThrow()
    await rm(parent)
    expect((await timeline.append([event])).map(e => e.text)).toEqual(['Retain me'])
    expect(await timeline.append([event], 1)).toEqual([])
    expect((await timeline.append([{ ...event, id: 2, text: 'Next' }], 1)).map(e => [e.id, e.text])).toEqual([[2, 'Next']])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
