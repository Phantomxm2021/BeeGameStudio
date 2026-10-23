import { describe, expect, test } from 'bun:test'
import { createBeeGameBillingRouteApp } from '../billing-app-factory'
import type { BeeGameBillingRouteRepository } from '../billing-ports'

describe('billing app error handling', () => {
  test('preserves the actionable usage billing failure message', async () => {
    const repository = {
      debitRealTimeUsageForUser: async () => {
        throw new Error('Supabase function beegame_debit_realtime_usage is missing')
      },
    } as unknown as BeeGameBillingRouteRepository

    const app = createBeeGameBillingRouteApp({
      billingConfig: {
        mode: 'server',
        creditControlToken: 'service-token',
      },
      dashboardRepository: repository,
      getCurrentUser: () => ({ id: 'user-1' }),
      hasPermission: () => false,
      requireRequestUser: false,
      resolveRequestUser: async () => undefined,
    })

    const response = await app.request('/api/internal/usage/debits', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-beegame-credit-control-token': 'service-token',
      },
      body: JSON.stringify({
        userId: 'user-1',
        sessionId: 'idea-intake:test',
        idempotencyKey: 'usage:test',
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          total_tokens: 2,
        },
      }),
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: 'Billing request failed',
      stage: 'usage_billing',
      message: 'Supabase function beegame_debit_realtime_usage is missing',
      traceId: expect.any(String),
    })
  })

  test('logs one full failure and aggregates repeated billing failures', async () => {
    const repository = {
      debitRealTimeUsageForUser: async () => {
        throw new Error('Synthetic persistent billing outage')
      },
    } as unknown as BeeGameBillingRouteRepository
    const app = createBeeGameBillingRouteApp({
      billingConfig: {
        mode: 'server',
        creditControlToken: 'service-token',
      },
      dashboardRepository: repository,
      getCurrentUser: () => ({ id: 'user-1' }),
      hasPermission: () => false,
      requireRequestUser: false,
      resolveRequestUser: async () => undefined,
    })
    const originalError = console.error
    const originalWarn = console.warn
    const errors: unknown[][] = []
    const warnings: unknown[][] = []
    console.error = (...args: unknown[]) => errors.push(args)
    console.warn = (...args: unknown[]) => warnings.push(args)
    try {
      const request = () =>
        app.request('/api/internal/usage/debits', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-beegame-credit-control-token': 'service-token',
          },
          body: JSON.stringify({
            userId: 'user-1',
            sessionId: 'idea-intake:test',
            idempotencyKey: 'usage:test',
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              cache_read_tokens: 0,
              cache_creation_tokens: 0,
              total_tokens: 2,
            },
          }),
        })
      const responses = await Promise.all([request(), request(), request()])
      const bodies = await Promise.all(responses.map(response => response.json()))

      expect(errors).toHaveLength(1)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]?.[1]).toMatchObject({ repeatCount: 2 })
      expect(new Set(bodies.map(body => body.traceId)).size).toBe(1)
    } finally {
      console.error = originalError
      console.warn = originalWarn
    }
  })
})
