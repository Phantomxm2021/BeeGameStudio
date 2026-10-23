import type { Hono } from 'hono'
import {
  numberValue,
  requireUsageServiceToken,
  stringValue,
} from './usage-control-request-helpers'
import { isObject, readJson } from './http-helpers'
import type { BillingRouteDeps } from './billing-route-types'
import type { BeeGameUsageBillingRecordInput } from './usage-control-client'
import { validImageBillingInput } from './image-billing'

export function registerBeeGameUsageControlRoutes(
  app: Hono,
  deps: Pick<BillingRouteDeps, 'billingConfig' | 'dashboardRepository'>,
): void {
  registerUsageRoute(app, deps, '/api/internal/usage/events', false)
  registerUsageRoute(app, deps, '/api/internal/usage/debits', true)
  app.post('/api/internal/usage/authorize', async c => {
    const forbidden = requireUsageServiceToken(c.req.raw, deps.billingConfig)
    if (forbidden) return forbidden
    c.header('Cache-Control', 'no-store')
    const userId = stringValue((await readJson(c.req.raw)).userId)
    if (!userId) return c.json({ error: 'User id is required' }, 400)
    if (!deps.dashboardRepository.getUsageWalletForUser)
      return c.json({ error: 'Usage wallet is unavailable' }, 503)
    const wallet = await deps.dashboardRepository.getUsageWalletForUser(userId)
    if (!Number.isSafeInteger(wallet.balanceCreditsMicro) || wallet.balanceCreditsMicro < 0)
      return c.json({ error: 'Usage wallet returned an invalid balance' }, 503)
    if (wallet.balanceCreditsMicro === 0)
      return c.json({ error: 'Insufficient realtime usage credits', code: 'insufficient_usage_credits' }, 402)
    return c.json({ available: true })
  })
  app.get('/api/internal/images/config', async c => {
    if (c.req.header('origin')) return c.json({ error: 'Browser access denied' }, 403)
    const forbidden = requireUsageServiceToken(c.req.raw, deps.billingConfig)
    if (forbidden) return forbidden
    c.header('Cache-Control', 'no-store')
    if (!deps.dashboardRepository.readImageGenerationSettings)
      return c.json({ source: 'supabase-platform', code: 'database-config-missing' }, 503)
    try {
      const result = await deps.dashboardRepository.readImageGenerationSettings()
      const { config: _, ...facts } = result
      console.info('[image-generation]', { event: 'configuration-read', ...facts })
      return c.json(result, result.code ? 503 : 200)
    } catch {
      return c.json({ source: 'supabase-platform', code: 'database-response' }, 503)
    }
  })
  app.post('/api/internal/images/billing', async c => {
    const forbidden = requireUsageServiceToken(c.req.raw, deps.billingConfig)
    if (forbidden) return forbidden
    const body = await readJson(c.req.raw)
    const userId = stringValue(body.userId)
    if (!userId || !validImageBillingInput(body))
      return c.json({ error: 'Invalid image billing request' }, 400)
    if (!deps.dashboardRepository.applyImageBilling)
      return c.json({ error: 'Image billing is unavailable' }, 503)
    try { return c.json(await deps.dashboardRepository.applyImageBilling(userId, body)) }
    catch { return c.json({ error: 'Image billing could not be completed; preserve the request identity' }, 503) }
  })
}

function registerUsageRoute(
  app: Hono,
  deps: Pick<BillingRouteDeps, 'billingConfig' | 'dashboardRepository'>,
  path: '/api/internal/usage/events' | '/api/internal/usage/debits',
  debit: boolean,
): void {
  app.post(path, async c => {
    const forbidden = requireUsageServiceToken(c.req.raw, deps.billingConfig)
    if (forbidden) return forbidden
    const body = await readJson(c.req.raw)
    const userId = stringValue(body.userId)
    const sessionId = stringValue(body.sessionId)
    const idempotencyKey = stringValue(body.idempotencyKey)
    const usage = isObject(body.usage) ? body.usage : undefined
    const usageFields = usage
      ? {
          prompt_tokens: numberValue(usage.prompt_tokens),
          completion_tokens: numberValue(usage.completion_tokens),
          cache_read_tokens: numberValue(usage.cache_read_tokens),
          cache_creation_tokens: numberValue(usage.cache_creation_tokens),
          total_tokens: numberValue(usage.total_tokens),
        }
      : undefined
    if (
      !userId ||
      !sessionId ||
      !idempotencyKey ||
      !usageFields ||
      Object.values(usageFields).some(
        value => !Number.isSafeInteger(value) || value < 0,
      )
    ) {
      return c.json(
        {
          error: 'Invalid request',
          message:
            'userId, sessionId, idempotencyKey, and non-negative integer usage fields are required',
        },
        400,
      )
    }
    const input: BeeGameUsageBillingRecordInput = {
      sessionId,
      turnId: stringValue(body.turnId) || undefined,
      projectId: stringValue(body.projectId) || undefined,
      idempotencyKey,
      usage: usageFields,
      metadata: isObject(body.metadata) ? body.metadata : undefined,
      pricingVersion: stringValue(body.pricingVersion) || undefined,
      usageSource:
        body.usageSource === 'model_runtime_host' ||
        body.usageSource === 'runtime_snapshot'
          ? body.usageSource
          : undefined,
    }
    return c.json(
      debit
        ? await deps.dashboardRepository.debitRealTimeUsageForUser(
            userId,
            input,
          )
        : await deps.dashboardRepository.recordUsageForUser(
            userId,
            input,
          ),
    )
  })
}
