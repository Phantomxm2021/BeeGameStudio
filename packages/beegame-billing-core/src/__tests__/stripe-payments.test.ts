import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  extractStripeCheckoutCreditGrant,
  loadStripePriceCreditMap,
  verifyStripeWebhookEvent,
} from '../stripe-payments'

describe('stripe-payments', () => {
  test('verifies checkout events and maps Stripe prices to BeeGame credits', () => {
    const payload = JSON.stringify({
      id: 'evt_checkout_completed',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_checkout',
          payment_status: 'paid',
          client_reference_id: 'user-from-session',
          metadata: {
            beeGameUserId: 'user-a',
            beeGamePriceId: 'price_500',
          },
        },
      },
    })
    const timestamp = '1783530000'
    const secret = 'whsec_test_secret'
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex')

    const event = verifyStripeWebhookEvent({
      payload,
      signatureHeader: `t=${timestamp},v1=${signature}`,
      secret,
    })

    expect(extractStripeCheckoutCreditGrant(
      event,
      loadStripePriceCreditMap('price_500=500'),
    )).toEqual({
      eventId: 'evt_checkout_completed',
      checkoutSessionId: 'cs_checkout',
      userId: 'user-a',
      priceId: 'price_500',
      credits: 500,
    })
  })
})
