import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { platformFormatCommandIssue, platformFormatResultLimit, SELECTED_FORMAT_INLINE_CHARS } from './format-tool-result.js'
import { getProjectDir } from '../utils/sessionStorage.js'
import { PREVIEW_SIZE_BYTES, processPreMappedToolResultBlock } from '../utils/toolResultStorage.js'

const input = { command: 'bun .beegame/delivery/check-content.mjs --format coordinates runtimeConsumption' }
const output = JSON.stringify({ ok: true, scope: 'content-format-selection', values: { baseline: 'source '.repeat(3000) } })
const block: ToolResultBlockParam = { type: 'tool_result', tool_use_id: 'offline-format-result', content: output }

test('format retrieval rejects source filtering before execution, without restricting ordinary commands', () => {
  for (const filter of ['head -200', 'tail -40', 'jq .values'])
    expect(platformFormatCommandIssue('Bash', { command: input.command + ' 2>&1 | ' + filter }, true)).toContain('without an output-filtering pipeline')
  expect(platformFormatCommandIssue('Bash', input, true)).toBeUndefined()
  expect(platformFormatCommandIssue('Bash', { command: 'cat docs/GDD.md | head -20' }, true)).toBeUndefined()
  expect(platformFormatCommandIssue('Bash', { command: input.command + ' | head -20' }, false)).toBeUndefined()
  for (const prefix of ['ls .beegame/delivery/ && ', 'cd /workspace && ', 'ls docs; '])
    expect(platformFormatCommandIssue('Bash', { command: prefix + input.command + ' | head -50' }, true)).toContain('without an output-filtering pipeline')
  expect(platformFormatResultLimit('Bash', { command: 'cd /workspace && ' + input.command }, block, true)).toBe(SELECTED_FORMAT_INLINE_CHARS)
})

test('only complete successful BGS platform format results receive the archive limit', () => {
  expect(platformFormatResultLimit('Bash', input, block, true)).toBe(SELECTED_FORMAT_INLINE_CHARS)
  for (const [name, command, result, native] of [
    ['Read', input, block, true], ['Bash', input, block, false],
    ['Bash', input, { ...block, is_error: true }, true],
    ['Bash', { command: 'bun .beegame/delivery/check-content.mjs --design-references' }, block, true],
    ['Bash', { command: 'echo source-document' }, block, true],
    ['Bash', input, { ...block, content: '{"ok":false,"scope":"content-format-selection"}' }, true],
    ['Bash', input, { ...block, content: output.slice(0, 100) }, true],
    ['Bash', input, { ...block, content: 'failed check: PRIVATE fixture' }, true],
  ] as const) expect(platformFormatResultLimit(name, command, result, native)).toBeUndefined()
})

test('a complete selected 3–8KB format stays inline, while large selections still persist', async () => {
  const selected = { ...block, content: JSON.stringify({ ok: true, scope: 'content-format-selection', values: { geometry: 'source '.repeat(600) } }) }
  expect(String(selected.content).length).toBeGreaterThan(PREVIEW_SIZE_BYTES)
  expect(String(selected.content).length).toBeLessThan(SELECTED_FORMAT_INLINE_CHARS)
  expect(await processPreMappedToolResultBlock(selected, 'Bash', platformFormatResultLimit('Bash', input, selected, true)!)).toBe(selected)
  expect(String(block.content).length).toBeGreaterThan(SELECTED_FORMAT_INLINE_CHARS)
})

