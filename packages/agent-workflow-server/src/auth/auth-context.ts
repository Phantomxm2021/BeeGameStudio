import type {
  BeeGameUserContext,
  BeeGameUserResolver,
} from './user-context'
import { BeeGameAuthUnavailableError, getBearerToken } from './user-context'
import { authRequestTimeoutMs } from '@bee-game-studio/security-core'

export type BeeGameAuthContextOptions = {
  currentUser?: BeeGameUserContext
  currentUserResolver?: BeeGameUserResolver
  resolveAccessToken?: (request: Request) => Promise<string | undefined>
  userResolveTimeoutMs?: number
}

export type BeeGameAuthContext = {
  resolveRequestUser: (request: Request) => Promise<BeeGameUserContext | undefined>
  getCurrentUser: (request?: Request) => BeeGameUserContext
  getAccessToken: (request: Request) => string | undefined
}

export function createBeeGameAuthContext(
  options: BeeGameAuthContextOptions,
): BeeGameAuthContext {
  // Identity and its credential belong to the same request. Re-reading the
  // session later can cross its refresh boundary or select a stale bearer.
  const requestAuth = new WeakMap<Request, { user: BeeGameUserContext; accessToken?: string }>()
  const userResolveTimeoutMs = normalizeAuthResolveTimeoutMs(
    options.userResolveTimeoutMs,
  )

  return {
    resolveRequestUser: async (request) => {
      if (options.currentUser) return options.currentUser
      requestAuth.delete(request)
      let accessToken: string | undefined
      const user = options.currentUserResolver
        ? await resolveUserWithTimeout(
            (async () => {
              accessToken = options.resolveAccessToken
                ? await options.resolveAccessToken(request)
                : getBearerToken(request)
              let identityRequest = request
              if (options.resolveAccessToken) {
                identityRequest = new Request(request)
                identityRequest.headers.delete('authorization')
                if (accessToken) identityRequest.headers.set('authorization', `Bearer ${accessToken}`)
              }
              return options.currentUserResolver!(identityRequest)
            })(),
            userResolveTimeoutMs,
          )
        : undefined
      if (user) requestAuth.set(request, { user, accessToken })
      return user
    },

    getCurrentUser: (request) => {
      const user =
        options.currentUser ??
        (request ? requestAuth.get(request)?.user : undefined)
      if (!user) throw new Error('Authenticated BeeGame user is required')
      return user
    },
    getAccessToken: request => options.currentUser
      ? getBearerToken(request)
      : requestAuth.get(request)?.accessToken,
  }
}

async function resolveUserWithTimeout(
  user: BeeGameUserContext | undefined | Promise<BeeGameUserContext | undefined>,
  timeoutMs: number,
): Promise<BeeGameUserContext | undefined> {
  if (timeoutMs <= 0) return await user
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      user,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new BeeGameAuthUnavailableError(undefined, 'timeout')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function normalizeAuthResolveTimeoutMs(value: number | undefined): number {
  // A cold request can perform two bounded calls: refresh, then identity.
  return value ?? 2 * authRequestTimeoutMs()
}
