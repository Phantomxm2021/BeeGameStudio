import { describe, expect, test } from 'bun:test'
import { createRemoteUsageBillingClient } from '../usage-control-client'

describe('remote usage billing client', () => {
  test('uses its service fetch instead of a later Agent runtime global fetch wrapper', async () => {
    const requests: string[] = []
    const serviceFetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return Response.json({
        duplicate: false,
      })
    }) as typeof fetch
    const client = createRemoteUsageBillingClient(
      {
        mode: 'remote',
        usageBillingMode: 'realtime',
        remoteApiBaseUrl: 'http://127.0.0.1:62175',
        creditControlToken: 'service-token',
      },
      serviceFetch,
    )

    await client?.debitRealTimeUsage('user-1', {
      sessionId: 'session-1',
      idempotencyKey: 'debit-1',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        total_tokens: 12,
      },
    })

    expect(requests).toEqual([
      'http://127.0.0.1:62175/api/internal/usage/debits',
    ])
  })

  test('surfaces the protected billing service failure instead of replacing it with a generic 500', async () => {
    const client = createRemoteUsageBillingClient(
      {
        mode: 'remote',
        usageBillingMode: 'realtime',
        remoteApiBaseUrl: 'http://127.0.0.1:62175',
        creditControlToken: 'service-token',
      },
      (async () =>
        Response.json(
          {
            error: 'Usage billing operation failed',
            message: 'Usage debit could not be completed',
          },
          { status: 500 },
        )) as unknown as typeof fetch,
    )

    await expect(
      client?.debitRealTimeUsage('user-1', {
        sessionId: 'session-1',
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          total_tokens: 2,
        },
        idempotencyKey: 'request-1',
      }),
    ).rejects.toThrow('Usage debit could not be completed')
  })

  test('forwards real-time shadow usage events to the billing service', async () => {
    let request: Request | undefined
    const client = createRemoteUsageBillingClient(
      {
        mode: 'remote',
        usageBillingMode: 'realtime',
        remoteApiBaseUrl: 'http://127.0.0.1:62175/',
        creditControlToken: 'service-token',
      },
      (async (input, init) => {
        request = new Request(input, init)
        return Response.json({ duplicate: false })
      }) as typeof fetch,
    )

    await client?.recordShadowUsage('user-1', {
      sessionId: 'session-1',
      idempotencyKey: 'shadow-1',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        total_tokens: 12,
      },
    })

    expect(request?.url).toBe(
      'http://127.0.0.1:62175/api/internal/usage/shadow-events',
    )
    expect(request?.headers.get('x-beegame-credit-control-token')).toBe(
      'service-token',
    )
    expect(await request?.json()).toMatchObject({
      userId: 'user-1',
      sessionId: 'session-1',
      idempotencyKey: 'shadow-1',
    })
  })
})
