import type { Hono } from 'hono'
import {
  hasBeeGamePermission,
  type BeeGameUserContext,
} from './auth/user-context'
import type {
  BeeGameBillingCreditPack,
  BeeGameBillingEventInput,
  DashboardRepository,
} from './dashboard-repository'
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
      await safeAppendBillingEvent(c.req.raw, deps.dashboardRepository, {
        provider: 'stripe',
        eventType: event.type,
        status: 'received',
        providerEventId: event.id,
      })
      const grant = extractStripeCheckoutCreditGrant(
        event,
        packsToCreditMap(await loadAvailableStripeCreditPacks(c.req.raw, deps.dashboardRepository)),
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
        packs: (await loadAvailableStripeCreditPacks(c.req.raw, deps.dashboardRepository))
          .map(toPublicCreditPack),
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
      const priceCredits = packsToCreditMap(
        await loadAvailableStripeCreditPacks(c.req.raw, deps.dashboardRepository),
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
        return c.json({
          error: 'Stripe checkout failed',
          message: error.message,
        }, error.status as 400 | 503)
      }
      await safeAppendBillingEvent(c.req.raw, deps.dashboardRepository, {
        provider: 'stripe',
        eventType: 'checkout.session.create_requested',
        status: 'failed',
        userId: user.id,
        errorMessage: toErrorMessage(error),
      })
      return c.json({
        error: 'Stripe checkout failed',
        message: toErrorMessage(error),
      }, 400)
    }
  })

  app.get('/api/admin/billing/events', async c => {
    const user = deps.getCurrentUser(c.req.raw)
    if (!hasBeeGamePermission(user, 'audit.read')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    if (deps.billingConfig.mode === 'remote') {
      return proxyBeeGameBillingRequest(
        c.req.raw,
        deps.billingConfig,
        '/api/admin/billing/events',
      )
    }
    return c.json({ events: await deps.dashboardRepository.listBillingEvents(c.req.raw) })
  })

  app.get('/api/admin/billing/credit-packs', async c => {
    const user = deps.getCurrentUser(c.req.raw)
    if (!hasBeeGamePermission(user, 'audit.read')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    if (deps.billingConfig.mode === 'remote') {
      return proxyBeeGameBillingRequest(
        c.req.raw,
        deps.billingConfig,
        '/api/admin/billing/credit-packs',
      )
    }
    return c.json({ packs: await deps.dashboardRepository.listBillingCreditPacks(c.req.raw) })
  })

  app.post('/api/admin/billing/credit-packs', async c => {
    const user = deps.getCurrentUser(c.req.raw)
    if (!hasBeeGamePermission(user, 'audit.read')) {
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
    const pack = await deps.dashboardRepository.upsertBillingCreditPack(c.req.raw, {
      priceId: stringValue(body.priceId),
      credits: numberValue(body.credits),
      displayName: stringValue(body.displayName) || undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      sortOrder: numberValue(body.sortOrder),
      metadata: isObject(body.metadata) ? body.metadata : undefined,
    })
    return c.json({ pack })
  })
}

async function loadAvailableStripeCreditPacks(
  request: Request,
  dashboardRepository: DashboardRepository,
): Promise<BeeGameBillingCreditPack[]> {
  const storedPacks = await dashboardRepository.listBillingCreditPacks(request, {
    enabledOnly: true,
  })
  if (storedPacks.length) return storedPacks
  const priceCredits = loadStripePriceCreditMap()
  return Object.entries(priceCredits)
    .map(([priceId, credits], index) => ({
      provider: 'stripe' as const,
      priceId,
      credits,
      enabled: true,
      sortOrder: index,
      metadata: {},
    }))
    .sort((left, right) => left.credits - right.credits)
}

function packsToCreditMap(packs: BeeGameBillingCreditPack[]): Record<string, number> {
  const mapping: Record<string, number> = {}
  for (const pack of packs) {
    if (pack.enabled && pack.priceId && pack.credits > 0) {
      mapping[pack.priceId] = pack.credits
    }
  }
  return mapping
}

function toPublicCreditPack(pack: BeeGameBillingCreditPack): {
  priceId: string
  credits: number
  displayName?: string
} {
  return {
    priceId: pack.priceId,
    credits: pack.credits,
    ...(pack.displayName ? { displayName: pack.displayName } : {}),
  }
}

async function safeAppendBillingEvent(
  request: Request | undefined,
  dashboardRepository: DashboardRepository,
  input: BeeGameBillingEventInput,
): Promise<void> {
  try {
    await dashboardRepository.appendBillingEvent(request, input)
  } catch (error) {
    console.warn('[BeeGame] Billing audit event failed:', {
      eventType: input.eventType,
      message: toErrorMessage(error),
    })
  }
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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value.trim())
  return Number.NaN
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed'
}
