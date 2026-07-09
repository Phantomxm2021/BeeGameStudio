import {
  createBeeGameAuthContext,
} from './auth/auth-context'
import {
  type BeeGameUserContext,
  type BeeGameUserResolver,
  createConfiguredUserResolver,
  hasBeeGamePermission,
} from './auth/user-context'
import {
  resolveBeeGameBillingConfig,
  type BeeGameBillingConfig,
} from '@bee-game-studio/beegame-billing-core/billing-config'
import {
  resolveBeeGameSkillsConfig,
} from '@bee-game-studio/beegame-skills-core/config'
import type {
  BeeGameBillingAppFactoryOptions,
} from './billing-app-factory'
import {
  DashboardRepository,
} from './dashboard-repository'
import {
  getDashboardDataRoot,
  getUserDashboardDataRoot,
} from './local-runtime-service'
import {
  createSupabaseDashboardStoreFromEnv,
  createSupabasePaymentProviderGrantStoreFromEnv,
} from './supabase-dashboard-store'

export type BeeGameBillingRuntimeOptions = {
  dashboardDataRoot?: string
  billingConfig?: BeeGameBillingConfig
  currentUser?: BeeGameUserContext
  currentUserResolver?: BeeGameUserResolver
}

export function createBeeGameBillingRuntimeDeps(
  options: BeeGameBillingRuntimeOptions = {},
): BeeGameBillingAppFactoryOptions {
  const dashboardDataRoot = getDashboardDataRoot(options.dashboardDataRoot)
  const supabaseStore = createSupabaseDashboardStoreFromEnv()
  const supabasePaymentProviderStore = createSupabasePaymentProviderGrantStoreFromEnv()
  const authContext = createBeeGameAuthContext({
    currentUser: options.currentUser,
    currentUserResolver: options.currentUserResolver ?? createConfiguredUserResolver(),
  })
  const getCurrentUser = authContext.getCurrentUser
  const dashboardRepository = new DashboardRepository({
    dashboardDataRoot,
    supabaseStore,
    supabasePaymentProviderStore,
    getUserDataRoot: request =>
      getUserDashboardDataRoot(dashboardDataRoot, getCurrentUser(request).id),
    modelConfigStore: false,
    skillsConfig: resolveBeeGameSkillsConfig(),
  })

  return {
    billingConfig: options.billingConfig ?? resolveBeeGameBillingConfig(),
    dashboardRepository,
    getCurrentUser,
    hasPermission: (user, permission) =>
      hasBeeGamePermission(user as BeeGameUserContext, permission),
    requireRequestUser: !options.currentUser,
    resolveRequestUser: authContext.resolveRequestUser,
  }
}
