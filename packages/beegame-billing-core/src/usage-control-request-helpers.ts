import type { BeeGameBillingConfig } from './billing-config'

export function requireUsageServiceToken(
  request: Request,
  billingConfig: BeeGameBillingConfig,
): Response | undefined {
  if (!billingConfig.creditControlToken) {
    return Response.json(
      {
        error: 'Usage billing disabled',
        message:
          'BEEGAME_CREDIT_CONTROL_TOKEN is required for usage billing APIs',
      },
      { status: 503 },
    )
  }
  const provided = request.headers.get('x-beegame-credit-control-token')?.trim()
  if (!provided || provided !== billingConfig.creditControlToken) {
    return Response.json(
      { error: 'Unauthorized', message: 'usage billing token is required' },
      { status: 401 },
    )
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
