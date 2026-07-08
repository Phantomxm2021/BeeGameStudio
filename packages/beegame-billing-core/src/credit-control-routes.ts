import type { Hono } from 'hono'
import {
  metadataWithIdempotency,
  numberValue,
  requireCreditControlToken,
  stringValue,
} from './credit-control-request-helpers'
import {
  isObject,
  readJson,
  toErrorMessage,
} from './http-helpers'
import type {
  BillingRouteDeps,
} from './billing-route-types'

export function registerBeeGameCreditControlRoutes(
  app: Hono,
  deps: Pick<BillingRouteDeps, 'billingConfig' | 'dashboardRepository'>,
): void {
  app.post('/api/internal/credits/reservations', async c => {
    const forbidden = requireCreditControlToken(c.req.raw, deps.billingConfig)
    if (forbidden) return forbidden
    const body = await readJson(c.req.raw)
    const userId = stringValue(body.userId)
    const credits = numberValue(body.credits)
    if (!userId || !Number.isSafeInteger(credits) || credits <= 0) {
      return c.json({
        error: 'Invalid request',
        message: 'userId and positive integer credits are required',
      }, 400)
    }
    const idempotencyKey = stringValue(body.idempotencyKey) ||
      stringValue(isObject(body.metadata) ? body.metadata.idempotencyKey : undefined)
    if (idempotencyKey) {
      const existing = await deps.dashboardRepository
        .findCreditReservationByIdempotencyKeyForUser(userId, idempotencyKey)
      if (existing) return c.json(existing)
    }
    return c.json(await deps.dashboardRepository.reserveCreditsForUser(userId, {
      credits,
      kind: stringValue(body.kind) || undefined,
      projectId: stringValue(body.projectId) || undefined,
      metadata: metadataWithIdempotency(body.metadata, idempotencyKey),
    }))
  })

  app.post('/api/internal/credits/reservations/:reservationId/settle', async c => {
    const forbidden = requireCreditControlToken(c.req.raw, deps.billingConfig)
    if (forbidden) return forbidden
    const body = await readJson(c.req.raw)
    const userId = stringValue(body.userId)
    const reservationId = c.req.param('reservationId')?.trim()
    const weightedTokens = numberValue(body.weightedTokens)
    if (!userId || !reservationId || !Number.isSafeInteger(weightedTokens) || weightedTokens < 0) {
      return c.json({
        error: 'Invalid request',
        message: 'userId, reservationId, and non-negative integer weightedTokens are required',
      }, 400)
    }
    const existing = await deps.dashboardRepository.getCreditSettlementForUser(userId, reservationId)
    if (existing) return c.json(existing)
    const idempotencyKey = stringValue(body.idempotencyKey) ||
      stringValue(isObject(body.metadata) ? body.metadata.idempotencyKey : undefined)
    try {
      return c.json(await deps.dashboardRepository.settleCreditReservationForUser(userId, {
        reservationId,
        weightedTokens,
        projectId: stringValue(body.projectId) || undefined,
        metadata: metadataWithIdempotency(body.metadata, idempotencyKey),
      }))
    } catch (error) {
      const completed = await deps.dashboardRepository.getCreditSettlementForUser(userId, reservationId)
      if (completed && toErrorMessage(error).includes('already settled')) return c.json(completed)
      throw error
    }
  })

  app.post('/api/internal/credits/reservations/:reservationId/refund', async c => {
    const forbidden = requireCreditControlToken(c.req.raw, deps.billingConfig)
    if (forbidden) return forbidden
    const body = await readJson(c.req.raw)
    const userId = stringValue(body.userId)
    const reservationId = c.req.param('reservationId')?.trim()
    if (!userId || !reservationId) {
      return c.json({
        error: 'Invalid request',
        message: 'userId and reservationId are required',
      }, 400)
    }
    const existing = await deps.dashboardRepository.getCreditSettlementForUser(userId, reservationId)
    if (existing) return c.json(existing)
    const idempotencyKey = stringValue(body.idempotencyKey) ||
      stringValue(isObject(body.metadata) ? body.metadata.idempotencyKey : undefined)
    try {
      return c.json(await deps.dashboardRepository.refundCreditReservationForUser(userId, {
        reservationId,
        projectId: stringValue(body.projectId) || undefined,
        metadata: metadataWithIdempotency(body.metadata, idempotencyKey),
      }))
    } catch (error) {
      const completed = await deps.dashboardRepository.getCreditSettlementForUser(userId, reservationId)
      if (completed && toErrorMessage(error).includes('already settled')) return c.json(completed)
      throw error
    }
  })

  app.post('/api/internal/credits/reconcile-stale-reservations', async c => {
    const forbidden = requireCreditControlToken(c.req.raw, deps.billingConfig)
    if (forbidden) return forbidden
    const body = await readJson(c.req.raw)
    const userId = stringValue(body.userId)
    const olderThanValue = stringValue(body.olderThan)
    const olderThan = new Date(olderThanValue)
    if (!userId || !olderThanValue || !Number.isFinite(olderThan.getTime())) {
      return c.json({
        error: 'Invalid request',
        message: 'userId and ISO olderThan are required',
      }, 400)
    }
    return c.json(await deps.dashboardRepository.expireStaleCreditReservationsForUser(userId, {
      olderThan,
      projectId: stringValue(body.projectId) || undefined,
      metadata: isObject(body.metadata) ? body.metadata : undefined,
    }))
  })
}
