import { describe, expect, test } from 'bun:test'
import {
  buildResourceServiceUrl,
  proxyAuthenticatedResourceRequest,
} from '../auth/authenticated-resource-proxy'
import { SESSION_COOKIE_NAME } from '../auth/session-routes'

describe('authenticated resource proxy', () => {
  test('builds resource service URLs without dropping the query string', () => {
    expect(buildResourceServiceUrl(
      'https://resources.beegame.test/base/',
      '/api/resource-packs?status=draft',
    )).toBe(
      'https://resources.beegame.test/base/api/resource-packs?status=draft',
    )
  })

  test('replaces a stale browser bearer with the refreshed HttpOnly session token', async () => {
    const forwarded: Array<{
      url: string
      authorization: string | null
      cookie: string | null
    }> = []
    const response = await proxyAuthenticatedResourceRequest(
      new Request('https://runtime.beegame.test/api/resource-packs', {
        headers: {
          authorization: 'Bearer stale-browser-token',
          cookie: `${SESSION_COOKIE_NAME}=session-1`,
        },
      }),
      'https://resources.beegame.test',
      '/api/resource-packs?status=draft',
      {
        getAccessToken: () => 'stale-session-token',
        getValidAccessToken: async () => 'refreshed-session-token',
      },
      async (input, init) => {
        const headers = new Headers(init?.headers)
        forwarded.push({
          url: String(input),
          authorization: headers.get('authorization'),
          cookie: headers.get('cookie'),
        })
        return Response.json({ packs: [] }, {
          headers: { etag: 'packs-v1' },
        })
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('packs-v1')
    expect(forwarded).toEqual([{
      url: 'https://resources.beegame.test/api/resource-packs?status=draft',
      authorization: 'Bearer refreshed-session-token',
      cookie: null,
    }])
  })

  test('streams an authenticated upload body to the resource service', async () => {
    const forwardedBodies: string[] = []
    const response = await proxyAuthenticatedResourceRequest(
      new Request('https://runtime.beegame.test/api/resource-packs/pack-1/elements', {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=session-1`,
          'content-type': 'application/octet-stream',
        },
        body: 'resource-bytes',
      }),
      'https://resources.beegame.test',
      '/api/resource-packs/pack-1/elements',
      {
        getAccessToken: () => 'current-session-token',
        getValidAccessToken: async () => 'current-session-token',
      },
      async (_input, init) => {
        forwardedBodies.push(await new Response(init?.body).text())
        return Response.json({ element: { id: 'element-1' } })
      },
    )

    expect(response.status).toBe(200)
    expect(forwardedBodies).toEqual(['resource-bytes'])
  })

  test('does not call the resource service when the HttpOnly session cannot refresh', async () => {
    let forwarded = false
    const response = await proxyAuthenticatedResourceRequest(
      new Request('https://runtime.beegame.test/api/resource-packs', {
        headers: {
          authorization: 'Bearer stale-browser-token',
          cookie: `${SESSION_COOKIE_NAME}=session-1`,
        },
      }),
      'https://resources.beegame.test',
      '/api/resource-packs',
      {
        getAccessToken: () => 'stale-session-token',
        getValidAccessToken: async () => undefined,
      },
      async () => {
        forwarded = true
        return Response.json({ packs: [] })
      },
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'Unauthorized',
      message: 'authentication required',
    })
    expect(forwarded).toBe(false)
  })
})
