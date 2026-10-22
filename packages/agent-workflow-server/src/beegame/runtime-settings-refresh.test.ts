import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager } from './session-manager'

test('changing capabilities during work refreshes the next task without interrupting or replaying work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-settings-refresh-'))
  let starts = 0, disposed = 0, turns = 0
  let release!: () => void
  let entered!: () => void
  const running = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const manager = new BeeGameSessionManager({ async start() {
    starts++
    return {
      stop() {}, async dispose() { disposed++ },
      async submit(input) {
        turns++
        if (turns === 1) { entered(); await gate }
        await input.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Synthetic task complete' })
      },
    }
  } }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'workspace'), userId: 'fixture' })
    await manager.send(session.id, 'First synthetic task')
    await running
    expect(manager.refreshIdleRunners()).toBe(0)
    expect(disposed).toBe(0)
    release()
    await manager.waitForSessionIdle(session.id)
    expect(turns).toBe(1)
    await manager.send(session.id, 'Second synthetic task')
    await manager.waitForSessionIdle(session.id)
    expect(starts).toBe(2)
    expect(disposed).toBe(1)
    expect(turns).toBe(2)
  } finally {
    release?.()
    await manager.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
