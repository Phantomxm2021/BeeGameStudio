import { describe, expect, test } from 'bun:test'
import { getSDKExecutionErrorDetail } from './session-manager'

describe('BeeGame SDK execution errors', () => {
  test('preserves a structured runtime result when the SDK omits its errors array', () => {
    expect(getSDKExecutionErrorDetail({
      type: 'result',
      is_error: true,
      result: 'Provider request reached its deadline.',
    })).toBe('Provider request reached its deadline.')
  })

  test('prefers the SDK errors array when it is available', () => {
    expect(getSDKExecutionErrorDetail({
      type: 'result',
      is_error: true,
      result: 'Fallback detail',
      errors: ['Primary detail'],
    })).toBe('Primary detail')
  })
})
