export class ProviderCompletionError extends Error {
  constructor() {
    super('Provider response ended without a completion reason')
    this.name = 'ProviderCompletionError'
  }
}

export function assertProviderCompletionReason(
  value: unknown,
): asserts value is string {
  if (typeof value !== 'string' || !value.trim())
    throw new ProviderCompletionError()
}
