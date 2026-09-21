import { expect, test } from 'bun:test'
import { parseNativeTerminalTaskNotification } from './native-task-notification'

test('reads structured task lifecycle without interpreting result language', () => {
  const message = { type: 'system', subtype: 'task_notification', task_id: 'a1',
    tool_use_id: 'resume-2', status: 'completed', summary: '検証済み / 완료' }
  expect(parseNativeTerminalTaskNotification({ value: JSON.stringify(message) }))
    .toEqual({ key: 'resume-2', taskId: 'a1', toolUseId: 'resume-2', status: 'completed', result: message.summary })
  expect(parseNativeTerminalTaskNotification({ value: 'irrelevant', message })?.status).toBe('completed')
  expect(parseNativeTerminalTaskNotification({ value: 'completed 検証済み' })).toBeUndefined()
  expect(parseNativeTerminalTaskNotification({ value: JSON.stringify({ ...message, subtype: 'task_started' }) })).toBeUndefined()
})

test('retains native XML notification support', () => {
  expect(parseNativeTerminalTaskNotification({ value: '<task-id>a1</task-id><status>failed</status><result>not complete</result>' }))
    .toEqual({ key: 'a1', taskId: 'a1', status: 'failed', result: 'not complete' })
})
