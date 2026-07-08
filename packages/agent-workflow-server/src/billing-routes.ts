import type { Hono } from 'hono'
import type { BeeGameUserContext } from './auth/user-context'
import type { DashboardRepository } from './dashboard-repository'
import type { BeeGameBillingConfig } from './billing-config'
import {
  StripeWebhookError,
  createStripeCheckoutSession,
  extractStripeCheckoutCreditGrant,
  loadStripePriceCreditMap,
  verifyStripeWebhookEvent,
} from './stripe-payments'

type BillingRouteDeps = {
  billingConfig: BeeGameBillingConfig
  dashboardRepository: DashboardRepository
  getCurrentUser: (request?: Request) => BeeGameUserContext
}

type JsonObject = Record<string, unknown>

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
      const grant = extractStripeCheckoutCreditGrant(event, loadStripePriceCreditMap())
      if (!grant) {
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
        return c.json({
          received: true,
          processed: false,
          eventId: grant.eventId,
          reason: 'duplicate_event',
        })
      }
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

export function registerBeeGameStripeStoreRoutes(
  app: Hono,
  deps: BillingRouteDeps,
): void {
  app.get('/api/payments/stripe/credit-packs', c => {
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
      const priceCredits = loadStripePriceCreditMap()
      return c.json({
        packs: Object.entries(priceCredits)
          .map(([priceId, credits]) => ({ priceId, credits }))
          .sort((left, right) => left.credits - right.credits),
      })
    } catch (error) {
      if (error instanceof StripeWebhookError) {
        return c.json({
          error: 'Stripe credit packs failed',
          message: error.message,
        }, error.status as 400 | 503)
      }
      return c.json({
        error: 'Stripe credit packs failed',
        message: toErrorMessage(error),
      }, 400)
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
        return c.json({
          error: 'Billing disabled',
          message: 'Billing is not configured',
        }, 503)
      }
      const body = await readJson(c.req.raw)
      const priceId = isObject(body) && typeof body.priceId === 'string'
        ? body.priceId.trim()
        : ''
      const priceCredits = loadStripePriceCreditMap()
      const credits = priceCredits[priceId]
      if (!priceId || !credits) {
        return c.json({
          error: 'Invalid request',
          message: 'Stripe price is not available for BeeGame credits',
        }, 400)
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
      return c.json({
        ...session,
        credits,
        priceId,
      })
    } catch (error) {
      if (error instanceof StripeWebhookError) {
        return c.json({
          error: 'Stripe checkout failed',
          message: error.message,
        }, error.status as 400 | 503)
      }
      return c.json({
        error: 'Stripe checkout failed',
        message: toErrorMessage(error),
      }, 400)
    }
  })
}

async function proxyBeeGameBillingRequest(
  request: Request,
  billingConfig: BeeGameBillingConfig,
  path: string,
): Promise<Response> {
  if (!billingConfig.remoteApiBaseUrl) {
    return Response.json({
      error: 'Remote billing failed',
      message: 'BEEGAME_BILLING_API_BASE_URL is required for remote billing mode',
    }, { status: 503 })
  }
  const headers = new Headers()
  const authorization = request.headers.get('authorization')
  if (authorization) headers.set('authorization', authorization)
  const origin = request.headers.get('origin')
  if (origin) headers.set('origin', origin)
  const accept = request.headers.get('accept')
  if (accept) headers.set('accept', accept)
  const method = request.method.toUpperCase()
  const init: RequestInit = { method, headers }
  if (method !== 'GET' && method !== 'HEAD') {
    const contentType = request.headers.get('content-type')
    if (contentType) headers.set('content-type', contentType)
    init.body = await request.text()
  }
  let response: Response
  try {
    response = await fetch(buildBeeGameBillingUrl(billingConfig.remoteApiBaseUrl, path), init)
  } catch {
    return Response.json({
      error: 'Remote billing failed',
      message: 'Billing service is unavailable',
    }, { status: 503 })
  }
  const responseHeaders = new Headers()
  const contentType = response.headers.get('content-type')
  if (contentType) responseHeaders.set('content-type', contentType)
  return new Response(await response.text(), {
    status: response.status,
    headers: responseHeaders,
  })
}

function buildBeeGameBillingUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return new URL(normalizedPath, normalizedBaseUrl).toString()
}

async function readJson(request: Request): Promise<JsonObject> {
  const body = await request.json().catch(() => ({}))
  return isObject(body) ? body : {}
}

function getRequestOrigin(request: Request): string {
  const origin = request.headers.get('origin')?.trim()
  if (origin) return origin.replace(/\/+$/, '')
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed'
}
