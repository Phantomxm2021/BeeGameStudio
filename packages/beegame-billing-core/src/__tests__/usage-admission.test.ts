import { expect, test } from 'bun:test'
import { createBeeGameBillingRouteApp } from '../billing-app-factory'
import { createRemoteUsageBillingClient } from '../usage-control-client'
import type { BeeGameBillingRouteRepository } from '../billing-ports'

test('service-token-protected admission reads the canonical available wallet balance and refuses empty wallets', async () => {
  let balance = 0, reads = 0
  const app = createBeeGameBillingRouteApp({ billingConfig: { mode: 'server', usageBillingMode: 'realtime', creditControlToken: 'synthetic-token' },
    dashboardRepository: { async getUsageWalletForUser(owner: string) { reads++; expect(owner).toBe('owner'); return { balanceCreditsMicro: balance } },
      async debitRealTimeUsageForUser() { throw Error('Supabase RPC: Insufficient realtime usage credits') } } as unknown as BeeGameBillingRouteRepository,
    requireRequestUser: false, resolveRequestUser: async () => undefined, getCurrentUser: () => ({ id: 'owner' }), hasPermission: () => false,
  })
  const client = createRemoteUsageBillingClient({ mode: 'remote', usageBillingMode: 'realtime', remoteApiBaseUrl: 'http://billing.test', creditControlToken: 'synthetic-token' },
    (input, init) => app.fetch(new Request(input, init)))!
  expect((await app.request('/api/internal/usage/authorize', { method: 'POST', body: '{"userId":"owner"}' })).status).toBe(401)
  expect(reads).toBe(0)
  await expect(client.assertUsageAvailable!('owner')).rejects.toMatchObject({ retryable: false, message: 'Insufficient realtime usage credits' })
  balance = 1
  await client.assertUsageAvailable!('owner')
  expect(reads).toBe(2)
  balance = NaN
  await expect(client.assertUsageAvailable!('owner')).rejects.toMatchObject({ retryable: true })
  await expect(client.debitRealTimeUsage('owner', { sessionId: 'job', idempotencyKey: 'call',
    usage: { prompt_tokens: 1, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 1 } }))
    .rejects.toMatchObject({ retryable: false, message: 'Insufficient realtime usage credits' })
})

test('an unconfirmed authorization response cannot authorize a new paid request', async () => {
  const client = createRemoteUsageBillingClient({ mode: 'remote', usageBillingMode: 'realtime', remoteApiBaseUrl: 'http://billing.test', creditControlToken: 'synthetic-token' },
    async () => Response.json({}))!
  await expect(client.assertUsageAvailable!('owner')).rejects.toMatchObject({ retryable: false, message: 'Usage authorization was not confirmed' })
})
