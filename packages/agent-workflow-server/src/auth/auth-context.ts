import type {
  BeeGameUserContext,
  BeeGameUserResolver,
} from './user-context'

export type BeeGameAuthContextOptions = {
  currentUser?: BeeGameUserContext
  currentUserResolver?: BeeGameUserResolver
}

export type BeeGameAuthContext = {
  resolveRequestUser: (request: Request) => Promise<BeeGameUserContext | undefined>
  getCurrentUser: (request?: Request) => BeeGameUserContext
}

export function createBeeGameAuthContext(
  options: BeeGameAuthContextOptions,
): BeeGameAuthContext {
  const requestUsers = new WeakMap<Request, BeeGameUserContext>()

  return {
    resolveRequestUser: async (request) => {
      if (options.currentUser) return options.currentUser
      const user = options.currentUserResolver
        ? await options.currentUserResolver(request)
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
