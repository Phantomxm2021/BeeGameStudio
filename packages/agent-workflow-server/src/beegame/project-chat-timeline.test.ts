import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile, appendFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectChatTimeline } from './project-chat-timeline'
import type { BeeGameEvent } from './session-manager'
import { compactTranscriptForChatHistory } from '../app'

test('old leaked worker prompts are hidden without renumbering journal cursors or deduplicating user text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bgs-internal-chat-'))
  try {
    const path = join(dir, 'events.jsonl')
    const make = (id: number, displayKind: string): BeeGameEvent => ({ id, sessionId: 'main', type: 'user.message',
      text: '修复按钮', createdAt: new Date(id), payload: { type: 'user.message', displayKind } })
    await writeFile(path, [make(1, 'change_request'), make(2, 'workflow_worker'), make(3, 'change_request')].map(e => JSON.stringify(e)).join('\n') + '\n')
    const timeline = new ProjectChatTimeline(path)
    expect((await timeline.append([])).map(e => e.id)).toEqual([1, 3])
    expect((await timeline.append([make(4, 'workflow_worker')])).map(e => e.id)).toEqual([1, 3])
    expect((await timeline.append([make(5, 'project_request')], 3)).map(e => e.id)).toEqual([4])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

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

test('mixed worker and mirror deltas form one ended thought before and after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'beegame-mixed-thinking-'))
  try {
    const path = join(dir, 'events.jsonl')
    const start = '2026-09-21T00:43:47.336Z'
    const make = (id: number, status: string, text: string): BeeGameEvent => ({ id, sessionId: 'worker', turnId: 'native-turn',
      type: 'assistant.thinking', text, createdAt: new Date(status === 'ended' ? '2026-09-21T00:44:00.972Z' : start),
      payload: { type: 'assistant.thinking', thinkingBlockId: 'native-message:0', thinkingStartedAt: start, status } })
    const mirror = { ...make(2, 'streaming', ' failed'), sessionId: 'main', turnId: undefined,
      payload: { ...make(2, '', '').payload!, workflowSourceSessionId: 'worker', workflowSourceEventId: 2, status: 'streaming' } }
    const timeline = new ProjectChatTimeline(path)
    await timeline.append([make(1, 'started', 'Bot'), mirror, make(3, 'ended', 'Thinking')])
    for (const reader of [timeline, new ProjectChatTimeline(path)]) {
      const events = await reader.append([])
      expect(events.every(e => e.sessionId === 'worker')).toBe(true)
      const compact = compactTranscriptForChatHistory(events)
      expect(compact).toHaveLength(1)
      expect(compact[0]).toMatchObject({ text: 'Bot failed', payload: { status: 'ended', thinkingStartedAt: start } })
      expect(+new Date(compact[0]!.createdAt) - +new Date(start)).toBe(13636)
    }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('late recovery, worker mirrors and restart cannot renumber a project cursor', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'beegame-chat-timeline-'))
  try {
    const path = join(dir, 'events.jsonl')
    const event = (id: number, at: number): BeeGameEvent => ({ id, sessionId: 'worker', type: 'assistant.message', text: String(id), createdAt: new Date(at) })
    const timeline = new ProjectChatTimeline(path)
    expect((await timeline.append([event(1, 100), event(3, 300)])).map(e => [e.id, e.text])).toEqual([[1, '1'], [2, '3']])
    const mirror = { ...event(1, 100), sessionId: 'main', id: 99, payload: { type: 'assistant.message', workflowSourceSessionId: 'worker', workflowSourceEventId: 1 } }
    const results = await Promise.all([timeline.append([event(2, 200)]), timeline.append([mirror, event(4, 400)])])
    expect(results.at(-1)?.map(e => [e.id, e.text])).toEqual([[1, '1'], [2, '3'], [3, '2'], [4, '4']])
    const reopened = new ProjectChatTimeline(path)
    expect((await reopened.append([event(2, 200), event(5, 500)])).filter(e => e.id > 4).map(e => e.text)).toEqual(['5'])
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

test('legacy text identity survives a journal restart in the middle of a streamed message', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'beegame-text-resume-'))
  try {
    const path = join(dir, 'events.jsonl')
    const partial: BeeGameEvent = { id: 80, sessionId: 'worker', turnId: 'turn',
      type: 'assistant.partial', text: 'Hello', createdAt: new Date(100),
      payload: { type: 'stream_event', event: { index: 1 } } }
    const timeline = new ProjectChatTimeline(path)
    const first = await timeline.append([partial])
    const reopened = new ProjectChatTimeline(path)
    const resumed = await reopened.append([{ ...partial, id: 81, text: ' world' },
      { ...partial, id: 82, type: 'assistant.message', text: 'Hello world',
        payload: { type: 'assistant', message: { id: 'native-id' } } }], 1)
    expect(resumed.map(e => e.id)).toEqual([2, 3])
    expect(resumed.every(e => e.payload?.assistantBlockId === first[0]?.payload?.assistantBlockId)).toBe(true)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
