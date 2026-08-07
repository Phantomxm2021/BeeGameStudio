import { describe, expect, test } from 'bun:test'
import { createResourceServerFetch } from '../external-fetch'

describe('resource server external fetch', () => {
  test('uses the configured TLS transport for every external request', async () => {
    let received: { input: RequestInfo | URL; init?: RequestInit } | undefined
    const fetchImpl = createResourceServerFetch(
      async (input, init) => {
        received = { input, init }
        return new Response('{}', { status: 200 })
      },
      { tls: { ca: 'configured-ca' } },
    )

    await fetchImpl('https://supabase.test/rest/v1/resource', {
      method: 'POST',
      headers: { authorization: 'Bearer service-token' },
      body: '{}',
    })

    expect(received?.input).toBe('https://supabase.test/rest/v1/resource')
    expect(received?.init).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer service-token' },
      tls: { ca: 'configured-ca' },
    })
  })

  test('leaves the runtime default transport unchanged when no TLS override is configured', async () => {
    let receivedInit: RequestInit | undefined
    const fetchImpl = createResourceServerFetch(
      async (_input, init) => {
        receivedInit = init
        return new Response('{}', { status: 200 })
      },
      {},
    )

    await fetchImpl('https://supabase.test/rest/v1/resource')

    expect(receivedInit).toBeUndefined()
  })
})
