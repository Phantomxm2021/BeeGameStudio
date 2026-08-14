import { afterEach, describe, expect, test } from 'bun:test'
import type { Message } from '../../../types/message.js'
import { microcompactMessages } from '../microCompact.js'

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

describe('durable tool history', () => {
  test('preserves the cached prefix for a custom Anthropic endpoint', async () => {
    process.env.BEEGAME_MODEL_TYPE = 'anthropic'
    process.env.ANTHROPIC_BASE_URL = 'https://provider.example.test'
    const originalContent = 'body '.repeat(4_000)
    const readResult = 'document line\n'.repeat(4_000)
    const messages: Message[] = [
      assistant([
        {
          type: 'tool_use',
          id: 'tool-write-custom',
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
          tool_use_id: 'tool-write-custom',
          content: 'File written successfully',
        },
      ]),
      assistant([
        {
          type: 'tool_use',
          id: 'tool-read-custom',
          name: 'Read',
          input: { file_path: '/project/docs/GDD.md' },
        },
      ]),
      user([
        {
          type: 'tool_result',
          tool_use_id: 'tool-read-custom',
          content: readResult,
        },
      ]),
      assistant([
        {
          type: 'tool_use',
          id: 'tool-edit-latest',
          name: 'Edit',
          input: {
            file_path: '/project/docs/GDD.md',
            old_string: 'old',
            new_string: 'new',
          },
        },
      ]),
      user([
        {
          type: 'tool_result',
          tool_use_id: 'tool-edit-latest',
          content: 'File edited successfully',
        },
      ]),
    ]

    const result = await microcompactMessages(messages)

    expect(
      (blocksOf(result.messages[0]!)[0]!.input as { content: string }).content,
    ).toBe(originalContent)
    expect(blocksOf(result.messages[1]!)[0]!.content).toBe(
      'File written successfully',
    )
    expect(blocksOf(result.messages[3]!)[0]!.content).toBe(readResult)
  })
})
