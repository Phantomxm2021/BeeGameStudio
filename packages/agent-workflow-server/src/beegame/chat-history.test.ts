import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BeeGameEvent } from './session-manager'
import { ChatJsonlReader } from './chat-jsonl-reader'
import { readChatHistoryPage } from './chat-history'

test('history pages materialize complete selected blocks, preserve older cursors and retain Todo state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'beegame-history-page-'))
  try {
    const path = join(dir, 'events.jsonl'), reader = new ChatJsonlReader<BeeGameEvent>()
    const page = (options: { limit: number; beforeId?: number }) => readChatHistoryPage(path, reader, options)
    const events: BeeGameEvent[] = []
    const add = (type: BeeGameEvent['type'], text: string, payload?: BeeGameEvent['payload']) => {
      events.push({ id: events.length + 1, sessionId: 's', turnId: 't', type, text, payload, createdAt: new Date(events.length + 1) })
    }
    add('tool.completed', 'TodoWrite', { type: 'tool.completed', toolName: 'TodoWrite', toolUseID: 'todo', input: { todos: [{ content: 'Review', status: 'completed' }] } })
    for (let i = 0; i < 700; i++) add('assistant.thinking', '中', { type: 'assistant.thinking', thinkingBlockId: 'thought', status: 'streaming' })
    add('assistant.thinking', 'Thinking', { type: 'assistant.thinking', thinkingBlockId: 'thought', status: 'ended' })
    add('user.message', 'Next request')
    add('assistant.message', 'Response')
    await writeFile(path, events.map(event => JSON.stringify(event)).join('\n') + '\n')
    const latest = await page({ limit: 2 })
    expect(latest.events.map(event => event.text)).toEqual(['Next request', 'Response'])
    expect(latest.page).toEqual({ hasMore: true, nextBeforeId: 703 })
    expect(latest.todoEvents[0]?.payload?.input).toEqual({ todos: [{ content: 'Review', status: 'completed' }] })
    const older = await page({ limit: 1, beforeId: latest.page.nextBeforeId! })
    expect(older.events).toHaveLength(1)
    expect(older.events[0]).toMatchObject({ id: 702, text: '中'.repeat(700), payload: { status: 'ended', sourceSequence: 2 } })
    expect((await page({ limit: 2, beforeId: older.page.nextBeforeId! })).events.map(event => event.text)).toEqual(['TodoWrite'])
    const stream = await reader.read(path, { afterId: 0 })
    expect(stream.rows).toHaveLength(500)
    expect((await reader.read(path, { afterId: stream.nextAfterId! })).rows.map(event => event.id)).toEqual(events.slice(500).map(event => event.id))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('page branch filtering sees edits outside the page without replaying superseded history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'beegame-history-edit-'))
  try {
    const path = join(dir, 'events.jsonl'), reader = new ChatJsonlReader<BeeGameEvent>()
    const page = (options: { limit: number; beforeId?: number }) => readChatHistoryPage(path, reader, options)
    const base = { sessionId: 's', createdAt: new Date(0) }
    const events: BeeGameEvent[] = [
      { ...base, id: 1, turnId: 'old', type: 'user.message', text: 'Old request', payload: { type: 'user.message', clientMessageId: 'request' } },
      { ...base, id: 2, turnId: 'old', type: 'assistant.message', text: 'Old answer' },
      { ...base, id: 3, turnId: 'new', type: 'user.message', text: 'Replacement', payload: { type: 'user.message', supersedesMessageId: 'request' } },
      { ...base, id: 4, turnId: 'new', type: 'assistant.message', text: 'New answer' },
    ]
    await writeFile(path, events.map(event => JSON.stringify(event)).join('\n') + '\n')
    const latest = await page({ limit: 1 })
    expect(latest.events[0]?.text).toBe('New answer')
    const older = await page({ limit: 10, beforeId: latest.page.nextBeforeId! })
    expect(older.events.map(event => event.text)).toEqual(['Replacement'])
    expect(older.page.hasMore).toBe(false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

