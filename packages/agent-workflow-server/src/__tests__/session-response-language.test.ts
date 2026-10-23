import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager, type BeeGameSessionSubmitInput } from '../beegame/session-manager'

test('a language change relaunches the native runner without changing the user message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-response-language-'))
  let starts = 0
  const submissions: BeeGameSessionSubmitInput[] = []
  const manager = new BeeGameSessionManager({
    start: async () => {
      starts++
      return {
        stop() {},
        async submit(input) {
          submissions.push(input)
          await input.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Done' })
        },
      }
    },
  }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'workspace'), projectId: 'language-test', userId: 'offline', language: 'zh' })
    for (const language of ['zh', 'en'] as const) {
      await manager.sendWithDisplay(session.id, 'Continue', { language })
      for (let i = 0; i < 200 && manager.get(session.id)?.turnStatus !== 'idle'; i++)
        await new Promise(resolve => setTimeout(resolve, 5))
      expect(manager.get(session.id)?.turnStatus).toBe('idle')
    }
    expect(starts).toBe(2)
    expect(submissions.map(input => input.language)).toEqual(['zh', 'en'])
    expect(submissions.map(input => input.prompt)).toEqual(['Continue', 'Continue'])
  } finally {
    await manager.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
