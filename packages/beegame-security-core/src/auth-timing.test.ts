import { expect, test } from 'bun:test'
import { authRequestTimeoutMs, verifiedTokenCacheUntil } from './auth-timing'

test('auth timeouts remain bounded even for invalid configuration', () => {
  expect(authRequestTimeoutMs(10)).toBe(10)
  expect(authRequestTimeoutMs(0)).toBe(8000)
  expect(authRequestTimeoutMs(NaN)).toBe(8000)
})

test('verified JWT cache is capped by expiry and malformed JWTs are not cached', () => {
  const exp = Math.floor(Date.now() / 1000) + 1
  const token = `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`
  expect(verifiedTokenCacheUntil(token, 15000)).toBe(exp * 1000)
  expect(verifiedTokenCacheUntil('not.a.jwt', 15000)).toBeLessThanOrEqual(Date.now())
})
