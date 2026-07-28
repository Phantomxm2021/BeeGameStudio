import { randomUUID } from 'node:crypto'
import type { Hono } from 'hono'
import type { Context } from 'hono'
import {
  loadAvailableStripeCreditPacks,
  safeAppendBillingEvent,
} from './billing-route-helpers'
import {
  stripeCreditPacksToCreditMap,
  toPublicStripeCreditPack,
} from './credit-pack-helpers'
import { numberValue, stringValue } from './usage-control-request-helpers'
import {
  getRequestOrigin,
  isObject,
  readJson,
  toErrorMessage,
} from './http-helpers'
import { proxyBeeGameBillingRequest } from './remote-billing-proxy'
import {
  StripeWebhookError,
  createStripeCheckoutSession,
} from './stripe-payments'
import type { BillingRouteDeps } from './billing-route-types'

export function registerBeeGameStripeStoreRoutes(
  app: Hono,
  deps: BillingRouteDeps,
): void {
  app.get('/api/payments/stripe/credit-packs', async c => {
    try {
      if (deps.billingConfig.mode === 'remote') {
        return proxyBeeGameBillingRequest(
          c.req.raw,
          deps.billingConfig,
          '/api/payments/stripe/credit-packs',
        )
      }
      if (deps.billingConfig.mode === 'disabled') {
        return c.json({ packs: [] })
      }
      return c.json({
        packs: (
          await loadAvailableStripeCreditPacks(
            c.req.raw,
            deps.dashboardRepository,
          )
        ).map(toPublicStripeCreditPack),
      })
    } catch (error) {
      if (error instanceof StripeWebhookError) {
        return c.json(
          {
            error: 'Stripe credit packs failed',
            message: error.message,
          },
          error.status as 400 | 503,
        )
      }
      return c.json(
        {
          error: 'Stripe credit packs failed',
          message: toErrorMessage(error),
        },
        400,
      )
    }
  })

  app.post('/api/payments/stripe/checkout-session', async c => {
    const user = deps.getCurrentUser(c.req.raw)
    try {
      if (deps.billingConfig.mode === 'remote') {
        return proxyBeeGameBillingRequest(
          c.req.raw,
          deps.billingConfig,
          '/api/payments/stripe/checkout-session',
        )
      }
      if (deps.billingConfig.mode === 'disabled') {
        return c.json(
          {
            error: 'Billing disabled',
            message: 'Billing is not configured',
          },
          503,
        )
      }
      const body = await readJson(c.req.raw)
      const priceId =
        isObject(body) && typeof body.priceId === 'string'
          ? body.priceId.trim()
          : ''
      const priceCredits = stripeCreditPacksToCreditMap(
        await loadAvailableStripeCreditPacks(
          c.req.raw,
          deps.dashboardRepository,
        ),
      )
      const credits = priceCredits[priceId]
      if (!priceId || !credits) {
        await safeAppendBillingEvent(c.req.raw, deps.dashboardRepository, {
          provider: 'stripe',
          eventType: 'checkout.session.create_requested',
          status: 'failed',
          userId: user.id,
          priceId,
          errorMessage: 'Stripe price is not available for BeeGame credits',
        })
        return c.json(
          {
            error: 'Invalid request',
            message: 'Stripe price is not available for BeeGame credits',
          },
          400,
        )
      }
      const origin = getRequestOrigin(c.req.raw)
      const session = await createStripeCheckoutSession({
        secretKey: process.env.BEEGAME_STRIPE_SECRET_KEY,
        priceId,
        userId: user.id,
        ...(user.email ? { userEmail: user.email } : {}),
        credits,
        successUrl: `${origin}/?payment=success`,
        cancelUrl: `${origin}/?payment=cancelled`,
      })
      await safeAppendBillingEvent(c.req.raw, deps.dashboardRepository, {
        provider: 'stripe',
        eventType: 'checkout.session.created',
        status: 'succeeded',
        userId: user.id,
        priceId,
        credits,
        checkoutSessionId: session.id,
      })
      return c.json({
        ...session,
        credits,
        priceId,
      })
    } catch (error) {
      if (error instanceof StripeWebhookError) {
        await safeAppendBillingEvent(c.req.raw, deps.dashboardRepository, {
          provider: 'stripe',
          eventType: 'checkout.session.create_requested',
          status: 'failed',
          userId: user.id,
          errorMessage: error.message,
        })
        return c.json(
          {
            error: 'Stripe checkout failed',
            message: error.message,
          },
          error.status as 400 | 503,
        )
      }
      await safeAppendBillingEvent(c.req.raw, deps.dashboardRepository, {
        provider: 'stripe',
        eventType: 'checkout.session.create_requested',
        status: 'failed',
        userId: user.id,
        errorMessage: toErrorMessage(error),
      })
      return c.json(
        {
          error: 'Stripe checkout failed',
          message: toErrorMessage(error),
        },
        400,
      )
    }
  })

  app.get('/api/admin/billing/events', async c => {
    const user = deps.getCurrentUser(c.req.raw)
    if (!deps.hasPermission(user, 'audit.read')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    if (deps.billingConfig.mode === 'remote') {
      return proxyBeeGameBillingRequest(
        c.req.raw,
        deps.billingConfig,
        '/api/admin/billing/events',
      )
    }
    try {
      return c.json({
        events: await deps.dashboardRepository.listBillingEvents(c.req.raw),
      })
    } catch (error) {
      return tracedRouteError(c, 'admin.billing.events.list', error)
    }
  })

  app.get('/api/admin/billing/credit-packs', async c => {
    const user = deps.getCurrentUser(c.req.raw)
    if (!deps.hasPermission(user, 'credits.admin')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    if (deps.billingConfig.mode === 'remote') {
      return proxyBeeGameBillingRequest(
        c.req.raw,
        deps.billingConfig,
        '/api/admin/billing/credit-packs',
      )
    }
    try {
      return c.json({
        packs: await deps.dashboardRepository.listBillingCreditPacks(c.req.raw),
      })
    } catch (error) {
      return tracedRouteError(c, 'admin.billing.credit-packs.list', error)
    }
  })

  app.post('/api/admin/billing/credit-packs', async c => {
    const user = deps.getCurrentUser(c.req.raw)
    if (!deps.hasPermission(user, 'credits.admin')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    if (deps.billingConfig.mode === 'remote') {
      return proxyBeeGameBillingRequest(
        c.req.raw,
        deps.billingConfig,
        '/api/admin/billing/credit-packs',
      )
    }
    const body = await readJson(c.req.raw)
    try {
      const pack = await deps.dashboardRepository.upsertBillingCreditPack(
        c.req.raw,
        {
          priceId: stringValue(body.priceId),
          credits: numberValue(body.credits),
          displayName: stringValue(body.displayName) || undefined,
          enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
          sortOrder: numberValue(body.sortOrder),
          metadata: isObject(body.metadata) ? body.metadata : undefined,
        },
      )
      return c.json({ pack })
    } catch (error) {
      return tracedRouteError(c, 'admin.billing.credit-packs.upsert', error)
    }
  })

  app.post('/api/admin/credits/grants', async c => {
    const user = deps.getCurrentUser(c.req.raw)
    if (!deps.hasPermission(user, 'credits.admin')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    if (deps.billingConfig.mode === 'remote') {
      return proxyBeeGameBillingRequest(
        c.req.raw,
        deps.billingConfig,
        '/api/admin/credits/grants',
      )
    }
    const body = await readJson(c.req.raw)
    const targetUserId =
      isObject(body) && typeof body.userId === 'string'
        ? body.userId.trim()
        : ''
    const credits =
      isObject(body) && typeof body.credits === 'number'
        ? Math.floor(body.credits)
        : 0
    if (!targetUserId || credits <= 0) {
      return c.json(
        {
          error: 'Invalid request',
          message: 'userId and positive credits are required.',
        },
        400,
      )
    }
    const metadata =
      isObject(body) && isObject(body.metadata) ? body.metadata : {}
    try {
      return c.json(
        await deps.dashboardRepository.grantCredits(c.req.raw, targetUserId, {
          credits,
          metadata: {
            ...metadata,
            grantedBy: user.id,
          },
        }),
      )
    } catch (error) {
      return tracedRouteError(c, 'admin.credits.grants', error)
    }
  })
}

function tracedRouteError(c: Context, route: string, error: unknown): Response {
  const traceId = randomUUID()
  console.warn('[BeeGame] route failed', {
    traceId,
    route,
    cause: error instanceof Error ? error.name : 'unknown_error',
  })
  return c.json({ error: 'Request failed', traceId }, 400)
}
