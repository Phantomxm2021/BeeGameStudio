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
  const failureOccurrences = new Map<
    string,
    { diagnosticId: string; repeatCount: number }
  >()

  app.onError((error, c) => {
    const reasonCode = c.req.path.startsWith('/api/internal/usage/')
      ? 'usage_billing'
      : 'billing_request'
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
      console.warn(
        '[BeeGame billing] request user resolution unavailable:',
        error,
      )
      return c.json(
        {
          error: 'Authentication service is temporarily unavailable',
        },
        503,
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
