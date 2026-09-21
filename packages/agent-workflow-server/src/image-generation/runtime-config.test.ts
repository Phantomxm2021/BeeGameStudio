import { test, expect } from 'bun:test'
import { Hono } from 'hono'
import { registerBeeGameUsageControlRoutes } from '@bee-game-studio/beegame-billing-core/usage-control-routes'
import { resolveBeeGameBillingConfig } from '@bee-game-studio/beegame-billing-core/billing-config'
import { createBeeGameSupabaseBillingRepositoryFromEnv } from '../../../beegame-billing-server/src/supabase-billing-repository'
import { buildBeeGameDevPlan } from '../../../../scripts/beegame-dev-lib'
import { loadRuntimeImageConfig } from './runtime-config'
import { encodeImageConfig } from './config-store'
import { imageConfigSchema } from './config'

test('dev runtime without service-role loads the platform row through authenticated existing service', async () => {
  const old = process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
  try {
    const plan = buildBeeGameDevPlan([], { cwd: '/repo', env: {
      AGENT_WORKFLOW_WORKSPACE_PATH: '/projects', BEEGAME_SUPABASE_URL: 'https://db.test',
      BEEGAME_SUPABASE_ANON_KEY: 'anon', BEEGAME_SUPABASE_SERVICE_ROLE_KEY: 'db-master',
      BEEGAME_CREDIT_CONTROL_TOKEN: 'service-token',
    }, ports: { frontend: 62173, runtime: 62174, billing: 62175, skills: 62176, resources: 62177 } })
    const runtime = plan.processes.find(p => p.name === 'runtime')!
    const billing = plan.processes.find(p => p.name === 'billing')!
    expect(runtime.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    const saved = imageConfigSchema.parse({ provider: 'cloudflare', apiKey: 'provider-secret', model: 'configured-model' })
    let reads = 0
    const repository = createBeeGameSupabaseBillingRepositoryFromEnv(billing.env, async (url, init) => {
      reads++
      expect(String(url)).toContain('https://db.test/rest/v1/beegame_image_generation_settings?id=eq.platform')
      expect(new Headers(init?.headers).get('apikey')).toBe('db-master')
      return Response.json([{ config: encodeImageConfig(saved) }])
    })
    const app = new Hono()
    registerBeeGameUsageControlRoutes(app, { billingConfig: resolveBeeGameBillingConfig(billing.env), dashboardRepository: repository })
    const endpoint = '/api/internal/images/config'
    expect((await app.request(endpoint)).status).toBe(401)
    expect((await app.request(endpoint, { headers: { authorization: 'Bearer user-token' } })).status).toBe(401)
    expect((await app.request(endpoint, { headers: { origin: 'http://browser', 'x-beegame-credit-control-token': 'service-token' } })).status).toBe(403)
    expect(reads).toBe(0)
    const result = await loadRuntimeImageConfig('/unused', { remote: true, billing: resolveBeeGameBillingConfig(runtime.env) },
      async (url, init) => app.request(new URL(String(url)).pathname, init))
    expect(result).toEqual(saved)
    expect(reads).toBe(1)
  } finally {
    if (old === undefined) delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
    else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY = old
  }
})

test('database errors retain safe HTTP/row facts and never fall back to local defaults', async () => {
  const billing = { mode: 'remote' as const, usageBillingMode: 'realtime' as const,
    remoteApiBaseUrl: 'http://service', creditControlToken: 'token' }
  for (const [response, code, expected] of [
    [new Response('private database error', { status: 403 }), 'database-http', { databaseHttpStatus: 403 }],
    [Response.json([]), 'platform-row-missing', { databaseHttpStatus: 200, rowExists: false }],
    [new Response('invalid json'), 'database-response', { databaseHttpStatus: 200 }],
  ] as const) {
    const repository = createBeeGameSupabaseBillingRepositoryFromEnv({
      BEEGAME_SUPABASE_URL: 'https://db.test', BEEGAME_SUPABASE_SERVICE_ROLE_KEY: 'key',
    }, async () => response)
    const app = new Hono()
    registerBeeGameUsageControlRoutes(app, { billingConfig: billing, dashboardRepository: repository })
    await expect(loadRuntimeImageConfig('/unused', { remote: true, billing },
      async (url, init) => app.request(new URL(String(url)).pathname, init))).rejects.toMatchObject({
        code, facts: { source: 'service-platform', databaseHost: 'db.test', ...expected },
      })
  }
})

test('service access, network and stored config errors remain distinct', async () => {
  const billing = { mode: 'remote' as const, usageBillingMode: 'realtime' as const,
    remoteApiBaseUrl: 'http://service', creditControlToken: 'token' }
  await expect(loadRuntimeImageConfig('/unused', { remote: true, billing: { ...billing, creditControlToken: undefined } }))
    .rejects.toMatchObject({ code: 'config-service-unconfigured' })
  await expect(loadRuntimeImageConfig('/unused', { remote: true, billing }, async () => { throw new Error('private network details') }))
    .rejects.toMatchObject({ code: 'config-service-network' })
  await expect(loadRuntimeImageConfig('/unused', { remote: true, billing }, async () => Response.json({ error: 'Unauthorized' }, { status: 401 })))
    .rejects.toMatchObject({ code: 'config-service-http', facts: { serviceHttpStatus: 401 } })
  await expect(loadRuntimeImageConfig('/unused', { remote: true, billing }, async () => Response.json({ rowExists: true, config: { provider: 'invalid-provider' } })))
    .rejects.toMatchObject({ code: 'config-decode-or-schema' })
  await expect(loadRuntimeImageConfig('/unused', { remote: true, billing }, async () => Response.json({ rowExists: true, config: {} })))
    .rejects.toMatchObject({ code: 'provider-key-missing' })
})
