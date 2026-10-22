import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager } from './session-manager'

test('session lifecycle uses structured task status without interpreting notification text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-task-notification-'))
  const manager = new BeeGameSessionManager({ start: async options => ({ stop() {}, async submit(turn) {
    const notify = (subtype: string, taskId: string, status?: string) => options.onNativeTaskNotification?.({
      value: 'completed 検証済み / 완료',
      message: { type: 'system', subtype, task_id: taskId, tool_use_id: taskId + '-tool',
        ...(status ? { status } : {}), summary: '検証済み / 완료' },
    })
    notify('task_started', 'other')
    for (const status of ['completed', 'failed', 'stopped', 'killed']) {
      notify('task_started', status)
      notify('task_notification', status, 'unrecognized')
      expect(manager.runtimeSnapshot(options.sessionId)?.activeSubagentToolUseIds).toEqual(['other-tool', status + '-tool'])
      notify('task_notification', status, status)
      notify('task_progress', status)
      expect(manager.runtimeSnapshot(options.sessionId)?.activeSubagentToolUseIds).toEqual(['other-tool'])
    }
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Offline fixture complete' })
  } }) }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'workspace'), projectId: 'fixture', userId: 'test' })
    await manager.send(session.id, 'Offline fixture')
    await manager.waitForSessionIdle(session.id)
    expect(manager.runtimeSnapshot(session.id)?.activeSubagentToolUseIds).toEqual(['other-tool'])
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})
