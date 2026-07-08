export type BeeGameBillingMode = 'server' | 'remote' | 'disabled'

export type BeeGameBillingConfig = {
  mode: BeeGameBillingMode
  remoteApiBaseUrl?: string
  creditControlToken?: string
}

type BillingEnv = {
  [key: string]: string | undefined
  BEEGAME_BILLING_MODE?: string
  BEEGAME_BILLING_API_BASE_URL?: string
  BEEGAME_CREDIT_CONTROL_TOKEN?: string
  BEEGAME_STRIPE_SECRET_KEY?: string
  BEEGAME_STRIPE_WEBHOOK_SECRET?: string
  BEEGAME_STRIPE_PRICE_CREDITS?: string
}

export function resolveBeeGameBillingConfig(
  env: BillingEnv = process.env,
): BeeGameBillingConfig {
  const remoteApiBaseUrl = normalizedOptional(env.BEEGAME_BILLING_API_BASE_URL)
  const creditControlToken = normalizedOptional(env.BEEGAME_CREDIT_CONTROL_TOKEN)
  const explicitMode = normalizedOptional(env.BEEGAME_BILLING_MODE)?.toLowerCase()
  if (explicitMode === 'server' || explicitMode === 'remote' || explicitMode === 'disabled') {
    return compactBillingConfig({
      mode: explicitMode,
      remoteApiBaseUrl,
      creditControlToken,
    })
  }
  if (remoteApiBaseUrl) {
    return compactBillingConfig({ mode: 'remote', remoteApiBaseUrl, creditControlToken })
  }
  if (
    normalizedOptional(env.BEEGAME_STRIPE_SECRET_KEY) ||
    normalizedOptional(env.BEEGAME_STRIPE_WEBHOOK_SECRET) ||
    normalizedOptional(env.BEEGAME_STRIPE_PRICE_CREDITS)
  ) {
    return compactBillingConfig({ mode: 'server', creditControlToken })
  }
  return compactBillingConfig({ mode: 'disabled', creditControlToken })
}

function normalizedOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function compactBillingConfig(config: BeeGameBillingConfig): BeeGameBillingConfig {
  return {
    mode: config.mode,
    ...(config.remoteApiBaseUrl ? { remoteApiBaseUrl: config.remoteApiBaseUrl } : {}),
    ...(config.creditControlToken ? { creditControlToken: config.creditControlToken } : {}),
  }
}
