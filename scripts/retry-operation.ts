export async function retryOperation<T>(
  operation: () => Promise<T>,
  options: {
    attempts?: number
    baseDelayMs?: number
    sleep?: (delayMs: number) => Promise<void>
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? 4
  const baseDelayMs = options.baseDelayMs ?? 250
  if (!Number.isSafeInteger(attempts) || attempts < 1)
    throw new Error('Retry attempts must be a positive integer')
  const sleep =
    options.sleep ??
    ((delayMs: number) =>
      new Promise<void>(resolve => setTimeout(resolve, delayMs)))
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt === attempts) break
      await sleep(baseDelayMs * 2 ** (attempt - 1))
    }
  }
  throw lastError
}
