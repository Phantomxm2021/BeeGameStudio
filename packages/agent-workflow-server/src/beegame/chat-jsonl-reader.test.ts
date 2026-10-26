import { expect, test } from 'bun:test'
import { appendFile, mkdtemp, rename, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatJsonlReader, CHAT_RECORD_BYTES } from './chat-jsonl-reader'

test('bounded pages preserve split UTF-8, append cursors and file replacement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat-tail-'))
  try {
    const path = join(dir, 'events.jsonl'), reader = new ChatJsonlReader<{ id: number; text: string }>()
    const row = Buffer.from(JSON.stringify({ id: 1, text: '萤火虫' }) + '\n')
    await writeFile(path, row.subarray(0, row.length - 5))
    expect((await reader.read(path)).rows).toEqual([])
    await appendFile(path, row.subarray(row.length - 5))
    expect((await reader.read(path)).rows).toEqual([{ id: 1, text: '萤火虫' }])
    const entries = await reader.entries(path)
    expect(await reader.entries(path)).toBe(entries)
    expect((await reader.read(path, { afterId: 1 })).rows).toEqual([])
    await appendFile(path, '{"id":2,"text":"second"}\n')
    expect((await reader.read(path, { afterId: 1 })).rows).toEqual([{ id: 2, text: 'second' }])
    const longText = 'Long tool result '.repeat(40_000)
    await appendFile(path, JSON.stringify({ id: 3, text: longText }) + '\n')
    expect((await reader.read(path, { limit: 1, newestFirst: true })).rows).toEqual([{ id: 3, text: longText }])
    expect(await reader.read(path, { limit: 1, beforeId: 3, newestFirst: true })).toMatchObject({ rows: [{ id: 2, text: 'second' }], hasMore: true, nextBeforeId: 2 })
    await writeFile(join(dir, 'replacement'), '{"id":4,"text":"new"}\n')
    await rename(join(dir, 'replacement'), path)
    expect((await reader.read(path)).rows).toEqual([{ id: 4, text: 'new' }])
    await writeFile(path, '{"id":5,"text":"x"}\n')
    expect((await reader.read(path)).rows).toEqual([{ id: 5, text: 'x' }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('malformed selected records fail visibly and remain retryable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat-tail-error-'))
  try {
    const path = join(dir, 'events.jsonl'), reader = new ChatJsonlReader()
    await writeFile(path, '{"id":1}\ninvalid\n')
    await expect(reader.read(path)).rejects.toThrow('Invalid Chat JSONL record')
    await expect(reader.read(path)).rejects.toThrow('Invalid Chat JSONL record')
    await writeFile(path, '{"id":1}\n{"id":2}\n')
    expect((await reader.read(path)).rows).toEqual([{ id: 1 }, { id: 2 }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('oversized cumulative progress is never materialized as a full history body or host fact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat-legacy-output-'))
  try {
    const path = join(dir, 'events.jsonl'), reader = new ChatJsonlReader<any>()
    const event = (id: number, type: string, payload: object) => ({ id, sessionId: 's', turnId: 'turn-1', type,
      text: type === 'tool.progress' ? 'fresh delta' : type, payload, createdAt: new Date(id).toISOString() })
    const permission = event(1, 'permission.resolved', { toolName: 'AskUserQuestion', decision: 'allow', input: { answers: { Style: 'A' } } })
    const progress = event(2, 'tool.progress', { toolName: 'Shell', toolUseID: 'cmd', output: 'x'.repeat(CHAT_RECORD_BYTES * 3) })
    const raw = JSON.stringify(permission) + '\n' + JSON.stringify(progress) + '\n'
    await writeFile(path, raw)
    const index = await reader.entries(path)
    expect(JSON.stringify(index).length).toBeLessThan(2000)
    const page = await reader.read(path, { limit: 1, newestFirst: true })
    expect(page.rows[0]).toMatchObject({ id: 2, text: 'fresh delta', payload: { historyBodyOmitted: true } })
    expect(JSON.stringify(page).length).toBeLessThan(2000)
    const keep = (row: any) => row
    const facts = await reader.readFacts(path, keep)
    expect(facts[0]).toEqual(permission)
    expect(facts.at(-1)).toMatchObject({ id: 2, turnId: 'turn-1', type: 'tool.progress', createdAt: progress.createdAt })
    expect(facts.at(-1).payload.output).toBeUndefined()
    expect(reader.readFactsSync(path, keep)).toEqual(facts)
    expect(await reader.readFacts(path, keep, ['permission.resolved'])).toEqual([permission])
    expect(await readFile(path, 'utf8')).toBe(raw)
    // Display omission must never turn a missing authoritative answer into a
    // successful/empty permission result.
    await appendFile(path, JSON.stringify(event(3, 'permission.resolved', { input: 'y'.repeat(CHAT_RECORD_BYTES + 1) })) + '\n')
    await expect(reader.readFacts(path, keep, ['permission.resolved'])).rejects.toThrow('bounded read limit')
  } finally { await rm(dir, { recursive: true, force: true }) }
})


test('oversized Shell terminal facts retain all other fields in async and sync reads without rewriting the journal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat-shell-receipt-'))
  try {
    const path = join(dir, 'events.jsonl')
    // Escapes, UTF-8 and embedded JSON cross many 256 KiB read boundaries.
    const output = ('萤火虫\\\"\n\t{"payload":{"output":"decoy"}}').repeat(130_000)
    const events = ['tool.completed', 'tool.failed'].map((type, index) => ({ id: index + 1, sessionId: 's', turnId: 't', type, text: 'command receipt',
      payload: { nested: [{ output: 'retain this' }], output, toolName: 'Shell', toolUseID: `cmd-${index}`,
        input: { command: 'printf result', cwd: '/temporary-workspace' }, exitCode: index, durationMs: 123,
        is_error: Boolean(index), status: index ? 'failed' : 'completed', parentToolUseID: 'parent',
        unknownMetadata: { usage: 45, output: 'also retained' } }, createdAt: '2026-10-26T00:00:00.000Z' }))
    // Force escaped unicode inside output and its key, including across chunks.
    const raw = events.map(event => JSON.stringify(event).replaceAll('萤', '\\u8424').replaceAll('"output":', '"out\\u0070ut":')).join('\n') + '\n'
    expect(Buffer.byteLength(JSON.stringify(events[0]))).toBeGreaterThan(CHAT_RECORD_BYTES)
    await writeFile(path, raw)
    const expected = events.map(({ payload: { output: _, ...payload }, ...event }) => ({ ...event, payload }))
    const keep = (row: any) => row
    expect(await new ChatJsonlReader<any>().readFacts(path, keep)).toEqual(expected)
    expect(new ChatJsonlReader<any>().readFactsSync(path, keep)).toEqual(expected)
    expect(await new ChatJsonlReader<any>().readFacts(path, keep, ['tool.failed'])).toEqual([expected[1]])
    expect(await readFile(path, 'utf8')).toBe(raw)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('oversized facts never elide Agent output, permissions or non-output fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat-fact-bounds-'))
  try {
    const path = join(dir, 'events.jsonl'), huge = 'x'.repeat(CHAT_RECORD_BYTES + 1)
    const cases = [
      { type: 'tool.completed', payload: { toolName: 'Agent', output: huge } },
      { type: 'permission.resolved', payload: { toolName: 'Shell', output: huge, decision: 'allow' } },
      { type: 'tool.failed', payload: { toolName: 'Shell', input: huge, output: 'small' } },
      { type: 'tool.completed', payload: { toolName: 'Shell', output: [huge] } },
      { type: 'tool.completed', text: huge, payload: { toolName: 'Shell', output: 'small' } },
    ]
    for (const event of cases) {
      await writeFile(path, JSON.stringify({ id: 1, sessionId: 's', ...event }) + '\n')
      await expect(new ChatJsonlReader().readFacts(path, row => row)).rejects.toThrow('bounded read limit')
      expect(() => new ChatJsonlReader().readFactsSync(path, row => row)).toThrow('bounded read limit')
    }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('projection rejects malformed omitted strings and duplicate paths, and failed reads stay retryable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat-shell-invalid-'))
  try {
    const path = join(dir, 'events.jsonl'), huge = 'x'.repeat(CHAT_RECORD_BYTES + 1)
    const prefix = '{"id":1,"sessionId":"s","type":"tool.completed","payload":{"toolName":"Shell","output":"' + huge
    const cases = [
      prefix + '\\q"}}\n', prefix + '\\u12z4"}}\n', prefix + '\t"}}\n', prefix + '\n',
      prefix + '","output":"second"}}\n',
      prefix + '"},"payload":{"toolName":"Shell","output":"second"}}\n',
      prefix + '"} garbage}\n',
      prefix + '"},"type":"tool.failed"}\n',
      prefix.replace('"toolName":"Shell"', '"toolName":"Agent","toolName":"Shell"') + '"}}\n',
    ]
    for (const raw of cases) {
      await writeFile(path, raw)
      const reader = new ChatJsonlReader()
      await expect(reader.readFacts(path, row => row)).rejects.toThrow('Invalid Chat JSONL record')
      expect(() => new ChatJsonlReader().readFactsSync(path, row => row)).toThrow('Invalid Chat JSONL record')
      await expect(reader.readFacts(path, row => row)).rejects.toThrow('Invalid Chat JSONL record')
    }
    await writeFile(path, prefix + '"}}\n')
    expect(await new ChatJsonlReader().readFacts(path, row => row)).toEqual([
      { id: 1, sessionId: 's', type: 'tool.completed', payload: { toolName: 'Shell' } },
    ])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
