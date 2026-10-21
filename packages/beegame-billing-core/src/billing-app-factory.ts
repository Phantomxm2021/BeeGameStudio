import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { randomUUID } from 'node:crypto'
import type { BeeGameBillingUserContext } from './billing-route-types'
import type { BillingRouteDeps } from './billing-route-types'
import {
  registerBeeGameBillingPublicRoutes,
  registerBeeGameBillingStoreRoutes,
} from './billing-route-groups'
import { toErrorMessage } from './http-helpers'

export type BeeGameBillingAppFactoryOptions = BillingRouteDeps & {
  requireRequestUser?: boolean
  resolveRequestUser: (
    request: Request,
  ) => Promise<BeeGameBillingUserContext | undefined>
  serviceName?: string
}

export function createBeeGameBillingRouteApp(
  options: BeeGameBillingAppFactoryOptions,
): Hono {
  const app = new Hono()
  const reportedAuthFailures = new WeakSet<object>()
  const failureOccurrences = new Map<
    string,
    { diagnosticId: string; repeatCount: number }
  >()

  app.onError((error, c) => {
    const reasonCode = c.req.path.startsWith('/api/internal/usage/')
      ? 'usage_billing'
      : 'billing_request'
    // This is the existing billing RPC's explicit refusal, not an outage.
    if (reasonCode === 'usage_billing' && toErrorMessage(error).includes('Insufficient realtime usage credits'))
      return c.json({ error: 'Insufficient realtime usage credits', stage: 'usage_billing', code: 'insufficient_usage_credits' }, 402)
    const failureKey = JSON.stringify({
      method: c.req.method,
      path: c.req.path,
      reasonCode,
      message: toErrorMessage(error),
    })
    const previous = failureOccurrences.get(failureKey)
    if (!previous && failureOccurrences.size >= 256) {
      const oldest = failureOccurrences.keys().next().value
      if (oldest !== undefined) failureOccurrences.delete(oldest)
    }
    const occurrence = previous
      ? { ...previous, repeatCount: previous.repeatCount + 1 }
      : { diagnosticId: randomUUID(), repeatCount: 1 }
    failureOccurrences.set(failureKey, occurrence)
    const traceId = occurrence.diagnosticId
    if (occurrence.repeatCount === 1) {
      console.error(
        `[BeeGame billing] ${c.req.method} ${c.req.path} failed:`,
        { traceId, reasonCode, error },
      )
    } else if ((occurrence.repeatCount & (occurrence.repeatCount - 1)) === 0) {
      // Log only exponentially spaced counters after the first full stack.
      // A persistent outage therefore remains visible without flooding logs.
      console.warn('[BeeGame billing] repeated failure', {
        traceId,
        reasonCode,
        repeatCount: occurrence.repeatCount,
      })
    }
    return c.json(
      {
        error: 'Billing request failed',
        ...(reasonCode === 'usage_billing'
          ? { stage: 'usage_billing' as const }
          : {}),
        message: toErrorMessage(error),
        traceId,
      },
      500,
    )
  })

  app.use('/api/*', cors())
  registerBeeGameBillingPublicRoutes(app, {
    billingConfig: options.billingConfig,
    dashboardRepository: options.dashboardRepository,
  })
  app.use('/api/*', async (c, next) => {
    if (options.requireRequestUser === false) {
      await next()
      return
    }
    let user: BeeGameBillingUserContext | undefined
    try {
      user = await options.resolveRequestUser(c.req.raw)
    } catch (error) {
      const facts = error && typeof error === 'object'
        ? error as { reason?: unknown; upstreamStatus?: unknown; elapsedMs?: unknown; retryAfterMs?: unknown } : {}
      const retryAfterMs = typeof facts.retryAfterMs === 'number' && Number.isFinite(facts.retryAfterMs)
        ? Math.max(1, Math.ceil(facts.retryAfterMs)) : 2000
      if (facts.reason !== 'cooldown' && !reportedAuthFailures.has(facts)) {
        reportedAuthFailures.add(facts)
        // Do not log raw errors, request headers, tokens or provider bodies.
        console.warn('[BeeGame billing] authentication unavailable', {
          timestamp: new Date().toISOString(), path: c.req.path,
          reason: ['timeout', 'network', 'upstream'].includes(String(facts.reason)) ? facts.reason : 'resolution_failed',
          upstreamStatus: typeof facts.upstreamStatus === 'number' ? facts.upstreamStatus : undefined,
          elapsedMs: typeof facts.elapsedMs === 'number' ? facts.elapsedMs : undefined,
        })
      }
      return c.json(
        {
          error: 'Authentication service is temporarily unavailable',
          message: 'Authentication service is temporarily unavailable',
          code: 'authentication_unavailable',
          recoverable: true,
          retry_after_ms: retryAfterMs,
        },
        503,
        { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
      )
    }
    if (!user) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'authentication required',
        },
        401,
      )
    }
    await next()
  })
  app.get('/health', c =>
    c.json({
      status: 'ok',
      service: options.serviceName ?? 'beegame-billing',
    }),
  )
  registerBeeGameBillingStoreRoutes(app, {
    billingConfig: options.billingConfig,
    dashboardRepository: options.dashboardRepository,
    proxyRemoteBillingRequest: options.proxyRemoteBillingRequest,
    getCurrentUser: options.getCurrentUser,
    hasPermission: options.hasPermission,
  })
  return app
}
