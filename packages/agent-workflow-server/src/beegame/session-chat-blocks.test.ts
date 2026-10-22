import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager } from './session-manager'

test('BGS item messages preserve whitespace and independent block IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beegame-chat-blocks-'))
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit({ onMessage }) {
    for (const index of [1, 3]) {
      const assistantBlockId = `item-${index}`
      for (const text of ['paragraph', '\n\n', String(index)])
        await onMessage({ type: 'runtime_event', eventType: 'assistant.partial', text, assistantBlockId })
      await onMessage({ type: 'runtime_event', eventType: 'assistant.message', text: '.', assistantBlockId })
    }
  } }) }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'workspace'), projectId: 'chat-test', userId: 'test' })
    await manager.send(session.id, 'hello')
    await manager.waitForSessionIdle(session.id)
    const events = manager.events(session.id)
    const finals = events.filter(e => e.type === 'assistant.message')
    expect(finals.map(e => e.text)).toEqual(['.', '.'])
    expect(new Set(finals.map(e => e.payload?.assistantBlockId)).size).toBe(2)
    expect(events.filter(e => e.type === 'assistant.partial' && e.text === '\n\n')).toHaveLength(2)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})
