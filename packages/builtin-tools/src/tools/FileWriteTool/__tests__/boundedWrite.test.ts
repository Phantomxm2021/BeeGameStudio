import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zodToJsonSchema } from 'src/utils/zodToJsonSchema.js'
import {
  FileWriteTool,
  MAX_WRITE_CONTENT_CHARS,
  resolveWriteContent,
} from '../FileWriteTool.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true })
})

function minimalToolContext() {
  return {
    readFileState: new Map(),
    updateFileHistoryState: () => undefined,
    dynamicSkillDirTriggers: new Set<string>(),
  } as never
}

const parentMessage = { uuid: crypto.randomUUID() } as never

describe('bounded native Write input', () => {
  test('publishes and enforces the per-call content limit', () => {
    expect(
      FileWriteTool.inputSchema.safeParse({
        file_path: '/tmp/document.md',
        content: 'x'.repeat(MAX_WRITE_CONTENT_CHARS),
        mode: 'overwrite',
      }).success,
    ).toBe(true)
    expect(
      FileWriteTool.inputSchema.safeParse({
        file_path: '/tmp/document.md',
        content: 'x'.repeat(MAX_WRITE_CONTENT_CHARS + 1),
        mode: 'overwrite',
      }).success,
    ).toBe(false)

    expect(
      FileWriteTool.inputSchema.safeParse({
        file_path: '/tmp/document.md',
        content: 'legacy calls remain valid',
      }).success,
    ).toBe(true)

    const jsonSchema = zodToJsonSchema(FileWriteTool.inputSchema)
    expect(
      (jsonSchema.properties as Record<string, Record<string, unknown>>).content
        ?.maxLength,
    ).toBe(MAX_WRITE_CONTENT_CHARS)
  })

  test('assembles bounded appends into the exact reference bytes', () => {
    const first = '第一段\n'
    const second = 'second block\n'
    const third = '最终段落\n'

    const created = resolveWriteContent({
      currentContent: null,
      content: first,
      mode: 'overwrite',
    })
    const appendedSecond = resolveWriteContent({
      currentContent: created,
      content: second,
      mode: 'append',
      expectedBytes: Buffer.byteLength(created),
    })
    const appendedThird = resolveWriteContent({
      currentContent: appendedSecond,
      content: third,
      mode: 'append',
      expectedBytes: Buffer.byteLength(appendedSecond),
    })

    expect(appendedThird).toBe(first + second + third)
    expect(
      FileWriteTool.inputSchema.safeParse({
        file_path: '/tmp/document.md',
        content: 'provider-compatible append',
        mode: 'append',
      }).success,
    ).toBe(true)
  })

  test('rejects missing, stale, and replayed append targets without content change', () => {
    expect(() =>
      resolveWriteContent({
        currentContent: null,
        content: 'chunk',
        mode: 'append',
        expectedBytes: 0,
      }),
    ).toThrow(/does not exist/i)

    const current = 'existing\n'
    expect(() =>
      resolveWriteContent({
        currentContent: current,
        content: 'next\n',
        mode: 'append',
        expectedBytes: 0,
      }),
    ).toThrow(/expected.*bytes/i)

    const appended = resolveWriteContent({
      currentContent: current,
      content: 'next\n',
      mode: 'append',
      expectedBytes: Buffer.byteLength(current),
    })
    expect(() =>
      resolveWriteContent({
        currentContent: appended,
        content: 'next\n',
        mode: 'append',
        expectedBytes: Buffer.byteLength(current),
      }),
    ).toThrow(/expected.*bytes/i)
    expect(appended).toBe('existing\nnext\n')
  })

  test('persists bounded overwrite and append calls through the native Write path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bounded-write-'))
    tempDirs.push(dir)
    const path = join(dir, 'document.md')
    const context = minimalToolContext()

    await FileWriteTool.call(
      { file_path: path, content: '第一段\n', mode: 'overwrite' },
      context,
      (() => true) as never,
      parentMessage,
    )
    const expectedBytes = Buffer.byteLength(readFileSync(path))
    await FileWriteTool.call(
      {
        file_path: path,
        content: 'second block\n',
        mode: 'append',
        expected_bytes: expectedBytes,
      },
      context,
      (() => true) as never,
      parentMessage,
    )

    expect(readFileSync(path, 'utf8')).toBe('第一段\nsecond block\n')
    await FileWriteTool.call(
      {
        file_path: path,
        content: 'provider append without byte hint\n',
        mode: 'append',
      },
      context,
      (() => true) as never,
      parentMessage,
    )
    expect(readFileSync(path, 'utf8')).toBe(
      '第一段\nsecond block\nprovider append without byte hint\n',
    )
    await expect(
      FileWriteTool.call(
        {
          file_path: path,
          content: 'second block\n',
          mode: 'append',
          expected_bytes: expectedBytes,
        },
        context,
        (() => true) as never,
        parentMessage,
      ),
    ).rejects.toThrow(/expected.*bytes/i)
    expect(readFileSync(path, 'utf8')).toBe(
      '第一段\nsecond block\nprovider append without byte hint\n',
    )
  })

  test('continues a newly created file for legacy calls without changing existing-file overwrite semantics', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bounded-write-legacy-'))
    tempDirs.push(dir)
    const createdPath = join(dir, 'created.md')
    const existingPath = join(dir, 'existing.md')
    const context = minimalToolContext()

    await FileWriteTool.call(
      { file_path: createdPath, content: 'first\n' },
      context,
      (() => true) as never,
      parentMessage,
    )
    await FileWriteTool.call(
      { file_path: createdPath, content: 'second\n' },
      context,
      (() => true) as never,
      parentMessage,
    )
    expect(readFileSync(createdPath, 'utf8')).toBe('first\nsecond\n')
    await expect(
      FileWriteTool.call(
        { file_path: createdPath, content: 'second\n' },
        context,
        (() => true) as never,
        parentMessage,
      ),
    ).rejects.toThrow(/replayed append/i)

    await FileWriteTool.call(
      { file_path: createdPath, content: '# Replacement\n' },
      context,
      (() => true) as never,
      parentMessage,
    )
    expect(readFileSync(createdPath, 'utf8')).toBe('# Replacement\n')

    await Bun.write(existingPath, 'old\n')
    ;(context as { readFileState: Map<string, unknown> }).readFileState.set(
      existingPath,
      {
        content: 'old\n',
        timestamp: Date.now() + 10_000,
        offset: undefined,
        limit: undefined,
      },
    )
    await FileWriteTool.call(
      { file_path: existingPath, content: 'replacement\n' },
      context,
      (() => true) as never,
      parentMessage,
    )
    expect(readFileSync(existingPath, 'utf8')).toBe('replacement\n')
  })
})
