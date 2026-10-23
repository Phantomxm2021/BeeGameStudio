import {
  createBeeGameBillingRouteApp,
} from '@bee-game-studio/beegame-billing-core/billing-app-factory'
import {
  resolveBeeGameBillingConfig,
  type BeeGameBillingConfig,
} from '@bee-game-studio/beegame-billing-core/billing-config'
import type {
  BeeGameBillingUserContext,
} from '@bee-game-studio/beegame-billing-core/billing-route-types'
import {
  createBeeGameBillingAuthContext,
  createConfiguredBillingUserResolver,
  hasBeeGameBillingPermission,
} from './auth'
import {
  createBeeGameSupabaseBillingRepositoryFromEnv,
  DEFAULT_USAGE_EVENTS_PAGE_SIZE,
  MAX_USAGE_EVENTS_PAGE_SIZE,
  type BeeGameBillingServerRepository,
} from './supabase-billing-repository'
import { createTLSAwareFetch } from '@bee-game-studio/security-core'

export type BeeGameBillingServerAppOptions = {
  billingConfig?: BeeGameBillingConfig
  currentUser?: BeeGameBillingUserContext
  currentUserResolver?: (
    request: Request,
  ) => BeeGameBillingUserContext | undefined | Promise<BeeGameBillingUserContext | undefined>
  repository?: BeeGameBillingServerRepository
}

export function createBeeGameBillingServerApp(
  options: BeeGameBillingServerAppOptions = {},
): ReturnType<typeof createBeeGameBillingRouteApp> {
  const serviceFetch = createTLSAwareFetch()
  const authContext = createBeeGameBillingAuthContext({
    currentUser: options.currentUser,
    currentUserResolver: options.currentUserResolver ?? createConfiguredBillingUserResolver(process.env, { fetchImpl: serviceFetch }),
  })
  const repository =
    options.repository ?? createBeeGameSupabaseBillingRepositoryFromEnv()
  const app = createBeeGameBillingRouteApp({
    billingConfig: options.billingConfig ?? resolveBeeGameBillingConfig(),
    dashboardRepository: repository,
    getCurrentUser: authContext.getCurrentUser,
    hasPermission: hasBeeGameBillingPermission,
    requireRequestUser: !options.currentUser,
    resolveRequestUser: authContext.resolveRequestUser,
    serviceName: 'beegame-billing',
  })
  app.get('/api/usage/events', async c => {
    const user = authContext.getCurrentUser(c.req.raw)
    const projectId = c.req.query('projectId')?.trim() || undefined
    const from = parseOptionalDate(c.req.query('from'))
    const to = parseOptionalDate(c.req.query('to'))
    if (from === null || to === null)
      return c.json({ error: 'Invalid usage date window' }, 400)
    const pagination = parseUsagePagination(c.req.query('offset'), c.req.query('limit'))
    if (!pagination) return c.json({ error: 'Invalid usage pagination' }, 400)
    const page = await repository.listUsageEventsPageForUser(
      user.id, projectId, from, to, pagination.offset, pagination.limit,
    )
    if (page.total !== null) c.header('X-Total-Count', String(page.total))
    const hasNextPage = page.total !== null
      ? page.total > pagination.offset + page.items.length
      : page.items.length === pagination.limit
    if (page.items.length > 0 && hasNextPage)
      c.header('X-Next-Offset', String(pagination.offset + page.items.length))
    return c.json(page.items)
  })
  app.get('/api/usage/summary', async c => {
    const user = authContext.getCurrentUser(c.req.raw)
    const projectId = c.req.query('projectId')?.trim() || undefined
    const from = parseOptionalDate(c.req.query('from'))
    const to = parseOptionalDate(c.req.query('to'))
    if (from === null || to === null)
      return c.json({ error: 'Invalid usage date window' }, 400)
    return c.json(await repository.getUsageSummaryForUser(user.id, projectId, from, to))
  })
  app.get('/api/usage-wallet', async c => {
    const user = authContext.getCurrentUser(c.req.raw)
    return c.json(await repository.getUsageWalletForUser(user.id))
  })
  return app
}

function parseOptionalDate(value: string | undefined): Date | undefined | null {
  if (!value?.trim()) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseUsagePagination(
  offsetValue: string | undefined,
  limitValue: string | undefined,
): { offset: number; limit: number } | null {
  const parse = (value: string | undefined, fallback: number, positive: boolean) => {
    if (!value?.trim()) return fallback
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || (positive ? parsed <= 0 : parsed < 0)) return null
    return parsed
  }
  const offset = parse(offsetValue, 0, false)
  const requestedLimit = parse(limitValue, DEFAULT_USAGE_EVENTS_PAGE_SIZE, true)
  if (offset === null || requestedLimit === null) return null
  return { offset, limit: Math.min(requestedLimit, MAX_USAGE_EVENTS_PAGE_SIZE) }
}
