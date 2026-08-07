export type ResourceExternalService = 'supabase' | 'resource-runtime' | 'resource-object'

export class ResourceExternalTransportError extends Error {
  readonly retryable = true

  constructor(
    readonly service: ResourceExternalService,
    readonly operation: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'ResourceExternalTransportError'
  }
}

const RETRYABLE_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'UNKNOWN_CERTIFICATE_VERIFICATION_ERROR',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
])

export function isResourceExternalTransportError(value: unknown): value is ResourceExternalTransportError {
  return value instanceof ResourceExternalTransportError
}

export async function withResourceExternalTransport<T>(options: {
  service: ResourceExternalService
  operation: string
  execute: () => Promise<T>
  attempts?: number
  sleep?: (milliseconds: number) => Promise<void>
}): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 3))
  const sleep = options.sleep ?? defaultSleep
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await options.execute()
    } catch (error) {
      lastError = error
      if (!isRetryableTransportCause(error)) throw error
      if (attempt === attempts) {
        throw new ResourceExternalTransportError(
          options.service,
          options.operation,
          `${options.service} ${options.operation} transport failed after ${attempts} attempts`,
          { cause: error },
        )
      }
      await sleep(transportBackoffMilliseconds(attempt))
    }
  }
  throw lastError
}

function isRetryableTransportCause(value: unknown): boolean {
  if (isResourceExternalTransportError(value)) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as { code?: unknown; cause?: unknown; error?: unknown }
  if (typeof record.code === 'string' && RETRYABLE_ERROR_CODES.has(record.code)) return true
  return isRetryableTransportCause(record.cause) || isRetryableTransportCause(record.error)
}

function transportBackoffMilliseconds(attempt: number): number {
  return attempt === 1 ? 200 : 800
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
