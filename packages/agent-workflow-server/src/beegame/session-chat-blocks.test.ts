import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager } from './session-manager'

test('native worker streams whitespace and independent text blocks of the same model message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beegame-chat-blocks-'))
  const manager = new BeeGameSessionManager({ start: async () => ({ stop() {}, async submit({ onMessage }) {
    const emit = (event: Record<string, unknown>) => onMessage({ type: 'stream_event', event })
    emit({ type: 'message_start', message: { id: 'native-message' } })
    for (const index of [1, 3]) {
      emit({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
      for (const text of ['paragraph', '\n\n', String(index)])
        emit({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } })
      emit({ type: 'content_block_stop', index })
      onMessage({ type: 'assistant', message: { id: 'native-message', content: [{ type: 'text', text: `paragraph\n\n${index}` }] } })
    }
  } }) }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'workspace'), projectId: 'chat-test', userId: 'test' })
    await manager.send(session.id, 'hello')
    for (let attempt = 0; attempt < 100 && manager.events(session.id).filter(e => e.type === 'assistant.message').length < 2; attempt++)
      await Bun.sleep(5)
    const events = manager.events(session.id)
    const finals = events.filter(e => e.type === 'assistant.message')
    expect(finals.map(e => e.text)).toEqual(['paragraph\n\n1', 'paragraph\n\n3'])
    expect(new Set(finals.map(e => e.payload?.assistantBlockId)).size).toBe(2)
    expect(events.filter(e => e.type === 'assistant.partial' && e.text === '\n\n')).toHaveLength(2)
  } finally { manager.dispose(); await rm(root, { recursive: true, force: true }) }
})
