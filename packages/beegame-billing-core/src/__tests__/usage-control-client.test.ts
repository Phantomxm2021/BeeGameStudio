import { describe, expect, test } from 'bun:test'
import {
  BeeGameUsageBillingError,
  createRemoteUsageBillingClient,
} from '../usage-control-client'

const input = {
  sessionId: 'session-1',
  usage: {
    prompt_tokens: 1,
    completion_tokens: 2,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    total_tokens: 3,
  },
  idempotencyKey: 'usage:session-1:request-1',
}

describe('remote usage billing errors', () => {
  test('preserves the billing stage when the billing service returns an error', async () => {
    const client = createRemoteUsageBillingClient({
      mode: 'remote',
      remoteApiBaseUrl: 'http://billing.test',
      creditControlToken: 'service-token',
      usageBillingMode: 'realtime',
    }, async () => new Response(JSON.stringify({
      error: 'Billing request failed',
      traceId: 'billing-trace-1',
      message: 'unknown certificate verification error',
    }), { status: 500 }))

    if (!client) throw new Error('remote billing client was not created')
    await expect(client.recordUsage('user-1', input)).rejects.toEqual(
      expect.objectContaining({
        name: 'BeeGameUsageBillingError',
        stage: 'usage_billing',
        retryable: true,
        traceId: 'billing-trace-1',
        message: 'unknown certificate verification error',
      }),
    )
  })

  test('does not mark a client validation response as a retryable transport failure', async () => {
    const client = createRemoteUsageBillingClient({
      mode: 'remote',
      remoteApiBaseUrl: 'http://billing.test',
      creditControlToken: 'service-token',
      usageBillingMode: 'realtime',
    }, async () => new Response(JSON.stringify({
      error: 'Invalid request',
      message: 'invalid usage',
    }), { status: 400 }))

    if (!client) throw new Error('remote billing client was not created')
    await expect(client.recordUsage('user-1', input)).rejects.toEqual(
      expect.objectContaining({
        name: 'BeeGameUsageBillingError',
        stage: 'usage_billing',
        retryable: false,
        message: 'invalid usage',
      }),
    )
  })

  test('exposes the canonical billing error type', () => {
    expect(new BeeGameUsageBillingError('failed', false)).toBeInstanceOf(Error)
  })
})
