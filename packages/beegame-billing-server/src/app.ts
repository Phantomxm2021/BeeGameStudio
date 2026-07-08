import {
  createBeeGameBillingRouteApp,
} from '@claude-code-best/beegame-billing-core/billing-app-factory'
import {
  resolveBeeGameBillingConfig,
  type BeeGameBillingConfig,
} from '@claude-code-best/beegame-billing-core/billing-config'
import type {
  BeeGameBillingUserContext,
} from '@claude-code-best/beegame-billing-core/billing-route-types'
import {
  createBeeGameBillingAuthContext,
  createConfiguredBillingUserResolver,
  hasBeeGameBillingPermission,
} from './auth'
import {
  createBeeGameSupabaseBillingRepositoryFromEnv,
} from './supabase-billing-repository'

export type BeeGameBillingServerAppOptions = {
  billingConfig?: BeeGameBillingConfig
  currentUser?: BeeGameBillingUserContext
  currentUserResolver?: (
    request: Request,
  ) => BeeGameBillingUserContext | undefined | Promise<BeeGameBillingUserContext | undefined>
}

export function createBeeGameBillingServerApp(
  options: BeeGameBillingServerAppOptions = {},
): ReturnType<typeof createBeeGameBillingRouteApp> {
  const authContext = createBeeGameBillingAuthContext({
    currentUser: options.currentUser,
    currentUserResolver: options.currentUserResolver ?? createConfiguredBillingUserResolver(),
  })
  return createBeeGameBillingRouteApp({
    billingConfig: options.billingConfig ?? resolveBeeGameBillingConfig(),
    dashboardRepository: createBeeGameSupabaseBillingRepositoryFromEnv(),
    getCurrentUser: authContext.getCurrentUser,
    hasPermission: hasBeeGameBillingPermission,
    requireRequestUser: !options.currentUser,
    resolveRequestUser: authContext.resolveRequestUser,
    serviceName: 'beegame-billing',
  })
}
