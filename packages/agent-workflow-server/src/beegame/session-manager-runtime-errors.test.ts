import { describe, expect, test } from 'bun:test'
import { getSDKExecutionErrorDetail, workflowToolRestriction } from './session-manager'

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

  test('limits Checklist authors to candidate writes without allowing a shell escape', () => {
    const record = { workflowAllowedTools: ['Write', 'Edit'] }
    expect(workflowToolRestriction(record as never, {
      toolName: 'Write',
    } as never)).toBeUndefined()
    expect(workflowToolRestriction(record as never, {
      toolName: 'Bash',
    } as never)).toContain('Write, Edit')
    expect(workflowToolRestriction(record as never, {
      toolName: 'Read',
    } as never)).toContain('Write, Edit')
  })
})
