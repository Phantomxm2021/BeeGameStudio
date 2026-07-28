import { Hono } from 'hono'
import { cors } from 'hono/cors'
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

  app.onError((error, c) => {
    console.error(
      `[BeeGame billing] ${c.req.method} ${c.req.path} failed:`,
      error,
    )
    return c.json(
      {
        error: 'Billing request failed',
        message: toErrorMessage(error),
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
    getCurrentUser: options.getCurrentUser,
    hasPermission: options.hasPermission,
  })
  return app
}
