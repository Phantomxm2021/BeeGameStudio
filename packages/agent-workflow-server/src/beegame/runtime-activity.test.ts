import { expect, test } from 'bun:test'
import { runtimeActivity } from './runtime-activity'

test('workflow timestamp does not hide later agent, tool and subagent observations', () => {
  expect(runtimeActivity([
    { type: 'tool.started', createdAt: '2026-09-20T12:10:00Z' },
    { type: 'system.status', createdAt: '2026-09-20T12:11:00Z', payload: { type: 'system', subtype: 'task_progress' } },
    { type: 'assistant.message', createdAt: '2026-09-20T12:12:00Z' },
  ], '2026-09-20T12:00:00Z')).toEqual({
    workflowUpdatedAt: '2026-09-20T12:00:00Z',
    agentEventAt: '2026-09-20T12:12:00.000Z', toolEventAt: '2026-09-20T12:10:00.000Z',
    subagentEventAt: '2026-09-20T12:11:00.000Z',
  })
  expect(runtimeActivity([]).agentEventAt).toBeNull()
})
