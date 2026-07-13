import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  refundCreditReservation,
  reserveCredits,
} from '../credit-store'
import { BeeGameSessionManager } from '../beegame/session-manager'

describe('BeeGame pending credit retry', () => {
  test('coalesces concurrent poll retries and applies failure backoff', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-credit-retry-'))
    let settleCalls = 0
    const manager = new BeeGameSessionManager({
      async start() {
        return {
          async submit(input) {
            input.onMessage({
              type: 'result',
              result: 'done',
              usage: { input_tokens: 10_000, output_tokens: 1_000, total_tokens: 11_000 },
            })
          },
          stop() {},
        }
      },
    }, workspace, () => ({}), {
      reserveCredits,
      refundCreditReservation,
      async settleCreditReservation() {
        settleCalls += 1
        await new Promise(resolve => setTimeout(resolve, 20))
        throw new Error('billing unavailable')
      },
    })
    try {
      const session = manager.start({ workspacePath: workspace, userId: 'credit-retry-user' })
      await manager.sendWithDisplay(session.id, 'Run turn', { taskType: 'agent_turn' })
      await waitFor(() => manager.events(session.id).some(event => event.payload?.type === 'credit.settle_pending'))

      await Promise.all(Array.from({ length: 8 }, () => manager.retryPendingCreditOperation(session.id)))
      expect(settleCalls).toBe(2)
      expect(manager.events(session.id).filter(event => event.payload?.type === 'credit.settle_retry_failed')).toHaveLength(1)

      await manager.retryPendingCreditOperation(session.id)
      expect(settleCalls).toBe(2)
      expect(manager.events(session.id).filter(event => event.payload?.type === 'credit.settle_retry_failed')).toHaveLength(1)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > 1_000) throw new Error('Timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