test('first-emission archive retains full output, IDs and raw block; small results and persistence failures stay inline', async () => {
  const root = await mkdtemp('/private/tmp/bgs-format-archive-fixture-')
  const original = process.env.BEEGAME_CONFIG_DIR
  const scoped = process.env.BEEGAME_NATIVE_TOOL_RESULTS_DIR
  try {
    process.env.BEEGAME_CONFIG_DIR = root
    delete process.env.BEEGAME_NATIVE_TOOL_RESULTS_DIR
    getProjectDir.cache.clear!()
    const limit = platformFormatResultLimit('Bash', input, block, true)!
    const result = await processPreMappedToolResultBlock(block, 'Bash', limit)
    expect(result.tool_use_id).toBe(block.tool_use_id)
    expect(result.type).toBe('tool_result')
    expect(String(result.content).length).toBeLessThan(output.length)
    const file = String(result.content).match(/Full output saved to: ([^\n]+)/)![1]!
    expect(file.startsWith(root)).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(output)
    expect(block.content).toBe(output)
    expect(await processPreMappedToolResultBlock(block, 'Bash', limit)).toEqual(result)
    const small = { ...block, tool_use_id: 'small-fixture', content: output.slice(0, 100) }
    expect(await processPreMappedToolResultBlock(small, 'Bash', limit)).toBe(small)
    const unavailable = join(root, 'not-a-directory')
    await writeFile(unavailable, 'fixture')
    process.env.BEEGAME_CONFIG_DIR = unavailable
    getProjectDir.cache.clear!()
    const failed = { ...block, tool_use_id: 'failed-persistence-fixture' }
    expect(await processPreMappedToolResultBlock(failed, 'Bash', limit)).toBe(failed)
  } finally {
    if (original === undefined) delete process.env.BEEGAME_CONFIG_DIR
    else process.env.BEEGAME_CONFIG_DIR = original
    if (scoped === undefined) delete process.env.BEEGAME_NATIVE_TOOL_RESULTS_DIR
    else process.env.BEEGAME_NATIVE_TOOL_RESULTS_DIR = scoped
    getProjectDir.cache.clear!()
    await rm(root, { recursive: true, force: true })
  }
})

test('complete native Read of the platform format uses the same archive, not ordinary documents or focused reads', async () => {
  const root = await mkdtemp('/private/tmp/bgs-format-read-fixture-')
  const original = process.env.BEEGAME_CONFIG_DIR
  const scoped = process.env.BEEGAME_NATIVE_TOOL_RESULTS_DIR
  try {
    process.env.BEEGAME_CONFIG_DIR = root
    delete process.env.BEEGAME_NATIVE_TOOL_RESULTS_DIR
    getProjectDir.cache.clear!()
    const input = { file_path: '/workspace/.beegame/delivery/content-format.json' }
    const readBlock = { ...block, tool_use_id: 'format-read-fixture', content: '    1→' + output }
    const limit = platformFormatResultLimit('Read', input, readBlock, true)!
    expect(limit).toBe(PREVIEW_SIZE_BYTES)
    const result = await processPreMappedToolResultBlock(readBlock, 'Read', limit)
    expect(result.tool_use_id).toBe(readBlock.tool_use_id)
    const file = String(result.content).match(/Full output saved to: ([^\n]+)/)![1]!
    expect(file.startsWith(root)).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(readBlock.content)
    expect(String(result.content).length).toBeLessThan(readBlock.content.length)
    expect(readBlock.content).toContain(output)
    for (const [otherInput, native, otherBlock] of [
      [{ ...input, offset: 100, limit: 20 }, true, readBlock],
      [{ file_path: '/workspace/docs/GDD.md' }, true, readBlock],
      [{ file_path: '/workspace/content-format.json' }, true, readBlock],
      [input, false, readBlock], [input, true, { ...readBlock, is_error: true }],
    ] as const) expect(platformFormatResultLimit('Read', otherInput, otherBlock, native)).toBeUndefined()
  } finally {
    if (original === undefined) delete process.env.BEEGAME_CONFIG_DIR
    else process.env.BEEGAME_CONFIG_DIR = original
    if (scoped === undefined) delete process.env.BEEGAME_NATIVE_TOOL_RESULTS_DIR
    else process.env.BEEGAME_NATIVE_TOOL_RESULTS_DIR = scoped
    getProjectDir.cache.clear!()
    await rm(root, { recursive: true, force: true })
  }
})
