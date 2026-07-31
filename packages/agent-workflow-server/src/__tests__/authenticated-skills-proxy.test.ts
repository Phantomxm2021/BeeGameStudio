import { describe, expect, test } from 'bun:test'
import { proxyAuthenticatedSkillsRequest } from '../auth/authenticated-skills-proxy'
import { SESSION_COOKIE_NAME } from '../auth/session-routes'

const skillsConfig = {
  apiBaseUrl: 'https://skills.beegame.test',
  required: true,
}

describe('authenticated skills proxy', () => {
  test('replaces a stale browser bearer with the refreshed HttpOnly session token', async () => {
    const forwarded: Array<{
      path: string
      authorization: string | null
      cookie: string | null
    }> = []
    const response = await proxyAuthenticatedSkillsRequest(
      new Request('https://runtime.beegame.test/api/user-skills', {
        headers: {
          authorization: 'Bearer stale-browser-token',
          cookie: `${SESSION_COOKIE_NAME}=session-1`,
        },
      }),
      skillsConfig,
      '/api/user-skills',
      {
        getAccessToken: () => 'stale-session-token',
        getValidAccessToken: async () => 'refreshed-session-token',
      },
      async (_config, request, path) => {
        forwarded.push({
          path,
          authorization: request.headers.get('authorization'),
          cookie: request.headers.get('cookie'),
        })
        return Response.json([])
      },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(forwarded).toEqual([{
      path: '/api/user-skills',
      authorization: 'Bearer refreshed-session-token',
      cookie: null,
    }])
  })

  test('does not call the skills service when the HttpOnly session cannot refresh', async () => {
    let forwarded = false
    const response = await proxyAuthenticatedSkillsRequest(
      new Request('https://runtime.beegame.test/api/user-skills', {
        headers: {
          authorization: 'Bearer stale-browser-token',
          cookie: `${SESSION_COOKIE_NAME}=session-1`,
        },
      }),
      skillsConfig,
      '/api/user-skills',
      {
        getAccessToken: () => 'stale-session-token',
        getValidAccessToken: async () => undefined,
      },
      async () => {
        forwarded = true
        return Response.json([])
      },
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'Unauthorized',
      message: 'authentication required',
    })
    expect(forwarded).toBe(false)
  })

  test('preserves an imported skill package body after authentication injection', async () => {
    const forwardedBodies: string[] = []
    const response = await proxyAuthenticatedSkillsRequest(
      new Request('https://runtime.beegame.test/api/user-skills/import', {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=session-1`,
          'content-type': 'application/octet-stream',
        },
        body: 'skill-package',
      }),
      skillsConfig,
      '/api/user-skills/import',
      {
        getAccessToken: () => 'current-session-token',
        getValidAccessToken: async () => 'current-session-token',
      },
      async (_config, request) => {
        forwardedBodies.push(await request.text())
        return Response.json({ id: 'skill-1' })
      },
    )

    expect(response.status).toBe(200)
    expect(forwardedBodies).toEqual(['skill-package'])
  })
})
