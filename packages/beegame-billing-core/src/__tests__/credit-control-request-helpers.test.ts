import { describe, expect, test } from 'bun:test'
import {
  metadataWithIdempotency,
  numberValue,
  requireCreditControlToken,
  stringValue,
} from '../credit-control-request-helpers'

describe('credit-control-request-helpers', () => {
  test('normalizes request scalar values', () => {
    expect(stringValue(' user-a ')).toBe('user-a')
    expect(stringValue(42)).toBe('')
    expect(numberValue(' 1200 ')).toBe(1200)
    expect(numberValue(500)).toBe(500)
    expect(Number.isNaN(numberValue({}))).toBe(true)
  })

  test('merges idempotency key into metadata without mutating input', () => {
    const metadata = { source: 'runtime-host' }

    expect(metadataWithIdempotency(metadata, 'reserve-once')).toEqual({
      source: 'runtime-host',
      idempotencyKey: 'reserve-once',
    })
    expect(metadata).toEqual({ source: 'runtime-host' })
    expect(metadataWithIdempotency(undefined, '')).toBeUndefined()
  })

  test('requires configured credit-control service token', async () => {
    const missing = requireCreditControlToken(
      new Request('https://billing.beegame.test/api/internal/credits/reservations'),
      { mode: 'server' },
    )
    expect(missing?.status).toBe(503)
    expect(await missing?.json()).toEqual({
      error: 'Credit control disabled',
      message: 'BEEGAME_CREDIT_CONTROL_TOKEN is required for credit control APIs',
    })

    const invalid = requireCreditControlToken(
      new Request('https://billing.beegame.test/api/internal/credits/reservations', {
        headers: { 'x-beegame-credit-control-token': 'wrong' },
      }),
      { mode: 'server', creditControlToken: 'expected' },
    )
    expect(invalid?.status).toBe(401)

    const allowed = requireCreditControlToken(
      new Request('https://billing.beegame.test/api/internal/credits/reservations', {
        headers: { 'x-beegame-credit-control-token': 'expected' },
      }),
      { mode: 'server', creditControlToken: 'expected' },
    )
    expect(allowed).toBeUndefined()
  })
})
