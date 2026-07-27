import type { Hono } from 'hono'
import type { BillingRouteDeps } from './billing-route-types'
import { registerBeeGameUsageControlRoutes } from './usage-control-routes'
import { registerBeeGameStripeStoreRoutes } from './stripe-store-admin-routes'
import { registerBeeGameStripeWebhookRoute } from './stripe-webhook-routes'

export function registerBeeGameBillingPublicRoutes(
  app: Hono,
  deps: Pick<BillingRouteDeps, 'billingConfig' | 'dashboardRepository'>,
): void {
  registerBeeGameStripeWebhookRoute(app, deps)
  registerBeeGameUsageControlRoutes(app, deps)
}

export function registerBeeGameBillingStoreRoutes(
  app: Hono,
  deps: BillingRouteDeps,
): void {
  registerBeeGameStripeStoreRoutes(app, deps)
}
