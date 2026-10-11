import { describe, expect, test } from 'bun:test'
import { FileWriteTool } from '../FileWriteTool'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getEmptyToolPermissionContext } from 'src/Tool.js'

describe('native Write input contract', () => {
  test('rejects a directory with a path error, not a request to read it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'native-write-directory-'))
    try {
      const context = {
        readFileState: new Map(),
        getAppState: () => ({ toolPermissionContext: getEmptyToolPermissionContext() }),
      } as any
      const result = await FileWriteTool.validateInput!({ file_path: root, content: 'x' }, context)
      expect(result).toMatchObject({ result: false, errorCode: 5 })
      expect(result.message).toContain('path is a directory')
      expect((await stat(root)).isDirectory()).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('accepts a large streamed write without a local checkpoint cap', () => {
    expect(
      FileWriteTool.inputSchema.safeParse({
        file_path: '/tmp/document.md',
        content: 'x'.repeat(32_768),
      }).success,
    ).toBe(true)
  })

  test('does not expose a studio-specific append protocol', () => {
    expect(
      FileWriteTool.inputSchema.safeParse({
        file_path: '/tmp/document.md',
        content: 'continuation',
        mode: 'append',
      }).success,
    ).toBe(false)
  })

  test('distinguishes an unread existing file from a stale read without relaxing overwrite protection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'native-write-read-state-')), path = join(root, 'existing.md')
    try {
      await writeFile(path, 'Original')
      const readFileState = new Map()
      const context = { readFileState, getAppState: () => ({ toolPermissionContext: getEmptyToolPermissionContext() }) } as any
      const input = { file_path: path, content: 'Replacement' }
      expect(await FileWriteTool.validateInput!(input, context)).toMatchObject({ result: false, errorCode: 2,
        message: 'This existing file has no valid Read record in the current tool context. Use Read on this file before overwriting it.' })
      readFileState.set(path, { content: 'Original', timestamp: 0 })
      expect(await FileWriteTool.validateInput!(input, context)).toMatchObject({ result: false, errorCode: 3 })
      readFileState.set(path, { content: 'Original', timestamp: (await stat(path)).mtimeMs })
      expect(await FileWriteTool.validateInput!(input, context)).toEqual({ result: true })
      expect(await readFile(path, 'utf8')).toBe('Original')
      expect(await FileWriteTool.validateInput!({ ...input, file_path: join(root, 'new.md') }, context)).toEqual({ result: true })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
