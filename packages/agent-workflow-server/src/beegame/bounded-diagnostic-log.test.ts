import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { appendBoundedDiagnosticRecord } from './bounded-diagnostic-log'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('appendBoundedDiagnosticRecord', () => {
  test('rotates diagnostic segments without modifying their records', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beegame-bounded-log-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'agent.raw.jsonl')

    appendBoundedDiagnosticRecord(path, 'first', { maxBytes: 13, archiveCount: 2 })
    appendBoundedDiagnosticRecord(path, 'second', { maxBytes: 13, archiveCount: 2 })
    appendBoundedDiagnosticRecord(path, 'third', { maxBytes: 13, archiveCount: 2 })

    expect(readFileSync(path, 'utf8')).toBe('third\n')
    expect(readFileSync(`${path}.1`, 'utf8')).toBe('first\nsecond\n')
  })

  test('keeps only the configured number of archives', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beegame-bounded-log-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'runtime.log')

    for (const value of ['one', 'two', 'three', 'four']) {
      appendBoundedDiagnosticRecord(path, value, { maxBytes: 6, archiveCount: 2 })
    }

    expect(readFileSync(path, 'utf8')).toBe('four\n')
    expect(readFileSync(`${path}.1`, 'utf8')).toBe('three\n')
    expect(readFileSync(`${path}.2`, 'utf8')).toBe('two\n')
  })

  test('omits one oversized diagnostic record with a structured marker', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beegame-bounded-log-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'agent.raw.jsonl')

    appendBoundedDiagnosticRecord(path, 'x'.repeat(512), {
      maxBytes: 256,
      archiveCount: 2,
    })

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      type: 'diagnostic.record_omitted',
      reason: 'record_exceeds_segment_limit',
      originalBytes: 513,
    })
  })

  test('discards an oversized legacy segment instead of archiving it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beegame-bounded-log-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'agent.raw.jsonl')

    writeFileSync(path, 'legacy-record', 'utf8')
    appendBoundedDiagnosticRecord(path, 'ok', {
      maxBytes: 8,
      archiveCount: 2,
    })

    expect(readFileSync(path, 'utf8')).toBe('ok\n')
  })
})
