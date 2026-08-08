import { describe, expect, test } from 'bun:test'
import { assertProviderCompletionReason } from '@ant/model-provider'

describe('provider completion terminal', () => {
  test('rejects a missing or blank completion reason', () => {
    for (const value of [undefined, null, '', '   '])
      expect(() => assertProviderCompletionReason(value)).toThrow(
        'Provider response ended without a completion reason',
      )
  })

  test('accepts every non-empty canonical completion reason', () => {
    for (const value of ['end_turn', 'tool_use', 'max_tokens'])
      expect(() => assertProviderCompletionReason(value)).not.toThrow()
  })
})
