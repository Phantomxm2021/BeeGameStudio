import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
  createBeeGameAuthContext,
} from './auth/auth-context'
import {
  type BeeGameUserContext,
  type BeeGameUserResolver,
  createConfiguredUserResolver,
} from './auth/user-context'
import {
  resolveBeeGameBillingConfig,
  type BeeGameBillingConfig,
} from './billing-config'
import {
  registerBeeGameStripeStoreRoutes,
  registerBeeGameStripeWebhookRoute,
} from './billing-routes'
import {
  DashboardRepository,
} from './dashboard-repository'
import {
  getDashboardDataRoot,
  getUserDashboardDataRoot,
} from './local-runtime-service'
import {
  createSupabaseDashboardStoreFromEnv,
  createSupabasePaymentProviderGrantStoreFromEnv,
} from './supabase-dashboard-store'

export type BeeGameBillingAppOptions = {
  dashboardDataRoot?: string
  billingConfig?: BeeGameBillingConfig
  currentUser?: BeeGameUserContext
  currentUserResolver?: BeeGameUserResolver
}

export function createBeeGameBillingApp(
  options: BeeGameBillingAppOptions = {},
): Hono {
  const app = new Hono()
  const dashboardDataRoot = getDashboardDataRoot(options.dashboardDataRoot)
  const supabaseStore = createSupabaseDashboardStoreFromEnv()
  const supabasePaymentProviderStore = createSupabasePaymentProviderGrantStoreFromEnv()
  const authContext = createBeeGameAuthContext({
    currentUser: options.currentUser,
    currentUserResolver: options.currentUserResolver ?? createConfiguredUserResolver(),
  })
  const getCurrentUser = authContext.getCurrentUser
  const dashboardRepository = new DashboardRepository({
    dashboardDataRoot,
    supabaseStore,
    supabasePaymentProviderStore,
    getUserDataRoot: request =>
      getUserDashboardDataRoot(dashboardDataRoot, getCurrentUser(request).id),
    modelConfigStore: false,
  })
  const billingConfig = options.billingConfig ?? resolveBeeGameBillingConfig()

  app.use('/api/*', cors())
  registerBeeGameStripeWebhookRoute(app, {
    billingConfig,
    dashboardRepository,
  })
  app.use('/api/*', async (c, next) => {
    if (options.currentUser) {
      await next()
      return
    }
    const user = await authContext.resolveRequestUser(c.req.raw)
    if (!user) {
      return c.json({
        error: 'Unauthorized',
        message: 'authentication required',
      }, 401)
    }
    await next()
  })
  app.get('/health', c => c.json({ status: 'ok', service: 'beegame-billing' }))
  registerBeeGameStripeStoreRoutes(app, {
    billingConfig,
    dashboardRepository,
    getCurrentUser,
  })
  return app
}
