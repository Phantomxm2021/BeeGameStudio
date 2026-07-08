export type BeeGameBillingMode = 'server' | 'remote' | 'disabled'

export type BeeGameBillingConfig = {
  mode: BeeGameBillingMode
  remoteApiBaseUrl?: string
}

type BillingEnv = {
  [key: string]: string | undefined
  BEEGAME_BILLING_MODE?: string
  BEEGAME_BILLING_API_BASE_URL?: string
  BEEGAME_STRIPE_SECRET_KEY?: string
  BEEGAME_STRIPE_WEBHOOK_SECRET?: string
  BEEGAME_STRIPE_PRICE_CREDITS?: string
}

export function resolveBeeGameBillingConfig(
  env: BillingEnv = process.env,
): BeeGameBillingConfig {
  const remoteApiBaseUrl = normalizedOptional(env.BEEGAME_BILLING_API_BASE_URL)
  const explicitMode = normalizedOptional(env.BEEGAME_BILLING_MODE)?.toLowerCase()
  if (explicitMode === 'server' || explicitMode === 'remote' || explicitMode === 'disabled') {
    return remoteApiBaseUrl ? { mode: explicitMode, remoteApiBaseUrl } : { mode: explicitMode }
  }
  if (remoteApiBaseUrl) {
    return { mode: 'remote', remoteApiBaseUrl }
  }
  if (
    normalizedOptional(env.BEEGAME_STRIPE_SECRET_KEY) ||
    normalizedOptional(env.BEEGAME_STRIPE_WEBHOOK_SECRET) ||
    normalizedOptional(env.BEEGAME_STRIPE_PRICE_CREDITS)
  ) {
    return { mode: 'server' }
  }
  return { mode: 'disabled' }
}

function normalizedOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
