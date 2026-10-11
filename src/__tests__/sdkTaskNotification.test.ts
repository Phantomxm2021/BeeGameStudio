import { describe, expect, test } from 'bun:test'
import { parseTaskNotificationSdkEvent } from '../utils/sdkEventQueue'

const notification = (status: string) =>
  '<task-notification><task-id>art-child</task-id><tool-use-id>tool-art</tool-use-id>' +
  '<output-file>art.output</output-file><status>' +
  status +
  '</status>' +
  '<summary>Art task finished</summary><result>Document saved</result>' +
  '<usage><total_tokens>32433</total_tokens><tool_uses>2</tool_uses>' +
  '<duration_ms>264121</duration_ms></usage></task-notification>'

describe('task notification SDK metadata', () => {
  for (const status of ['completed', 'failed', 'stopped', 'killed'] as const) {
    test('preserves terminal status ' + status, () => {
      expect(parseTaskNotificationSdkEvent(notification(status))).toEqual({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'art-child',
        tool_use_id: 'tool-art',
        status: status === 'killed' ? 'stopped' : status,
        output_file: 'art.output',
        summary: 'Art task finished',
        usage: { total_tokens: 32433, tool_uses: 2, duration_ms: 264121 },
      })
    })
  }
  test('progress, invalid status and missing identity cannot close a task', () => {
    for (const value of [
      undefined,
      [],
      notification('running'),
      notification('unknown'),
      notification('completed').replace('<task-id>art-child</task-id>', ''),
      notification('completed').replace('<status>completed</status>', ''),
      '<task-id>art-child</task-id><result><status>completed</status></result>',
    ])
      expect(parseTaskNotificationSdkEvent(value)).toBeUndefined()
  })
})
