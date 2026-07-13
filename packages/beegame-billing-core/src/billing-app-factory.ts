import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type {
  BeeGameBillingUserContext,
} from './billing-route-types'
import type {
  BillingRouteDeps,
} from './billing-route-types'
import {
  registerBeeGameBillingPublicRoutes,
  registerBeeGameBillingStoreRoutes,
} from './billing-route-groups'
import { toErrorMessage } from './http-helpers'

export type BeeGameBillingAppFactoryOptions = BillingRouteDeps & {
  requireRequestUser?: boolean
  resolveRequestUser: (request: Request) => Promise<BeeGameBillingUserContext | undefined>
  serviceName?: string
}

export function createBeeGameBillingRouteApp(
  options: BeeGameBillingAppFactoryOptions,
): Hono {
  const app = new Hono()

  app.onError((error, c) => {
    console.error(`[BeeGame billing] ${c.req.method} ${c.req.path} failed:`, error)
    if (c.req.path.startsWith('/api/internal/credits/')) {
      return c.json({
        error: 'Credit control operation failed',
        message: toErrorMessage(error),
      }, 500)
    }
    return c.json({ error: 'Billing request failed' }, 500)
  })

  app.use('/api/*', cors())
  registerBeeGameBillingPublicRoutes(app, {
    billingConfig: options.billingConfig,
    dashboardRepository: options.dashboardRepository,
  }, {
    creditControl: true,
  })
  app.use('/api/*', async (c, next) => {
    if (options.requireRequestUser === false) {
      await next()
      return
    }
    const user = await options.resolveRequestUser(c.req.raw)
    if (!user) {
      return c.json({
        error: 'Unauthorized',
        message: 'authentication required',
      }, 401)
    }
    await next()
  })
  app.get('/health', c => c.json({
    status: 'ok',
    service: options.serviceName ?? 'beegame-billing',
  }))
  registerBeeGameBillingStoreRoutes(app, {
    billingConfig: options.billingConfig,
    dashboardRepository: options.dashboardRepository,
    getCurrentUser: options.getCurrentUser,
    hasPermission: options.hasPermission,
  })
  return app
}
