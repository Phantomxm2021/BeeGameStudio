import type {
  BeeGameBillingRouteRepository,
} from './billing-ports'
import type {
  BeeGameBillingConfig,
} from './billing-config'

export type BeeGameBillingUserContext = {
  id: string
  role?: string
  permissions?: string[]
  email?: string
}

export type BillingRouteDeps = {
  billingConfig: BeeGameBillingConfig
  dashboardRepository: BeeGameBillingRouteRepository
  getCurrentUser: (request?: Request) => BeeGameBillingUserContext
  hasPermission: (
    user: BeeGameBillingUserContext,
    permission: 'audit.read',
  ) => boolean
}
