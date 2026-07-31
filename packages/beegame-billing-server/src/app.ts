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
  type BeeGameBillingServerRepository,
} from './supabase-billing-repository'

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
  const authContext = createBeeGameBillingAuthContext({
    currentUser: options.currentUser,
    currentUserResolver: options.currentUserResolver ?? createConfiguredBillingUserResolver(),
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
    const events = await repository.listUsageEventsForUser(user.id, projectId)
    return c.json(
      events.filter(event => {
        const createdAt = new Date(event.createdAt)
        if (from && createdAt < from) return false
        if (to && createdAt > to) return false
        return true
      }),
    )
  })
  app.get('/api/usage/summary', async c => {
    const user = authContext.getCurrentUser(c.req.raw)
    const projectId = c.req.query('projectId')?.trim() || undefined
    const from = parseOptionalDate(c.req.query('from'))
    const to = parseOptionalDate(c.req.query('to'))
    if (from === null || to === null)
      return c.json({ error: 'Invalid usage date window' }, 400)
    const events = (await repository.listUsageEventsForUser(user.id, projectId))
      .filter(event => {
        const createdAt = new Date(event.createdAt)
        if (from && createdAt < from) return false
        if (to && createdAt > to) return false
        return true
      })
    return c.json(events.reduce((summary, event) => ({
      eventsCount: summary.eventsCount + 1,
      promptTokens: summary.promptTokens + event.delta.prompt_tokens,
      completionTokens: summary.completionTokens + event.delta.completion_tokens,
      cacheReadTokens: summary.cacheReadTokens + event.delta.cache_read_tokens,
      cacheCreationTokens: summary.cacheCreationTokens + event.delta.cache_creation_tokens,
      totalTokens: summary.totalTokens + event.delta.total_tokens,
      weightedTokens: summary.weightedTokens + event.weightedTokensDelta,
      creditsMicro: summary.creditsMicro + event.creditsMicro,
    }), {
      eventsCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      weightedTokens: 0,
      creditsMicro: 0,
    }))
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
