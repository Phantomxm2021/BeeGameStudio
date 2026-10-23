import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBeeGameBillingServerApp } from '../index'
import type { BeeGameBillingServerRepository } from '../supabase-billing-repository'

describe('BeeGame billing server package', () => {
  test('does not depend on the runtime host package', async () => {
    const packageJson = JSON.parse(
      await readFile(join(import.meta.dir, '../../package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
    }
    expect(packageJson.dependencies).not.toHaveProperty(
      '@bee-game-studio/agent-workflow-server',
    )
  })

  test('exports a standalone billing app factory', async () => {
    const app = createBeeGameBillingServerApp({
      currentUser: {
        id: 'customer-a',
        role: 'developer',
      },
    })
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', service: 'beegame-billing' })
  })

  test('serves user-scoped usage reads from the billing repository', async () => {
    const events = [{
      id: 'usage-1',
      idempotencyKey: 'turn-1',
      userId: 'customer-a',
      sessionId: 'session-1',
      projectId: 'project-a',
      pricingVersion: 'weighted-v1',
      usageSource: 'runtime_snapshot' as const,
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        cache_read_tokens: 3,
        cache_creation_tokens: 2,
        total_tokens: 20,
      },
      delta: {
        prompt_tokens: 10,
        completion_tokens: 5,
        cache_read_tokens: 3,
        cache_creation_tokens: 2,
        total_tokens: 20,
      },
      weightedTokens: 18,
      weightedTokensDelta: 18,
      creditsMicro: 7,
      createdAt: '2026-07-30T10:00:00.000Z',
      metadata: {},
    }]
    const repository = {
      listUsageEventsPageForUser: async (userId: string, projectId?: string) => {
        expect(userId).toBe('customer-a')
        expect(projectId).toBe('project-a')
        return { items: events, total: 1 }
      },
      getUsageSummaryForUser: async (userId: string, projectId?: string) => {
        expect(userId).toBe('customer-a')
        expect(projectId).toBe('project-a')
        return {
          eventsCount: 1,
          promptTokens: 10,
          completionTokens: 5,
          cacheReadTokens: 3,
          cacheCreationTokens: 2,
          totalTokens: 20,
          weightedTokens: 18,
          creditsMicro: 7,
        }
      },
      getUsageWalletForUser: async (userId: string) => {
        expect(userId).toBe('customer-a')
        return {
          userId,
          includedCreditsMicro: 100,
          consumedCreditsMicro: 7,
          balanceCreditsMicro: 93,
        }
      },
    } as unknown as BeeGameBillingServerRepository
    const app = createBeeGameBillingServerApp({
      currentUser: { id: 'customer-a', role: 'developer' },
      repository,
    })

    const eventResponse = await app.request('/api/usage/events?projectId=project-a')
    expect(eventResponse.status).toBe(200)
    expect(await eventResponse.json()).toEqual(events)

    const summaryResponse = await app.request('/api/usage/summary?projectId=project-a')
    expect(summaryResponse.status).toBe(200)
    expect(await summaryResponse.json()).toEqual({
      eventsCount: 1,
      promptTokens: 10,
      completionTokens: 5,
      cacheReadTokens: 3,
      cacheCreationTokens: 2,
      totalTokens: 20,
      weightedTokens: 18,
      creditsMicro: 7,
    })

    const walletResponse = await app.request('/api/usage-wallet')
    expect(walletResponse.status).toBe(200)
    expect(await walletResponse.json()).toEqual({
      userId: 'customer-a',
      includedCreditsMicro: 100,
      consumedCreditsMicro: 7,
      balanceCreditsMicro: 93,
    })
  })

  test('uses server-side summaries and bounded detail pages with browser-readable pagination', async () => {
    const calls: unknown[][] = []
    const repository = {
      listUsageEventsPageForUser: async (...args: unknown[]) => {
        calls.push(['page', ...args])
        return {
          items: [{ id: 'usage-last' }],
          total: 3,
        }
      },
      getUsageSummaryForUser: async (...args: unknown[]) => {
        calls.push(['summary', ...args])
        return {
          eventsCount: 3,
          promptTokens: 30,
          completionTokens: 6,
          cacheReadTokens: 2,
          cacheCreationTokens: 1,
          totalTokens: 38,
          weightedTokens: 40,
          creditsMicro: 9,
        }
      },
      getUsageWalletForUser: async () => ({
        userId: 'customer-a', includedCreditsMicro: 100,
        consumedCreditsMicro: 9, balanceCreditsMicro: 91,
      }),
    } as unknown as BeeGameBillingServerRepository
    const app = createBeeGameBillingServerApp({
      currentUser: { id: 'customer-a', role: 'developer' },
      repository,
    })
    const eventsResponse = await app.request(
      '/api/usage/events?projectId=project-a&from=2026-07-01T00%3A00%3A00Z&to=2026-08-01T00%3A00%3A00Z&offset=2&limit=500',
      { headers: { origin: 'https://dashboard.example' } },
    )
    expect(eventsResponse.status).toBe(200)
    expect(await eventsResponse.json()).toEqual([{ id: 'usage-last' }])
    expect(eventsResponse.headers.get('x-total-count')).toBe('3')
    expect(eventsResponse.headers.get('x-next-offset')).toBeNull()
    const exposed = eventsResponse.headers.get('access-control-expose-headers')?.toLowerCase()
    expect(exposed).toContain('x-total-count')
    expect(exposed).toContain('x-next-offset')
    const summaryResponse = await app.request(
      '/api/usage/summary?projectId=project-a&from=2026-07-01T00%3A00%3A00Z&to=2026-08-01T00%3A00%3A00Z',
    )
    expect(await summaryResponse.json()).toEqual({
      eventsCount: 3,
      promptTokens: 30,
      completionTokens: 6,
      cacheReadTokens: 2,
      cacheCreationTokens: 1,
      totalTokens: 38,
      weightedTokens: 40,
      creditsMicro: 9,
    })
    expect(calls).toEqual([
      ['page', 'customer-a', 'project-a', new Date('2026-07-01T00:00:00.000Z'), new Date('2026-08-01T00:00:00.000Z'), 2, 200],
      ['summary', 'customer-a', 'project-a', new Date('2026-07-01T00:00:00.000Z'), new Date('2026-08-01T00:00:00.000Z')],
    ])
  })
})
