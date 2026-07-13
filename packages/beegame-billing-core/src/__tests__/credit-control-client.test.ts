import { describe, expect, test } from 'bun:test'
import { createRemoteCreditControlClient } from '../credit-control-client'

describe('remote credit control client', () => {
  test('uses its service fetch instead of a later Agent runtime global fetch wrapper', async () => {
    const requests: string[] = []
    const serviceFetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return Response.json({
        reservationId: 'reservation-1',
        reservedCredits: 10,
        settledCredits: 2,
        refundedCredits: 8,
        balance: { balanceCredits: 98 },
      })
    }) as typeof fetch
    const client = createRemoteCreditControlClient({
      mode: 'remote',
      remoteApiBaseUrl: 'http://127.0.0.1:62175',
      creditControlToken: 'service-token',
    }, serviceFetch)

    const settlement = await client?.settleCreditReservation('user-1', {
      reservationId: 'reservation-1',
      weightedTokens: 12_000,
    })

    expect(requests).toEqual([
      'http://127.0.0.1:62175/api/internal/credits/reservations/reservation-1/settle',
    ])
    expect(settlement?.settledCredits).toBe(2)
  })

  test('surfaces the protected billing service failure instead of replacing it with a generic 500', async () => {
    const client = createRemoteCreditControlClient({
      mode: 'remote',
      remoteApiBaseUrl: 'http://127.0.0.1:62175',
      creditControlToken: 'service-token',
    }, (async () => Response.json({
      error: 'Credit control operation failed',
      message: 'Credit reservation could not be completed',
    }, { status: 500 })) as unknown as typeof fetch)

    await expect(client?.reserveCredits('user-1', {
      credits: 3,
      idempotencyKey: 'request-1',
    })).rejects.toThrow('Credit reservation could not be completed')
  })
})
