import { describe, expect, test } from 'bun:test'
import {
  getRequestOrigin,
  readJson,
  toErrorMessage,
} from '../http-helpers'

describe('http-helpers', () => {
  test('reads object JSON and falls back to an empty object', async () => {
    expect(await readJson(new Request('https://billing.beegame.test', {
      method: 'POST',
      body: JSON.stringify({ priceId: 'price_500' }),
    }))).toEqual({ priceId: 'price_500' })
    expect(await readJson(new Request('https://billing.beegame.test', {
      method: 'POST',
      body: JSON.stringify(['not-an-object']),
    }))).toEqual({})
    expect(await readJson(new Request('https://billing.beegame.test', {
      method: 'POST',
      body: 'not-json',
    }))).toEqual({})
  })

  test('gets request origin from header or URL', () => {
    expect(getRequestOrigin(new Request('https://runtime.beegame.test/api', {
      headers: { origin: 'https://app.beegame.test///' },
    }))).toBe('https://app.beegame.test')
    expect(getRequestOrigin(new Request('https://runtime.beegame.test/api'))).toBe(
      'https://runtime.beegame.test',
    )
  })

  test('normalizes error messages', () => {
    expect(toErrorMessage(new Error('Stripe failed'))).toBe('Stripe failed')
    expect(toErrorMessage('failed')).toBe('Request failed')
  })
})
