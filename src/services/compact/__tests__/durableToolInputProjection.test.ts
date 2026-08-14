import { afterEach, describe, expect, test } from 'bun:test'
import type { Message } from '../../../types/message.js'
import {
  microcompactMessages,
  projectCompletedFileMutationInputs,
} from '../microCompact.js'

const originalBaseUrl = process.env.ANTHROPIC_BASE_URL
const originalModelType = process.env.BEEGAME_MODEL_TYPE

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = originalBaseUrl
  if (originalModelType === undefined) delete process.env.BEEGAME_MODEL_TYPE
  else process.env.BEEGAME_MODEL_TYPE = originalModelType
})

const assistant = (content: unknown[]): Message =>
  ({
    type: 'assistant',
    uuid: crypto.randomUUID(),
    message: { role: 'assistant', content },
  }) as Message

const user = (content: unknown[]): Message =>
  ({
    type: 'user',
    uuid: crypto.randomUUID(),
    message: { role: 'user', content },
  }) as Message

const blocksOf = (message: Message): Array<Record<string, unknown>> =>
  message.message!.content as unknown as Array<Record<string, unknown>>

describe('projectCompletedFileMutationInputs', () => {
  test('removes older Write content but keeps the latest mutation in working context', () => {
    const originalContent = '# Long document\n' + 'body '.repeat(4_000)
    const latestContent = 'latest section body'
    const messages: Message[] = [
      assistant([
        {
          type: 'tool_use',
          id: 'tool-write-1',
          name: 'Write',
          input: { file_path: '/project/docs/GDD.md', content: originalContent },
        },
      ]),
      user([
        {
          type: 'tool_result',
          tool_use_id: 'tool-write-1',
          content: 'File written successfully',
        },
      ]),
      assistant([
        {
          type: 'tool_use',
          id: 'tool-write-2',
          name: 'Write',
          input: {
            file_path: '/project/docs/Latest.md',
            content: latestContent,
          },
        },
      ]),
      user([
        {
          type: 'tool_result',
          tool_use_id: 'tool-write-2',
          content: 'File written successfully',
        },
      ]),
    ]

    const projected = projectCompletedFileMutationInputs(messages)
    const projectedBlock = blocksOf(projected[0]!)[0]!
    const originalBlock = blocksOf(messages[0]!)[0]!

    expect(projectedBlock.input).toEqual({
      file_path: '/project/docs/GDD.md',
      content: '[Previously written content cleared; read the file if needed]',
    })
    expect((originalBlock.input as { content: string }).content).toBe(
      originalContent,
    )
    expect(
      (blocksOf(projected[2]!)[0]!.input as { content: string }).content,
    ).toBe(latestContent)
  })

  test('removes completed Edit replacement payloads', () => {
    const messages: Message[] = [
      assistant([
        {
          type: 'tool_use',
          id: 'tool-edit-1',
          name: 'Edit',
          input: {
            file_path: '/project/docs/GDD.md',
            old_string: '<!-- section -->',
            new_string: 'body '.repeat(4_000),
            replace_all: false,
          },
        },
      ]),
      user([
        {
          type: 'tool_result',
          tool_use_id: 'tool-edit-1',
          content: 'File edited successfully',
        },
      ]),
      assistant([
        {
          type: 'tool_use',
          id: 'tool-write-after-edit',
          name: 'Write',
          input: {
            file_path: '/project/docs/Latest.md',
            content: 'latest mutation',
          },
        },
      ]),
      user([
        {
          type: 'tool_result',
          tool_use_id: 'tool-write-after-edit',
          content: 'File written successfully',
        },
      ]),
    ]

    const projected = projectCompletedFileMutationInputs(messages)
    const block = blocksOf(projected[0]!)[0]!

    expect(block.input).toEqual({
      file_path: '/project/docs/GDD.md',
      old_string: '[Previously replaced text cleared]',
      new_string: '[Previously written content cleared; read the file if needed]',
      replace_all: false,
    })
  })

  test('keeps failed and unresolved file mutation inputs intact', () => {
    const failedInput = {
      file_path: '/project/docs/GDD.md',
      content: 'failed body',
    }
    const pendingInput = {
      file_path: '/project/docs/GDD.md',
      content: 'pending body',
    }
    const messages: Message[] = [
      assistant([
        {
          type: 'tool_use',
          id: 'tool-write-failed',
          name: 'Write',
          input: failedInput,
        },
        {
          type: 'tool_use',
          id: 'tool-write-pending',
          name: 'Write',
          input: pendingInput,
        },
      ]),
      user([
        {
          type: 'tool_result',
          tool_use_id: 'tool-write-failed',
          content: 'permission denied',
          is_error: true,
        },
      ]),
    ]

    const projected = projectCompletedFileMutationInputs(messages)
    const blocks = blocksOf(projected[0]!)

    expect(blocks[0]!.input).toEqual(failedInput)
    expect(blocks[1]!.input).toEqual(pendingInput)
  })

  test('uses the local projection for a custom Anthropic endpoint', async () => {
    process.env.BEEGAME_MODEL_TYPE = 'anthropic'
    process.env.ANTHROPIC_BASE_URL = 'https://provider.example.test'
    const messages: Message[] = [
      assistant([
        {
          type: 'tool_use',
          id: 'tool-write-custom',
          name: 'Write',
          input: {
            file_path: '/project/docs/GDD.md',
            content: 'body '.repeat(4_000),
          },
        },
      ]),
      user([
        {
          type: 'tool_result',
          tool_use_id: 'tool-write-custom',
          content: 'File written successfully',
        },
      ]),
    ]

    messages.push(
      assistant([
        {
          type: 'tool_use',
          id: 'tool-write-custom-latest',
          name: 'Write',
          input: {
            file_path: '/project/docs/Latest.md',
            content: 'latest mutation',
          },
        },
      ]),
      user([
        {
          type: 'tool_result',
          tool_use_id: 'tool-write-custom-latest',
          content: 'File written successfully',
        },
      ]),
    )

    const result = await microcompactMessages(messages)
    const block = blocksOf(result.messages[0]!)[0]!

    expect((block.input as { content: string }).content).toBe(
      '[Previously written content cleared; read the file if needed]',
    )
  })

  test('leaves official Anthropic history for server-side context management', async () => {
    process.env.BEEGAME_MODEL_TYPE = 'anthropic'
    process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
    const originalContent = 'body '.repeat(4_000)
    const messages: Message[] = [
      assistant([
        {
          type: 'tool_use',
          id: 'tool-write-official',
          name: 'Write',
          input: {
            file_path: '/project/docs/GDD.md',
            content: originalContent,
          },
        },
      ]),
      user([
        {
          type: 'tool_result',
          tool_use_id: 'tool-write-official',
          content: 'File written successfully',
        },
      ]),
    ]

    const result = await microcompactMessages(messages)
    const block = blocksOf(result.messages[0]!)[0]!

    expect((block.input as { content: string }).content).toBe(originalContent)
  })
})
