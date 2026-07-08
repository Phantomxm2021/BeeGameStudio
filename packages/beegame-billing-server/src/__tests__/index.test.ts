import { describe, expect, test } from 'bun:test'
import { createBeeGameBillingServerApp } from '../index'

describe('BeeGame billing server package', () => {
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
})
