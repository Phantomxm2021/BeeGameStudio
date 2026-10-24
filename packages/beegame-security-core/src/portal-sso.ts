// Shared by BGS and the Portal Worker. The envelope keeps access tokens out of
// page scripts/URLs and binds grants, cookies and state to distinct audiences.
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const decode = (value: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw Error('Invalid envelope')
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
}
async function key(secret: string) {
  const bytes = decode(secret)
  if (bytes.length !== 32) throw Error('Portal SSO key must contain 32 bytes')
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export function portalNonce(): string {
  return encode(crypto.getRandomValues(new Uint8Array(32)))
}
export async function sealPortalPayload(secret: string, purpose: string, payload: { expiresAt: number; [key: string]: unknown }): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(purpose) }, await key(secret), encoder.encode(JSON.stringify(payload)))
  return `${encode(iv)}.${encode(new Uint8Array(ciphertext))}`
}
export async function openPortalPayload(secret: string, purpose: string, value: string): Promise<Record<string, unknown> | null> {
  try {
    if (value.length > 8192) return null
    const [iv, ciphertext, extra] = value.split('.')
    if (!iv || !ciphertext || extra || decode(iv).length !== 12) return null
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: encoder.encode(purpose) }, await key(secret), decode(ciphertext))
    const payload = JSON.parse(decoder.decode(plaintext))
    return payload && typeof payload === 'object' && typeof payload.expiresAt === 'number' && Number.isFinite(payload.expiresAt) && payload.expiresAt > Date.now() ? payload : null
  } catch { return null }
}
export function portalTokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(decoder.decode(decode(token.split('.')[1] || '')))
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp * 1000 : 0
  } catch { return 0 }
}
