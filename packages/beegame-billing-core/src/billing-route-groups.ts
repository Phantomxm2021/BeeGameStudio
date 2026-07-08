import type { Hono } from 'hono'
import type {
  BillingRouteDeps,
} from './billing-route-types'
import {
  registerBeeGameCreditControlRoutes,
} from './credit-control-routes'
import {
  registerBeeGameStripeStoreRoutes,
} from './stripe-store-admin-routes'
import {
  registerBeeGameStripeWebhookRoute,
} from './stripe-webhook-routes'

export type BeeGameBillingPublicRouteOptions = {
  creditControl?: boolean
}

export function registerBeeGameBillingPublicRoutes(
  app: Hono,
  deps: Pick<BillingRouteDeps, 'billingConfig' | 'dashboardRepository'>,
  options: BeeGameBillingPublicRouteOptions = {},
): void {
  registerBeeGameStripeWebhookRoute(app, deps)
  if (options.creditControl) {
    registerBeeGameCreditControlRoutes(app, deps)
  }
}

export function registerBeeGameBillingStoreRoutes(
  app: Hono,
  deps: BillingRouteDeps,
): void {
  registerBeeGameStripeStoreRoutes(app, deps)
}
