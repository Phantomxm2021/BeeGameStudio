import { expect, test } from 'bun:test'
import { observeDeliverySmoke } from './delivery-smoke-observation'

const responses: Record<string, unknown> = {
  '/api/usage-wallet': { consumedCreditsMicro: 10, reservedCreditsMicro: 0 },
  '/api/usage/summary?projectId=p': { creditsMicro: 10 },
  '/api/beegame-sessions/s': { status: 'running', turnStatus: 'idle' },
  '/api/projects/p/deployment-readiness': { allowed: false },
}

test.each(Object.keys(responses))('retains telemetry and identifies a failed %s', async failedPath => {
  const snapshot = await observeDeliverySmoke(async path => {
    if (path === failedPath) throw new Error('timeout')
    return responses[path]
  }, 'p', 's')
  expect(snapshot.errors).toEqual([{ path: failedPath, error: 'timeout' }])
  expect(snapshot.billingAvailable).toBe(!failedPath.startsWith('/api/usage'))
  if (!failedPath.includes('sessions')) expect(snapshot.session?.turnStatus).toBe('idle')
})

test('unknown billing is not interpreted as zero credits', async () => {
  const snapshot = await observeDeliverySmoke(async path =>
    path === '/api/usage-wallet' ? { consumedCreditsMicro: null, reservedCreditsMicro: 0 } : responses[path], 'p', 's')
  expect(snapshot.billingAvailable).toBe(false)
})
