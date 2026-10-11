const PRODUCT_MODEL_KEYS = {
  opus: 'BGS_DEFAULT_STRONG_MODEL',
  sonnet: 'BGS_DEFAULT_BALANCED_MODEL',
  haiku: 'BGS_DEFAULT_FAST_MODEL',
} as const

/** Shared family override; an explicit BGS empty value disables its legacy alias. */
export function getSharedModelDefault(family: keyof typeof PRODUCT_MODEL_KEYS): string | undefined {
  return process.env[PRODUCT_MODEL_KEYS[family]] ??
    process.env[`ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`]
}

export function getSharedModelDefaultKey(family: keyof typeof PRODUCT_MODEL_KEYS): string {
  return PRODUCT_MODEL_KEYS[family]
}
