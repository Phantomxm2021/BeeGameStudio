import { describe, expect, test } from 'bun:test'
import type { Message } from 'src/types/message.js'
import forceSnip from '../force-snip'

function message(index: number): Message {
  return {
    uuid: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    type: 'user',
    message: { role: 'user', content: `message ${index}` },
    timestamp: '2026-06-22T00:00:00.000Z',
  } as Message
}

describe('force-snip command', () => {
  test('appends a snip boundary that records removed message UUIDs', async () => {
    let messages = [message(1), message(2)]
    const command = await forceSnip.load()
    const result = await command.call('', {
      messages,
      setMessages: (updater: (prev: Message[]) => Message[]) => {
        messages = updater(messages)
      },
    } as never)

    expect(result).toEqual({
      type: 'text',
      value:
        'Snipped 2 message(s). Older history will be excluded from the next model query.',
    })
    expect(messages).toHaveLength(3)
    const boundary = messages[2] as Message & {
      subtype?: string
      snipMetadata?: { removedUuids?: string[] }
    }
    expect(boundary.type).toBe('system')
    expect(boundary.subtype).toBe('snip_boundary')
    expect(boundary.snipMetadata?.removedUuids).toEqual([
      messages[0]!.uuid,
      messages[1]!.uuid,
    ])
  })
})
