import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ToolUseContext } from 'src/Tool.js'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import { FileReadTool } from '../../FileReadTool/FileReadTool.js'
import { FileWriteTool } from '../../FileWriteTool/FileWriteTool.js'
import { FileEditTool } from '../FileEditTool.js'

describe('file tools directory preflight', () => {
  let directoryPath: string
  let context: ToolUseContext

  beforeAll(async () => {
    directoryPath = await mkdtemp(join(tmpdir(), 'file-tool-directory-'))
    context = {
      getAppState: () => ({
        toolPermissionContext: getEmptyToolPermissionContext(),
      }),
      readFileState: new Map(),
    } as unknown as ToolUseContext
  })

  afterAll(async () => {
    await rm(directoryPath, { recursive: true, force: true })
  })

  test('Read rejects a directory before attempting file I/O', async () => {
    const result = await FileReadTool.validateInput?.(
      { file_path: directoryPath },
      context,
    )

    expect(result?.result).toBe(false)
    expect(result?.message).toContain('existing directory')
  })

  test('Write rejects a directory before attempting file I/O', async () => {
    const result = await FileWriteTool.validateInput?.(
      { file_path: directoryPath, content: 'content' },
      context,
    )

    expect(result?.result).toBe(false)
    expect(result?.message).toContain('existing directory')
  })

  test('Edit rejects a directory before attempting file I/O', async () => {
    const result = await FileEditTool.validateInput?.(
      {
        file_path: directoryPath,
        old_string: 'before',
        new_string: 'after',
      },
      context,
    )

    expect(result?.result).toBe(false)
    expect(result?.message).toContain('existing directory')
  })
})
