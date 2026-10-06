import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createNativeCliProcessRunner } from '../../packages/agent-workflow-server/src/beegame/native-cli-process-runner'
import { BeeGameSessionManager } from '../../packages/agent-workflow-server/src/beegame/session-manager'

const fixture = fileURLToPath(new URL('./fixtures/direction-handoff-runtime.ts', import.meta.url))

test.each([2, 3, 4] as const)('writing batch %d preserves dependent task ordering through the real SDK/outer runner', async batch => {
  const cwd = await mkdtemp('/private/tmp/bgs-ordered-author-sdk-')
  const runtime = await createNativeCliProcessRunner({ command: [process.execPath, fixture] })
    .start({ sessionId: 'ordered-author', cwd, env: {} })
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 4_000)
  const messages: Record<string, unknown>[] = []
  try {
    await runtime.submit({ prompt: 'batch-' + batch, signal: controller.signal,
      onMessage: message => { messages.push(message) }, requestPermission: async () => ({ behavior: 'deny' }) })
    const starts = messages.filter(row => row.subtype === 'task_started')
    const ends = messages.filter(row => row.subtype === 'task_notification')
    expect(starts).toHaveLength(batch === 3 ? 1 : 2)
    expect(ends).toHaveLength(starts.length)
    for (const [i, start] of starts.entries()) {
      const end = ends.find(row => row.task_id === start.task_id)!
      expect(end.status).toBe('completed')
      expect(end.tool_use_id).toBe(start.tool_use_id)
      if (i + 1 < starts.length) expect(messages.indexOf(end)).toBeLessThan(messages.indexOf(starts[i + 1]!))
      expect(JSON.stringify(messages).split('Final answer ' + start.task_id)).toHaveLength(2)
    }
    expect(messages.at(-1)?.subtype).toBe('success')
    expect(messages.at(-1)?.queuedNotifications).toBe(0)
    expect(JSON.stringify(messages)).not.toContain('TaskOutput')
  } finally { clearTimeout(timeout); await runtime.dispose?.(); await rm(cwd, { recursive: true, force: true }) }
})

for (const mode of ['completed', 'foreground', 'fast', 'evicted', 'failed', 'killed', 'cancelled']) {
  test('real scheduled-author SDK handoff reaches the outer runner: ' + mode, async () => {
    const cwd = await mkdtemp('/private/tmp/bgs-direction-handoff-test-')
    const runtime = await createNativeCliProcessRunner({ command: [process.execPath, fixture] })
      .start({ sessionId: 'direction-handoff', cwd, env: {} })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort('test_timeout'), 4_000)
    const messages: Record<string, unknown>[] = []
    try {
      const submitted = runtime.submit({ prompt: mode, signal: controller.signal,
        onMessage: message => { messages.push(message) }, requestPermission: async () => ({ behavior: 'deny' }),
      })
      if (mode === 'failed' || mode === 'killed') await expect(submitted).rejects.toThrow('did not complete')
      else if (mode === 'cancelled') await expect(submitted).rejects.toThrow('cancelled')
      else await submitted
      const starts = messages.filter(row => row.subtype === 'task_started')
      const ends = messages.filter(row => row.subtype === 'task_notification')
      expect(starts).toHaveLength(3)
      if (mode === 'completed' || mode === 'foreground' || mode === 'fast' || mode === 'evicted') {
        expect(ends).toHaveLength(3)
        expect(ends.map(row => row.task_id).sort()).toEqual(starts.map(row => row.task_id).sort())
        for (const end of ends) {
          const start = starts.find(row => row.task_id === end.task_id)!
          expect(end.tool_use_id).toBe(start.tool_use_id)
          expect(end.status).toBe('completed')
          expect(messages.indexOf(end)).toBeLessThan(messages.findIndex(row => row.type === 'result'))
        }
      } else if (mode === 'cancelled') {
        expect(ends).toHaveLength(0)
      } else {
        expect(ends).toHaveLength(3)
        expect(ends.every(row => row.status === (mode === 'killed' ? 'stopped' : 'failed'))).toBe(true)
        expect(ends.some(row => row.status === 'completed')).toBe(false)
      }
      expect(messages.at(-1)?.queuedNotifications).toBe(0)
      const text = JSON.stringify(messages)
      expect(text).not.toContain('TaskOutput')
      if (['completed', 'fast', 'evicted'].includes(mode)) for (const start of starts)
        expect(text.split('Final answer ' + start.task_id)).toHaveLength(2)
      if (['failed', 'killed', 'cancelled'].includes(mode))
        expect(text).not.toContain('Actual final handoff:')
    } finally {
      clearTimeout(timeout)
      await runtime.dispose?.()
      await rm(cwd, { recursive: true, force: true })
    }
  })
}

test('scheduled authors release the real session settlement and next-turn guard', async () => {
  const root = await mkdtemp('/private/tmp/bgs-direction-session-test-')
  const manager = new BeeGameSessionManager(
    createNativeCliProcessRunner({ command: [process.execPath, fixture] }), root)
  const session = manager.start({ workspacePath: root, userId: 'offline-owner', projectId: 'offline-project' })
  let expired = false
  let settlements = 0
  let ready = 0
  const timeout = setTimeout(() => { expired = true; manager.stop(session.id) }, 8_000)
  try {
    for (const mode of ['completed', 'fast']) {
      await manager.sendWithDisplay(session.id, mode, {
        usageExternallyAccounted: true,
        onTurnSettled: async () => { settlements++ },
        onTurnReady: () => { ready++ },
      })
      await manager.waitForSessionIdle(session.id)
      await Bun.sleep(0)
      expect(expired).toBe(false)
      expect(manager.get(session.id)?.turnStatus).toBe('idle')
      expect(manager.runtimeSnapshot(session.id).activeSubagentToolUseIds).toEqual([])
    }
    expect(settlements).toBe(2)
    expect(ready).toBe(2)
    const events = manager.transcript(session.id)
    expect(events.filter(row => row.type === 'turn.completed')).toHaveLength(2)
    expect(events.some(row => row.type === 'turn.failed')).toBe(false)
  } finally {
    clearTimeout(timeout)
    await manager.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 10_000)

for (const mode of ['mixed-failure', 'cancelled']) {
  test('failed scheduler disposal clears the session active indicators: ' + mode, async () => {
    const root = await mkdtemp('/private/tmp/bgs-direction-session-failure-test-')
    const manager = new BeeGameSessionManager(
      createNativeCliProcessRunner({ command: [process.execPath, fixture] }), root)
    const session = manager.start({ workspacePath: root, userId: 'offline-owner', projectId: 'offline-project' })
    let expired = false
    const timeout = setTimeout(() => { expired = true; manager.stop(session.id) }, 4_000)
    try {
      await manager.sendWithDisplay(session.id, mode, { usageExternallyAccounted: true })
      await manager.waitForSessionIdle(session.id)
      expect(expired).toBe(false)
      expect(manager.get(session.id)?.turnStatus).toBe('idle')
      expect(manager.runtimeSnapshot(session.id).activeSubagentToolUseIds).toEqual([])
      const events = manager.transcript(session.id)
      expect(events.filter(row => row.type === 'turn.failed')).toHaveLength(1)
      expect(events.some(row => row.type === 'turn.completed')).toBe(false)
    } finally {
      clearTimeout(timeout)
      await manager.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
}
