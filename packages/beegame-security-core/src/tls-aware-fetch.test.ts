import { describe, expect, test } from 'bun:test'
import { createTLSAwareFetch } from './index'

describe('BGS TLS-aware fetch boundary', () => {
  test('merges configured transport options into service requests', async () => {
    let received:
      | {
          input: RequestInfo | URL
          init?: RequestInit & { tls?: { ca?: string } }
        }
      | undefined
    const fetchImpl = createTLSAwareFetch(
      async (input, init) => {
        received = { input, init }
        return new Response('{}')
      },
      { tls: { ca: 'configured-ca' } },
    )

    await fetchImpl('https://service.test/data', { method: 'POST' })

    expect(received).toEqual({
      input: 'https://service.test/data',
      init: { method: 'POST', tls: { ca: 'configured-ca' } },
    })
  })

  test('returns the original transport when no TLS option is configured', () => {
    const fetchImpl = async () => new Response('{}')
    expect(createTLSAwareFetch(fetchImpl, {})).toBe(fetchImpl)
  })
})
