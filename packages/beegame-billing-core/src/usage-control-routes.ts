import type { Hono } from 'hono'
import {
  numberValue,
  requireUsageServiceToken,
  stringValue,
} from './usage-control-request-helpers'
import { isObject, readJson } from './http-helpers'
import type { BillingRouteDeps } from './billing-route-types'
import type { BeeGameUsageBillingRecordInput } from './usage-control-client'

export function registerBeeGameUsageControlRoutes(
  app: Hono,
  deps: Pick<BillingRouteDeps, 'billingConfig' | 'dashboardRepository'>,
): void {
  registerUsageRoute(app, deps, '/api/internal/usage/events', false)
  registerUsageRoute(app, deps, '/api/internal/usage/debits', true)
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
