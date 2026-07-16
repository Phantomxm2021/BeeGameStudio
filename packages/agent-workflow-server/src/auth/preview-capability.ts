import { randomBytes } from 'node:crypto'

const COOKIE_NAME = 'beegame_preview_capability'

type PreviewCapability = {
  sessionId: string
  userId: string
}

export type PreviewCapabilityManager = {
  issueCookie(request: Request, sessionId: string, userId: string): string
  verifyRequest(request: Request, sessionId: string): { userId: string } | undefined
  allowsSandboxedSubresource(request: Request, sessionId: string): boolean
  revokeSession(sessionId: string): void
}

export function createPreviewCapabilityManager(): PreviewCapabilityManager {
  const capabilities = new Map<string, PreviewCapability>()
  const activeSessions = new Set<string>()

  return {
    issueCookie(request, sessionId, userId) {
      const token = randomBytes(32).toString('base64url')
      capabilities.set(token, { sessionId, userId })
      activeSessions.add(sessionId)
      const secure = requestIsSecure(request) ? '; Secure' : ''
      return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=${previewPath(sessionId)}${secure}`
    },

    verifyRequest(request, sessionId) {
      const token = readCookie(request, COOKIE_NAME)
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
        if (capability.sessionId === sessionId) capabilities.delete(token)
      }
    },
  }
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
