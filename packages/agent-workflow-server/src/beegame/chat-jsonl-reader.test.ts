import { expect, test } from 'bun:test'
import { appendFile, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatJsonlReader } from './chat-jsonl-reader'

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
