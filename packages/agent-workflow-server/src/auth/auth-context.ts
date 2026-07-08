import type {
  BeeGameUserContext,
  BeeGameUserResolver,
} from './user-context'

export type BeeGameAuthContextOptions = {
  currentUser?: BeeGameUserContext
  currentUserResolver?: BeeGameUserResolver
  userResolveTimeoutMs?: number
}

export type BeeGameAuthContext = {
  resolveRequestUser: (request: Request) => Promise<BeeGameUserContext | undefined>
  getCurrentUser: (request?: Request) => BeeGameUserContext
}

export function createBeeGameAuthContext(
  options: BeeGameAuthContextOptions,
): BeeGameAuthContext {
  const requestUsers = new WeakMap<Request, BeeGameUserContext>()
  const userResolveTimeoutMs = normalizeAuthResolveTimeoutMs(
    options.userResolveTimeoutMs,
  )

  return {
    resolveRequestUser: async (request) => {
      if (options.currentUser) return options.currentUser
      const user = options.currentUserResolver
        ? await resolveUserWithTimeout(
            options.currentUserResolver(request),
            userResolveTimeoutMs,
          )
        : undefined
      if (user) requestUsers.set(request, user)
      return user
    },

    getCurrentUser: (request) => {
      const user =
        options.currentUser ??
        (request ? requestUsers.get(request) : undefined)
      if (!user) throw new Error('Authenticated BeeGame user is required')
      return user
    },
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
      new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function normalizeAuthResolveTimeoutMs(value: number | undefined): number {
  const configured = value ?? Number.parseInt(
    process.env.BEEGAME_AUTH_RESOLVE_TIMEOUT_MS ?? '',
    10,
  )
  return Number.isFinite(configured) && configured >= 0 ? configured : 3_000
}
