/** Never serialize exception messages, stacks, URLs, bodies or credentials. */
export function safeErrorFacts(error: unknown): { httpStatus?: number; networkCode?: string } {
  const facts: { httpStatus?: number; networkCode?: string } = {}
  const networkCodes = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
    'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ])
  try {
    // Bounded cause traversal handles fetch errors without copying raw causes.
    for (let depth = 0; depth < 3 && error && typeof error === 'object'; depth++) {
      const value = error as { status?: unknown; code?: unknown; cause?: unknown }
      if (facts.httpStatus === undefined && typeof value.status === 'number' &&
          Number.isInteger(value.status) && value.status >= 100 && value.status <= 599)
        facts.httpStatus = value.status
      if (facts.networkCode === undefined && typeof value.code === 'string' && networkCodes.has(value.code))
        facts.networkCode = value.code
      error = value.cause
    }
  } catch { /* Diagnostics must not turn malformed errors into new failures. */ }
  return facts
}
