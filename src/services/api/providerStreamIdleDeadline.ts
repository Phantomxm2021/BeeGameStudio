export class ProviderStreamIdleError extends Error {
  readonly retryable = false

  constructor(readonly timeoutMs: number) {
    super(`Provider SSE stream produced no events for ${timeoutMs}ms`)
    this.name = 'ProviderStreamIdleError'
  }
}

export const DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS = 180_000

export function resolveProviderStreamIdleTimeoutMs(
  configured: string | undefined,
): number {
  const parsed = Number.parseInt(configured ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS
}

/**
 * Applies the idle deadline to each iterator read. Cancelling the provider SDK
 * response is best effort only: compatible gateways can leave next() pending
 * after their socket stops delivering SSE. Racing next() itself guarantees
 * that the native runtime regains control and can report the transport error.
 */
export async function* withProviderStreamIdleDeadline<T>(
  input: AsyncIterable<T>,
  options: Readonly<{
    timeoutMs: number
    warningMs?: number
    onWarning?(): void
    onTimeout?(): void
  }>,
): AsyncGenerator<T> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    throw new Error('Provider stream idle timeout must be positive')
  const iterator = input[Symbol.asyncIterator]()
  try {
    for (;;) {
      let warningTimer: ReturnType<typeof setTimeout> | undefined
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_resolve, reject) => {
        if (
          options.onWarning &&
          options.warningMs !== undefined &&
          options.warningMs > 0 &&
          options.warningMs < options.timeoutMs
        )
          warningTimer = setTimeout(options.onWarning, options.warningMs)
        timeoutTimer = setTimeout(() => {
          options.onTimeout?.()
          reject(new ProviderStreamIdleError(options.timeoutMs))
        }, options.timeoutMs)
      })
      let result: IteratorResult<T>
      try {
        result = await Promise.race([iterator.next(), timeout])
      } finally {
        if (warningTimer !== undefined) clearTimeout(warningTimer)
        if (timeoutTimer !== undefined) clearTimeout(timeoutTimer)
      }
      if (result.done) return
      yield result.value
    }
  } finally {
    void iterator.return?.()
  }
}
