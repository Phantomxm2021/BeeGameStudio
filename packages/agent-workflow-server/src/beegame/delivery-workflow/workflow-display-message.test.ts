import { describe, expect, test } from 'bun:test'
import { sanitizeWorkflowDisplayMessage } from './workflow-display-message'

describe('sanitizeWorkflowDisplayMessage', () => {
  test('keeps human-readable workflow progress', () => {
    expect(sanitizeWorkflowDisplayMessage('正在审计资源清单。')).toBe(
      '正在审计资源清单。',
    )
  })

  test('removes a complete structured worker payload', () => {
    expect(
      sanitizeWorkflowDisplayMessage(
        JSON.stringify({
          workerType: 'resource-curator',
          status: 'completed',
          revision: 'resource-revision',
        }),
      ),
    ).toBe('')
  })

  test('keeps prose while removing a fenced protocol payload', () => {
    expect(
      sanitizeWorkflowDisplayMessage(
        '资源审计完成。\n```json\n{"status":"completed"}\n```',
      ),
    ).toBe('资源审计完成。')
  })
})
