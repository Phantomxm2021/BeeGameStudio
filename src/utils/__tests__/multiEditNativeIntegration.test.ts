import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, writeFile } from 'fs/promises'
import { MULTI_EDIT_TOOL_NAME } from '@bee-game-studio/builtin-tools/tools/MultiEditTool/constants.js'
import { isCodeEditingTool } from '../../hooks/toolPermission/permissionLogging.js'
import { getAutoMemPath } from '../../memdir/paths.js'
import type { Message } from '../../types/message.js'
import { extractReadFilesFromMessages } from '../queryHelpers.js'
import { isMemoryFileAccess } from '../sessionFileAccessHooks.js'
import { createStreamlinedTransformer } from '../streamlinedTransform.js'

describe('native MultiEdit integration', () => {
  test('classifies MultiEdit as a code editing tool', () => {
    expect(isCodeEditingTool(MULTI_EDIT_TOOL_NAME)).toBe(true)
  })

  test('recognizes MultiEdit access to an auto-memory file', () => {
    expect(
      isMemoryFileAccess(MULTI_EDIT_TOOL_NAME, {
        file_path: join(getAutoMemPath(), 'MEMORY.md'),
        edits: [{ old_string: 'before', new_string: 'after' }],
      }),
    ).toBe(true)
  })

  test('restores post-MultiEdit disk state when rebuilding the read cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'multi-edit-cache-'))
    const target = join(dir, 'document.md')
    await writeFile(target, 'updated on disk\n')

    const messages = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'multi-edit-1',
              name: MULTI_EDIT_TOOL_NAME,
              input: {
                file_path: target,
                edits: [{ old_string: 'before', new_string: 'after' }],
              },
            },
          ],
        },
      },
      {
        type: 'user',
        timestamp: Date.now(),
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'multi-edit-1',
              content: 'updated',
              is_error: false,
            },
          ],
        },
      },
    ] as unknown as Message[]

    expect(extractReadFilesFromMessages(messages, dir).get(target)?.content).toBe(
      'updated on disk\n',
    )
  })

  test('reports MultiEdit as a write in streamlined output', () => {
    const transform = createStreamlinedTransformer()
    const output = transform({
      type: 'assistant',
      session_id: 'session',
      uuid: 'message',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'multi-edit-1',
            name: MULTI_EDIT_TOOL_NAME,
            input: { file_path: '/tmp/document.md', edits: [] },
          },
        ],
      },
    } as never)

    expect(output).toMatchObject({
      type: 'streamlined_tool_use_summary',
      tool_summary: 'Wrote 1 file',
    })
  })
})
