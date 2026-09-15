import { expect, test } from 'bun:test'
import { mkdtemp, rm, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../../../foundation-documents'
import type { FoundationIrInput } from '../input'
import { runNativeIrOperation } from './native-operation'

// Transport-only fixture: validates file isolation and metering, not IR semantics.
const source = { documents: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, content: '# 修理\n原文。' })) } as unknown as FoundationIrInput
const command = [process.execPath, join(import.meta.dir, 'test-fixtures/native-operation.ts')]

test('native IR adapter reads exact isolated source, returns output bytes and meters terminal once', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'ir-native-test-')))
  try {
    const result = await runNativeIrOperation({ source, directory, configuration: { command, env: {} },
      operation: { kind: 'compile', prompt: 'fixture operation', readOnlyFiles: { 'node-contracts.json': '{}\n' }, outputFormat: 'json' },
      signal: new AbortController().signal, onUsage: async () => {}, onProgress: async () => {} })
    expect(result.failure).toBeUndefined()
    expect(result.text).toBe('{"schemaVersion":"game-ir-direct-draft.v1","modules":[]}\n')
    expect(result.usageObserved).toBe(true)
    expect(result.usage.total_tokens).toBe(15)
    expect(await readFile(join(directory, 'workspace/docs/GDD.md'), 'utf8')).toBe('# 修理\n原文。')
    expect(await readFile(join(directory, 'workspace/node-contracts.json'), 'utf8')).toBe('{}\n')
    expect(await readFile(join(directory, 'native-events.jsonl'), 'utf8')).toContain('started')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('native IR cancellation drains observed usage and never admits an output', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'ir-native-stop-')))
  const abort = new AbortController()
  try {
    const result = await runNativeIrOperation({ source, directory, configuration: { command: [...command, '--cancel-fixture'], env: {} },
      operation: { kind: 'compile', prompt: 'fixture operation', outputFormat: 'json' },
      signal: abort.signal, onUsage: async () => { abort.abort() }, onProgress: async () => {} })
    expect(result.failure).toBe('stopped')
    expect(result.text).toBeUndefined()
    expect(result.usageObserved).toBe(true)
    expect(result.usage.total_tokens).toBe(10)
    expect(result.completion.stdoutDrained).toBe(true)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
