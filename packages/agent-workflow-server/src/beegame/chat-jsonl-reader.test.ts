import { expect, test } from 'bun:test'
import { appendFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatJsonlReader } from './chat-jsonl-reader'
import { readStageChatHistory } from './session-manager'
import { mkdir } from 'node:fs/promises'

test('reads only appended complete records; split UTF-8 survives polls and file replacement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat-tail-'))
  try {
    const path = join(dir, 'events.jsonl')
    const reader = new ChatJsonlReader<{ text: string }>()
    const row = Buffer.from(JSON.stringify({ text: '萤火虫' }) + '\n')
    await writeFile(path, row.subarray(0, 11))
    expect((await reader.read(path)).rows).toEqual([])
    await appendFile(path, row.subarray(11))
    expect((await reader.read(path)).rows).toEqual([{ text: '萤火虫' }])
    expect(await reader.read(path)).toMatchObject({ rows: [], bytesRead: 0, reset: false })
    await appendFile(path, '{"text":"second"}\n')
    expect(await reader.read(path)).toMatchObject({ rows: [{ text: 'second' }], bytesRead: 18, reset: false })
    const longText = 'Long tool result '.repeat(40_000)
    await appendFile(path, JSON.stringify({ text: longText }) + '\n')
    expect((await reader.read(path)).rows).toEqual([{ text: longText }])
    await writeFile(join(dir, 'replacement'), '{"text":"new"}\n')
    await rename(join(dir, 'replacement'), path)
    expect(await reader.read(path)).toMatchObject({ rows: [{ text: 'new' }], reset: true })
    await writeFile(path, '{"text":"x"}\n')
    expect(await reader.read(path)).toMatchObject({ rows: [{ text: 'x' }], reset: true })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('malformed complete records fail visibly without committing a cursor past the error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat-tail-error-'))
  try {
    const path = join(dir, 'events.jsonl')
    const reader = new ChatJsonlReader()
    await writeFile(path, '{"id":1}\ninvalid\n')
    await expect(reader.read(path)).rejects.toThrow('Invalid Chat JSONL record')
    await writeFile(path, '{"id":1}\n{"id":2}\n')
    expect((await reader.read(path)).rows).toEqual([{ id: 1 }, { id: 2 }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('live follower and history share incremental projection; primary Chat excludes diagnostic duplicates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat-stage-tail-'))
  try {
    const stageDir = join(dir, '.beegame/workflow/foundation-authoring/state')
    await mkdir(stageDir, { recursive: true })
    const path = join(stageDir, 'run.chat-events.jsonl')
    const row = (event: string, data: Record<string, unknown>) => JSON.stringify({ at: '2026-09-20T00:00:00Z', event,
      data: { queryId: 'q', agentId: 'root', messageId: 'm', index: 0, ...data } }) + '\n'
    await writeFile(join(stageDir, 'run.native-events.jsonl'), row('response.message', {
      type: 'assistant', message: { id: 'old', content: [{ type: 'text', text: 'Must not be replayed' }] } }))
    await writeFile(path, row('response.content_start', { type: 'thinking', occurredAt: '2026-09-20T00:00:00Z' }))
    const first = await Promise.all([readStageChatHistory(dir), readStageChatHistory(dir)])
    expect(first[0]).toHaveLength(1)
    expect(first[1]).toEqual(first[0])
    await appendFile(path, row('response.content_snapshot', { type: 'thinking', content: 'Checking assets', receivedBytes: 15 }))
    expect(await readStageChatHistory(dir)).toHaveLength(2)
    expect(await readStageChatHistory(dir)).toHaveLength(2)
    await appendFile(path, row('response.query_end', { status: 'aborted', occurredAt: '2026-09-20T00:00:02.130Z' }))
    const ended = await readStageChatHistory(dir)
    expect(ended).toHaveLength(3)
    expect(ended[2].payload).toMatchObject({ status: 'ended', reason: 'interrupted', thinkingStartedAt: '2026-09-20T00:00:00Z' })
    expect(ended[2].createdAt.toISOString()).toBe('2026-09-20T00:00:02.130Z')
    // A truncated/replaced source must also reset the projector's active blocks.
    await writeFile(path, row('response.query_end', { status: 'aborted' }))
    expect(await readStageChatHistory(dir)).toEqual([])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
