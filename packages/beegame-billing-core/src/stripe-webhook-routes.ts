import type { Hono } from 'hono'
import {
  loadAvailableStripeCreditPacks,
  safeAppendBillingEvent,
} from './billing-route-helpers'
import {
  stripeCreditPacksToCreditMap,
} from './credit-pack-helpers'
import {
  toErrorMessage,
} from './http-helpers'
import {
  StripeWebhookError,
  extractStripeCheckoutCreditGrant,
  verifyStripeWebhookEvent,
} from './stripe-payments'
import type {
  BillingRouteDeps,
} from './billing-route-types'

export function registerBeeGameStripeWebhookRoute(
  app: Hono,
  deps: Pick<BillingRouteDeps, 'billingConfig' | 'dashboardRepository'>,
): void {
  app.post('/api/payments/stripe/webhook', async c => {
    if (deps.billingConfig.mode !== 'server') {
      return c.json({
        error: 'Billing webhook disabled',
        message: 'Stripe webhook is only enabled in server billing mode',
      }, 503)
    }
    let stripeEventId = ''
    let stripeEventType = ''
    try {
      const payload = await c.req.raw.text()
      const event = verifyStripeWebhookEvent({
        payload,
        signatureHeader: c.req.raw.headers.get('stripe-signature'),
        secret: process.env.BEEGAME_STRIPE_WEBHOOK_SECRET,
      })
      stripeEventId = event.id
      stripeEventType = event.type
      await safeAppendBillingEvent(c.req.raw, deps.dashboardRepository, {
        provider: 'stripe',
        eventType: event.type,
        status: 'received',
        providerEventId: event.id,
      })
      const grant = extractStripeCheckoutCreditGrant(
        event,
        stripeCreditPacksToCreditMap(
          await loadAvailableStripeCreditPacks(c.req.raw, deps.dashboardRepository),
        ),
      )
      if (!grant) {
        await safeAppendBillingEvent(c.req.raw, deps.dashboardRepository, {
          provider: 'stripe',
          eventType: event.type,
          status: 'ignored',
          providerEventId: event.id,
          metadata: { reason: 'ignored_event' },
        })
        return c.json({
          received: true,
          processed: false,
          eventId: event.id,
          reason: 'ignored_event',
        })
      }
      const result = await deps.dashboardRepository.grantPaymentProviderCredits(
        c.req.raw,
        grant.userId,
        {
          credits: grant.credits,
          metadata: {
            source: 'payment_provider',
            provider: 'stripe',
            providerReference: grant.eventId,
            stripeCheckoutSessionId: grant.checkoutSessionId,
            stripePriceId: grant.priceId,
          },
        },
      )
      if (result.grantedCredits <= 0) {
        await safeAppendBillingEvent(c.req.raw, deps.dashboardRepository, {
          provider: 'stripe',
          eventType: event.type,
          status: 'ignored',
          userId: grant.userId,
          priceId: grant.priceId,
          credits: grant.credits,
          providerEventId: grant.eventId,
          checkoutSessionId: grant.checkoutSessionId,
          metadata: { reason: 'duplicate_event' },
        })
        return c.json({
          received: true,
          processed: false,
          eventId: grant.eventId,
          reason: 'duplicate_event',
        })
      }
      await safeAppendBillingEvent(c.req.raw, deps.dashboardRepository, {
        provider: 'stripe',
        eventType: event.type,
        status: 'succeeded',
        userId: grant.userId,
        priceId: grant.priceId,
        credits: grant.credits,
        providerEventId: grant.eventId,
        checkoutSessionId: grant.checkoutSessionId,
      })
      return c.json({
        received: true,
        processed: true,
        eventId: grant.eventId,
        grantedCredits: result.grantedCredits,
      })
    } catch (error) {
      console.warn('[BeeGame] Stripe webhook failed:', {
        eventId: stripeEventId || undefined,
        eventType: stripeEventType || undefined,
        message: toErrorMessage(error),
      })
      await safeAppendBillingEvent(c.req.raw, deps.dashboardRepository, {
        provider: 'stripe',
        eventType: stripeEventType || 'stripe.webhook',
        status: 'failed',
        providerEventId: stripeEventId || undefined,
        errorMessage: toErrorMessage(error),
      })
      if (error instanceof StripeWebhookError) {
        return c.json({
          error: 'Stripe webhook failed',
          message: error.message,
        }, error.status as 400 | 503)
      }
      return c.json({
        error: 'Stripe webhook failed',
        message: toErrorMessage(error),
      }, 400)
    }
  })
}
