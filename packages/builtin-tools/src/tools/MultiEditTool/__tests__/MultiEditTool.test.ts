import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache.js'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import {
  executeFileEdits,
  validateFileEdits,
} from '../../FileEditTool/fileEditPipeline.js'
import { FileEditTool } from '../../FileEditTool/FileEditTool.js'

const originalSimpleMode = process.env.CLAUDE_CODE_SIMPLE
const originalCheckpoints = process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING
let tempDir = ''

beforeAll(() => {
  process.env.CLAUDE_CODE_SIMPLE = '1'
  process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING = '1'
  tempDir = mkdtempSync(join(tmpdir(), 'native-multi-edit-'))
})

afterAll(() => {
  if (originalSimpleMode === undefined) delete process.env.CLAUDE_CODE_SIMPLE
  else process.env.CLAUDE_CODE_SIMPLE = originalSimpleMode
  if (originalCheckpoints === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING
  } else {
    process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING = originalCheckpoints
  }
  rmSync(tempDir, { recursive: true, force: true })
})

function createExecutionContext(filePath: string, content: string): any {
  const readFileState = createFileStateCacheWithSizeLimit(10)
  readFileState.set(filePath, {
    content,
    timestamp: Number.MAX_SAFE_INTEGER,
    offset: undefined,
    limit: undefined,
  })
  return {
    readFileState,
    userModified: false,
    updateFileHistoryState: () => {},
    dynamicSkillDirTriggers: new Set<string>(),
    getAppState: () => ({
      toolPermissionContext: getEmptyToolPermissionContext(),
    }),
  }
}

describe('validateFileEdits', () => {
  test('validates the complete ordered batch before execution', async () => {
    const target = join(tempDir, 'validate-success.md')
    const original = '<!-- one -->\n<!-- two -->\n'
    await Bun.write(target, original)
    const context = createExecutionContext(target, original)

    const result = await validateFileEdits(
      {
        file_path: target,
        edits: [
          { old_string: '<!-- one -->', new_string: 'ONE', replace_all: false },
          { old_string: '<!-- two -->', new_string: 'TWO', replace_all: false },
        ],
      },
      context,
    )

    expect(result.result).toBe(true)
    expect(await Bun.file(target).text()).toBe(original)
  })

  test('returns a validation failure for a missing later replacement', async () => {
    const target = join(tempDir, 'validate-failure.md')
    const original = '<!-- one -->\n'
    await Bun.write(target, original)
    const context = createExecutionContext(target, original)

    const result = await validateFileEdits(
      {
        file_path: target,
        edits: [
          { old_string: '<!-- one -->', new_string: 'ONE', replace_all: false },
          { old_string: 'missing', new_string: 'never', replace_all: false },
        ],
      },
      context,
    )

    expect(result).toMatchObject({
      result: false,
      message: expect.stringContaining('String to replace not found'),
    })
    expect(await Bun.file(target).text()).toBe(original)
  })
})

describe('executeFileEdits', () => {
  test('commits all ordered replacements with one atomic result', async () => {
    const target = join(tempDir, 'atomic-success.md')
    mkdirSync(tempDir, { recursive: true })
    const original = 'alpha\n<!-- one -->\n<!-- two -->\nomega\n'
    await Bun.write(target, original)
    const context = createExecutionContext(target, original)

    const result = await executeFileEdits(
      {
        file_path: target,
        edits: [
          { old_string: '<!-- one -->', new_string: 'ONE', replace_all: false },
          { old_string: '<!-- two -->', new_string: 'TWO', replace_all: false },
        ],
      },
      context,
      { uuid: crypto.randomUUID() } as any,
    )

    expect(await Bun.file(target).text()).toBe('alpha\nONE\nTWO\nomega\n')
    expect(result.edits).toHaveLength(2)
    expect(result.structuredPatch.length).toBeGreaterThan(0)
  })

  test('leaves the file unchanged when any replacement fails', async () => {
    const target = join(tempDir, 'atomic-failure.md')
    const original = 'alpha\nONE\nTWO\nomega\n'
    await Bun.write(target, original)
    const context = createExecutionContext(target, original)

    await expect(
      executeFileEdits(
        {
          file_path: target,
          edits: [
            { old_string: 'ONE', new_string: 'one again', replace_all: false },
            {
              old_string: 'missing',
              new_string: 'never written',
              replace_all: false,
            },
          ],
        },
        context,
        { uuid: crypto.randomUUID() } as any,
      ),
    ).rejects.toThrow('String to replace not found')

    expect(await Bun.file(target).text()).toBe(original)
  })
})

describe('FileEditTool compatibility', () => {
  test('preserves single-edit validation metadata and ambiguity errors', async () => {
    const target = join(tempDir, 'single-edit-validation.md')
    const original = 'TARGET\nTARGET\n'
    await Bun.write(target, original)
    const context = createExecutionContext(target, original)

    const ambiguous = await FileEditTool.validateInput!(
      {
        file_path: target,
        old_string: 'TARGET',
        new_string: 'replacement',
        replace_all: false,
      },
      context,
    )
    expect(ambiguous).toMatchObject({ result: false, errorCode: 9 })

    const valid = await FileEditTool.validateInput!(
      {
        file_path: target,
        old_string: 'TARGET',
        new_string: 'replacement',
        replace_all: true,
      },
      context,
    )
    expect(valid).toMatchObject({
      result: true,
      meta: { actualOldString: 'TARGET' },
    })
  })

  test('preserves the existing single-edit output contract', async () => {
    const target = join(tempDir, 'single-edit.md')
    const original = 'before\nTARGET\nafter\n'
    await Bun.write(target, original)
    const context = createExecutionContext(target, original)

    const result = await FileEditTool.call(
      {
        file_path: target,
        old_string: 'TARGET',
        new_string: 'replacement',
        replace_all: false,
      },
      context,
      undefined as any,
      { uuid: crypto.randomUUID() } as any,
    )

    expect(await Bun.file(target).text()).toBe('before\nreplacement\nafter\n')
    expect(result.data).toMatchObject({
      filePath: target,
      oldString: 'TARGET',
      newString: 'replacement',
      replaceAll: false,
      userModified: false,
    })
  })
})
