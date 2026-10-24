export const BEEGAME_MODEL_BILLING_SOURCE = 'BEEGAME_MODEL_BILLING_SOURCE' as const

export const MODEL_BILLING_SOURCES = [
  'platform',
  'byok',
  'chatgpt-subscription',
] as const

export type ModelBillingSource = (typeof MODEL_BILLING_SOURCES)[number]

/**
 * Only BGS-provided platform access is billable. BYOK includes personal
 * key-authenticated plans such as OpenCode Go; provider brands do not set cost ownership.
 * Billing provenance is host-owned. Missing or unrecognized values must not
 * turn a caller-supplied runtime environment into a personal-billing path.
 */
export function getModelBillingSource(
  env: Readonly<Record<string, unknown>> | undefined,
): ModelBillingSource {
  const source = env?.[BEEGAME_MODEL_BILLING_SOURCE]
  return source === 'byok' || source === 'chatgpt-subscription'
    ? source
    : 'platform'
}

export function isPersonalModelBillingSource(
  source: ModelBillingSource,
): boolean {
  return source === 'byok' || source === 'chatgpt-subscription'
}
