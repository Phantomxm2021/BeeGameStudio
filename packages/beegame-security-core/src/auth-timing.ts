/** One upstream call. Runtime may need refresh followed by identity lookup. */
export function authRequestTimeoutMs(value?: number): number {
  const configured = value ?? Number(process.env.BEEGAME_AUTH_RESOLVE_TIMEOUT_MS || NaN)
  return Number.isFinite(configured) && configured > 0 ? configured : 8_000
}

/** Only bounds an already verified identity cache; never authenticates a JWT. */
export function verifiedTokenCacheUntil(token: string, ttlMs: number): number {
  const deadline = Date.now() + ttlMs
  if (token.split('.').length !== 3) return deadline
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? Math.min(deadline, payload.exp * 1_000) : Date.now()
  } catch { return Date.now() }
}
