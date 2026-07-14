import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getProductionDeliveryFailure } from '../app'
import { BeeGameSessionManager, type BeeGameSessionRunner } from './session-manager'

describe('production deployment acceptance boundary', () => {
  test('blocks deployment for a production session without independent delivery evidence', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-deployment-gate-'))
    const runner: BeeGameSessionRunner = {
      async start() {
        return {
          async submit(input) {
            input.onMessage({ type: 'result', result: 'Implementation turn ended.' })
          },
          stop() {},
        }
      },
    }
    const manager = new BeeGameSessionManager(runner, workspace)
    try {
      const session = manager.start({ workspacePath: workspace, userId: 'test-user' })
      await manager.sendWithDisplay(session.id, 'Implement the approved brief.', {
        displayKind: 'confirmed_brief',
      })
      await waitFor(() => manager.get(session.id)?.turnStatus === 'idle')

      expect(manager.requiresProductionContract(session.id)).toBe(true)
      expect(getProductionDeliveryFailure(manager, session.id, workspace)).toEqual({
        error: expect.objectContaining({
          code: 'delivery_not_accepted',
          issues: expect.arrayContaining([
            expect.stringContaining('Required production artifact is missing or empty'),
          ]),
        }),
      })
    } finally {
      manager.list().forEach(session => manager.stop(session.id))
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('does not impose the game-production gate on an ordinary session', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-deployment-ordinary-'))
    const manager = new BeeGameSessionManager({
      async start() {
        return { async submit() {}, stop() {} }
      },
    }, workspace)
    try {
      const session = manager.start({ workspacePath: workspace, userId: 'test-user' })
      expect(getProductionDeliveryFailure(manager, session.id, workspace)).toBeNull()
    } finally {
      manager.list().forEach(session => manager.stop(session.id))
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
