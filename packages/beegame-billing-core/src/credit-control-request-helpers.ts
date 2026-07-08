import type { BeeGameBillingConfig } from './billing-config'

type JsonObject = Record<string, unknown>

export function requireCreditControlToken(
  request: Request,
  billingConfig: BeeGameBillingConfig,
): Response | undefined {
  if (!billingConfig.creditControlToken) {
    return Response.json({
      error: 'Credit control disabled',
      message: 'BEEGAME_CREDIT_CONTROL_TOKEN is required for credit control APIs',
    }, { status: 503 })
  }
  const provided = request.headers.get('x-beegame-credit-control-token')?.trim()
  if (!provided || provided !== billingConfig.creditControlToken) {
    return Response.json({
      error: 'Unauthorized',
      message: 'credit control token is required',
    }, { status: 401 })
  }
  return undefined
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function numberValue(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value.trim())
  return Number.NaN
}

export function metadataWithIdempotency(
  value: unknown,
  idempotencyKey: string,
): Record<string, unknown> | undefined {
  const metadata = isObject(value) ? { ...value } : {}
  if (idempotencyKey) metadata.idempotencyKey = idempotencyKey
  return Object.keys(metadata).length ? metadata : undefined
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
