import { describe, expect, test } from 'bun:test'
import { SnipTool } from '../SnipTool'

describe('SnipTool', () => {
  test('reports snipped message count and summary', async () => {
    const result = await SnipTool.call(
      {
        message_ids: ['msg-1', 'msg-2'],
        reason: 'Old exploration is no longer needed.',
      }
    )

    expect(result.data).toEqual({
      snipped_count: 2,
      summary: 'Old exploration is no longer needed.',
    })
    expect(SnipTool.renderToolUseMessage({ message_ids: ['msg-1'] })).toBe(
      'Snip: 1 message',
    )
    expect(SnipTool.userFacingName()).toBe('Snip')
  })
})
