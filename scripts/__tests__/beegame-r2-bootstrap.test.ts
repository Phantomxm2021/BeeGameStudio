import { describe, expect, test } from 'bun:test'
import {
  bootstrapBeeGameR2,
  resolveR2CorsOrigins,
} from '../beegame-r2-bootstrap'

const env = {
  BEEGAME_R2_ACCOUNT_ID: 'account',
  CLOUDFLARE_API_TOKEN: 'token',
  BEEGAME_R2_DELIVERY_PUBLIC_BASE_URL: 'https://games.example.test/',
}

describe('BeeGame R2 bootstrap', () => {
  test('creates only missing platform buckets and never exposes credentials', async () => {
    const calls: Array<{ url: string; method: string; authorization: string | null }> = []
    const request = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({
        url,
        method,
        authorization: new Headers(init?.headers).get('authorization'),
      })
      if (method === 'GET' && url.endsWith('/beegame-resource-private'))
        return Response.json({ success: false, errors: [] }, { status: 404 })
      return Response.json({ success: true, result: {} })
    }) as typeof fetch

    const result = await bootstrapBeeGameR2({ env, fetch: request })

    expect(result.buckets).toEqual([
      { name: 'beegame-project-private', created: false },
      { name: 'beegame-resource-private', created: true },
      { name: 'beegame-delivery', created: false },
      { name: 'beegame-log-private', created: false },
    ])
    expect(result.deliveryPublicBaseUrl).toBe('https://games.example.test')
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1)
    expect(calls.filter(call => call.method === 'PUT')).toHaveLength(3)
    expect(result.cors).toEqual([
      {
        name: 'beegame-project-private',
        origins: ['http://127.0.0.1:62173', 'http://localhost:62173'],
      },
      {
        name: 'beegame-resource-private',
        origins: ['http://127.0.0.1:62173', 'http://localhost:62173'],
      },
      {
        name: 'beegame-delivery',
        origins: ['http://127.0.0.1:62173', 'http://localhost:62173'],
      },
    ])
    expect(calls.every(call => call.authorization === 'Bearer token')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('token')
  })

  test('reuses API origins and validates additional R2 browser origins', () => {
    expect(
      resolveR2CorsOrigins({
        BEEGAME_API_CORS_ORIGINS: 'https://studio.example.test',
        BEEGAME_R2_CORS_ORIGINS:
          'https://preview.example.test,https://studio.example.test/',
      }),
    ).toEqual([
      'http://127.0.0.1:62173',
      'http://localhost:62173',
      'https://studio.example.test',
      'https://preview.example.test',
    ])
    expect(() =>
      resolveR2CorsOrigins({
        BEEGAME_R2_CORS_ORIGINS: 'https://example.test/path',
      }),
    ).toThrow('Invalid R2 browser CORS origin')
  })

  test('requires a one-time management token instead of reusing S3 credentials', async () => {
    await expect(
      bootstrapBeeGameR2({
        env: { BEEGAME_R2_ACCOUNT_ID: 'account' },
      }),
    ).rejects.toThrow('CLOUDFLARE_API_TOKEN')
  })

  test('turns account-level R2 activation failures into an actionable message', async () => {
    const request = (async () =>
      Response.json(
        {
          success: false,
          errors: [{ message: 'Please enable R2 through the Cloudflare Dashboard.' }],
        },
        { status: 403 },
      )) as typeof fetch

    await expect(
      bootstrapBeeGameR2({ env, fetch: request }),
    ).rejects.toThrow('Cloudflare R2 is not enabled for this account')
  })
})
