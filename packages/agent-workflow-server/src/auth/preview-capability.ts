import { randomBytes } from 'node:crypto'

const COOKIE_NAME = 'beegame_preview_capability'
export const PREVIEW_CAPABILITY_QUERY_PARAM = '__beegame_preview_capability'

type PreviewCapability = {
  sessionId: string
  userId: string
}

export type PreviewCapabilityManager = {
  issueCookie(request: Request, sessionId: string, userId: string): string
  issueUrl(url: string, sessionId: string, userId: string): string
  verifyRequest(request: Request, sessionId: string): { userId: string } | undefined
  allowsSandboxedSubresource(request: Request, sessionId: string): boolean
  revokeSession(sessionId: string): void
}

export function createPreviewCapabilityManager(): PreviewCapabilityManager {
  const capabilities = new Map<string, PreviewCapability>()
  const tokensBySessionOwner = new Map<string, string>()
  const activeSessions = new Set<string>()

  const issueToken = (sessionId: string, userId: string): string => {
    const ownerKey = sessionOwnerKey(sessionId, userId)
    const existing = tokensBySessionOwner.get(ownerKey)
    if (existing && capabilities.has(existing)) return existing
    const token = randomBytes(32).toString('base64url')
    capabilities.set(token, { sessionId, userId })
    tokensBySessionOwner.set(ownerKey, token)
    activeSessions.add(sessionId)
    return token
  }

  return {
    issueCookie(request, sessionId, userId) {
      const token = issueToken(sessionId, userId)
      const secure = requestIsSecure(request) ? '; Secure' : ''
      return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=${previewPath(sessionId)}${secure}`
    },

    issueUrl(url, sessionId, userId) {
      if (!url) return url
      const token = issueToken(sessionId, userId)
      const parsed = new URL(url, 'http://beegame.invalid')
      parsed.searchParams.set(PREVIEW_CAPABILITY_QUERY_PARAM, token)
      if (hasAbsoluteScheme(url)) return parsed.toString()
      return `${parsed.pathname}${parsed.search}${parsed.hash}`
    },

    verifyRequest(request, sessionId) {
      const token = new URL(request.url).searchParams.get(PREVIEW_CAPABILITY_QUERY_PARAM) ||
        readCookie(request, COOKIE_NAME)
      if (!token) return undefined
      const capability = capabilities.get(token)
      if (!capability || capability.sessionId !== sessionId) return undefined
      return { userId: capability.userId }
    },

    allowsSandboxedSubresource(request, sessionId) {
      return activeSessions.has(sessionId) && isSandboxedSubresourceRequest(request)
    },

    revokeSession(sessionId) {
      activeSessions.delete(sessionId)
      for (const [token, capability] of capabilities) {
        if (capability.sessionId !== sessionId) continue
        capabilities.delete(token)
        tokensBySessionOwner.delete(sessionOwnerKey(capability.sessionId, capability.userId))
      }
    },
  }
}

function sessionOwnerKey(sessionId: string, userId: string): string {
  return `${sessionId}\u0000${userId}`
}

function hasAbsoluteScheme(url: string): boolean {
  const colon = url.indexOf(':')
  if (colon <= 0) return false
  for (let index = 0; index < colon; index += 1) {
    const code = url.charCodeAt(index)
    const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
    const isDigit = code >= 48 && code <= 57
    if (!isLetter && !(index > 0 && (isDigit || code === 43 || code === 45 || code === 46))) {
      return false
    }
  }
  return true
}

function previewPath(sessionId: string): string {
  return `/previews/${encodeURIComponent(sessionId)}/`
}

function requestIsSecure(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',', 1)[0]?.trim()
  return forwarded === 'https' || new URL(request.url).protocol === 'https:'
}

function isSandboxedSubresourceRequest(request: Request): boolean {
  const method = request.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') return false
  const mode = request.headers.get('sec-fetch-mode') ?? ''
  const destination = request.headers.get('sec-fetch-dest') ?? ''
  if (mode === 'navigate' || destination === 'document' || destination === 'iframe') return false
  return request.headers.get('origin') === 'null' || Boolean(destination)
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    return part.slice(separator + 1).trim() || undefined
  }
  return undefined
}
