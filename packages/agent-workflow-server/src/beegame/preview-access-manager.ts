import { randomUUID } from 'node:crypto'

export type PreviewAccessSubject = {
  userId: string
  projectId: string
  sessionId: string
  generation: number
}

export type PreviewAccessTarget = Pick<PreviewAccessSubject, 'sessionId' | 'generation'>

export type PreviewAccessGrant = {
  token: string
  expiresAt: string
}

export type PreviewAccessSession = PreviewAccessSubject & {
  token: string
  expiresAt: string
}

type StoredAccess = PreviewAccessSubject & {
  expiresAtMs: number
}

export type PreviewAccessManagerOptions = {
  now?: () => Date
  randomId?: () => string
  ttlMs?: number
}

const DEFAULT_TTL_MS = 5 * 60 * 1_000

export class PreviewAccessManager {
  private readonly grants = new Map<string, StoredAccess>()
  private readonly sessions = new Map<string, StoredAccess>()
  private readonly now: () => Date
  private readonly randomId: () => string
  private readonly ttlMs: number

  constructor(options: PreviewAccessManagerOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.randomId = options.randomId ?? randomUUID
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  }

  issue(subject: PreviewAccessSubject): PreviewAccessGrant {
    const token = this.randomId()
    const expiresAtMs = this.now().getTime() + this.ttlMs
    this.grants.set(token, { ...subject, expiresAtMs })
    return { token, expiresAt: new Date(expiresAtMs).toISOString() }
  }

  consumeGrant(token: string, target: PreviewAccessTarget): PreviewAccessSession | undefined {
    const grant = this.grants.get(token)
    this.grants.delete(token)
    if (!grant || !matchesTarget(grant, target) || this.isExpired(grant)) return undefined
    const sessionToken = this.randomId()
    this.sessions.set(sessionToken, grant)
    return toSession(sessionToken, grant)
  }

  authorize(token: string | undefined, target: PreviewAccessTarget): PreviewAccessSession | undefined {
    if (!token) return undefined
    const session = this.sessions.get(token)
    if (!session || !matchesTarget(session, target) || this.isExpired(session)) {
      this.sessions.delete(token)
      return undefined
    }
    return toSession(token, session)
  }

  revoke(sessionId: string): void {
    removeForSession(this.grants, sessionId)
    removeForSession(this.sessions, sessionId)
  }

  private isExpired(access: StoredAccess): boolean {
    return access.expiresAtMs <= this.now().getTime()
  }
}

function matchesTarget(access: StoredAccess, target: PreviewAccessTarget): boolean {
  return access.sessionId === target.sessionId && access.generation === target.generation
}

function toSession(token: string, access: StoredAccess): PreviewAccessSession {
  return {
    token,
    userId: access.userId,
    projectId: access.projectId,
    sessionId: access.sessionId,
    generation: access.generation,
    expiresAt: new Date(access.expiresAtMs).toISOString(),
  }
}

function removeForSession(entries: Map<string, StoredAccess>, sessionId: string): void {
  for (const [token, access] of entries) {
    if (access.sessionId === sessionId) entries.delete(token)
  }
}
