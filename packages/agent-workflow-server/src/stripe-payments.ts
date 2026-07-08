import { createHmac, timingSafeEqual } from 'node:crypto'

export type StripePaymentEvent = {
  id: string
  type: string
  data?: {
    object?: unknown
  }
}

export type StripeCheckoutCreditGrant = {
  eventId: string
  checkoutSessionId: string
  userId: string
  priceId: string
  credits: number
}

export type StripeCheckoutSessionRequest = {
  secretKey?: string
  priceId: string
  userId: string
  userEmail?: string
  credits: number
  successUrl: string
  cancelUrl: string
  fetch?: typeof fetch
}

export type StripeCheckoutSessionResponse = {
  id: string
  url: string
}

export function verifyStripeWebhookEvent(input: {
  payload: string
  signatureHeader: string | null
  secret: string | undefined
}): StripePaymentEvent {
  const secret = input.secret?.trim()
  if (!secret) {
    throw new StripeWebhookError(503, 'Stripe webhook is not configured')
  }
  const parsedSignature = parseStripeSignatureHeader(input.signatureHeader)
  if (!parsedSignature) {
    throw new StripeWebhookError(400, 'Stripe signature is missing or invalid')
  }
  const expected = createHmac('sha256', secret)
    .update(`${parsedSignature.timestamp}.${input.payload}`)
    .digest('hex')
  if (!constantTimeHexEqual(expected, parsedSignature.signature)) {
    throw new StripeWebhookError(400, 'Stripe signature verification failed')
  }
  const parsed = JSON.parse(input.payload) as unknown
  if (!isRecord(parsed) || typeof parsed.id !== 'string' || typeof parsed.type !== 'string') {
    throw new StripeWebhookError(400, 'Stripe event payload is invalid')
  }
  return parsed as StripePaymentEvent
}

export function extractStripeCheckoutCreditGrant(
  event: StripePaymentEvent,
  priceCredits: Record<string, number>,
): StripeCheckoutCreditGrant | undefined {
  if (event.type !== 'checkout.session.completed') return undefined
  const session = isRecord(event.data) && isRecord(event.data.object)
    ? event.data.object
    : undefined
  if (!session) {
    throw new StripeWebhookError(400, 'Stripe checkout session is missing')
  }
  const paymentStatus = stringField(session.payment_status)
  if (paymentStatus && paymentStatus !== 'paid') return undefined
  const metadata = isRecord(session.metadata) ? session.metadata : {}
  const userId = stringField(metadata.beeGameUserId) ||
    stringField(metadata.userId) ||
    stringField(session.client_reference_id)
  const priceId = stringField(metadata.beeGamePriceId) ||
    stringField(metadata.priceId)
  if (!userId || !priceId) {
    throw new StripeWebhookError(400, 'Stripe checkout session is missing BeeGame user or price metadata')
  }
  const credits = priceCredits[priceId]
  if (!Number.isInteger(credits) || credits <= 0) {
    throw new StripeWebhookError(400, 'Stripe price is not mapped to credits')
  }
  return {
    eventId: event.id,
    checkoutSessionId: stringField(session.id) || '',
    userId,
    priceId,
    credits,
  }
}

export function loadStripePriceCreditMap(
  raw = process.env.BEEGAME_STRIPE_PRICE_CREDITS,
): Record<string, number> {
  const trimmed = raw?.trim()
  if (!trimmed) return {}
  const parsed = parseStripePriceCreditMap(trimmed)
  if (!isRecord(parsed)) {
    throw new StripeWebhookError(
      503,
      'BEEGAME_STRIPE_PRICE_CREDITS must be a JSON object or comma-separated price=credits pairs',
    )
  }
  const mapping: Record<string, number> = {}
  for (const [priceId, value] of Object.entries(parsed)) {
    const credits = Math.floor(numberField(value))
    if (priceId.trim() && credits > 0) {
      mapping[priceId.trim()] = credits
    }
  }
  if (!Object.keys(mapping).length) {
    throw new StripeWebhookError(
      503,
      'BEEGAME_STRIPE_PRICE_CREDITS must map at least one Stripe price ID to positive credits',
    )
  }
  return mapping
}

export async function createStripeCheckoutSession(
  input: StripeCheckoutSessionRequest,
): Promise<StripeCheckoutSessionResponse> {
  const secretKey = input.secretKey?.trim()
  if (!secretKey) {
    throw new StripeWebhookError(503, 'Stripe checkout is not configured')
  }
  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('line_items[0][price]', input.priceId)
  params.set('line_items[0][quantity]', '1')
  params.set('client_reference_id', input.userId)
  params.set('metadata[beeGameUserId]', input.userId)
  params.set('metadata[beeGamePriceId]', input.priceId)
  params.set('metadata[beeGameCredits]', String(input.credits))
  params.set('success_url', input.successUrl)
  params.set('cancel_url', input.cancelUrl)
  if (input.userEmail?.trim()) {
    params.set('customer_email', input.userEmail.trim())
  }
  const fetchImpl = input.fetch ?? fetch
  const response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  const body = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string'
      ? body.error.message
      : `Stripe checkout session creation failed with status ${response.status}`
    throw new StripeWebhookError(400, message)
  }
  if (!isRecord(body) || typeof body.id !== 'string' || typeof body.url !== 'string') {
    throw new StripeWebhookError(400, 'Stripe checkout session response is invalid')
  }
  return {
    id: body.id,
    url: body.url,
  }
}

export class StripeWebhookError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'StripeWebhookError'
    Object.setPrototypeOf(this, StripeWebhookError.prototype)
  }
}

function parseStripeSignatureHeader(
  header: string | null,
): { timestamp: string; signature: string } | undefined {
  if (!header) return undefined
  const parts = header.split(',')
  let timestamp = ''
  let signature = ''
  for (const part of parts) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex <= 0) continue
    const key = part.slice(0, separatorIndex).trim()
    const value = part.slice(separatorIndex + 1).trim()
    if (key === 't') timestamp = value
    if (key === 'v1' && !signature) signature = value
  }
  return timestamp && signature ? { timestamp, signature } : undefined
}

function constantTimeHexEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'hex')
  const actualBuffer = Buffer.from(actual, 'hex')
  return expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberField(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value.trim())
  return Number.NaN
}

function parseStripePriceCreditMap(raw: string): unknown {
  if (raw.startsWith('{')) {
    try {
      return JSON.parse(raw) as unknown
    } catch {
      throw new StripeWebhookError(
        503,
        'BEEGAME_STRIPE_PRICE_CREDITS must be valid JSON when it starts with "{"',
      )
    }
  }
  const mapping: Record<string, number> = {}
  for (const item of raw.split(',')) {
    const pair = item.trim()
    if (!pair) continue
    const equalsIndex = pair.indexOf('=')
    const colonIndex = pair.indexOf(':')
    const separatorIndex = equalsIndex >= 0
      ? equalsIndex
      : colonIndex
    if (separatorIndex <= 0 || separatorIndex >= pair.length - 1) continue
    const priceId = pair.slice(0, separatorIndex).trim()
    const credits = Number(pair.slice(separatorIndex + 1).trim())
    if (priceId && Number.isFinite(credits)) {
      mapping[priceId] = credits
    }
  }
  return mapping
}
