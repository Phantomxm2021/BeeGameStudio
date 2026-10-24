import * as auth from '../../frontend/src/services/supabaseAuthApi'
import type { BeeGameSupabaseSession } from '../../frontend/src/services/supabaseAuthApi'

// A BGS handoff restores a host-only HttpOnly Portal session. Neither its access
// token nor the original BGS refresh token is exposed to browser JavaScript.
let bgsSession: BeeGameSupabaseSession | null = null
export async function initializeSupabaseSession() {
  const response = await fetch('/api/auth/bgs/session', { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
  if (response.ok) {
    const value = await response.json()
    bgsSession = { accessToken: '', expiresAt: value.expiresAt, user: value.user }
    sessionStorage.removeItem('beeplay_bgs_auto_attempt')
    return bgsSession
  }
  if (response.status !== 401) throw Error('Unable to restore BeePlay session')
  bgsSession = null
  return auth.initializeSupabaseSession()
}
export const hasBgsPortalSession = () => bgsSession !== null
export const getSupabaseSessionUser = () => bgsSession?.user || auth.getSupabaseSessionUser()
export const getValidSupabaseAccessToken = () => bgsSession ? Promise.resolve('') : auth.getValidSupabaseAccessToken()
export const signInWithSupabasePassword = auth.signInWithSupabasePassword
export const signInWithSupabaseOAuth = auth.signInWithSupabaseOAuth
export async function clearSupabaseSession() {
  if (bgsSession) {
    const response = await fetch('/api/auth/bgs/logout', { method: 'POST', signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw Error('Unable to sign out')
  }
  bgsSession = null
  sessionStorage.setItem('beeplay_bgs_auto_attempt', 'signed-out')
  auth.clearSupabaseSession()
}
